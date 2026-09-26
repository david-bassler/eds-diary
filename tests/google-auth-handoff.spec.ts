import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const ACTION_ID = 'playwright_auth_action_000000000001'
const CREDENTIAL_SENTINEL = 'playwright-oauth-credential-sentinel'
const PERMISSION_ID = 'playwright-provider-identity'

async function installProviderSimulator(context: BrowserContext, options: { rejectPopupIdentity?: boolean; rejectConfirmation?: boolean; stallConfirmation?: boolean } = {}): Promise<void> {
  let identityRequests = 0
  await context.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.google={accounts:{oauth2:{initTokenClient(options){return{requestAccessToken(){options.callback({access_token:${JSON.stringify(CREDENTIAL_SENTINEL)},expires_in:3600})}}}}}};`,
    })
  })
  await context.route('https://www.googleapis.com/**', async (route) => {
    identityRequests += 1
    const authorization = await route.request().headerValue('authorization')
    if (authorization !== `Bearer ${CREDENTIAL_SENTINEL}`) {
      await route.fulfill({ status: 401, json: { error: { message: 'missing simulator credential' } } })
      return
    }
    if (options.rejectPopupIdentity && identityRequests === 1) {
      await route.fulfill({ status: 503, json: { error: { message: 'simulated popup identity failure' } } })
      return
    }
    if (options.stallConfirmation && identityRequests === 2) return
    if (options.rejectConfirmation && identityRequests === 2) {
      await route.fulfill({ status: 503, json: { error: { message: 'simulated confirmation failure' } } })
      return
    }
    await route.fulfill({ json: { user: { permissionId: PERMISSION_ID } } })
  })
}

async function beginProductiveAuthentication(page: Page, timeoutMs = 120_000): Promise<void> {
  await page.evaluate(async ({ actionId, timeout }) => {
    const { GoogleAuthProvider } = await import('/src/sync/google/GoogleAuthProvider.ts')
    const provider = new GoogleAuthProvider('/google-auth/', timeout)
    const state = window as typeof window & {
      authProvider?: InstanceType<typeof GoogleAuthProvider>
      authResult?: Promise<unknown>
      authPopup?: Window | null
    }
    const open = window.open.bind(window)
    window.open = (...args) => {
      const popup = open(...args)
      state.authPopup = popup
      return popup
    }
    state.authProvider = provider
    state.authResult = provider.authenticate(actionId)
  }, { actionId: ACTION_ID, timeout: timeoutMs })
}

async function persistentText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const values = [document.documentElement.textContent ?? '', localStorage.toString(), sessionStorage.toString()]
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? ''
        values.push(key, storage.getItem(key) ?? '')
      }
    }
    const databases = await indexedDB.databases()
    values.push(JSON.stringify(databases))
    return values.join('\n')
  })
}

test.describe('productive Auth-Origin handoff', () => {
  test('reproduces the post-OAuth hang when bridge identity confirmation never returns', async ({ context, page }) => {
    await installProviderSimulator(context, { stallConfirmation: true })
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await beginProductiveAuthentication(page, 3_000)
    const popup = await popupPromise
    await popup.getByRole('button', { name: 'Mit Google anmelden' }).click()
    await expect(popup.getByRole('status')).toHaveText('Identität wird gebunden …')

    const outcome = await page.evaluate(async () => {
      const state = window as typeof window & { authResult?: Promise<unknown> }
      return state.authResult!.then(() => 'resolved', (error) => error instanceof Error ? error.message : 'rejected')
    })
    expect(outcome).toBe('Google authentication handoff timed out.')
    expect(await persistentText(page)).not.toContain(CREDENTIAL_SENTINEL)
    await page.evaluate(async () => {
      const state = window as typeof window & { authProvider?: { disconnect(): Promise<void> } }
      await state.authProvider?.disconnect()
    })
  })

  test('propagates bridge identity-confirmation failure without waiting for the outer timeout', async ({ context, page }) => {
    await installProviderSimulator(context, { rejectConfirmation: true })
    await page.goto('/')
    const popupPromise = page.waitForEvent('popup')
    await beginProductiveAuthentication(page, 30_000)
    const popup = await popupPromise
    await popup.getByRole('button', { name: 'Mit Google anmelden' }).click()
    const startedAt = Date.now()
    const outcome = await page.evaluate(async () => {
      const state = window as typeof window & { authResult?: Promise<unknown> }
      return state.authResult!.then(() => 'resolved', (error) => error instanceof Error ? error.message : 'rejected')
    })
    expect(outcome).toBe('Google authentication bridge rejected the secure handoff.')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(await persistentText(page)).not.toContain(CREDENTIAL_SENTINEL)
  })

  test('propagates popup identity failure through the bridge without waiting for the outer timeout', async ({ context, page }) => {
    await installProviderSimulator(context, { rejectPopupIdentity: true })
    await page.goto('/')
    const popupPromise = page.waitForEvent('popup')
    await beginProductiveAuthentication(page, 30_000)
    const popup = await popupPromise
    await popup.getByRole('button', { name: 'Mit Google anmelden' }).click()
    const startedAt = Date.now()
    const outcome = await page.evaluate(async () => {
      const state = window as typeof window & { authResult?: Promise<unknown> }
      return state.authResult!.then(() => 'resolved', (error) => error instanceof Error ? error.message : 'rejected')
    })
    expect(outcome).toBe('Google authentication bridge rejected the secure handoff.')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(await persistentText(page)).not.toContain(CREDENTIAL_SENTINEL)
  })

  test('completes popup-to-bridge handoff and the first provider RPC', async ({ context, page }) => {
    await installProviderSimulator(context)
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await beginProductiveAuthentication(page)
    const popup = await popupPromise
    await popup.evaluate(({ actionId }) => {
      window.opener!.postMessage({ type: 'eds-diary/google-auth-ready/v2', action_id: `${actionId}-stale` }, 'http://127.0.0.1:4173')
    }, { actionId: ACTION_ID })
    const staleActionOutcome = await page.evaluate(async () => {
      const state = window as typeof window & { authResult?: Promise<unknown> }
      return Promise.race([
        state.authResult!.then(() => 'settled', () => 'settled'),
        new Promise<'pending'>((resolve) => window.setTimeout(() => resolve('pending'), 100)),
      ])
    })
    expect(staleActionOutcome).toBe('pending')
    await popup.getByRole('button', { name: 'Mit Google anmelden' }).click()

    const result = await page.evaluate(async () => {
      const state = window as typeof window & {
        authProvider?: {
          getApiClient(): { request<T>(url: string): Promise<T> }
          getIdentityBinding(): unknown
        }
        authResult?: Promise<unknown>
      }
      const binding = await state.authResult
      const value = await state.authProvider!.getApiClient().request<{ user: { permissionId: string } }>(
        'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)',
      )
      return { binding, value, iframeCount: document.querySelectorAll('iframe').length }
    })
    expect(result).toEqual({
      binding: { providerId: 'google-drive-sheets-v1', subject: PERMISSION_ID },
      value: { user: { permissionId: PERMISSION_ID } },
      iframeCount: 1,
    })
    await expect(popup.getByRole('status')).toHaveText('Google-Verbindung bestätigt. Du kannst jetzt zum Tagebuch zurückkehren.')
    expect(await persistentText(page)).not.toContain(CREDENTIAL_SENTINEL)

    const deniedAuthorization = await page.evaluate(async () => {
      const state = window as typeof window & { authProvider?: { getApiClient(): { request<T>(url: string, init?: RequestInit): Promise<T> } } }
      return state.authProvider!.getApiClient().request('https://www.googleapis.com/drive/v3/about', {
        headers: { Authorization: 'must-not-cross-diary-origin' },
      }).then(() => 'allowed', (error) => error instanceof Error ? error.message : 'rejected')
    })
    expect(deniedAuthorization).toBe('Authorization headers must never enter the diary origin.')

    const disconnected = await page.evaluate(async () => {
      const state = window as typeof window & {
        authProvider?: {
          disconnect(): Promise<void>
          getApiClient(): { request<T>(url: string): Promise<T> }
        }
      }
      const client = state.authProvider!.getApiClient()
      await state.authProvider!.disconnect()
      return client.request('https://www.googleapis.com/drive/v3/about').then(
        () => 'allowed',
        (error) => error instanceof Error ? error.message : 'rejected',
      )
    })
    expect(disconnected).toBe('Google authentication session is closed.')
  })

  test('ignores a ready message carrying the right action from a foreign origin', async ({ context, page }) => {
    await installProviderSimulator(context)
    await page.goto('/')
    const popupPromise = page.waitForEvent('popup')
    await beginProductiveAuthentication(page, 3_000)
    await popupPromise
    await page.evaluate(({ actionId }) => {
      const state = window as typeof window & { authPopup?: Window | null }
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'eds-diary/google-auth-ready/v2', action_id: actionId },
        origin: 'https://attacker.invalid',
        source: state.authPopup,
      }))
    }, { actionId: ACTION_ID })
    const outcome = await page.evaluate(async () => {
      const state = window as typeof window & { authResult?: Promise<unknown> }
      return state.authResult!.then(() => 'resolved', (error) => error instanceof Error ? error.message : 'rejected')
    })
    expect(outcome).toBe('Google authentication handoff timed out.')
  })
})
