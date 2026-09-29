import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

export interface VirtualDevice {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly securityTelemetry: SecurityTelemetryEntry[]
  close(): Promise<void>
}

interface SecurityTelemetryEntry {
  location: 'request-url' | 'request-headers' | 'request-body' | 'console' | 'page-error'
  value: string
}

type AppendFault =
  | { kind: 'no_commit'; note: string }
  | { kind: 'commit_response_lost'; note: string }
  | { kind: 'duplicate'; note: string }
  | { kind: 'delay'; milliseconds: number; note: string }
  | { kind: 'intervening_duplicate'; note: string }

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
  recoveryKey: string
  recoveryArtifact: unknown
}

export interface V2DomainWriteSummary {
  recordId: string
  revisionId: string
  coveredRowCount: number
  writerStatus: string
  outboxStatus: string
  rootWrapMode: string
  selected: boolean
}

export interface V2ResumeSummary { writerStatus: string; painRevisionCount: number; rootWrapMode: string }
export interface V2JoinSummary extends V2ResumeSummary { writerDeviceId: string; joined: boolean; repositoryPainCount: number; writeRejected: boolean }
export interface V2HandoffSummary { stage: string; writerStatus: string; writerGeneration: number | null; remoteRows: number }
export interface V2TakeoverSummary extends V2HandoffSummary { maintenanceOnly: boolean }

const TEST_CREDENTIAL = 'multi-device-oauth-sentinel'
const TEST_PERMISSION_ID = 'multi-device-provider-account'

interface SharedRemote {
  name?: string
  rows: string[]
  manifest?: string[]
  protocolRows?: string[][]
  properties?: Record<string, string>
  trashed?: boolean
  artifactRows?: string[]
  sheetKind?: 'protocol' | 'recovery-v5' | 'recovery-v6'
}

/** Creates genuinely isolated browser profiles while routing their provider
 * traffic to one process-owned remote state. The harness never copies browser
 * storage or device keys between contexts. */
export class MultiDeviceHarness {
  private readonly devices: VirtualDevice[] = []
  private readonly remotes = new Map<string, SharedRemote>()
  private readonly appendFaults: AppendFault[] = []

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
    const securityTelemetry: SecurityTelemetryEntry[] = []
    const instrumentPage = (instrumentedPage: Page): void => {
      // Simulated Auth-Origin is hosted at /google-auth/ under localhost.
      // It is a separate credential trust boundary despite the test host.
      // Scan only the actual Diary page and Diary-owned request initiators.
      if (instrumentedPage !== page) return
      instrumentedPage.on('console', (message) => {
        const source = message.location().url
        if (source && new URL(source, instrumentedPage.url()).pathname.startsWith('/google-auth/')) return
        securityTelemetry.push({ location: 'console', value: message.text() })
      })
      instrumentedPage.on('pageerror', (error) => {
        securityTelemetry.push({ location: 'page-error', value: error.message })
      })
      instrumentedPage.on('request', (request) => {
        const target = new URL(request.url())
        const diary = new URL(page.url())
        if (target.origin !== diary.origin || target.pathname.startsWith('/google-auth/')) return
        try {
          if (new URL(request.frame().url()).pathname.startsWith('/google-auth/')) return
        } catch {
          // Worker/navigation requests with no accessible frame still have to
          // pass the exact Diary-origin/path check above.
        }
        securityTelemetry.push({ location: 'request-url', value: request.url() })
        securityTelemetry.push({ location: 'request-headers', value: JSON.stringify(request.headers()) })
        const body = request.postData()
        if (body !== null) securityTelemetry.push({ location: 'request-body', value: body })
      })
    }
    instrumentPage(page)
    context.on('page', instrumentPage)
    const device: VirtualDevice = {
      name,
      context,
      page,
      securityTelemetry,
      close: async () => { await context.close() },
    }
    this.devices.push(device)
    return device
  }

  remoteRows(remoteId: string): readonly string[] {
    return [...(this.remotes.get(remoteId)?.rows ?? [])]
  }

  remoteProtocolRowCount(remoteId: string): number { return this.remotes.get(remoteId)?.protocolRows?.length ?? 0 }

  snapshotRemoteProtocolRows(remoteId: string): string[][] {
    return structuredClone(this.remotes.get(remoteId)?.protocolRows ?? [])
  }

  replaceRemoteProtocolRows(remoteId: string, rows: readonly (readonly string[])[]): void {
    const remote = this.remotes.get(remoteId)
    if (!remote?.protocolRows) throw new Error('V2 protocol remote is unavailable.')
    remote.protocolRows = rows.map((row) => [...row])
  }

  async authenticate(device: VirtualDevice, actionId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(actionId)) {
      throw new Error('Harness authentication requires a valid 32-128 character action binding.')
    }
    await Promise.all(device.context.pages().filter((page) => page !== device.page).map(async (page) => page.close()))
    const popupPromise = device.page.waitForEvent('popup', { timeout: 15_000 })
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

  enqueueProviderAppendFault(fault: AppendFault): void { this.appendFaults.push(fault) }

  async scanBrowserPersistence(device: VirtualDevice, sentinels: readonly string[]): Promise<readonly string[]> {
    const persistenceHits = await device.page.evaluate(async ({ needles }) => {
      const hits: string[] = []
      const inspect = (location: string, value: unknown) => {
        let encoded: string
        try { encoded = typeof value === 'string' ? value : JSON.stringify(value) }
        catch { encoded = String(value) }
        needles.forEach((needle, index) => {
          if (needle.length && encoded.includes(needle)) hits.push(`${location}:sentinel-${index}`)
        })
      }
      inspect('dom', document.documentElement.textContent ?? '')
      for (const [name, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          if (key !== null) inspect(`${name}:${key}`, storage.getItem(key))
        }
      }
      const databases = await indexedDB.databases()
      for (const info of databases) {
        if (!info.name) continue
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(info.name!)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const stores = [...database.objectStoreNames]
        if (stores.length) {
          const transaction = database.transaction(stores, 'readonly')
          await Promise.all(stores.map((storeName) => new Promise<void>((resolve, reject) => {
            const request = transaction.objectStore(storeName).getAll()
            request.onsuccess = () => { inspect(`indexedDB:${info.name}:${storeName}`, request.result); resolve() }
            request.onerror = () => reject(request.error)
          })))
        }
        database.close()
      }
      if ('caches' in window) {
        for (const cacheName of await caches.keys()) {
          const cache = await caches.open(cacheName)
          for (const request of await cache.keys()) {
            inspect(`cache:${cacheName}:request`, request.url)
            inspect(`cache:${cacheName}:response`, await (await cache.match(request))?.text())
          }
        }
      }
      return hits
    }, { needles: [...sentinels] })
    const telemetryHits = device.securityTelemetry.flatMap((entry) => sentinels.flatMap((sentinel, index) =>
      sentinel.length && entry.value.includes(sentinel) ? [`${entry.location}:sentinel-${index}`] : []))
    return [...persistenceHits, ...telemetryHits]
  }

  async authenticate(device: VirtualDevice, actionId: string): Promise<void> {
    await Promise.all(device.context.pages().filter((page) => page !== device.page).map(async (page) => page.close()))
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

  async establishProductiveV2(device: VirtualDevice): Promise<ProductiveV2LifecycleSummary> {
    return device.page.evaluate(async () => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, painRepository, dataLayer, v1Provider, v2Provider, localDatabase, persistence] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/features/pain/painRepository.ts'),
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleSingleWriterProvider.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/security/v2/localPersistence.ts'),
      ])
      const urs = bytes.randomBytes(32)
      const passphrase = 'synthetic productive v2 passphrase 2026'
      await painRepository.createPainEntry({
        startedAt: '2026-09-26T08:00:00.000Z', intensity: 3, note: 'productive-v2-before-upgrade',
      })
      const api = state.multiDeviceAuth!.provider.getApiClient() as never
      const source = v1Provider.googleProviderSessionFromAuthenticatedClient(api)
      const successor = v2Provider.googleV2ProviderSessionFromAuthenticatedClient(api)
      await dataLayer.enableAuthenticatedRemoteSession(source, urs)
      const upgraded = await dataLayer.upgradeAuthenticatedRemoteSessionToV2(source, successor, urs)
      if (upgraded.stage !== 'switched') throw new Error(`Productive v1→v2 upgrade stopped at ${upgraded.stage}.`)
      state.productiveV2Session = successor
      await painRepository.createPainEntry({
        startedAt: '2026-09-26T09:00:00.000Z', intensity: 4, note: 'productive-v2-after-upgrade',
      })
      await localDatabase.enrollActivePassphraseRootWrap(passphrase)
      const status = await dataLayer.remoteSessionStatus()
      const selection = await localDatabase.activeProtocolSelectionV2()
      if (!selection || status.profile !== 'v2' || !status.remoteResourceId) throw new Error('Productive upgrade did not select a bound v2 epoch.')
      const store = new persistence.IndexedDbV2LocalSecurityStore()
      const prepared = await store.loadRootWrapV6(selection.epoch_id)
      const rootKey = await localDatabase.openSuccessorRootWrapV6WithActiveMode(prepared)
      const salt = await (await import('/src/security/v2/crypto.ts')).deriveEpochSaltV2(bytes.fromBase64Url(selection.diary_id), bytes.fromBase64Url(selection.epoch_id))
      const local = await store.loadState(rootKey, salt, selection.epoch_id)
      return {
        diaryId: selection.diary_id,
        epochId: selection.epoch_id,
        remoteId: status.remoteResourceId,
        recoveryKey: bytes.base64Url(urs),
        passphrase,
        writerStatus: local.writer_status,
        painCount: (await painRepository.listPainEntries()).length,
        coveredRowCount: local.remote_anchor?.covered_row_count ?? 0,
      }
    })
  }

  async establishProductiveRemoteV1(device: VirtualDevice): Promise<ProductiveV1CrashSeed> {
    return device.page.evaluate(async () => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } } }
      const [bytes, painRepository, dataLayer, provider, localDatabase] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/features/pain/painRepository.ts'),
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleSingleWriterProvider.ts'),
        import('/src/data/localDatabase.ts'),
      ])
      const urs = bytes.randomBytes(32), passphrase = 'synthetic crash resume passphrase 2026'
      await painRepository.createPainEntry({ intensity: 2, note: 'productive-crash-source' })
      const session = provider.googleProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      await dataLayer.enableAuthenticatedRemoteSession(session, urs)
      await localDatabase.enrollActivePassphraseRootWrap(passphrase)
      return { recoveryKey: bytes.base64Url(urs), passphrase }
    })
  }

  async runProductiveProfileUpgrade(device: VirtualDevice, seed: ProductiveV1CrashSeed, faultPoint?: string): Promise<string> {
    return device.page.evaluate(async ({ input, point }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, localDatabase, sourceProvider, successorProvider, serviceModule, dataLayer] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/sync/google/GoogleSingleWriterProvider.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/profileUpgradeV2Service.ts'),
        import('/src/data/initializeDataLayer.ts'),
      ])
      const status = await localDatabase.localRootWrapStatus()
      if (status.locked) await localDatabase.unlockActiveRootWithPassphrase(input.passphrase)
      const api = state.multiDeviceAuth!.provider.getApiClient() as never
      const source = sourceProvider.googleProviderSessionFromAuthenticatedClient(api)
      const successor = successorProvider.googleV2ProviderSessionFromAuthenticatedClient(api)
      const active = await localDatabase.activeEpochSyncContext(), transport = await source.transportForEpoch(active.diaryId, active.epochId)
      const result = await new serviceModule.ProductiveProfileUpgradeV2Service(
        source,
        transport,
        successor,
        bytes.fromBase64Url(input.recoveryKey),
        undefined,
        point ? (reached) => { if (reached === point) throw new Error(`persistent-crash:${point}`) } : undefined,
      ).upgrade()
      if (result.stage === 'switched') {
        state.productiveV2Session = successor
        await dataLayer.installAuthenticatedRemoteSession(successor)
      }
      return result.stage
    }, { input: seed, point: faultPoint })
  }

  async runProductiveRecoveryRekey(device: VirtualDevice, seed: ProductiveRecoveryRekeySeed, faultPoint?: string): Promise<string> {
    return device.page.evaluate(async ({ input, point }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, provider, serviceModule] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/recoveryRekeyV2Service.ts'),
      ])
      state.productiveV2Session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      const result = await new serviceModule.ProductiveRecoveryRekeyV2Service(
        state.productiveV2Session as never,
        undefined,
        undefined,
        point ? (reached) => { if (reached === point) throw new Error(`persistent-crash:${point}`) } : undefined,
      ).rekey(bytes.fromBase64Url(input.newRecoveryKey))
      return result.stage
    }, { input: seed, point: faultPoint })
  }

  async productiveRotationStages(device: VirtualDevice): Promise<readonly string[]> {
    return device.page.evaluate(async () => {
      const { __v2LocalPersistenceTesting } = await import('/src/security/v2/localPersistence.ts')
      const database = await __v2LocalPersistenceTesting.openDatabase()
      const transaction = database.transaction(__v2LocalPersistenceTesting.STORES.rotationOperations, 'readonly')
      const request = transaction.objectStore(__v2LocalPersistenceTesting.STORES.rotationOperations).getAll()
      const operations = await new Promise<Array<{ state?: { stage?: unknown } }>>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as Array<{ state?: { stage?: unknown } }>)
        request.onerror = () => reject(request.error)
      })
      return operations.map((operation) => typeof operation.state?.stage === 'string' ? operation.state.stage : 'invalid')
    })
  }

  async prepareProductiveJoinProtection(device: VirtualDevice, passphrase: string): Promise<void> {
    await device.page.evaluate(async ({ value }) => {
      const localDatabase = await import('/src/data/localDatabase.ts')
      await localDatabase.enrollActivePassphraseRootWrap(value)
    }, { value: passphrase })
  }

  async runProductiveJoin(device: VirtualDevice, recoveryKey: string, faultPoint?: string): Promise<string> {
    return device.page.evaluate(async ({ encodedRecoveryKey, point }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, provider, serviceModule] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/readOnlyJoinV2Service.ts'),
      ])
      const session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      const result = await new serviceModule.ProductiveReadOnlyJoinV2Service(
        session,
        undefined,
        point ? async (reached) => { if (reached === point) throw new Error(`persistent-crash:${point}`) } : undefined,
      ).join(bytes.fromBase64Url(encodedRecoveryKey))
      return result.epochId
    }, { encodedRecoveryKey: recoveryKey, point: faultPoint })
  }

  async unlockProductiveRootThroughUi(device: VirtualDevice, passphrase: string): Promise<void> {
    const unlockGate = device.page.getByRole('heading', { name: 'Lokales Tagebuch gesperrt' })
    await unlockGate.waitFor({ state: 'visible', timeout: 10_000 })
    await device.page.getByLabel('Passphrase').fill(passphrase)
    await device.page.getByRole('button', { name: 'Entsperren' }).click()
    await device.page.getByRole('navigation', { name: 'Hauptnavigation' }).waitFor({ state: 'visible' })
  }

  async unlockProductiveRootWithService(device: VirtualDevice, passphrase: string): Promise<void> {
    await device.page.evaluate(async ({ value }) => {
      const localDatabase = await import('/src/data/localDatabase.ts')
      await localDatabase.unlockActiveRootWithPassphrase(value)
    }, { value: passphrase })
  }

  async restoreProductiveRuntimeAfterCeremony(device: VirtualDevice, passphrase: string): Promise<void> {
    await device.page.evaluate(async ({ value }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [dataLayer, localDatabase, provider] = await Promise.all([
        import('/src/data/initializeDataLayer.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
      ])
      const selection = await localDatabase.activeProtocolSelectionV2()
      if (!selection) throw new Error('Ceremony resume did not leave an active v2 protocol selection.')
      const rootStatus = await localDatabase.localRootWrapStatus()
      if (rootStatus.locked) await localDatabase.unlockActiveRootWithPassphrase(value)
      const session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      await dataLayer.installAuthenticatedRemoteSession(session)
    }, { value: passphrase })
  }

  async reloadAuthenticateUnlockAndRestoreProductiveRuntime(
    device: VirtualDevice,
    passphrase: string,
    actionId: string,
  ): Promise<void> {
    await device.page.reload()
    await this.authenticate(device, actionId)
    await this.unlockProductiveRootThroughUi(device, passphrase)
    await this.restoreProductiveRuntimeAfterCeremony(device, passphrase)
  }

  async lockProductiveRoot(device: VirtualDevice): Promise<void> {
    await device.page.evaluate(async () => {
      const localDatabase = await import('/src/data/localDatabase.ts')
      await localDatabase.lockActiveRoot()
    })
  }

  async reloadLockedProductiveV2(device: VirtualDevice, actionId: string): Promise<void> {
    await device.page.reload()
    await this.authenticate(device, actionId)
    await device.page.evaluate(async () => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const provider = await import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts')
      state.productiveV2Session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
    })
  }

  async readProductivePain(device: VirtualDevice): Promise<number> {
    return device.page.evaluate(async () => {
      const repository = await import('/src/features/pain/painRepository.ts')
      return (await repository.listPainEntries()).length
    })
  }

  async reloadUnlockAndContinueProductiveV2(device: VirtualDevice, lifecycle: ProductiveV2LifecycleSummary): Promise<ProductiveV2LifecycleSummary> {
    await device.page.reload()
    await this.authenticate(device, 'productive_v2_reload_unlock_000001')
    return device.page.evaluate(async ({ expected }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, painRepository, dataLayer, v2Provider, localDatabase, persistence] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/features/pain/painRepository.ts'),
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/security/v2/localPersistence.ts'),
      ])
      const locked = await localDatabase.localRootWrapStatus()
      if (!locked.locked || locked.mode !== 'passphrase') throw new Error('Reload did not restore the productive passphrase lock gate.')
      const wrongRejected = await localDatabase.unlockActiveRootWithPassphrase(`${expected.passphrase}-wrong`).then(() => false, () => true)
      if (!wrongRejected || !(await localDatabase.localRootWrapStatus()).locked) throw new Error('Wrong productive unlock did not remain fail-closed.')
      await localDatabase.unlockActiveRootWithPassphrase(expected.passphrase)
      const session = v2Provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      await dataLayer.installAuthenticatedRemoteSession(session)
      const before = await painRepository.listPainEntries()
      if (!before.some((entry) => entry.note === 'productive-v2-after-upgrade')) throw new Error('Productive v2 domain record was not materialized after unlock.')
      await painRepository.createPainEntry({
        startedAt: '2026-09-26T10:00:00.000Z', intensity: 5, note: 'productive-v2-after-reload',
      })
      const selection = await localDatabase.activeProtocolSelectionV2()
      if (!selection) throw new Error('Productive v2 selection disappeared after reload.')
      const store = new persistence.IndexedDbV2LocalSecurityStore(), prepared = await store.loadRootWrapV6(selection.epoch_id)
      const rootKey = await localDatabase.openSuccessorRootWrapV6WithActiveMode(prepared)
      const salt = await (await import('/src/security/v2/crypto.ts')).deriveEpochSaltV2(bytes.fromBase64Url(selection.diary_id), bytes.fromBase64Url(selection.epoch_id))
      const local = await store.loadState(rootKey, salt, selection.epoch_id)
      return { ...expected, writerStatus: local.writer_status, painCount: (await painRepository.listPainEntries()).length, coveredRowCount: local.remote_anchor?.covered_row_count ?? 0 }
    }, { expected: lifecycle })
  }

  async joinAndUnlockProductiveV2(device: VirtualDevice, lifecycle: ProductiveV2LifecycleSummary): Promise<{ writerStatus: string; painCount: number; notes: string[] }> {
    return device.page.evaluate(async ({ expected }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [bytes, dataLayer, v2Provider, localDatabase, painRepository] = await Promise.all([
        import('/src/security/crypto/bytes.ts'),
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/features/pain/painRepository.ts'),
      ])
      const session = v2Provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      await dataLayer.joinExistingV2Diary(session, bytes.fromBase64Url(expected.recoveryKey))
      await localDatabase.enrollActivePassphraseRootWrap(expected.passphrase)
      await localDatabase.lockActiveRoot()
      const wrongRejected = await localDatabase.unlockActiveRootWithPassphrase(`${expected.passphrase}-wrong`).then(() => false, () => true)
      if (!wrongRejected || !(await localDatabase.localRootWrapStatus()).locked) throw new Error('Joined device accepted a wrong unlock factor.')
      await localDatabase.unlockActiveRootWithPassphrase(expected.passphrase)
      await dataLayer.installAuthenticatedRemoteSession(session)
      const status = await dataLayer.remoteSessionStatus(), entries = await painRepository.listPainEntries()
      return { writerStatus: status.writerStatus ?? '', painCount: entries.length, notes: entries.map((entry) => entry.note).sort() }
    }, { expected: lifecycle })
  }

  async verifyProductiveV2Remote(device: VirtualDevice): Promise<{ kind: string; coveredRowCount: number; writerStatus: string }> {
    return device.page.evaluate(async () => {
      const state = window as typeof window & { productiveV2Session?: {
        transportForEpoch(diaryId: string, epochId: string): Promise<{ read(remoteId: string): Promise<unknown> }>
        codecForEpoch(diaryId: string, epochId: string, rootKey: Uint8Array, transport: unknown): Promise<{ verifyRemote(snapshot: unknown): Promise<{ profileState: unknown }> }>
      } }
      const [localDatabase, persistence, bytes, crypto] = await Promise.all([
        import('/src/data/localDatabase.ts'),
        import('/src/security/v2/localPersistence.ts'),
        import('/src/security/crypto/bytes.ts'),
        import('/src/security/v2/crypto.ts'),
      ])
      const selection = await localDatabase.activeProtocolSelectionV2(), session = state.productiveV2Session
      if (!selection || !session) throw new Error('Productive v2 session/selection is unavailable.')
      const store = new persistence.IndexedDbV2LocalSecurityStore(), prepared = await store.loadRootWrapV6(selection.epoch_id)
      const rootKey = await localDatabase.openSuccessorRootWrapV6WithActiveMode(prepared)
      const salt = await crypto.deriveEpochSaltV2(bytes.fromBase64Url(selection.diary_id), bytes.fromBase64Url(selection.epoch_id))
      const local = await store.loadState(rootKey, salt, selection.epoch_id)
      if (!local.remote_binding) throw new Error('Productive v2 state has no remote binding.')
      const transport = await session.transportForEpoch(selection.diary_id, selection.epoch_id)
      const codec = await session.codecForEpoch(selection.diary_id, selection.epoch_id, rootKey, transport)
      const verified = await codec.verifyRemote(await transport.read(local.remote_binding.remote_resource_id))
      const canonical = verified.profileState as { kind?: string; remote_anchor?: { covered_row_count?: number }; current_writer?: { writer_device_id?: string } }
      return {
        kind: canonical.kind ?? '',
        coveredRowCount: canonical.remote_anchor?.covered_row_count ?? 0,
        writerStatus: canonical.current_writer?.writer_device_id === local.writer_device_id ? 'writer_active' : 'read_only',
      }
    })
  }

  async refreshProductiveV2(device: VirtualDevice): Promise<void> {
    await device.page.evaluate(async () => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [dataLayer, provider] = await Promise.all([
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
      ])
      const session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      await dataLayer.installAuthenticatedRemoteSession(session)
    })
  }

  async reloadUnlockProductiveV2(device: VirtualDevice, lifecycle: ProductiveV2LifecycleSummary, actionId: string): Promise<{ writerStatus: string; painCount: number }> {
    await device.page.reload()
    await this.authenticate(device, actionId)
    return device.page.evaluate(async ({ expected }) => {
      const state = window as typeof window & { multiDeviceAuth?: { provider: { getApiClient(): unknown } }; productiveV2Session?: unknown }
      const [localDatabase, dataLayer, provider, painRepository] = await Promise.all([
        import('/src/data/localDatabase.ts'),
        import('/src/data/initializeDataLayer.ts'),
        import('/src/sync/google/GoogleTransferableSingleWriterV2Provider.ts'),
        import('/src/features/pain/painRepository.ts'),
      ])
      await localDatabase.unlockActiveRootWithPassphrase(expected.passphrase)
      const session = provider.googleV2ProviderSessionFromAuthenticatedClient(state.multiDeviceAuth!.provider.getApiClient() as never)
      state.productiveV2Session = session
      await dataLayer.installAuthenticatedRemoteSession(session)
      const status = await dataLayer.remoteSessionStatus()
      return { writerStatus: status.writerStatus ?? '', painCount: (await painRepository.listPainEntries()).length }
    }, { expected: lifecycle })
  }

  async writeProductivePain(device: VirtualDevice, note: string): Promise<{ writerStatus: string; painCount: number; coveredRowCount: number }> {
    return device.page.evaluate(async ({ value }) => {
      const [painRepository, dataLayer] = await Promise.all([
        import('/src/features/pain/painRepository.ts'),
        import('/src/data/initializeDataLayer.ts'),
      ])
      await painRepository.createPainEntry({ intensity: 6, note: value })
      const status = await dataLayer.remoteSessionStatus()
      return { writerStatus: status.writerStatus ?? '', painCount: (await painRepository.listPainEntries()).length, coveredRowCount: 0 }
    }, { value: note }).then(async (result) => ({ ...result, coveredRowCount: (await this.verifyProductiveV2Remote(device)).coveredRowCount }))
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

  /** L2/L3 protocol fixture for focused control tests only. It manually authors protocol bytes and is never Golden-Path or release-gate evidence. */
  async createTransferDescriptor(device: VirtualDevice): Promise<unknown> {
    return device.page.evaluate(async () => {
      const state = window as typeof window & { v2GoldenSession?: unknown; productiveV2Session?: unknown }
      const { ProductiveWriterHandoffV2Service } = await import('/src/data/writerHandoffV2Service.ts')
      return new ProductiveWriterHandoffV2Service((state.productiveV2Session ?? state.v2GoldenSession) as never).createTransferDescriptor()
    })
  }

  async handoffWriter(device: VirtualDevice, descriptor: unknown, faultPoint?: string): Promise<V2HandoffSummary> {
    return device.page.evaluate(async ({ transfer, point }) => {
      const state = window as typeof window & { v2GoldenSession?: unknown; productiveV2Session?: unknown }
      const { ProductiveWriterHandoffV2Service } = await import('/src/data/writerHandoffV2Service.ts')
      const { IndexedDbV2LocalSecurityStore } = await import('/src/security/v2/localPersistence.ts')
      const { activeProtocolSelectionV2, openSuccessorRootWrapV6WithActiveMode } = await import('/src/data/localDatabase.ts')
      const { deriveEpochSaltV2 } = await import('/src/security/v2/crypto.ts')
      const { fromBase64Url } = await import('/src/security/crypto/bytes.ts')
      const result = await new ProductiveWriterHandoffV2Service(
        (state.productiveV2Session ?? state.v2GoldenSession) as never,
        undefined,
        undefined,
        point ? (reached) => { if (reached === point) throw new Error(`persistent-crash:${point}`) } : undefined,
      ).handoff(transfer)
      const selection = await activeProtocolSelectionV2()
      if (!selection) throw new Error('Handoff source lost active selection.')
      const store = new IndexedDbV2LocalSecurityStore(), prepared = await store.loadRootWrapV6(selection.epoch_id)
      const rootKey = await openSuccessorRootWrapV6WithActiveMode(prepared)
      const local = await store.loadState(rootKey, await deriveEpochSaltV2(fromBase64Url(selection.diary_id), fromBase64Url(selection.epoch_id)), selection.epoch_id)
      return { stage: result.stage, writerStatus: local.writer_status, writerGeneration: local.writer_generation, remoteRows: result.expectedWriterGeneration }
    }, { transfer: descriptor, point: faultPoint })
  }

  async adoptWriter(device: VirtualDevice): Promise<V2HandoffSummary> {
    return device.page.evaluate(async () => {
      const state = window as typeof window & { v2GoldenSession?: unknown; productiveV2Session?: unknown }
      const { ProductiveWriterHandoffV2Service } = await import('/src/data/writerHandoffV2Service.ts')
      const local = await new ProductiveWriterHandoffV2Service((state.productiveV2Session ?? state.v2GoldenSession) as never).adoptGrantedWriter()
      return { stage: 'durable', writerStatus: local.writer_status, writerGeneration: local.writer_generation, remoteRows: local.remote_anchor?.covered_row_count ?? 0 }
    })
  }

  async forceTakeover(device: VirtualDevice, recoveryKey: string, faultPoint?: string): Promise<V2TakeoverSummary> {
    return device.page.evaluate(async ({ encodedRecoveryKey, point }) => {
      const state = window as typeof window & { v2GoldenSession?: unknown; productiveV2Session?: unknown }
      const [{ ProductiveForcedTakeoverV2Service }, { IndexedDbV2LocalSecurityStore }, { activeProtocolSelectionV2, openSuccessorRootWrapV6WithActiveMode }, { deriveEpochSaltV2 }, { fromBase64Url }] = await Promise.all([
        import('/src/data/forcedTakeoverV2Service.ts'),
        import('/src/security/v2/localPersistence.ts'),
        import('/src/data/localDatabase.ts'),
        import('/src/security/v2/crypto.ts'),
        import('/src/security/crypto/bytes.ts'),
      ])
      const result = await new ProductiveForcedTakeoverV2Service(
        (state.productiveV2Session ?? state.v2GoldenSession) as never,
        undefined,
        undefined,
        point ? async (reached) => { if (reached === point) throw new Error(`persistent-crash:${point}`) } : undefined,
      ).takeover(fromBase64Url(encodedRecoveryKey))
      const selection = await activeProtocolSelectionV2()
      if (!selection) throw new Error('Forced Takeover lost active selection.')
      const store = new IndexedDbV2LocalSecurityStore()
      const prepared = await store.loadRootWrapV6(selection.epoch_id)
      const rootKey = await openSuccessorRootWrapV6WithActiveMode(prepared)
      const epochSalt = await deriveEpochSaltV2(fromBase64Url(selection.diary_id), fromBase64Url(selection.epoch_id))
      const local = await store.loadState(rootKey, epochSalt, selection.epoch_id)
      return {
        stage: result.stage,
        writerStatus: local.writer_status,
        writerGeneration: local.writer_generation,
        remoteRows: local.remote_anchor?.covered_row_count ?? 0,
        maintenanceOnly: result.maintenanceOnly,
      }
    }, { encodedRecoveryKey: recoveryKey, point: faultPoint })
  }

  async snapshotAuthenticatedV2State(device: VirtualDevice, epochId: string): Promise<unknown> {
    return device.page.evaluate(async ({ epoch }) => {
      const { __v2LocalPersistenceTesting } = await import('/src/security/v2/localPersistence.ts')
      const database = await __v2LocalPersistenceTesting.openDatabase()
      const names = [
        __v2LocalPersistenceTesting.STORES.states,
        __v2LocalPersistenceTesting.STORES.reservations,
        __v2LocalPersistenceTesting.STORES.envelopes,
        __v2LocalPersistenceTesting.STORES.outbox,
        __v2LocalPersistenceTesting.STORES.readModels,
        __v2LocalPersistenceTesting.STORES.writerGrantOperations,
      ]
      const transaction = database.transaction(names, 'readonly')
      const entries = await Promise.all(names.map((name) => new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })))
      return { epoch, stores: names.map((name, index) => ({ name, entries: entries[index] })) }
    }, { epoch: epochId })
  }

  async restoreAuthenticatedV2State(device: VirtualDevice, backup: unknown): Promise<void> {
    await device.page.evaluate(async ({ stored }) => {
      const candidate = stored as { stores: Array<{ name: string; entries: unknown[] }> }
      const { __v2LocalPersistenceTesting } = await import('/src/security/v2/localPersistence.ts')
      const database = await __v2LocalPersistenceTesting.openDatabase()
      await new Promise<void>((resolve, reject) => {
        const names = candidate.stores.map((store) => store.name)
        const transaction = database.transaction(names, 'readwrite')
        for (const storeBackup of candidate.stores) {
          const objectStore = transaction.objectStore(storeBackup.name)
          objectStore.clear()
          for (const entry of storeBackup.entries) objectStore.put(entry)
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    }, { stored: backup })
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
      const query = url.searchParams.get('q') ?? ''
      const named = /name = '([^']+)'/u.exec(query)?.[1]
      const property = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/u.exec(query)
      await route.fulfill({
        json: {
          files: [...this.remotes.entries()].filter(([, remote]) => remote.name && !remote.trashed
            && (!named || remote.name === named)
            && (!property || remote.properties?.[property[1]!] === property[2])).map(([id, remote]) => ({
            id,
            name: remote.name,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            trashed: Boolean(remote.trashed),
            ownedByMe: true,
            shared: false,
            isAppAuthorized: true,
            appProperties: remote.properties ?? {},
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
        id: fileMatch[1], name: remote.name, mimeType: 'application/vnd.google-apps.spreadsheet', trashed: Boolean(remote.trashed),
        ownedByMe: true, shared: false, isAppAuthorized: true, appProperties: remote.properties ?? {},
      } })
      return
    }
    if (fileMatch && request.method() === 'PATCH') {
      const remote = this.remotes.get(fileMatch[1]!)
      if (!remote) { await route.fulfill({ status: 404 }); return }
      const payload = request.postDataJSON() as { appProperties?: Record<string, string>; trashed?: boolean }
      if (payload.appProperties) remote.properties = { ...payload.appProperties }
      if (payload.trashed !== undefined) remote.trashed = payload.trashed
      await route.fulfill({ json: { id: fileMatch[1], trashed: Boolean(remote.trashed), appProperties: remote.properties ?? {} } })
      return
    }
    if (url.pathname === '/v4/spreadsheets' && request.method() === 'POST') {
      const payload = request.postDataJSON() as {
        properties?: { title?: unknown }
        sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>
      }
      if (typeof payload.properties?.title !== 'string') { await route.fulfill({ status: 400 }); return }
      const definitions = payload.sheets ?? []
      const artifact = definitions.length === 1 && definitions[0]?.properties?.title === '_a'
      const artifactRows = definitions[0]?.properties?.gridProperties?.rowCount
      const sheetKind = artifact ? (artifactRows === 45 ? 'recovery-v6' : 'recovery-v5') : 'protocol'
      const remoteId = `simulated-sheet-${this.remotes.size + 1}`
      this.remotes.set(remoteId, {
        name: payload.properties.title,
        rows: [],
        manifest: [],
        protocolRows: [],
        artifactRows: artifact ? Array.from({ length: artifactRows ?? 1 }, () => '') : undefined,
        sheetKind,
        properties: {},
      })
      await route.fulfill({ json: {
        spreadsheetId: remoteId,
        sheets: definitions.map((_, index) => ({ properties: { sheetId: index + 1 } })),
      } })
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
        const sheets = remote.sheetKind === 'protocol' || !remote.sheetKind
          ? [
              { properties: { sheetId: 1, title: '_m', sheetType: 'GRID', gridProperties: { rowCount: 1, columnCount: 4 } }, merges: [] },
              { properties: { sheetId: 2, title: '_r', sheetType: 'GRID', gridProperties: { rowCount: Math.max(1, remote.protocolRows?.length ?? 0), columnCount: 3 } }, merges: [] },
            ]
          : [{ properties: { sheetId: 1, title: '_a', sheetType: 'GRID', gridProperties: { rowCount: remote.artifactRows?.length ?? 1, columnCount: 1 } }, merges: [] }]
        await route.fulfill({ json: { sheets } })
        return
      }
      if (fields.includes('sheets(properties(sheetId,title))')) {
        const sheets = remote.sheetKind === 'protocol' || !remote.sheetKind
          ? [{ properties: { sheetId: 1, title: '_m' } }, { properties: { sheetId: 2, title: '_r' } }]
          : [{ properties: { sheetId: 1, title: '_a' } }]
        await route.fulfill({ json: { sheets } })
        return
      }
      const title = range.includes('_a') ? '_a' : range.includes('_m') ? '_m' : '_r'
      const values = title === '_a'
        ? (remote.artifactRows ?? []).map((value) => value === '' ? [] : [value])
        : title === '_m' ? [remote.manifest ?? []] : (remote.protocolRows ?? [])
      await route.fulfill({ json: { sheets: [{ properties: { sheetId: title === '_r' ? 2 : 1, title }, data: [{
        startRow: 0,
        rowData: values.map((row) => row.length ? { values: row.map((value) => ({ userEnteredValue: { stringValue: value } })) } : {}),
      }] }] } })
      return
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as { row?: unknown; requests?: Array<{ updateCells?: { rows?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }> }; appendCells?: { rows?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }> } }> }
      if (typeof payload.row === 'string') remote.rows.push(payload.row)
      else if (payload.requests?.[0]?.updateCells) {
        const updated = payload.requests[0].updateCells.rows?.map((row) => row.values?.map((cell) => cell.userEnteredValue?.stringValue ?? '') ?? []) ?? []
        if (remote.sheetKind === 'protocol' || !remote.sheetKind) remote.manifest = updated[0] ?? []
        else remote.artifactRows = updated.map((row) => row[0] ?? '')
      }
      else if (payload.requests?.[0]?.appendCells) {
        const row = payload.requests[0].appendCells.rows?.[0]?.values?.map((cell) => cell.userEnteredValue?.stringValue ?? '') ?? []
        const fault = this.appendFaults.shift()
        if (fault?.kind === 'delay') await new Promise((resolve) => setTimeout(resolve, fault.milliseconds))
        if (fault?.kind === 'no_commit') { await route.abort('timedout'); return }
        if (fault?.kind === 'intervening_duplicate' && remote.protocolRows?.length) remote.protocolRows.push([...remote.protocolRows.at(-1)!])
        remote.protocolRows = [...(remote.protocolRows ?? []), row]
        if (fault?.kind === 'duplicate') remote.protocolRows.push([...row])
        if (fault?.kind === 'commit_response_lost') { await route.abort('timedout'); return }
      } else { await route.fulfill({ status: 400 }); return }
      await route.fulfill({ json: {} })
      return
    }
    if (request.method() === 'GET') { await route.fulfill({ json: { rows: remote.rows } }); return }
    await route.fulfill({ status: 405 })
  }
}
