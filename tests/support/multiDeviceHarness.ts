import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

export interface VirtualDevice {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  close(): Promise<void>
}

export interface V2BootstrapSummary {
  diaryId: string
  epochId: string
  creationLocator: string
  remoteId: string
  manifestFingerprint: string
  writerDeviceId: string
  writerKeyId: string
  coveredRowCount: number
  writerGeneration: number
}

const TEST_CREDENTIAL = 'multi-device-oauth-sentinel'
const TEST_PERMISSION_ID = 'multi-device-provider-account'

interface SharedRemote {
  name?: string
  rows: string[]
  manifest?: string[]
  protocolRows?: string[][]
  properties?: Record<string, string>
}

/** Creates genuinely isolated browser profiles while routing their provider
 * traffic to one process-owned remote state. The harness never copies browser
 * storage or device keys between contexts. */
export class MultiDeviceHarness {
  private readonly devices: VirtualDevice[] = []
  private readonly remotes = new Map<string, SharedRemote>()

  constructor(private readonly browser: Browser) {}

  async device(name: string): Promise<VirtualDevice> {
    if (this.devices.some((device) => device.name === name)) throw new Error(`Virtual device ${name} already exists.`)
    const context = await this.browser.newContext()
    await context.route('https://accounts.google.com/gsi/client', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: `window.google={accounts:{oauth2:{initTokenClient(options){return{requestAccessToken(){options.callback({access_token:${JSON.stringify(TEST_CREDENTIAL)},expires_in:3600})}}}}}};`,
      })
    })
    await context.route('https://www.googleapis.com/**', (route) => this.googleRoute(route))
    await context.route('https://sheets.googleapis.com/**', (route) => this.googleRoute(route))
    const page = await context.newPage()
    const device: VirtualDevice = {
      name,
      context,
      page,
      close: async () => { await context.close() },
    }
    this.devices.push(device)
    return device
  }

  remoteRows(remoteId: string): readonly string[] {
    return [...(this.remotes.get(remoteId)?.rows ?? [])]
  }

  async authenticate(device: VirtualDevice, actionId: string): Promise<void> {
    const popupPromise = device.page.waitForEvent('popup')
    await device.page.evaluate(async ({ action }) => {
      const { GoogleAuthProvider } = await import('/src/sync/google/GoogleAuthProvider.ts')
      const provider = new GoogleAuthProvider('/google-auth/')
      const state = window as typeof window & { multiDeviceAuth?: { provider: InstanceType<typeof GoogleAuthProvider>; result: Promise<unknown> } }
      state.multiDeviceAuth = { provider, result: provider.authenticate(action) }
    }, { action: actionId })
    const popup = await popupPromise
    await popup.getByRole('button', { name: 'Mit Google anmelden' }).click()
    await device.page.evaluate(async () => {
      const state = window as typeof window & { multiDeviceAuth?: { result: Promise<unknown> } }
      await state.multiDeviceAuth!.result
    })
  }

  async enrollWriterDeviceKey(device: VirtualDevice): Promise<string> {
    return device.page.evaluate(async () => {
      const { generateWriterDeviceKeyV2 } = await import('/src/security/v2/crypto.ts')
      const writer = await generateWriterDeviceKeyV2()
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('virtual-device-state', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('writer-keys')
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('writer-keys', 'readwrite')
          transaction.objectStore('writer-keys').put({
            writerKeyId: writer.writerKeyId,
            publicKey: writer.publicKeyRaw,
            privateKey: writer.privateKey,
          }, 'local-writer')
          transaction.oncomplete = () => { database.close(); resolve() }
          transaction.onerror = () => reject(transaction.error)
        }
        request.onerror = () => reject(request.error)
      })
      return writer.writerKeyId
    })
  }

  async createAndDiscoverV2(device: VirtualDevice, diaryId: string, epochId: string, locator: string): Promise<string> {
    return device.page.evaluate(async ({ diary, epoch, creationLocator }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } } }
      const { GoogleSheetsTransferableSingleWriterV2Transport } = await import('/src/sync/google/GoogleSheetsTransferableSingleWriterV2Transport.ts')
      const api = state.multiDeviceAuth!.provider.getApiClient()
      const transport = await GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(api as never, diary, epoch)
      await transport.create(creationLocator, [])
      const candidates = await transport.discover(creationLocator)
      if (candidates.length !== 1) throw new Error('Expected exactly one newly created V2 candidate.')
      return candidates[0]!.remoteId
    }, { diary: diaryId, epoch: epochId, creationLocator: locator })
  }

  async discoverV2(device: VirtualDevice, diaryId: string, epochId: string, locator: string): Promise<readonly string[]> {
    return device.page.evaluate(async ({ diary, epoch, creationLocator }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } } }
      const { GoogleSheetsTransferableSingleWriterV2Transport } = await import('/src/sync/google/GoogleSheetsTransferableSingleWriterV2Transport.ts')
      const transport = await GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(state.multiDeviceAuth!.provider.getApiClient() as never, diary, epoch)
      return (await transport.discover(creationLocator)).map((candidate) => candidate.remoteId)
    }, { diary: diaryId, epoch: epochId, creationLocator: locator })
  }

  async bootstrapCanonicalV2(device: VirtualDevice): Promise<V2BootstrapSummary> {
    return device.page.evaluate(async ({ permissionId }) => {
      const state = window as typeof window & {
        multiDeviceAuth?: { provider: { getApiClient(): unknown } }
        v2GoldenState?: Record<string, unknown>
      }
      const [bytesModule, cryptoCore, v2Crypto, manifestModule, typesModule, envelopeModule, prefixModule, transportModule, codecModule] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/security/crypto/core.ts'),
        import('/src/security/v2/crypto.ts'),
        import('/src/security/v2/manifest.ts'),
        import('/src/security/v2/types.ts'),
        import('/src/security/v2/envelopes.ts'),
        import('/src/security/v2/prefix.ts'),
        import('/src/sync/google/GoogleSheetsTransferableSingleWriterV2Transport.ts'),
        import('/src/sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec.ts'),
      ])
      const { base64Url } = bytesModule
      const random = (length: number) => cryptoCore.randomBytes(length)
      const diaryId = base64Url(random(16))
      const epochId = base64Url(random(16))
      const keyId = base64Url(random(16))
      const creationLocator = base64Url(random(16))
      const rootKey = random(32)
      const urs = random(32)
      const epochSalt = await v2Crypto.deriveEpochSaltV2(bytesModule.fromBase64Url(diaryId), bytesModule.fromBase64Url(epochId))
      const writer = await v2Crypto.generateWriterDeviceKeyV2()
      const recovery = await v2Crypto.generateRecoveryTakeoverKeyMaterialV2()
      const writerDeviceId = base64Url(random(16))
      const grantId = base64Url(random(32))
      const recoveryUrsId = await v2Crypto.recoveryUrsIdV2(urs)
      const recoveryCommitment = await v2Crypto.recoveryCommitmentV2(urs, bytesModule.fromBase64Url(diaryId), 0)
      const api = state.multiDeviceAuth!.provider.getApiClient()
      const transport = await transportModule.GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(api as never, diaryId, epochId)
      const accountBinding = await transportModule.googleAccountBindingV2(diaryId, permissionId)
      const history = [{ recovery_generation: 0, recovery_urs_id: recoveryUrsId, recovery_takeover_key_id: recovery.recoveryTakeoverKeyId }]
      const payload = {
        diary_id: diaryId,
        epoch_id: epochId,
        key_id: keyId,
        creation_locator: creationLocator,
        recovery_generation: 0,
        recovery_urs_commitment: recoveryCommitment,
        recovery_urs_id: recoveryUrsId,
        recovery_credential_history: history,
        diary_marker: 'epoch-manifest-v6' as const,
        crypto_suite: 'A256GCM-HKDF-SHA256-ED25519-v6' as const,
        sync_profile: 'google-sheets-transferable-single-writer-v2' as const,
        created_at: '2026-09-26T12:00:00.000Z',
        google_account_binding: accountBinding,
        predecessor_epochs: [],
        record_schema_allowlist: [...typesModule.SINGLE_WRITER_V2_SCHEMA_ALLOWLIST],
        record_schema_registry_hash: (await import('/src/security/v2/schemaRegistry.ts')).V2_SCHEMA_REGISTRY_HASH,
        protocol_limits: structuredClone(manifestModule.V6_PROTOCOL_LIMITS),
        epoch_start_authority_mode: 'genesis_grant_required' as const,
        epoch_start_writer_generation: 1,
        epoch_start_writer_grant_id: grantId,
        epoch_start_writer_device_id: writerDeviceId,
        epoch_start_writer_key_id: writer.writerKeyId,
        epoch_start_writer_public_key: base64Url(writer.publicKeyRaw),
        recovery_takeover_key_id: recovery.recoveryTakeoverKeyId,
        recovery_takeover_public_key: base64Url(recovery.publicKeyRaw),
      }
      const cells = await manifestModule.prepareManifestV6(rootKey, epochSalt, { diaryId, epochId }, payload)
      await transport.create(creationLocator, [])
      const candidates = await transport.discover(creationLocator)
      if (candidates.length !== 1) throw new Error('V2 bootstrap did not discover exactly one candidate.')
      const remoteId = candidates[0]!.remoteId
      await transport.writeManifest(remoteId, manifestModule.manifestCellsArrayV6(cells))
      await transport.patchProperties(remoteId, { app_format: 'sync-v6', epoch_locator: await transportModule.epochLocatorV2(diaryId, epochId) })
      await transport.read(remoteId)
      const grant = {
        grant_id: grantId,
        writer_generation: 1,
        writer_device_id: writerDeviceId,
        writer_key_id: writer.writerKeyId,
        writer_public_key: base64Url(writer.publicKeyRaw),
        previous_grant_id: null,
        previous_writer_generation: 0,
        recovery_generation: 0,
        reason: 'initial' as const,
        authority_anchor: await prefixModule.createAnchorV2(diaryId, epochId, []),
        authorization: { kind: 'manifest_genesis' as const, signer_key_id: null, signature: null },
      }
      const revision = {
        record_type: 'writer_grant' as const,
        record_schema: 'writer-grant-sw-v2' as const,
        record_id: base64Url(random(16)),
        revision_id: base64Url(random(32)),
        parent_revision_ids: [],
        record_status: 'control' as const,
        record_data: grant,
        migration_origin: null,
        protocol_created_at: '2026-09-26T12:00:00.000Z',
        writer_context: null,
        writer_signature: null,
      }
      const envelope = await envelopeModule.sealRevisionEnvelopeV2(rootKey, epochSalt, { diaryId, epochId }, revision, random(32), random(12))
      await transport.append(remoteId, envelopeModule.envelopeRowV2(envelope))
      const codec = new codecModule.GoogleSheetsTransferableSingleWriterV2ProfileCodec(diaryId, epochId, rootKey, accountBinding)
      const verified = await codec.verifyRemote(await transport.read(remoteId))
      const profile = verified.profileState as { remote_anchor: { covered_row_count: number }; current_writer: { writer_generation: number } }
      const manifestFingerprint = await manifestModule.manifestFingerprintV6(cells)
      state.v2GoldenState = { diaryId, epochId, keyId, creationLocator, remoteId, rootKey, urs, epochSalt, writer, recovery, writerDeviceId, grantId, cells, manifestFingerprint, transport, codec }
      return {
        diaryId, epochId, creationLocator, remoteId, manifestFingerprint, writerDeviceId, writerKeyId: writer.writerKeyId,
        coveredRowCount: profile.remote_anchor.covered_row_count,
        writerGeneration: profile.current_writer.writer_generation,
      }
    }, { permissionId: TEST_PERMISSION_ID })
  }

  async append(device: VirtualDevice, remoteId: string, row: string): Promise<void> {
    await device.page.evaluate(async ({ id, value }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): { request<T>(url: string, init?: RequestInit): Promise<T> } } } }
      await state.multiDeviceAuth!.provider.getApiClient().request(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
        method: 'POST', body: JSON.stringify({ row: value }),
      })
    }, { id: remoteId, value: row })
  }

  async read(device: VirtualDevice, remoteId: string): Promise<readonly string[]> {
    return device.page.evaluate(async ({ id }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): { request<T>(url: string): Promise<T> } } } }
      const result = await state.multiDeviceAuth!.provider.getApiClient().request<{ rows: string[] }>(`https://sheets.googleapis.com/v4/spreadsheets/${id}`)
      return result.rows
    }, { id: remoteId })
  }

  async close(): Promise<void> {
    await Promise.all(this.devices.map(async (device) => device.context.close()))
    this.devices.length = 0
  }

  private async googleRoute(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    if (await request.headerValue('authorization') !== `Bearer ${TEST_CREDENTIAL}`) {
      await route.fulfill({ status: 401, json: { error: { message: 'Missing simulator credential.' } } })
      return
    }
    if (url.pathname === '/drive/v3/about') {
      await route.fulfill({ json: { user: { permissionId: TEST_PERMISSION_ID } } })
      return
    }
    if (url.pathname === '/drive/v3/files' && request.method() === 'GET') {
      await route.fulfill({
        json: {
          files: [...this.remotes.entries()].filter(([, remote]) => remote.name).map(([id, remote]) => ({
            id,
            name: remote.name,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            trashed: false,
            appProperties: {},
          })),
        },
      })
      return
    }
    const permissionMatch = /^\/drive\/v3\/files\/([^/]+)\/permissions$/u.exec(url.pathname)
    if (permissionMatch && request.method() === 'GET') {
      await route.fulfill({ json: { permissions: [{ id: TEST_PERMISSION_ID, type: 'user', role: 'owner', deleted: false }] } })
      return
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/u.exec(url.pathname)
    if (fileMatch && request.method() === 'GET') {
      const remote = this.remotes.get(fileMatch[1]!)
      if (!remote) { await route.fulfill({ status: 404 }); return }
      await route.fulfill({ json: {
        id: fileMatch[1], mimeType: 'application/vnd.google-apps.spreadsheet', trashed: false,
        ownedByMe: true, shared: false, isAppAuthorized: true, appProperties: remote.properties ?? {},
      } })
      return
    }
    if (fileMatch && request.method() === 'PATCH') {
      const remote = this.remotes.get(fileMatch[1]!)
      if (!remote) { await route.fulfill({ status: 404 }); return }
      const payload = request.postDataJSON() as { appProperties?: Record<string, string> }
      remote.properties = { ...(payload.appProperties ?? {}) }
      await route.fulfill({ json: { id: fileMatch[1], appProperties: remote.properties } })
      return
    }
    if (url.pathname === '/v4/spreadsheets' && request.method() === 'POST') {
      const payload = request.postDataJSON() as { properties?: { title?: unknown } }
      if (typeof payload.properties?.title !== 'string') { await route.fulfill({ status: 400 }); return }
      const remoteId = `v2-remote-${this.remotes.size + 1}`
      this.remotes.set(remoteId, { name: payload.properties.title, rows: [], manifest: [], protocolRows: [], properties: {} })
      await route.fulfill({ json: { spreadsheetId: remoteId, sheets: [{ properties: { sheetId: 1 } }, { properties: { sheetId: 2 } }] } })
      return
    }
    const match = /^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate)?$/u.exec(url.pathname)
    const remoteId = match?.[1] ?? ''
    if (!remoteId) { await route.fulfill({ status: 400 }); return }
    const remote = this.remotes.get(remoteId) ?? { rows: [] }
    this.remotes.set(remoteId, remote)
    if (request.method() === 'GET' && url.searchParams.has('fields')) {
      const fields = url.searchParams.get('fields') ?? ''
      const range = url.searchParams.get('ranges') ?? ''
      if (fields.includes('gridProperties')) {
        await route.fulfill({ json: { sheets: [
          { properties: { sheetId: 1, title: '_m', sheetType: 'GRID', gridProperties: { rowCount: 1, columnCount: 4 } }, merges: [] },
          { properties: { sheetId: 2, title: '_r', sheetType: 'GRID', gridProperties: { rowCount: Math.max(1, remote.protocolRows?.length ?? 0), columnCount: 3 } }, merges: [] },
        ] } })
        return
      }
      if (fields.includes('sheets(properties(sheetId,title))')) {
        await route.fulfill({ json: { sheets: [{ properties: { sheetId: 1, title: '_m' } }, { properties: { sheetId: 2, title: '_r' } }] } })
        return
      }
      const title = range.includes('_m') ? '_m' : '_r'
      const values = title === '_m' ? [remote.manifest ?? []] : (remote.protocolRows ?? [])
      await route.fulfill({ json: { sheets: [{ properties: { sheetId: title === '_m' ? 1 : 2, title }, data: [{ startRow: 0, rowData: values.map((row) => ({ values: row.map((value) => ({ userEnteredValue: { stringValue: value } })) })) }] }] } })
      return
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as { row?: unknown; requests?: Array<{ updateCells?: { rows?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }> }; appendCells?: { rows?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }> } }> }
      if (typeof payload.row === 'string') remote.rows.push(payload.row)
      else if (payload.requests?.[0]?.updateCells) remote.manifest = payload.requests[0].updateCells.rows?.[0]?.values?.map((cell) => cell.userEnteredValue?.stringValue ?? '') ?? []
      else if (payload.requests?.[0]?.appendCells) {
        const row = payload.requests[0].appendCells.rows?.[0]?.values?.map((cell) => cell.userEnteredValue?.stringValue ?? '') ?? []
        remote.protocolRows = [...(remote.protocolRows ?? []), row]
      } else { await route.fulfill({ status: 400 }); return }
      await route.fulfill({ json: {} })
      return
    }
    if (request.method() === 'GET') { await route.fulfill({ json: { rows: remote.rows } }); return }
    await route.fulfill({ status: 405 })
  }
}
