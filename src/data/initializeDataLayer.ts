import { clearSecureSynchronizer, initializeSyncManager, installSecureSynchronizer } from './syncManager'
import { SingleWriterSyncService } from './singleWriterSyncService'
import type { GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { GoogleSheetsSingleWriterTransport } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { activeEpochSyncContext } from './localDatabase'
import { ProductiveRotationService, type CompletedRotation } from './productiveRotationService'

let initialized = false
let secureSync:SingleWriterSyncService|null=null

export interface GoogleRemoteSessionStatus {
  mode:'local_offline'|'remote_bound'
  epochId:string
  remoteResourceId:string|null
}

/** Called only after the provider identity and persisted remote binding have
 * been authenticated. This is the productive sync slot used by the app. */
export async function synchronizeDataLayer():Promise<void>{if(!secureSync)throw new Error('Secure single-writer sync is not authenticated.');await secureSync.synchronize()}

/** Called by the authenticated provider hand-off. It reconstructs the product
 * service from the MAC-authenticated active remote binding. */
export async function installAuthenticatedGoogleSession(api:GoogleApiClient):Promise<void>{
  const service=await SingleWriterSyncService.createGoogle(api)
  secureSync=service
  installSecureSynchronizer(()=>service.synchronize())
}
export function clearAuthenticatedRemoteSession():void{secureSync=null;clearSecureSynchronizer()}

export async function googleRemoteSessionStatus():Promise<GoogleRemoteSessionStatus>{
  const active=await activeEpochSyncContext(),binding=active.state.remote_binding
  return{mode:binding?'remote_bound':'local_offline',epochId:active.epochId,remoteResourceId:binding?.remote_resource_id??null}
}

/** First productive Google enablement. The caller must supply a separately saved
 * 32-byte recovery secret; the operation creates a new remote-bound epoch rather
 * than binding the local-offline pseudo-manifest in place. */
export async function enableAuthenticatedGoogleSession(api:GoogleApiClient,urs:Uint8Array):Promise<CompletedRotation>{
  if(urs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
  const active=await activeEpochSyncContext()
  if(active.state.remote_binding||active.state.remote_anchor||active.state.epoch_status!=='local_offline')throw new Error('The active epoch is not eligible for first remote enablement.')
  const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(api,active.diaryId,active.epochId)
  const result=await ProductiveRotationService.remoteEnablement(transport,urs).rotate()
  await installAuthenticatedGoogleSession(api)
  return result
}

/** Product entry point used by an already remote-bound authenticated settings lifecycle. */
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
