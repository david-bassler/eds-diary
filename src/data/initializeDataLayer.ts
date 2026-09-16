import { initializeSyncManager } from './syncManager'

let initialized = false

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true

  // Legacy whole-table feature synchronizers are intentionally not registered.
  // The immutable envelope outbox is the only productive remote write source.
  initializeSyncManager()
}
