export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'error'

export interface SyncSnapshot {
  state: SyncState
  error: Error | null
  connected: boolean
}

const dirtyVersions = new Map<string, number>()
const listeners = new Set<(snapshot: SyncSnapshot) => void>()

let version = 0
let timer: ReturnType<typeof globalThis.setTimeout> | null = null
let running: Promise<void> | null = null
let requestedFull = false
let initialized = false
let secureSynchronizer:(()=>Promise<void>)|null=null
let currentSnapshot: SyncSnapshot = {
  state: 'local',
  error: null,
  connected: false,
}

function emit(state: SyncState, error: Error | null = null): void {
  currentSnapshot = {
    state,
    error,
    connected: secureSynchronizer !== null,
  }

  for (const listener of listeners) listener(currentSnapshot)
}

export function getSyncSnapshot(): SyncSnapshot {
  return { ...currentSnapshot }
}

export function onSyncState(
  listener: (snapshot: SyncSnapshot) => void,
): () => void {
  listeners.add(listener)
  listener(getSyncSnapshot())
  return () => listeners.delete(listener)
}

export function registerSyncFeature(
  name: string,
  handler: {
    push: () => Promise<void>
    full?: () => Promise<void>
  },
): void {
  void name;void handler
  throw new Error('Legacy whole-table remote writers are disabled; immutable envelopes are the only sync source.')
}

/** Data-layer-only hook. Authentication installs the verified coordinator here;
 * no provider login state on its own grants writer authority. */
export function installSecureSynchronizer(synchronize:()=>Promise<void>):void{secureSynchronizer=synchronize;refreshSyncState()}
export function clearSecureSynchronizer():void{secureSynchronizer=null;refreshSyncState()}

export function markDirty(name: string): void {
  version += 1
  dirtyVersions.set(name, version)
  emit('pending')

  if (timer !== null) globalThis.clearTimeout(timer)

  if (secureSynchronizer) {
    timer = globalThis.setTimeout(() => {
      void syncPending()
    }, 1400)
  }
}

async function performPass(full: boolean): Promise<void> {
  emit('syncing')
  void full
  if(!secureSynchronizer)throw new Error('Secure single-writer sync is not authenticated.')
  const captured=new Map(dirtyVersions)
  await secureSynchronizer()
  for(const[name,value]of captured)if(dirtyVersions.get(name)===value)dirtyVersions.delete(name)
}

async function run(full: boolean): Promise<void> {
  if (!secureSynchronizer) {
    emit(dirtyVersions.size ? 'pending' : 'local')
    return
  }

  requestedFull = requestedFull || full
  if (running) return running

  running = (async () => {
    try {
      do {
        const shouldRunFull = requestedFull
        requestedFull = false
        await performPass(shouldRunFull)
      } while (requestedFull || dirtyVersions.size)

      emit('synced')
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('Synchronisierung fehlgeschlagen.')
      emit('error', error)
      throw error
    } finally {
      running = null
    }
  })()

  return running
}

export function syncPending(): Promise<void> {
  return run(false)
}

export function syncAll(): Promise<void> {
  return run(true)
}

export function refreshSyncState(): void {
  emit(
    dirtyVersions.size
      ? 'pending'
      : secureSynchronizer
        ? 'synced'
        : 'local',
  )
}

export function initializeSyncManager(): void {
  if (initialized) return
  initialized = true

  window.addEventListener('online', () => {
    // Online is transport availability, not permission to mutate remote state.
    if (secureSynchronizer) emit(dirtyVersions.size ? 'pending' : 'local')
  })
}
