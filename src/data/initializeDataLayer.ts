import { clearSecureSynchronizer, initializeSyncManager, installSecureSynchronizer } from './syncManager'
import { SingleWriterSyncService } from './singleWriterSyncService'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import { activeEpochSyncContext } from './localDatabase'
import { normalizeLegacyActivityEntriesForSecureMigration } from './legacyCompatibility'
import { ProductiveRotationService, type CompletedRotation } from './productiveRotationService'

let initialized = false
let secureSync:SingleWriterSyncService|null=null
let activeProviderSession:SingleWriterProviderSession|null=null
let legacyCompatibilityPromise:Promise<void>|null=null

function ensureLegacyCompatibility():Promise<void>{
  legacyCompatibilityPromise??=normalizeLegacyActivityEntriesForSecureMigration()
  return legacyCompatibilityPromise
}

export interface RemoteSessionStatus {
  mode:'local_offline'|'remote_bound'
  epochId:string
  remoteResourceId:string|null
}

/** Productive sync slot used after an authenticated provider session has been
 * established by a concrete UI/provider adapter. */
export async function synchronizeDataLayer():Promise<void>{if(!secureSync)throw new Error('Secure single-writer sync is not authenticated.');await secureSync.synchronize()}

export async function installAuthenticatedRemoteSession(session:SingleWriterProviderSession):Promise<void>{
  await ensureLegacyCompatibility()
  const service=await SingleWriterSyncService.createAuthenticated(session)
  activeProviderSession=session
  secureSync=service
  installSecureSynchronizer(()=>service.synchronize())
}

export async function clearAuthenticatedRemoteSession():Promise<void>{
  const session=activeProviderSession
  activeProviderSession=null
  secureSync=null
  clearSecureSynchronizer()
  await session?.disconnect()
}

export async function remoteSessionStatus():Promise<RemoteSessionStatus>{
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext(),binding=active.state.remote_binding
  return{mode:binding?'remote_bound':'local_offline',epochId:active.epochId,remoteResourceId:binding?.remote_resource_id??null}
}

/** First productive remote enablement. The caller supplies an authenticated
 * provider session and a separately saved 32-byte recovery secret. */
export async function enableAuthenticatedRemoteSession(session:SingleWriterProviderSession,urs:Uint8Array):Promise<CompletedRotation>{
  if(urs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext()
  if(active.state.remote_binding||active.state.remote_anchor||active.state.epoch_status!=='local_offline')throw new Error('The active epoch is not eligible for first remote enablement.')
  const transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await ProductiveRotationService.remoteEnablement(session,transport,urs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

/** Product entry point used by an already remote-bound authenticated session. */
export async function replaceRecoverySecret(session:SingleWriterProviderSession,newUrs:Uint8Array):Promise<CompletedRotation>{
  if(newUrs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext()
  if(!active.state.remote_binding||active.state.epoch_status!=='active')throw new Error('Recovery key replacement requires an active authenticated remote epoch.')
  const transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await ProductiveRotationService.recoveryRekey(session,transport,newUrs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

/** Product entry point used by an already remote-bound authenticated session. */
export async function rotateAuthenticatedRemoteSession(session:SingleWriterProviderSession,urs:Uint8Array):Promise<CompletedRotation>{
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext(),transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await new ProductiveRotationService(session,transport,urs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true

  // Legacy whole-table feature synchronizers are intentionally not registered.
  // The immutable envelope outbox is the only productive remote write source.
  initializeSyncManager()
}
