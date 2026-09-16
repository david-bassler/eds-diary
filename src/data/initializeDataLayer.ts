import { clearSecureSynchronizer, initializeSyncManager, installSecureSynchronizer } from './syncManager'
import { SingleWriterSyncService } from './singleWriterSyncService'
import type { GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { GoogleSheetsSingleWriterTransport } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { activeEpochSyncContext } from './localDatabase'
import { ProductiveRotationService, type CompletedRotation } from './productiveRotationService'

let initialized = false
let secureSync:SingleWriterSyncService|null=null

/** Called only after the provider identity and persisted remote binding have
 * been authenticated.  This is the productive sync slot used by the app. */
export async function synchronizeDataLayer():Promise<void>{if(!secureSync)throw new Error('Secure single-writer sync is not authenticated.');await secureSync.synchronize()}

/** Called by the authenticated provider hand-off. It constructs (and on reload
 * reconstructs) the product service from the MAC-authenticated active binding. */
export async function installAuthenticatedGoogleSession(api:GoogleApiClient):Promise<void>{
  const service=await SingleWriterSyncService.createGoogle(api)
  secureSync=service
  installSecureSynchronizer(()=>service.synchronize())
}
export function clearAuthenticatedRemoteSession():void{secureSync=null;clearSecureSynchronizer()}

/** Product entry point used by the authenticated settings lifecycle. */
export async function rotateAuthenticatedGoogleSession(api:GoogleApiClient,urs:Uint8Array):Promise<CompletedRotation>{
  const active=await activeEpochSyncContext(),transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(api,active.diaryId,active.epochId)
  const result=await new ProductiveRotationService(transport,urs).rotate()
  await installAuthenticatedGoogleSession(api)
  return result
}

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true

  // Legacy whole-table feature synchronizers are intentionally not registered.
  // The immutable envelope outbox is the only productive remote write source.
  initializeSyncManager()
}
