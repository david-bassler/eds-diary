import { clearSecureSynchronizer, initializeSyncManager, installSecureSynchronizer } from './syncManager'
import { SingleWriterSyncService } from './singleWriterSyncService'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import { activeEpochSyncContext, activeProtocolSelectionV2, openSuccessorRootWrapV6WithActiveMode } from './localDatabase'
import { normalizeLegacyActivityEntriesForSecureMigration } from './legacyCompatibility'
import { ProductiveRotationService, type CompletedRotation } from './productiveRotationService'
import { ensurePersistentStorage } from './storageDurability'
import { installAuthenticatedV2RemoteSession, disconnectAuthenticatedV2RemoteSession } from './v2ApplicationRuntime'
import { ProductiveRecoveryRekeyV2Service, type RecoveryRekeyResultV2 } from './recoveryRekeyV2Service'
import { ProductiveNativeRotationV2Service, type NativeRotationResultV2 } from './nativeRotationV2Service'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { fixedBase64Url } from '../security/crypto/bytes'

type AuthenticatedProviderSession=SingleWriterProviderSession|TransferableSingleWriterV2ProviderSession
interface SecureSynchronizer {synchronize():Promise<void>}

let initialized = false
let secureSync:SecureSynchronizer|null=null
let activeProviderSession:AuthenticatedProviderSession|null=null
let legacyCompatibilityPromise:Promise<void>|null=null

function ensureLegacyCompatibility():Promise<void>{
  legacyCompatibilityPromise??=normalizeLegacyActivityEntriesForSecureMigration()
  return legacyCompatibilityPromise
}
function isV1Session(value:AuthenticatedProviderSession):value is SingleWriterProviderSession{return value.profileId===SINGLE_WRITER_V1_PROFILE}
function isV2Session(value:AuthenticatedProviderSession):value is TransferableSingleWriterV2ProviderSession{return value.profileId===SINGLE_WRITER_V2_PROFILE}

export interface RemoteSessionStatus {
  mode:'local_offline'|'remote_bound'
  profile:'v1'|'v2'
  epochId:string
  remoteResourceId:string|null
  writerStatus?:'writer_active'|'read_only'
  recoveryRekeyRequired?:boolean
}

async function activeV2Status():Promise<RemoteSessionStatus|null>{
  const selection=await activeProtocolSelectionV2()
  if(!selection)return null
  const store=new IndexedDbV2LocalSecurityStore(),wrap=await store.loadRootWrapV6(selection.epoch_id)
  const rootKey=await openSuccessorRootWrapV6WithActiveMode(wrap)
  const salt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
  const state=await store.loadState(rootKey,salt,selection.epoch_id)
  if(state.diary_id!==selection.diary_id||state.manifest_fingerprint!==selection.manifest_fingerprint)throw new Error('Active v2 protocol selection does not match StateV6.')
  return{
    mode:state.remote_binding?'remote_bound':'local_offline',
    profile:'v2',
    epochId:state.epoch_id,
    remoteResourceId:state.remote_binding?.remote_resource_id??null,
    writerStatus:state.writer_status,
    recoveryRekeyRequired:state.recovery_rekey_rotation_required,
  }
}

/** Productive sync slot used after an authenticated provider session has been
 * established by a concrete UI/provider adapter. */
export async function synchronizeDataLayer():Promise<void>{
  if(!secureSync)throw new Error('Secure single-writer sync is not authenticated.')
  await secureSync.synchronize()
}

export async function installAuthenticatedRemoteSession(session:AuthenticatedProviderSession):Promise<void>{
  const v2=await activeProtocolSelectionV2()
  if(v2){
    if(!isV2Session(session))throw new Error('An active v2 diary requires a transferable-single-writer v2 provider session.')
    if(activeProviderSession&&activeProviderSession!==session)await disconnectCurrentSession()
    const service=await installAuthenticatedV2RemoteSession(session)
    activeProviderSession=session
    secureSync=service
    installSecureSynchronizer(()=>service.synchronize())
    await service.refreshVerifiedReadModel()
    return
  }
  if(!isV1Session(session))throw new Error('The active v1 diary requires a single-writer-v1 provider session.')
  await ensureLegacyCompatibility()
  if(activeProviderSession&&activeProviderSession!==session)await disconnectCurrentSession()
  const service=await SingleWriterSyncService.createAuthenticated(session)
  activeProviderSession=session
  secureSync=service
  installSecureSynchronizer(()=>service.synchronize())
}

async function disconnectCurrentSession():Promise<void>{
  const session=activeProviderSession
  activeProviderSession=null
  secureSync=null
  clearSecureSynchronizer()
  if(session?.profileId===SINGLE_WRITER_V2_PROFILE)await disconnectAuthenticatedV2RemoteSession()
  else await session?.disconnect()
}

export async function clearAuthenticatedRemoteSession():Promise<void>{await disconnectCurrentSession()}

export async function remoteSessionStatus():Promise<RemoteSessionStatus>{
  const v2=await activeV2Status()
  if(v2)return v2
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext(),binding=active.state.remote_binding
  return{mode:binding?'remote_bound':'local_offline',profile:'v1',epochId:active.epochId,remoteResourceId:binding?.remote_resource_id??null}
}

/** First productive remote enablement exists only for the legacy v1 local
 * diary. An already-selected v2 diary must use Join/profile-upgrade semantics. */
export async function enableAuthenticatedRemoteSession(session:SingleWriterProviderSession,urs:Uint8Array):Promise<CompletedRotation>{
  if(await activeProtocolSelectionV2())throw new Error('v1 remote enablement is forbidden after v2 protocol selection.')
  if(urs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext()
  if(active.state.remote_binding||active.state.remote_anchor||active.state.epoch_status!=='local_offline')throw new Error('The active epoch is not eligible for first remote enablement.')
  const transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await ProductiveRotationService.remoteEnablement(session,transport,urs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

export async function replaceRecoverySecret(
  session:AuthenticatedProviderSession,
  newUrs:Uint8Array,
):Promise<CompletedRotation|RecoveryRekeyResultV2>{
  if(newUrs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
  if(await activeProtocolSelectionV2()){
    if(!isV2Session(session))throw new Error('v2 Recovery-Rekey requires a v2 provider session.')
    const result=await new ProductiveRecoveryRekeyV2Service(session).rekey(newUrs)
    await installAuthenticatedRemoteSession(session)
    return result
  }
  if(!isV1Session(session))throw new Error('v1 Recovery-Rekey requires a v1 provider session.')
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext()
  if(!active.state.remote_binding||active.state.epoch_status!=='active')throw new Error('Recovery key replacement requires an active authenticated remote epoch.')
  const transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await ProductiveRotationService.recoveryRekey(session,transport,newUrs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

export async function rotateAuthenticatedRemoteSession(
  session:AuthenticatedProviderSession,
  urs:Uint8Array,
):Promise<CompletedRotation|NativeRotationResultV2>{
  if(await activeProtocolSelectionV2()){
    if(!isV2Session(session))throw new Error('Native v2 rotation requires a v2 provider session.')
    const result=await new ProductiveNativeRotationV2Service(session,urs).rotate('normal')
    await installAuthenticatedRemoteSession(session)
    return result
  }
  if(!isV1Session(session))throw new Error('v1 rotation requires a v1 provider session.')
  await ensureLegacyCompatibility()
  const active=await activeEpochSyncContext(),transport=await session.transportForEpoch(active.diaryId,active.epochId)
  const result=await new ProductiveRotationService(session,transport,urs).rotate()
  await installAuthenticatedRemoteSession(session)
  return result
}

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true
  initializeSyncManager()
  void ensurePersistentStorage().catch(()=>undefined)
}
