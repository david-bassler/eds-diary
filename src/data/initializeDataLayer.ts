import { initializeSyncManager } from './syncManager'
import type { SingleWriterSyncService } from './singleWriterSyncService'

let initialized = false
let secureSync:SingleWriterSyncService|null=null

/** Called only after the provider identity and persisted remote binding have
 * been authenticated.  This is the productive sync slot used by the app. */
export function registerSingleWriterSync(service:SingleWriterSyncService):void{secureSync=service}
export async function synchronizeDataLayer():Promise<void>{if(!secureSync)throw new Error('Secure single-writer sync is not authenticated.');await secureSync.synchronize()}

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true

  // Legacy whole-table feature synchronizers are intentionally not registered.
  // The immutable envelope outbox is the only productive remote write source.
  initializeSyncManager()
}
