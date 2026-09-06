import {
  isGoogleConnected,
  onGoogleConnection,
} from './googleSheets'

export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'error'

export interface SyncSnapshot {
  state: SyncState
  error: Error | null
  connected: boolean
}

interface SyncHandler {
  push: () => Promise<void>
  full: () => Promise<void>
}

const handlers = new Map<string, SyncHandler>()
const dirtyVersions = new Map<string, number>()
const listeners = new Set<(snapshot: SyncSnapshot) => void>()

let version = 0
let timer: number | null = null
let running: Promise<void> | null = null
let requestedFull = false
let initialized = false
let currentSnapshot: SyncSnapshot = {
  state: 'local',
  error: null,
  connected: false,
}

function emit(state: SyncState, error: Error | null = null): void {
  currentSnapshot = {
    state,
    error,
    connected: isGoogleConnected(),
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
  handlers.set(name, {
    push: handler.push,
    full: handler.full ?? handler.push,
  })
}

export function markDirty(name: string): void {
  version += 1
  dirtyVersions.set(name, version)
  emit('pending')

  if (timer !== null) window.clearTimeout(timer)

  if (isGoogleConnected()) {
    timer = window.setTimeout(() => {
      void syncPending()
    }, 1400)
  }
}

async function performPass(full: boolean): Promise<void> {
  emit('syncing')
  const names = full ? [...handlers.keys()] : [...dirtyVersions.keys()]

  for (const name of names) {
    const handler = handlers.get(name)
    if (!handler) continue

    const capturedVersion = dirtyVersions.get(name)
    await (full ? handler.full() : handler.push())

    if (dirtyVersions.get(name) === capturedVersion) {
      dirtyVersions.delete(name)
    }
  }
}

async function run(full: boolean): Promise<void> {
  if (!isGoogleConnected()) {
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
      : isGoogleConnected()
        ? 'synced'
        : 'local',
  )
}

export function initializeSyncManager(): void {
  if (initialized) return
  initialized = true

  onGoogleConnection((connected) => {
    refreshSyncState()
    if (connected) void syncAll().catch(() => {})
  })

  window.addEventListener('online', () => {
    if (isGoogleConnected()) void syncPending().catch(() => {})
  })
}
