import { assertAllowedGoogleApiRequest } from './googleAuthRpcPolicy'

interface TokenResponse { access_token?: string; error?: string; expires_in?: number }
interface TokenClient { requestAccessToken(options?: { prompt?: string }): void }
interface GoogleAccounts { oauth2: { initTokenClient(options: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback: () => void }): TokenClient; revoke(token: string, callback: () => void): void } }

declare global { interface Window { google?: { accounts: GoogleAccounts } } }

const ACTION = /^[A-Za-z0-9_-]{32,128}$/
const params = new URLSearchParams(location.search)
const actionId = params.get('action_id') ?? ''
const returnOriginText = params.get('return_origin') ?? ''
const configuredOrigins = (import.meta.env.VITE_DIARY_ORIGINS as string | undefined)?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const status = document.querySelector<HTMLParagraphElement>('#status')!
const login = document.querySelector<HTMLButtonElement>('#login')!
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!
let returnOrigin: string | null = null
let bound = false
let accessToken = ''
let tokenClient: TokenClient | null = null

function fail(message: string): void { status.textContent = message; login.hidden = true }
function validOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin
    if (origin !== value || !configuredOrigins.includes(origin) || origin === location.origin) return null
    return origin
  } catch { return null }
}
function loadGoogleRuntime(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Runtime konnte nicht geladen werden.'))
    document.head.append(script)
  })
}
async function providerIdentity(): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error('Google-Identität konnte nicht bestätigt werden.')
  const value = await response.json() as { user?: { permissionId?: string } }
  if (!value.user?.permissionId) throw new Error('Google lieferte keine stabile Identität.')
  return value.user.permissionId
}
async function rpc(port: MessagePort, data: Record<string, unknown>): Promise<void> {
  const requestId = typeof data.request_id === 'string' ? data.request_id : ''
  try {
    if (!accessToken || data.type !== 'eds-diary/google-api-request/v1' || !requestId) throw new Error('Ungültige API-Anfrage.')
    const url = new URL(String(data.url ?? ''))
    const init = (data.init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string }
    const method = (init.method ?? 'GET').toUpperCase()
    assertAllowedGoogleApiRequest(url, method)
    const headers = new Headers(init.headers)
    if (headers.has('authorization')) throw new Error('Authorization darf nicht übergeben werden.')
    headers.set('Authorization', `Bearer ${accessToken}`)
    const response = await fetch(url, { method, headers, ...(typeof init.body === 'string' ? { body: init.body } : {}) })
    const value: unknown = response.status === 204 ? null : await response.json()
    if (!response.ok) throw Object.assign(new Error('Google API hat die Anfrage abgelehnt.'), { status: response.status })
    port.postMessage({ type: 'eds-diary/google-api-response/v1', request_id: requestId, ok: true, value })
  } catch (cause) {
    const error = cause as Error & { status?: number }
    port.postMessage({ type: 'eds-diary/google-api-response/v1', request_id: requestId, ok: false, error: { message: error.message, ...(error.status ? { status: error.status } : {}) } })
  }
}
async function bind(event: MessageEvent<unknown>): Promise<void> {
  if (bound || event.origin !== returnOrigin || event.source !== window.opener || !event.data || typeof event.data !== 'object') return
  const message = event.data as Record<string, unknown>
  if (message.type !== 'eds-diary/google-auth-bind/v1' || message.action_id !== actionId || message.return_origin !== returnOrigin || event.ports.length !== 1) return
  bound = true
  const port = event.ports[0]!
  try {
    const permissionId = await providerIdentity()
    port.addEventListener('message', (portEvent: MessageEvent<unknown>) => {
      if (!portEvent.data || typeof portEvent.data !== 'object') return
      const data = portEvent.data as Record<string, unknown>
      if (data.type === 'eds-diary/google-auth-disconnect/v1') {
        const token = accessToken; accessToken = ''; port.close()
        if (token) window.google?.accounts.oauth2.revoke(token, () => undefined)
        status.textContent = 'Google-Sitzung wurde getrennt.'
        return
      }
      void rpc(port, data)
    })
    port.start()
    port.postMessage({ type: 'eds-diary/google-auth-bound/v1', action_id: actionId, permission_id: permissionId })
    status.textContent = 'Verbunden. Dieses Fenster kann offen bleiben.'
  } catch (cause) { bound = false; fail(cause instanceof Error ? cause.message : 'Bindung fehlgeschlagen.') }
}
async function start(): Promise<void> {
  returnOrigin = validOrigin(returnOriginText)
  if (!window.opener || !ACTION.test(actionId) || !returnOrigin || !clientId) { fail('Ungültige oder nicht erlaubte Anmeldeanforderung.'); return }
  try {
    await loadGoogleRuntime()
    tokenClient = window.google!.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: (response) => {
      if (!response.access_token || response.error) { fail('Google-Anmeldung wurde nicht abgeschlossen.'); return }
      accessToken = response.access_token
      login.hidden = true
      status.textContent = 'Identität wird gebunden …'
      window.opener.postMessage({ type: 'eds-diary/google-auth-ready/v1', action_id: actionId }, returnOrigin!)
    }, error_callback: () => fail('Google-Anmeldung wurde abgebrochen.') })
    login.hidden = false
    status.textContent = 'Melde dich mit dem Google-Konto an, das das verschlüsselte Tagebuch besitzt.'
  } catch (cause) { fail(cause instanceof Error ? cause.message : 'Google-Anmeldung ist nicht verfügbar.') }
}
window.addEventListener('message', (event) => { void bind(event) })
login.addEventListener('click', () => tokenClient?.requestAccessToken({ prompt: 'select_account' }))
cancel.addEventListener('click', () => window.close())
void start()
