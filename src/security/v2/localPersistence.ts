import { base64Url, equalBytes, fixedBase64Url, fromBase64Url, randomBytes } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { hmacSha256, sha256 } from '../crypto/core'
import { deriveLocalStateMacKeyV2, recoveryTakeoverKeyIdV2, revisionSigningBytesV2, verifyEd25519V2, writerGrantSigningBytesV2 } from './crypto'
import { openRevisionEnvelopeV2 } from './envelopes'
import type { PreparedEnvelope } from '../envelopes'
import { localJournalInitialV2, localJournalNextV2, localStateTagV6, recoveryCredentialHistoryHashV2, validateEpochLocalSecurityStateV6, validateStoredWriterDeviceKeyV2, verifyLocalStateTagV6, withDiaryLockV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from './localState'
import { isVerifiedRecoveryTakeoverStagingV2, openRecoveryTakeoverStagingV2, verifyRecoveryTakeoverStagingV2, type RecoveryTakeoverStagingV2, type VerifiedRecoveryTakeoverStagingV2 } from './recoveryStaging'
import { openRecoveryArtifactV6, recoveryArtifactHashV6, recoveryArtifactLocatorV6, recoveryFamilyLocatorV6, type RecoveryArtifactV6 } from './recovery'
import { activationLineageCacheHashV2, openActivationLineageCacheV2, type ActivationLineageCacheV2 } from './activationLineageCache'
import { advanceRotationOperationStateV2, rotationOperationStateHashV2, validateRotationOperationStateV2, type RotationOperationStateV2, type RotationOperationStageV2 } from './profileUpgrade'
import { openBestEffortRootWrapV6, validateRootWrapV6, type RootWrapV6 } from './rootWrap'
import { advanceWriterGrantOperationStateV2, validateWriterGrantOperationStateV2, writerGrantOperationStateHashV2, type WriterGrantOperationStageV2, type WriterGrantOperationStateV2 } from './writerGrantOperation'
import { advanceRecoveryRekeyOperationStateV2, recoveryRekeyOperationStateHashV2, validateRecoveryRekeyOperationStateV2, type RecoveryRekeyOperationStateV2, type RecoveryRekeyStageV2 } from './recoveryRekeyOperation'
import type { CreationPersistence, CreationState } from '../../sync/core/creation'
import type { RecoveryAuthorityTransitionV2, WriterGrantV2 } from './types'

const DATABASE_NAME='eds-diary-v2-security'
const DATABASE_VERSION=10
const STORES={states:'epochSecurityStateV6',writerKeys:'writerDeviceKeysV2',reservations:'envelopeReservationsV6',envelopes:'envelopesV6',outbox:'outboxV6',recoveryStaging:'recoveryTakeoverStagingV2',recoveryArtifacts:'recoveryArtifactsV6',rotationOperations:'rotationOperationsV2',writerGrantOperations:'writerGrantOperationsV2',lineageCaches:'activationLineageCachesV2',rootWraps:'rootWrapsV6',rootWrappingKeys:'rootWrappingKeysV6',creationOperations:'creationOperationsV2',operationArtifacts:'operationArtifactsV2'} as const

const TERMINAL_ROTATION_OPERATION_STATES_V2=new Set(['switched','stale','cutover_race','post_activation_superseded'])
const TERMINAL_WRITER_GRANT_OPERATION_STATES_V2=new Set(['durable','stale'])
const TERMINAL_RECOVERY_OPERATION_STATES_V2=new Set(['completed','stale','superseded'])

export interface EnvelopeReservationV6 {
  id:string
  epoch_id:string
  envelope_id:string
  iv:string
  state:'reserved'|'sealed'
}
export interface PersistedEnvelopeV6 extends PreparedEnvelope {
  id:string
  epoch_id:string
  local_sequence:number
}
export interface PreparedEnvelopeAuthorityV2 {
  writer_generation:number
  writer_grant_id:string
  writer_device_id:string
  writer_key_id:string
}
export interface VerifiedDispositionContextV2 {
  remote_rows:ReadonlyArray<readonly string[]>
  current_writer:PreparedEnvelopeAuthorityV2
  source_epoch_sealed:boolean
  recovery_rekey_rotation_required:boolean
  preserve_ceremony_owned?:boolean
}
export type V2OutboxStatus='prepared'|'pending'|'durable'|'stale_writer_pending'
export type V2OutboxCeremonyOwner='rotation'|'recovery_rekey'
export interface V2OutboxEntryCore {
  id:string
  epoch_id:string
  envelope_id:string
  status:V2OutboxStatus
  authority:PreparedEnvelopeAuthorityV2|null
  ceremony_owner?:V2OutboxCeremonyOwner
}
export interface V2OutboxEntry extends V2OutboxEntryCore {tag:string}
async function outboxTag(rootKey:Uint8Array,epochSalt:Uint8Array,entry:V2OutboxEntryCore):Promise<string>{
  return base64Url(await hmacSha256(await deriveLocalStateMacKeyV2(rootKey,epochSalt),canonicalBytes(entry as never)))
}
async function verifyOutboxTag(rootKey:Uint8Array,epochSalt:Uint8Array,entry:V2OutboxEntry):Promise<void>{
  const {tag,...core}=entry,expected=fromBase64Url(await outboxTag(rootKey,epochSalt,core))
  if(!equalBytes(fixedBase64Url(tag,32,'outbox_tag'),expected))throw new Error('V2 outbox MAC failed.')
}

function sameAuthority(left:PreparedEnvelopeAuthorityV2|null,right:PreparedEnvelopeAuthorityV2):boolean{
  return left!==null
    &&left.writer_generation===right.writer_generation
    &&left.writer_grant_id===right.writer_grant_id
    &&left.writer_device_id===right.writer_device_id
    &&left.writer_key_id===right.writer_key_id
}
function assertStateTransition(current:EpochLocalSecurityStateV6,next:EpochLocalSecurityStateV6):void{
  if(current.epoch_status==='orphaned'&&next.epoch_status!=='orphaned')throw new Error('Orphaned v2 epochs are terminal and cannot be reactivated.')
}
function assertOutboxTransition(current:V2OutboxStatus,next:V2OutboxStatus):void{
  if(current==='durable'&&next!=='durable')throw new Error('Durable v2 outbox entries are terminal.')
  if(current==='stale_writer_pending'&&next!=='stale_writer_pending')throw new Error('Stale-writer quarantine is terminal.')
}
async function assertAuthorityMatchesEnvelope(
  rootKey:Uint8Array,
  epochSalt:Uint8Array,
  diaryId:string,
  epochId:string,
  envelope:PreparedEnvelope,
  authority:PreparedEnvelopeAuthorityV2|null,
):Promise<void>{
  const revision=await openRevisionEnvelopeV2(rootKey,epochSalt,{diaryId,epochId},envelope)
  const context=revision.writer_context
  if(authority===null){
    if(revision.record_schema!=='writer-grant-sw-v2'||context!==null||revision.writer_signature!==null)throw new Error('Only WriterGrantV2 may omit persisted Writer provenance.')
    return
  }
  if(!context
    ||context.writer_generation!==authority.writer_generation
    ||context.writer_grant_id!==authority.writer_grant_id
    ||context.writer_device_id!==authority.writer_device_id
    ||context.writer_key_id!==authority.writer_key_id)throw new Error('Prepared envelope Writer provenance does not match its encrypted RevisionV2.')
}

function requestResult<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.addEventListener('success',()=>resolve(request.result),{once:true})
    request.addEventListener('error',()=>reject(request.error??new Error('IndexedDB request failed.')),{once:true})
  })
}
function transactionDone(tx:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    tx.addEventListener('complete',()=>resolve(),{once:true})
    tx.addEventListener('abort',()=>reject(tx.error??new Error('IndexedDB transaction aborted.')),{once:true})
    tx.addEventListener('error',()=>reject(tx.error??new Error('IndexedDB transaction failed.')),{once:true})
  })
}
let databasePromise:Promise<IDBDatabase>|null=null
async function openDatabase():Promise<IDBDatabase>{
  if(databasePromise)return databasePromise
  databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,DATABASE_VERSION)
    request.addEventListener('upgradeneeded',()=>{
      const db=request.result
      if(!db.objectStoreNames.contains(STORES.states))db.createObjectStore(STORES.states,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.writerKeys))db.createObjectStore(STORES.writerKeys,{keyPath:'writer_signing_key_id'})
      if(!db.objectStoreNames.contains(STORES.reservations)){
        const store=db.createObjectStore(STORES.reservations,{keyPath:'id'})
        store.createIndex('byEpoch','epoch_id')
        store.createIndex('byEpochIv',['epoch_id','iv'],{unique:true})
      }else{
        const store=request.transaction!.objectStore(STORES.reservations)
        if(!store.indexNames.contains('byEpochIv'))store.createIndex('byEpochIv',['epoch_id','iv'],{unique:true})
      }
      if(!db.objectStoreNames.contains(STORES.envelopes)){const store=db.createObjectStore(STORES.envelopes,{keyPath:'id'});store.createIndex('byEpoch','epoch_id');store.createIndex('bySequence',['epoch_id','local_sequence'],{unique:true})}
      if(!db.objectStoreNames.contains(STORES.outbox)){const store=db.createObjectStore(STORES.outbox,{keyPath:'id'});store.createIndex('byEpoch','epoch_id')}
      if(!db.objectStoreNames.contains(STORES.recoveryStaging))db.createObjectStore(STORES.recoveryStaging,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.recoveryArtifacts))db.createObjectStore(STORES.recoveryArtifacts,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.rotationOperations))db.createObjectStore(STORES.rotationOperations,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.writerGrantOperations))db.createObjectStore(STORES.writerGrantOperations,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.lineageCaches))db.createObjectStore(STORES.lineageCaches,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.rootWraps))db.createObjectStore(STORES.rootWraps,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.rootWrappingKeys))db.createObjectStore(STORES.rootWrappingKeys,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.creationOperations))db.createObjectStore(STORES.creationOperations,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.operationArtifacts))db.createObjectStore(STORES.operationArtifacts,{keyPath:'id'})
    })
    request.addEventListener('success',()=>{
      const db=request.result
      db.addEventListener('versionchange',()=>{db.close();databasePromise=null})
      resolve(db)
    },{once:true})
    request.addEventListener('error',()=>{databasePromise=null;reject(request.error??new Error('V2 security database open failed.'))},{once:true})
  })
  return databasePromise
}

const VERIFIED_PERSISTED_RECOVERY_ARTIFACTS=new WeakSet<VerifiedPersistedRecoveryArtifactV6>()
const VERIFIED_PERSISTED_RECOVERY_ARTIFACT_TOKEN=Symbol('VerifiedPersistedRecoveryArtifactV6')
export class VerifiedPersistedRecoveryArtifactV6 {
  constructor(
    readonly artifact:RecoveryArtifactV6,
    readonly artifactSha256:string,
    readonly familyLocator:string,
    readonly artifactLocator:string,
    readonly diaryId:string,
    readonly epochId:string,
    token:symbol,
  ){
    if(token!==VERIFIED_PERSISTED_RECOVERY_ARTIFACT_TOKEN)throw new Error('VerifiedPersistedRecoveryArtifactV6 can only be created after persistent readback verification.')
    VERIFIED_PERSISTED_RECOVERY_ARTIFACTS.add(this)
  }
}
export function isVerifiedPersistedRecoveryArtifactV6(value:unknown):value is VerifiedPersistedRecoveryArtifactV6{
  return typeof value==='object'&&value!==null&&VERIFIED_PERSISTED_RECOVERY_ARTIFACTS.has(value as VerifiedPersistedRecoveryArtifactV6)
}

export class IndexedDbV2LocalSecurityStore {
  creationPersistence():CreationPersistence{
    return{
      read:async(locator:string)=>{
        const db=await openDatabase(),tx=db.transaction(STORES.creationOperations,'readonly')
        const stored=await requestResult<{id:string;state:CreationState;hash:string}|undefined>(tx.objectStore(STORES.creationOperations).get(locator))
        await transactionDone(tx)
        if(!stored)return null
        const hash=base64Url(await sha256(canonicalBytes(stored.state as never)))
        if(hash!==stored.hash)throw new Error('V2 creation operation state hash failed.')
        return structuredClone(stored.state)
      },
      write:async(state:CreationState)=>{
        const db=await openDatabase(),readTx=db.transaction(STORES.creationOperations,'readonly')
        const prior=await requestResult<{id:string;state:CreationState;hash:string}|undefined>(readTx.objectStore(STORES.creationOperations).get(state.locator))
        await transactionDone(readTx)
        const expected=prior?.state.operationGeneration??0
        if((state.operationGeneration??0)!==expected)throw new Error('Stale V2 creation operation generation.')
        const next={...state,operationGeneration:expected+1},hash=base64Url(await sha256(canonicalBytes(next as never)))
        const tx=db.transaction(STORES.creationOperations,'readwrite')
        tx.objectStore(STORES.creationOperations).put({id:state.locator,state:structuredClone(next),hash})
        await transactionDone(tx)
      },
    }
  }

  async putImmutableOperationArtifact(id:string,value:unknown):Promise<string>{
    if(!id)throw new Error('V2 operation artifact ID is required.')
    const bytes=new TextDecoder().decode(canonicalBytes(value as never)),hash=base64Url(await sha256(canonicalBytes(value as never))),db=await openDatabase()
    const readTx=db.transaction(STORES.operationArtifacts,'readonly')
    const existing=await requestResult<{id:string;value:unknown;bytes:string;hash:string}|undefined>(readTx.objectStore(STORES.operationArtifacts).get(id))
    await transactionDone(readTx)
    if(existing){
      if(existing.bytes!==bytes||existing.hash!==hash)throw new Error('V2 immutable operation artifact collision.')
      return hash
    }
    const tx=db.transaction(STORES.operationArtifacts,'readwrite')
    tx.objectStore(STORES.operationArtifacts).add({id,value:structuredClone(value),bytes,hash})
    await transactionDone(tx)
    const verifyTx=db.transaction(STORES.operationArtifacts,'readonly')
    const readback=await requestResult<{id:string;value:unknown;bytes:string;hash:string}|undefined>(verifyTx.objectStore(STORES.operationArtifacts).get(id))
    await transactionDone(verifyTx)
    if(!readback||readback.bytes!==bytes||readback.hash!==hash)throw new Error('V2 operation artifact persistent readback mismatch.')
    return hash
  }

  async operationArtifact<T>(id:string):Promise<T|null>{
    const db=await openDatabase(),tx=db.transaction(STORES.operationArtifacts,'readonly')
    const stored=await requestResult<{id:string;value:T;bytes:string;hash:string}|undefined>(tx.objectStore(STORES.operationArtifacts).get(id))
    await transactionDone(tx)
    if(!stored)return null
    const bytes=new TextDecoder().decode(canonicalBytes(stored.value as never)),hash=base64Url(await sha256(canonicalBytes(stored.value as never)))
    if(bytes!==stored.bytes||hash!==stored.hash)throw new Error('V2 operation artifact integrity failed.')
    return structuredClone(stored.value)
  }

  async persistProfileUpgradeSuccessorPlanBundle(args:{
    artifactId:string
    artifactValue:unknown
    rootKey:Uint8Array
    epochSalt:Uint8Array
    rootWrap:RootWrapV6
    bestEffortWrappingKey:CryptoKey|null
    writerKey:StoredWriterDeviceKeyV2
    recoveryStaging:RecoveryTakeoverStagingV2
    urs:Uint8Array
    state:EpochLocalSecurityStateV6
  }):Promise<void>{
    if(!args.artifactId)throw new Error('Profile-upgrade plan artifact ID is required.')
    validateRootWrapV6(args.rootWrap)
    validateEpochLocalSecurityStateV6(args.state)
    if(args.rootWrap.epoch_id!==args.state.epoch_id
      ||args.rootWrap.diary_id!==args.state.diary_id
      ||args.rootWrap.key_id!==args.state.key_id
      ||args.rootWrap.manifest_fingerprint!==args.state.manifest_fingerprint)throw new Error('Profile-upgrade RootWrapV6/StateV6 binding mismatch.')
    if((args.rootWrap.mode==='best-effort')!==(args.bestEffortWrappingKey!==null))throw new Error('Profile-upgrade best-effort wrapping-key binding mismatch.')
    if(args.bestEffortWrappingKey){
      const opened=await openBestEffortRootWrapV6(args.rootWrap,args.bestEffortWrappingKey)
      if(base64Url(opened)!==base64Url(args.rootKey))throw new Error('Profile-upgrade RootWrapV6 readback failed before persistence.')
    }
    await validateStoredWriterDeviceKeyV2(args.writerKey,args.state.diary_id,args.state.epoch_id)
    const verifiedStaging=await verifyRecoveryTakeoverStagingV2(args.recoveryStaging,args.urs)
    if(!isVerifiedRecoveryTakeoverStagingV2(verifiedStaging)
      ||args.recoveryStaging.diary_id!==args.state.diary_id
      ||args.recoveryStaging.epoch_id!==args.state.epoch_id
      ||args.recoveryStaging.manifest_fingerprint!==args.state.manifest_fingerprint)throw new Error('Profile-upgrade RecoveryTakeoverStagingV2 binding mismatch.')
    const planBytes=new TextDecoder().decode(canonicalBytes(args.artifactValue as never))
    const planHash=base64Url(await sha256(canonicalBytes(args.artifactValue as never)))
    const wrapBytes=new TextDecoder().decode(canonicalBytes(args.rootWrap as never))
    const stateTag=await localStateTagV6(args.rootKey,args.epochSalt,args.state)
    const stagingId=`${args.recoveryStaging.epoch_id}:${args.recoveryStaging.recovery_generation}:${args.recoveryStaging.recovery_takeover_key_id}:${args.recoveryStaging.manifest_fingerprint}`
    const db=await openDatabase()
    const readTx=db.transaction([
      STORES.operationArtifacts,STORES.rootWraps,STORES.rootWrappingKeys,STORES.writerKeys,
      STORES.recoveryStaging,STORES.states,
    ],'readonly')
    const requests=[
      readTx.objectStore(STORES.operationArtifacts).get(args.artifactId),
      readTx.objectStore(STORES.rootWraps).get(args.state.epoch_id),
      readTx.objectStore(STORES.rootWrappingKeys).get(args.rootWrap.wrap_id),
      readTx.objectStore(STORES.writerKeys).get(args.writerKey.writer_signing_key_id),
      readTx.objectStore(STORES.recoveryStaging).get(stagingId),
      readTx.objectStore(STORES.states).get(args.state.epoch_id),
    ]
    const existing=await Promise.all(requests.map(request=>requestResult<unknown>(request)))
    await transactionDone(readTx)
    if(existing.some(value=>value!==undefined))throw new Error('Profile-upgrade successor planning bundle already exists incompletely or collides with local state.')
    const tx=db.transaction([
      STORES.operationArtifacts,STORES.rootWraps,STORES.rootWrappingKeys,STORES.writerKeys,
      STORES.recoveryStaging,STORES.states,
    ],'readwrite')
    tx.objectStore(STORES.operationArtifacts).add({id:args.artifactId,value:structuredClone(args.artifactValue),bytes:planBytes,hash:planHash})
    tx.objectStore(STORES.rootWraps).add({id:args.state.epoch_id,wrap:structuredClone(args.rootWrap),bytes:wrapBytes})
    if(args.bestEffortWrappingKey)tx.objectStore(STORES.rootWrappingKeys).add({id:args.rootWrap.wrap_id,key:args.bestEffortWrappingKey})
    tx.objectStore(STORES.writerKeys).add(args.writerKey)
    tx.objectStore(STORES.recoveryStaging).add({id:stagingId,staging:structuredClone(args.recoveryStaging)})
    tx.objectStore(STORES.states).add({id:args.state.epoch_id,state:structuredClone(args.state),tag:stateTag})
    await transactionDone(tx)
    const [plan,state,writer,staging,wrap]=await Promise.all([
      this.operationArtifact<unknown>(args.artifactId),
      this.loadState(args.rootKey,args.epochSalt,args.state.epoch_id),
      this.loadWriterKey(args.writerKey.writer_signing_key_id,args.state.diary_id,args.state.epoch_id),
      this.loadRecoveryTakeoverStagingMaterial({
        epochId:args.state.epoch_id,
        recoveryGeneration:args.recoveryStaging.recovery_generation,
        recoveryTakeoverKeyId:args.recoveryStaging.recovery_takeover_key_id,
        manifestFingerprint:args.state.manifest_fingerprint,
        urs:args.urs,
      }),
      this.loadRootWrapV6(args.state.epoch_id),
    ])
    if(plan===null||state.manifest_fingerprint!==args.state.manifest_fingerprint||!writer||!isVerifiedRecoveryTakeoverStagingV2(staging.verified)||wrap.wrap.wrap_id!==args.rootWrap.wrap_id)throw new Error('Profile-upgrade successor planning bundle readback failed.')
  }

  async persistNativeRotationSuccessorPlanBundle(args:{
    artifactId:string
    artifactValue:unknown
    rootKey:Uint8Array
    epochSalt:Uint8Array
    rootWrap:RootWrapV6
    bestEffortWrappingKey:CryptoKey|null
    writerKey:StoredWriterDeviceKeyV2
    recoveryStaging:RecoveryTakeoverStagingV2
    urs:Uint8Array
    state:EpochLocalSecurityStateV6
  }):Promise<void>{
    if(!args.artifactId)throw new Error('Native v2 rotation plan artifact ID is required.')
    validateRootWrapV6(args.rootWrap);validateEpochLocalSecurityStateV6(args.state)
    if(args.state.epoch_status!=='local_offline'||args.state.writer_status!=='read_only'||args.state.remote_binding!==null||args.state.remote_anchor!==null)throw new Error('Native v2 rotation Successor must start local_offline/read_only and unbound.')
    if(args.rootWrap.epoch_id!==args.state.epoch_id||args.rootWrap.diary_id!==args.state.diary_id||args.rootWrap.key_id!==args.state.key_id||args.rootWrap.manifest_fingerprint!==args.state.manifest_fingerprint)throw new Error('Native v2 rotation RootWrapV6/StateV6 binding mismatch.')
    if((args.rootWrap.mode==='best-effort')!==(args.bestEffortWrappingKey!==null))throw new Error('Native v2 rotation best-effort wrapping-key binding mismatch.')
    if(args.bestEffortWrappingKey&&base64Url(await openBestEffortRootWrapV6(args.rootWrap,args.bestEffortWrappingKey))!==base64Url(args.rootKey))throw new Error('Native v2 rotation RootWrapV6 readback failed.')
    await validateStoredWriterDeviceKeyV2(args.writerKey,args.state.diary_id,args.state.epoch_id)
    if(args.writerKey.writer_device_id!==args.state.writer_device_id||args.writerKey.writer_signing_key_id!==args.state.writer_signing_key_id)throw new Error('Native v2 rotation carried WriterDeviceKeyV2 binding mismatch.')
    const verifiedStaging=await verifyRecoveryTakeoverStagingV2(args.recoveryStaging,args.urs)
    if(!isVerifiedRecoveryTakeoverStagingV2(verifiedStaging)||args.recoveryStaging.diary_id!==args.state.diary_id||args.recoveryStaging.epoch_id!==args.state.epoch_id||args.recoveryStaging.manifest_fingerprint!==args.state.manifest_fingerprint)throw new Error('Native v2 rotation RecoveryTakeoverStagingV2 binding mismatch.')

    const planBytes=new TextDecoder().decode(canonicalBytes(args.artifactValue as never)),planHash=base64Url(await sha256(canonicalBytes(args.artifactValue as never)))
    const wrapBytes=new TextDecoder().decode(canonicalBytes(args.rootWrap as never)),stateTag=await localStateTagV6(args.rootKey,args.epochSalt,args.state)
    const stagingId=`${args.recoveryStaging.epoch_id}:${args.recoveryStaging.recovery_generation}:${args.recoveryStaging.recovery_takeover_key_id}:${args.recoveryStaging.manifest_fingerprint}`
    const db=await openDatabase(),readTx=db.transaction([STORES.operationArtifacts,STORES.rootWraps,STORES.rootWrappingKeys,STORES.writerKeys,STORES.recoveryStaging,STORES.states],'readonly')
    const [planPrior,wrapPrior,wrapKeyPrior,writerPrior,stagingPrior,statePrior]=await Promise.all([
      requestResult<unknown>(readTx.objectStore(STORES.operationArtifacts).get(args.artifactId)),
      requestResult<unknown>(readTx.objectStore(STORES.rootWraps).get(args.state.epoch_id)),
      requestResult<unknown>(readTx.objectStore(STORES.rootWrappingKeys).get(args.rootWrap.wrap_id)),
      requestResult<StoredWriterDeviceKeyV2|undefined>(readTx.objectStore(STORES.writerKeys).get(args.writerKey.writer_signing_key_id)),
      requestResult<unknown>(readTx.objectStore(STORES.recoveryStaging).get(stagingId)),
      requestResult<unknown>(readTx.objectStore(STORES.states).get(args.state.epoch_id)),
    ])
    await transactionDone(readTx)
    if(planPrior!==undefined||wrapPrior!==undefined||wrapKeyPrior!==undefined||stagingPrior!==undefined||statePrior!==undefined)throw new Error('Native v2 rotation Successor plan collides with existing local state.')
    if(writerPrior){
      await validateStoredWriterDeviceKeyV2(writerPrior,args.state.diary_id,args.state.epoch_id)
      if(writerPrior.writer_device_id!==args.writerKey.writer_device_id||writerPrior.writer_public_key!==args.writerKey.writer_public_key)throw new Error('Native v2 rotation carried WriterDeviceKeyV2 collision.')
    }

    const tx=db.transaction([STORES.operationArtifacts,STORES.rootWraps,STORES.rootWrappingKeys,STORES.writerKeys,STORES.recoveryStaging,STORES.states],'readwrite')
    tx.objectStore(STORES.operationArtifacts).add({id:args.artifactId,value:structuredClone(args.artifactValue),bytes:planBytes,hash:planHash})
    tx.objectStore(STORES.rootWraps).add({id:args.state.epoch_id,wrap:structuredClone(args.rootWrap),bytes:wrapBytes})
    if(args.bestEffortWrappingKey)tx.objectStore(STORES.rootWrappingKeys).add({id:args.rootWrap.wrap_id,key:args.bestEffortWrappingKey})
    if(!writerPrior)tx.objectStore(STORES.writerKeys).add(args.writerKey)
    tx.objectStore(STORES.recoveryStaging).add({id:stagingId,staging:structuredClone(args.recoveryStaging)})
    tx.objectStore(STORES.states).add({id:args.state.epoch_id,state:structuredClone(args.state),tag:stateTag})
    await transactionDone(tx)
    const [plan,state,writer,staging,wrap]=await Promise.all([
      this.operationArtifact<unknown>(args.artifactId),this.loadState(args.rootKey,args.epochSalt,args.state.epoch_id),
      this.loadWriterKey(args.writerKey.writer_signing_key_id,args.state.diary_id,args.state.epoch_id),
      this.loadRecoveryTakeoverStagingMaterial({epochId:args.state.epoch_id,recoveryGeneration:args.recoveryStaging.recovery_generation,recoveryTakeoverKeyId:args.recoveryStaging.recovery_takeover_key_id,manifestFingerprint:args.state.manifest_fingerprint,urs:args.urs}),
      this.loadRootWrapV6(args.state.epoch_id),
    ])
    if(plan===null||state.epoch_status!=='local_offline'||!writer||!isVerifiedRecoveryTakeoverStagingV2(staging.verified)||wrap.wrap.wrap_id!==args.rootWrap.wrap_id)throw new Error('Native v2 rotation Successor planning bundle readback failed.')
  }

  async persistReadOnlyJoinBundle(args:{
    artifactId:string
    artifactValue:unknown
    rootKey:Uint8Array
    epochSalt:Uint8Array
    rootWrap:RootWrapV6
    bestEffortWrappingKey:CryptoKey|null
    writerKey:StoredWriterDeviceKeyV2
    state:EpochLocalSecurityStateV6
    lineageCache:ActivationLineageCacheV2|null
  }):Promise<void>{
    if(!args.artifactId)throw new Error('Read-only Join plan artifact ID is required.')
    validateRootWrapV6(args.rootWrap)
    validateEpochLocalSecurityStateV6(args.state)
    if(args.state.epoch_status!=='active'||args.state.writer_status!=='read_only'
      ||args.state.writer_generation!==null||args.state.writer_grant_id!==null
      ||args.state.remote_binding===null||args.state.remote_anchor===null
      ||args.state.verified_writer_device_id===null||args.state.verified_writer_key_id===null
      ||args.state.verified_writer_generation===null||args.state.verified_writer_grant_id===null)throw new Error('Read-only Join StateV6 must be a fully verified active read-only binding.')
    if(args.state.local_journal_count!==0||args.state.stale_writer_pending_count!==0)throw new Error('Read-only Join must start without local v2 mutations.')
    if(args.rootWrap.epoch_id!==args.state.epoch_id
      ||args.rootWrap.diary_id!==args.state.diary_id
      ||args.rootWrap.key_id!==args.state.key_id
      ||args.rootWrap.manifest_fingerprint!==args.state.manifest_fingerprint)throw new Error('Read-only Join RootWrapV6/StateV6 binding mismatch.')
    if((args.rootWrap.mode==='best-effort')!==(args.bestEffortWrappingKey!==null))throw new Error('Read-only Join best-effort wrapping-key binding mismatch.')
    if(args.bestEffortWrappingKey){
      const opened=await openBestEffortRootWrapV6(args.rootWrap,args.bestEffortWrappingKey)
      if(base64Url(opened)!==base64Url(args.rootKey))throw new Error('Read-only Join RootWrapV6 verification failed.')
    }
    await validateStoredWriterDeviceKeyV2(args.writerKey,args.state.diary_id,args.state.epoch_id)
    if(args.writerKey.writer_device_id!==args.state.writer_device_id||args.writerKey.writer_signing_key_id!==args.state.writer_signing_key_id)throw new Error('Read-only Join WriterDeviceKeyV2 does not bind the local device identity.')

    let cacheHash:string|null=null
    if(args.lineageCache){
      const lineage=await openActivationLineageCacheV2({cache:args.lineageCache,rootKey:args.rootKey,epochSalt:args.epochSalt,diaryId:args.state.diary_id,epochId:args.state.epoch_id,manifestFingerprint:args.state.manifest_fingerprint})
      if(!lineage.length)throw new Error('Read-only Join lineage cache must contain cross-epoch activation evidence.')
      cacheHash=await activationLineageCacheHashV2(args.lineageCache)
      if(args.state.activation_lineage_cache_ref?.cache_id!==args.lineageCache.cache_id
        ||args.state.activation_lineage_cache_ref.cache_record_hash!==cacheHash)throw new Error('Read-only Join lineage-cache reference mismatch.')
    }else if(args.state.activation_lineage_cache_ref!==null)throw new Error('Read-only Join StateV6 references a missing lineage cache.')

    const planBytes=new TextDecoder().decode(canonicalBytes(args.artifactValue as never))
    const planHash=base64Url(await sha256(canonicalBytes(args.artifactValue as never)))
    const wrapBytes=new TextDecoder().decode(canonicalBytes(args.rootWrap as never))
    const stateTag=await localStateTagV6(args.rootKey,args.epochSalt,args.state)
    const db=await openDatabase()
    const stores=[STORES.operationArtifacts,STORES.rootWraps,STORES.rootWrappingKeys,STORES.writerKeys,STORES.states,...(args.lineageCache?[STORES.lineageCaches]:[])] as string[]
    const readTx=db.transaction(stores,'readonly')
    const requests=[
      readTx.objectStore(STORES.operationArtifacts).get(args.artifactId),
      readTx.objectStore(STORES.rootWraps).get(args.state.epoch_id),
      readTx.objectStore(STORES.rootWrappingKeys).get(args.rootWrap.wrap_id),
      readTx.objectStore(STORES.writerKeys).get(args.writerKey.writer_signing_key_id),
      readTx.objectStore(STORES.states).get(args.state.epoch_id),
      ...(args.lineageCache?[readTx.objectStore(STORES.lineageCaches).get(args.lineageCache.cache_id)]:[]),
    ]
    const existing=await Promise.all(requests.map(request=>requestResult<unknown>(request)))
    await transactionDone(readTx)
    if(existing.some(value=>value!==undefined))throw new Error('Read-only Join bundle collides with existing local v2 state.')

    const tx=db.transaction(stores,'readwrite')
    tx.objectStore(STORES.operationArtifacts).add({id:args.artifactId,value:structuredClone(args.artifactValue),bytes:planBytes,hash:planHash})
    tx.objectStore(STORES.rootWraps).add({id:args.state.epoch_id,wrap:structuredClone(args.rootWrap),bytes:wrapBytes})
    if(args.bestEffortWrappingKey)tx.objectStore(STORES.rootWrappingKeys).add({id:args.rootWrap.wrap_id,key:args.bestEffortWrappingKey})
    tx.objectStore(STORES.writerKeys).add(args.writerKey)
    if(args.lineageCache)tx.objectStore(STORES.lineageCaches).add({id:args.lineageCache.cache_id,cache:structuredClone(args.lineageCache),hash:cacheHash})
    tx.objectStore(STORES.states).add({id:args.state.epoch_id,state:structuredClone(args.state),tag:stateTag})
    await transactionDone(tx)

    const [plan,state,writer,wrap]=await Promise.all([
      this.operationArtifact<unknown>(args.artifactId),
      this.loadState(args.rootKey,args.epochSalt,args.state.epoch_id),
      this.loadWriterKey(args.writerKey.writer_signing_key_id,args.state.diary_id,args.state.epoch_id),
      this.loadRootWrapV6(args.state.epoch_id),
    ])
    if(plan===null||state.writer_status!=='read_only'||!writer||wrap.wrap.wrap_id!==args.rootWrap.wrap_id)throw new Error('Read-only Join bundle readback failed.')
    if(args.lineageCache)await this.loadActivationLineageCache(args.rootKey,args.epochSalt,args.state.epoch_id)
  }

  async persistRootWrapV6(wrap:RootWrapV6,bestEffortWrappingKey:CryptoKey|null):Promise<void>{
    validateRootWrapV6(wrap)
    if((wrap.mode==='best-effort')!==(bestEffortWrappingKey!==null))throw new Error('RootWrapV6 best-effort key persistence mismatch.')
    if(bestEffortWrappingKey){
      const algorithm=bestEffortWrappingKey.algorithm as AesKeyAlgorithm
      if(bestEffortWrappingKey.type!=='secret'||bestEffortWrappingKey.extractable||bestEffortWrappingKey.algorithm.name!=='AES-GCM'||algorithm.length!==256)throw new Error('RootWrapV6 best-effort key is invalid.')
      const opened=await openBestEffortRootWrapV6(wrap,bestEffortWrappingKey)
      if(opened.byteLength!==32)throw new Error('RootWrapV6 best-effort verification failed.')
    }
    const encoded=new TextDecoder().decode(canonicalBytes(wrap as never)),db=await openDatabase()
    const readTx=db.transaction([STORES.rootWraps,STORES.rootWrappingKeys],'readonly')
    const wrapRequest=readTx.objectStore(STORES.rootWraps).get(wrap.epoch_id)
    const keyRequest=readTx.objectStore(STORES.rootWrappingKeys).get(wrap.wrap_id)
    const [existingWrap,existingKey]=await Promise.all([
      requestResult<{id:string;wrap:RootWrapV6;bytes:string}|undefined>(wrapRequest),
      requestResult<{id:string;key:CryptoKey}|undefined>(keyRequest),
    ])
    await transactionDone(readTx)
    if(existingWrap){
      if(existingWrap.bytes!==encoded||existingWrap.wrap.wrap_id!==wrap.wrap_id)throw new Error('RootWrapV6 immutable epoch binding collision.')
      if(wrap.mode==='best-effort'&&!existingKey)throw new Error('RootWrapV6 best-effort key is missing.')
      return
    }
    const tx=db.transaction([STORES.rootWraps,STORES.rootWrappingKeys],'readwrite')
    tx.objectStore(STORES.rootWraps).add({id:wrap.epoch_id,wrap:structuredClone(wrap),bytes:encoded})
    if(bestEffortWrappingKey)tx.objectStore(STORES.rootWrappingKeys).add({id:wrap.wrap_id,key:bestEffortWrappingKey})
    await transactionDone(tx)
    const verifyTx=db.transaction(STORES.rootWraps,'readonly')
    const readback=await requestResult<{id:string;wrap:RootWrapV6;bytes:string}|undefined>(verifyTx.objectStore(STORES.rootWraps).get(wrap.epoch_id))
    await transactionDone(verifyTx)
    if(!readback||readback.bytes!==encoded)throw new Error('RootWrapV6 persistent readback mismatch.')
    validateRootWrapV6(readback.wrap)
  }

  async loadRootWrapV6(epochId:string):Promise<{wrap:RootWrapV6;bestEffortWrappingKey:CryptoKey|null}>{
    fixedBase64Url(epochId,16,'epoch_id')
    const db=await openDatabase(),tx=db.transaction([STORES.rootWraps,STORES.rootWrappingKeys],'readonly')
    const wrapRequest=tx.objectStore(STORES.rootWraps).get(epochId)
    const stored=await requestResult<{id:string;wrap:RootWrapV6;bytes:string}|undefined>(wrapRequest)
    if(!stored){tx.abort();throw new Error('RootWrapV6 is missing.')}
    const keyRequest=tx.objectStore(STORES.rootWrappingKeys).get(stored.wrap.wrap_id)
    const key=await requestResult<{id:string;key:CryptoKey}|undefined>(keyRequest)
    await transactionDone(tx)
    validateRootWrapV6(stored.wrap)
    if(stored.bytes!==new TextDecoder().decode(canonicalBytes(stored.wrap as never)))throw new Error('RootWrapV6 stored bytes mismatch.')
    if(stored.wrap.mode==='best-effort'&&!key)throw new Error('RootWrapV6 best-effort key is missing.')
    if(stored.wrap.mode!=='best-effort'&&key)throw new Error('RootWrapV6 unexpected wrapping key.')
    return{wrap:structuredClone(stored.wrap),bestEffortWrappingKey:key?.key??null}
  }

  async persistPreparedWriterGrantOperationBundle(args:{
    rootKey:Uint8Array
    epochSalt:Uint8Array
    expectedOperationGeneration:number
    reservation:EnvelopeReservationV6
    envelope:PreparedEnvelope
    operation:WriterGrantOperationStateV2
    recoveryTakeoverPublicKey?:string
  }):Promise<EpochLocalSecurityStateV6>{
    validateWriterGrantOperationStateV2(args.operation)
    if(args.operation.stage!=='prepared')throw new Error('WriterGrantOperationStateV2 bundle must start at prepared.')
    if(args.operation.prepared_envelope.envelope_id!==args.envelope.envelopeId
      ||args.operation.prepared_envelope.iv!==args.envelope.iv
      ||args.operation.prepared_envelope.ciphertext!==args.envelope.ciphertext)throw new Error('WriterGrantOperationStateV2 does not bind the prepared envelope bytes.')
    if(args.reservation.state!=='reserved'||args.reservation.envelope_id!==args.envelope.envelopeId||args.reservation.iv!==args.envelope.iv)throw new Error('WriterGrantOperationStateV2 envelope reservation mismatch.')
    return withDiaryLockV2((await this.loadState(args.rootKey,args.epochSalt,args.operation.epoch_id)).diary_id,async()=>{
      const current=await this.loadState(args.rootKey,args.epochSalt,args.operation.epoch_id)
      if(current.operation_generation!==args.expectedOperationGeneration)throw new Error('Stale StateV6 generation during WriterGrant preparation.')
      const isHandoff=args.operation.operation_kind==='handoff'
      const isForced=args.operation.operation_kind==='forced_takeover'
      if(!isHandoff&&!isForced)throw new Error('Unsupported WriterGrant operation kind.')
      if(current.epoch_status!=='active')throw new Error('WriterGrant preparation requires active StateV6.')
      if(isHandoff&&(current.writer_status!=='writer_active'||current.writer_generation===null||current.writer_grant_id===null))throw new Error('Cooperative Handoff preparation requires writer_active StateV6.')
      if(isForced&&current.writer_status!=='read_only')throw new Error('Forced Takeover preparation requires read_only StateV6.')
      const recoveryOperationBlocks=current.recovery_operation_state_ref!==null
        &&!TERMINAL_RECOVERY_OPERATION_STATES_V2.has(current.recovery_operation_state_ref.state)
        &&!(isForced&&current.recovery_rekey_rotation_required)
      const operationBlocked=(current.rotation_state_ref!==null&&!TERMINAL_ROTATION_OPERATION_STATES_V2.has(current.rotation_state_ref.state))
        ||current.migration_state_ref!==null
        ||(current.writer_operation_state_ref!==null&&!TERMINAL_WRITER_GRANT_OPERATION_STATES_V2.has(current.writer_operation_state_ref.state))
        ||recoveryOperationBlocks
      if(operationBlocked)throw new Error('WriterGrant preparation is blocked by another non-terminal security operation.')
      await assertAuthorityMatchesEnvelope(args.rootKey,args.epochSalt,current.diary_id,current.epoch_id,args.envelope,null)
      const revision=await openRevisionEnvelopeV2(args.rootKey,args.epochSalt,{diaryId:current.diary_id,epochId:current.epoch_id},args.envelope)
      const grant=revision.record_data as WriterGrantV2
      const anchor=current.remote_anchor
      const predecessorGeneration=isHandoff?current.writer_generation:current.verified_writer_generation
      const predecessorGrantId=isHandoff?current.writer_grant_id:current.verified_writer_grant_id
      if(revision.record_schema!=='writer-grant-sw-v2'||!grant
        ||grant.reason!==(isHandoff?'handoff':'forced_takeover')
        ||grant.authorization.kind!==(isHandoff?'writer_handoff':'recovery_takeover')
        ||grant.previous_writer_generation!==predecessorGeneration||grant.previous_grant_id!==predecessorGrantId
        ||predecessorGeneration===null||predecessorGrantId===null
        ||grant.writer_generation!==predecessorGeneration+1||grant.writer_generation!==args.operation.expected_writer_generation
        ||grant.grant_id!==args.operation.expected_writer_grant_id
        ||grant.recovery_generation!==current.recovery_generation
        ||anchor===null
        ||anchor.covered_row_count!==args.operation.authority_anchor.covered_row_count
        ||anchor.prefix_hash!==args.operation.authority_anchor.prefix_hash
        ||anchor.anchor_profile!==args.operation.authority_anchor.anchor_profile
        ||grant.authority_anchor.covered_row_count!==anchor.covered_row_count
        ||grant.authority_anchor.prefix_hash!==anchor.prefix_hash
        ||grant.authority_anchor.anchor_profile!==anchor.anchor_profile)throw new Error('Prepared WriterGrant does not bind the authenticated current Writer/Recovery/Anchor state.')

      if(isHandoff){
        if(grant.authorization.signer_key_id!==current.writer_signing_key_id)throw new Error('Prepared Handoff Grant signer does not match the authenticated local Writer.')
        const sourceKey=await this.loadWriterKey(current.writer_signing_key_id,current.diary_id,current.epoch_id)
        if(!sourceKey||sourceKey.writer_device_id!==current.writer_device_id||!grant.authorization.signature
          ||!await verifyEd25519V2(fixedBase64Url(sourceKey.writer_public_key,32,'writer_public_key'),grant.authorization.signature,writerGrantSigningBytesV2(current.diary_id,current.epoch_id,grant)))throw new Error('Prepared Handoff Grant authorization does not verify against the authenticated local WriterDeviceKeyV2.')
      }else{
        if(!args.recoveryTakeoverPublicKey||current.recovery_takeover_key_id===null
          ||grant.authorization.signer_key_id!==current.recovery_takeover_key_id
          ||!grant.authorization.signature)throw new Error('Prepared Forced Takeover Grant is missing authenticated Recovery authorization.')
        const recoveryPublic=fixedBase64Url(args.recoveryTakeoverPublicKey,32,'recovery_takeover_public_key')
        if(await recoveryTakeoverKeyIdV2(recoveryPublic)!==current.recovery_takeover_key_id
          ||!await verifyEd25519V2(recoveryPublic,grant.authorization.signature,writerGrantSigningBytesV2(current.diary_id,current.epoch_id,grant)))throw new Error('Prepared Forced Takeover Grant authorization does not verify against the authenticated current Recovery authority.')
        const targetKey=await this.loadWriterKey(current.writer_signing_key_id,current.diary_id,current.epoch_id)
        if(!targetKey||targetKey.writer_device_id!==current.writer_device_id
          ||grant.writer_device_id!==current.writer_device_id
          ||grant.writer_key_id!==current.writer_signing_key_id
          ||grant.writer_public_key!==targetKey.writer_public_key)throw new Error('Prepared Forced Takeover Grant does not target the authenticated local WriterDeviceKeyV2.')
      }

      const db=await openDatabase(),checkTx=db.transaction(STORES.reservations,'readonly')
      const storedReservation=await requestResult<EnvelopeReservationV6|undefined>(checkTx.objectStore(STORES.reservations).get(args.reservation.id))
      await transactionDone(checkTx)
      if(!storedReservation||storedReservation.state!=='reserved'||storedReservation.envelope_id!==args.envelope.envelopeId||storedReservation.iv!==args.envelope.iv)throw new Error('WriterGrant envelope reservation is missing or changed.')
      const hash=await writerGrantOperationStateHashV2(args.operation),sequence=current.local_journal_count+1
      const next:EpochLocalSecurityStateV6={
        ...current,
        operation_generation:current.operation_generation+1,
        writer_operation_state_ref:{operation_id:args.operation.operation_id,state:args.operation.stage,state_record_hash:hash},
        local_journal_count:sequence,
        local_journal_hash:await localJournalNextV2(current.local_journal_hash,sequence,args.envelope),
      }
      validateEpochLocalSecurityStateV6(next)
      const tag=await localStateTagV6(args.rootKey,args.epochSalt,next)
      const outboxCore:V2OutboxEntryCore={id:args.reservation.id,epoch_id:args.operation.epoch_id,envelope_id:args.envelope.envelopeId,status:'prepared',authority:null}
      const outboxEntry:V2OutboxEntry={...outboxCore,tag:await outboxTag(args.rootKey,args.epochSalt,outboxCore)}
      const tx=db.transaction([STORES.reservations,STORES.envelopes,STORES.outbox,STORES.writerGrantOperations,STORES.states],'readwrite')
      tx.objectStore(STORES.reservations).put({...storedReservation,state:'sealed'} satisfies EnvelopeReservationV6)
      tx.objectStore(STORES.envelopes).add({...args.envelope,id:args.reservation.id,epoch_id:args.operation.epoch_id,local_sequence:sequence} satisfies PersistedEnvelopeV6)
      tx.objectStore(STORES.outbox).add(outboxEntry)
      tx.objectStore(STORES.writerGrantOperations).add({id:args.operation.operation_id,state:structuredClone(args.operation),hash})
      tx.objectStore(STORES.states).put({id:next.epoch_id,state:structuredClone(next),tag})
      await transactionDone(tx)
      const [operation,state]=await Promise.all([this.loadWriterGrantOperation(args.operation.operation_id),this.loadState(args.rootKey,args.epochSalt,args.operation.epoch_id)])
      if(operation.stage!=='prepared'||state.writer_operation_state_ref?.state_record_hash!==hash)throw new Error('WriterGrant operation bundle readback failed.')
      await this.verifyLocalJournal(args.rootKey,args.epochSalt,args.operation.epoch_id)
      return state
    })
  }

  async loadWriterGrantOperation(operationId:string):Promise<WriterGrantOperationStateV2>{
    fixedBase64Url(operationId,32,'operation_id')
    const db=await openDatabase(),tx=db.transaction(STORES.writerGrantOperations,'readonly')
    const stored=await requestResult<{id:string;state:WriterGrantOperationStateV2;hash:string}|undefined>(tx.objectStore(STORES.writerGrantOperations).get(operationId))
    await transactionDone(tx)
    if(!stored||stored.id!==operationId)throw new Error('WriterGrantOperationStateV2 is missing.')
    validateWriterGrantOperationStateV2(stored.state)
    if(stored.hash!==await writerGrantOperationStateHashV2(stored.state))throw new Error('WriterGrantOperationStateV2 readback hash failed.')
    return structuredClone(stored.state)
  }

  async loadBoundWriterGrantOperation(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<WriterGrantOperationStateV2|null>{
    const state=await this.loadState(rootKey,epochSalt,epochId),ref=state.writer_operation_state_ref
    if(!ref)return null
    const operation=await this.loadWriterGrantOperation(ref.operation_id),hash=await writerGrantOperationStateHashV2(operation)
    if(operation.epoch_id!==epochId||operation.stage!==ref.state||hash!==ref.state_record_hash)throw new Error('WriterGrantOperationStateV2 StateV6 binding failed.')
    return operation
  }

  async advanceWriterGrantOperationBinding(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    expectedOperationGeneration:number,
    expectedStage:WriterGrantOperationStageV2,
    next:WriterGrantOperationStateV2,
  ):Promise<EpochLocalSecurityStateV6>{
    return withDiaryLockV2((await this.loadState(rootKey,epochSalt,epochId)).diary_id,async()=>{
      await this.verifyLocalJournal(rootKey,epochSalt,epochId)
      const current=await this.loadState(rootKey,epochSalt,epochId),operation=await this.loadWriterGrantOperation(next.operation_id)
      if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during WriterGrant transition.')
      const ref=current.writer_operation_state_ref,priorHash=await writerGrantOperationStateHashV2(operation)
      if(!ref||ref.operation_id!==operation.operation_id||ref.state!==operation.stage||ref.state_record_hash!==priorHash)throw new Error('WriterGrantOperationStateV2 current StateV6 binding failed.')
      if(operation.stage!==expectedStage)throw new Error('WriterGrantOperationStateV2 stage changed before transition.')
      advanceWriterGrantOperationStateV2(operation,next)
      const nextHash=await writerGrantOperationStateHashV2(next),db=await openDatabase()
      if(next.stage==='durable'){
        const readTx=db.transaction(STORES.outbox,'readonly')
        const entry=await requestResult<V2OutboxEntry|undefined>(readTx.objectStore(STORES.outbox).get(`${epochId}:${operation.prepared_envelope.envelope_id}`))
        await transactionDone(readTx)
        if(!entry)throw new Error('Durable WriterGrant operation is missing its ceremony-owned outbox entry.')
        await verifyOutboxTag(rootKey,epochSalt,entry)
        if(entry.authority!==null||entry.status!=='durable')throw new Error('Durable WriterGrant operation requires canonical durable ceremony evidence.')
      }
      let staleOutbox:V2OutboxEntry|null=null,staleCount=current.stale_writer_pending_count
      if(next.stage==='stale'){
        const anchor=current.remote_anchor
        if(anchor===null
          ||anchor.anchor_profile!==operation.authority_anchor.anchor_profile
          ||anchor.covered_row_count<=operation.authority_anchor.covered_row_count)throw new Error('Stale WriterGrant operation requires authenticated remote prefix advancement beyond its authority anchor.')
        const readTx=db.transaction(STORES.outbox,'readonly')
        const entryRequest=readTx.objectStore(STORES.outbox).get(`${epochId}:${operation.prepared_envelope.envelope_id}`)
        const entriesRequest=readTx.objectStore(STORES.outbox).index('byEpoch').getAll(epochId)
        const [entry,entries]=await Promise.all([
          requestResult<V2OutboxEntry|undefined>(entryRequest),
          requestResult<V2OutboxEntry[]>(entriesRequest),
        ])
        await transactionDone(readTx)
        if(!entry)throw new Error('Stale WriterGrant operation is missing its ceremony-owned outbox entry.')
        await verifyOutboxTag(rootKey,epochSalt,entry)
        if(entry.authority!==null)throw new Error('WriterGrant ceremony outbox entry unexpectedly carries Writer provenance.')
        assertOutboxTransition(entry.status,'stale_writer_pending')
        const core:V2OutboxEntryCore={id:entry.id,epoch_id:entry.epoch_id,envelope_id:entry.envelope_id,status:'stale_writer_pending',authority:null}
        staleOutbox={...core,tag:await outboxTag(rootKey,epochSalt,core)}
        staleCount=entries.filter(item=>item.id!==entry.id&&item.status==='stale_writer_pending').length+1
      }
      const nextState:EpochLocalSecurityStateV6={
        ...current,
        operation_generation:current.operation_generation+1,
        writer_operation_state_ref:{operation_id:next.operation_id,state:next.stage,state_record_hash:nextHash},
        stale_writer_pending_count:staleCount,
      }
      validateEpochLocalSecurityStateV6(nextState);assertStateTransition(current,nextState)
      const tag=await localStateTagV6(rootKey,epochSalt,nextState)
      const stores=[STORES.writerGrantOperations,STORES.states,...(staleOutbox?[STORES.outbox]:[])] as string[]
      const tx=db.transaction(stores,'readwrite')
      tx.objectStore(STORES.writerGrantOperations).put({id:next.operation_id,state:structuredClone(next),hash:nextHash})
      if(staleOutbox)tx.objectStore(STORES.outbox).put(staleOutbox)
      tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(nextState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,epochId)
    })
  }

  private recoveryRekeyRecordId(operationId:string):string{return`recovery-rekey:${operationId}`}

  async persistPreparedRecoveryRekeyBundle(args:{
    rootKey:Uint8Array
    epochSalt:Uint8Array
    newUrs:Uint8Array
    expectedOperationGeneration:number
    reservation:EnvelopeReservationV6
    envelope:PreparedEnvelope
    operation:RecoveryRekeyOperationStateV2
    artifact:RecoveryArtifactV6
  }):Promise<EpochLocalSecurityStateV6>{
    validateRecoveryRekeyOperationStateV2(args.operation)
    if(args.operation.operation_origin!=='local_rekey'||args.operation.stage!=='new_material_staged'||args.operation.artifact_publish_attempted)throw new Error('Prepared Recovery-Rekey bundle must start as unattempted local new_material_staged.')
    if(args.newUrs.byteLength!==32)throw new Error('Prepared Recovery-Rekey bundle requires a 32-byte new URS.')
    if(args.reservation.state!=='reserved'||args.reservation.epoch_id!==args.operation.epoch_id||args.reservation.envelope_id!==args.envelope.envelopeId||args.reservation.iv!==args.envelope.iv)throw new Error('Recovery-Rekey transition reservation mismatch.')
    if(args.operation.transition_envelope.envelope_id!==args.envelope.envelopeId||args.operation.transition_envelope.iv!==args.envelope.iv||args.operation.transition_envelope.ciphertext!==args.envelope.ciphertext)throw new Error('RecoveryRekeyOperationStateV2 does not bind transition envelope bytes.')
    return withDiaryLockV2((await this.loadState(args.rootKey,args.epochSalt,args.operation.epoch_id)).diary_id,async()=>{
      await this.verifyLocalJournal(args.rootKey,args.epochSalt,args.operation.epoch_id)
      const current=await this.loadState(args.rootKey,args.epochSalt,args.operation.epoch_id)
      if(current.operation_generation!==args.expectedOperationGeneration)throw new Error('Stale StateV6 generation during Recovery-Rekey preparation.')
      if(current.epoch_status!=='active'||current.writer_status!=='writer_active'||current.writer_generation===null||current.writer_grant_id===null||current.remote_anchor===null||current.remote_binding===null)throw new Error('Recovery-Rekey preparation requires the active authenticated local Writer.')
      if(current.rotation_state_ref&&!TERMINAL_ROTATION_OPERATION_STATES_V2.has(current.rotation_state_ref.state))throw new Error('Recovery-Rekey preparation is blocked by Rotation.')
      if(current.writer_operation_state_ref&&!TERMINAL_WRITER_GRANT_OPERATION_STATES_V2.has(current.writer_operation_state_ref.state))throw new Error('Recovery-Rekey preparation is blocked by WriterGrant ceremony.')
      if(current.migration_state_ref!==null)throw new Error('Recovery-Rekey preparation is blocked by migration state.')
      const existingRef=current.recovery_operation_state_ref
      if(existingRef){
        const existing=await this.loadRecoveryRekeyOperation(existingRef.operation_id)
        if(existing.stage!==existingRef.state||await recoveryRekeyOperationStateHashV2(existing)!==existingRef.state_record_hash)throw new Error('Existing Recovery-Rekey binding failed.')
        if(args.operation.supersedes_transition_id!==existing.transition_id||TERMINAL_RECOVERY_OPERATION_STATES_V2.has(existing.stage)
          ||!['transition_durable','source_backup_verified','successor_rotation_required'].includes(existing.stage))throw new Error('Recovery-Rekey preparation may supersede only the exact current post-durable pending operation.')
      }else if(args.operation.supersedes_transition_id!==null)throw new Error('Recovery-Rekey supersession references no local active operation.')

      const revision=await openRevisionEnvelopeV2(args.rootKey,args.epochSalt,{diaryId:current.diary_id,epochId:current.epoch_id},args.envelope)
      const transition=revision.record_data as RecoveryAuthorityTransitionV2
      if(revision.record_schema!=='recovery-authority-transition-sw-v2'||revision.record_type!=='recovery_authority_transition'||revision.record_status!=='control'||!revision.writer_context||!revision.writer_signature||!transition)throw new Error('Recovery-Rekey prepared envelope is not a writer-signed RecoveryAuthorityTransitionV2.')
      if(transition.transition_id!==args.operation.transition_id||transition.from_recovery_generation!==current.recovery_generation||transition.from_recovery_urs_id!==current.recovery_urs_id
        ||transition.from_recovery_takeover_key_id!==current.recovery_takeover_key_id||transition.to_recovery_generation!==args.operation.to_recovery_generation
        ||transition.to_recovery_urs_commitment!==args.operation.to_recovery_urs_commitment||transition.to_recovery_urs_id!==args.operation.to_recovery_urs_id
        ||transition.to_recovery_takeover_key_id!==args.operation.to_recovery_takeover_key_id
        ||transition.authority_anchor.covered_row_count!==current.remote_anchor.covered_row_count||transition.authority_anchor.prefix_hash!==current.remote_anchor.prefix_hash)throw new Error('Prepared RecoveryAuthorityTransitionV2 does not bind current StateV6 Recovery/Anchor state.')
      const authority:PreparedEnvelopeAuthorityV2={writer_generation:current.writer_generation,writer_grant_id:current.writer_grant_id,writer_device_id:current.writer_device_id,writer_key_id:current.writer_signing_key_id}
      await assertAuthorityMatchesEnvelope(args.rootKey,args.epochSalt,current.diary_id,current.epoch_id,args.envelope,authority)
      const writer=await this.loadWriterKey(current.writer_signing_key_id,current.diary_id,current.epoch_id)
      if(!writer||writer.writer_device_id!==current.writer_device_id||!await verifyEd25519V2(fixedBase64Url(writer.writer_public_key,32,'writer_public_key'),revision.writer_signature,revisionSigningBytesV2(current.diary_id,current.epoch_id,revision)))throw new Error('Prepared RecoveryAuthorityTransitionV2 Writer signature failed against authenticated local WriterDeviceKeyV2.')

      const recovered=await openRecoveryArtifactV6(args.artifact,args.newUrs),payload=recovered.payload
      if(base64Url(recovered.rootKey)!==base64Url(args.rootKey)||payload.diary_id!==current.diary_id||payload.epoch_id!==current.epoch_id||payload.key_id!==current.key_id
        ||payload.manifest_fingerprint!==current.manifest_fingerprint||payload.google_account_binding!==current.remote_binding.remote_identity_binding
        ||payload.recovery_generation!==args.operation.to_recovery_generation||payload.recovery_urs_commitment!==args.operation.to_recovery_urs_commitment
        ||payload.recovery_urs_id!==args.operation.to_recovery_urs_id||payload.recovery_takeover_key_id!==args.operation.to_recovery_takeover_key_id
        ||payload.recovery_takeover_public_key!==transition.to_recovery_takeover_public_key||payload.remote_anchor.covered_row_count!==current.remote_anchor.covered_row_count
        ||payload.remote_anchor.prefix_hash!==current.remote_anchor.prefix_hash)throw new Error('Prepared RecoveryArtifactV6 does not bind Recovery-Rekey to-State/current epoch.')
      const proof=payload.recovery_authority_transition_proof
      if(!proof||proof.source_epoch_id!==current.epoch_id||proof.source_manifest_fingerprint!==current.manifest_fingerprint
        ||proof.transition_envelope.envelope_id!==args.envelope.envelopeId||proof.transition_envelope.iv!==args.envelope.iv||proof.transition_envelope.ciphertext!==args.envelope.ciphertext
        ||proof.from_recovery_generation!==transition.from_recovery_generation||proof.from_recovery_urs_id!==transition.from_recovery_urs_id||proof.from_recovery_takeover_key_id!==transition.from_recovery_takeover_key_id
        ||proof.to_recovery_generation!==transition.to_recovery_generation||proof.to_recovery_urs_commitment!==transition.to_recovery_urs_commitment||proof.to_recovery_urs_id!==transition.to_recovery_urs_id
        ||proof.to_recovery_takeover_key_id!==transition.to_recovery_takeover_key_id||proof.to_recovery_takeover_public_key!==transition.to_recovery_takeover_public_key)throw new Error('Prepared RecoveryArtifactV6 transition proof mismatch.')
      const proofHash=base64Url(await sha256(canonicalBytes(proof as never)))
      if(proofHash!==args.operation.transition_proof_sha256||args.artifact.recovery_artifact_id!==args.operation.recovery_artifact_id
        ||await recoveryArtifactHashV6(args.artifact)!==args.operation.recovery_artifact_sha256
        ||await recoveryArtifactLocatorV6(args.newUrs,current.diary_id,current.epoch_id)!==args.operation.recovery_artifact_locator)throw new Error('RecoveryRekeyOperationStateV2 artifact/proof identity mismatch.')
      if(payload.recovery_credential_history.length<2)throw new Error('Recovery-Rekey artifact credential history is incomplete.')
      const priorHistory=payload.recovery_credential_history.slice(0,-1),last=payload.recovery_credential_history.at(-1)!
      if(await recoveryCredentialHistoryHashV2(priorHistory)!==current.recovery_credential_history_sha256
        ||last.recovery_generation!==args.operation.to_recovery_generation||last.recovery_urs_id!==args.operation.to_recovery_urs_id||last.recovery_takeover_key_id!==args.operation.to_recovery_takeover_key_id)throw new Error('Recovery-Rekey artifact does not append exactly one fresh credential-history entry.')
      if(payload.activation_lineage.length){
        const cache=await this.loadActivationLineageCache(args.rootKey,args.epochSalt,current.epoch_id)
        const lineage=await openActivationLineageCacheV2({cache,rootKey:args.rootKey,epochSalt:args.epochSalt,diaryId:current.diary_id,epochId:current.epoch_id,manifestFingerprint:current.manifest_fingerprint})
        if(new TextDecoder().decode(canonicalBytes(lineage as never))!==new TextDecoder().decode(canonicalBytes(payload.activation_lineage as never)))throw new Error('Recovery-Rekey artifact activation lineage differs from authenticated local cache.')
      }else if(current.activation_lineage_cache_ref!==null)throw new Error('Recovery-Rekey artifact unexpectedly drops authenticated activation lineage.')

      const db=await openDatabase(),checkTx=db.transaction([STORES.reservations,STORES.operationArtifacts,STORES.recoveryArtifacts],'readonly')
      const [storedReservation,priorOperation,priorArtifact]=await Promise.all([
        requestResult<EnvelopeReservationV6|undefined>(checkTx.objectStore(STORES.reservations).get(args.reservation.id)),
        requestResult<unknown>(checkTx.objectStore(STORES.operationArtifacts).get(this.recoveryRekeyRecordId(args.operation.operation_id))),
        requestResult<unknown>(checkTx.objectStore(STORES.recoveryArtifacts).get(`${current.epoch_id}:${args.artifact.recovery_artifact_id}`)),
      ])
      await transactionDone(checkTx)
      if(!storedReservation||storedReservation.state!=='reserved'||storedReservation.envelope_id!==args.envelope.envelopeId||storedReservation.iv!==args.envelope.iv)throw new Error('Recovery-Rekey transition reservation is missing or changed.')
      if(priorOperation!==undefined||priorArtifact!==undefined)throw new Error('Recovery-Rekey prepared bundle collides with existing operation/artifact.')

      const sequence=current.local_journal_count+1,operationHash=await recoveryRekeyOperationStateHashV2(args.operation)
      const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,recovery_operation_state_ref:{operation_id:args.operation.operation_id,state:args.operation.stage,state_record_hash:operationHash},
        local_journal_count:sequence,local_journal_hash:await localJournalNextV2(current.local_journal_hash,sequence,args.envelope)}
      validateEpochLocalSecurityStateV6(next)
      const stateTag=await localStateTagV6(args.rootKey,args.epochSalt,next),outboxCore:V2OutboxEntryCore={id:args.reservation.id,epoch_id:current.epoch_id,envelope_id:args.envelope.envelopeId,status:'prepared',authority,ceremony_owner:'recovery_rekey'}
      const outboxEntry:V2OutboxEntry={...outboxCore,tag:await outboxTag(args.rootKey,args.epochSalt,outboxCore)}
      const operationBytes=new TextDecoder().decode(canonicalBytes(args.operation as never)),artifactBytes=new TextDecoder().decode(canonicalBytes(args.artifact as never))
      const familyLocator=await recoveryFamilyLocatorV6(args.newUrs),artifactLocator=await recoveryArtifactLocatorV6(args.newUrs,current.diary_id,current.epoch_id)
      const tx=db.transaction([STORES.reservations,STORES.envelopes,STORES.outbox,STORES.operationArtifacts,STORES.recoveryArtifacts,STORES.states],'readwrite')
      tx.objectStore(STORES.reservations).put({...storedReservation,state:'sealed'} satisfies EnvelopeReservationV6)
      tx.objectStore(STORES.envelopes).add({...args.envelope,id:args.reservation.id,epoch_id:current.epoch_id,local_sequence:sequence} satisfies PersistedEnvelopeV6)
      tx.objectStore(STORES.outbox).add(outboxEntry)
      tx.objectStore(STORES.operationArtifacts).add({id:this.recoveryRekeyRecordId(args.operation.operation_id),value:structuredClone(args.operation),bytes:operationBytes,hash:operationHash})
      tx.objectStore(STORES.recoveryArtifacts).add({id:`${current.epoch_id}:${args.artifact.recovery_artifact_id}`,artifactBytes,artifactSha256:args.operation.recovery_artifact_sha256,familyLocator,artifactLocator})
      tx.objectStore(STORES.states).put({id:current.epoch_id,state:structuredClone(next),tag:stateTag})
      await transactionDone(tx)
      await this.verifyLocalJournal(args.rootKey,args.epochSalt,current.epoch_id)
      await this.loadRecoveryRekeyOperation(args.operation.operation_id)
      await this.persistRecoveryArtifactV6(args.newUrs,current.diary_id,current.epoch_id,args.artifact)
      return this.loadState(args.rootKey,args.epochSalt,current.epoch_id)
    })
  }


  async loadRecoveryRekeyOperation(operationId:string):Promise<RecoveryRekeyOperationStateV2>{
    fixedBase64Url(operationId,32,'operation_id')
    const id=this.recoveryRekeyRecordId(operationId),db=await openDatabase(),tx=db.transaction(STORES.operationArtifacts,'readonly')
    const stored=await requestResult<{id:string;value:RecoveryRekeyOperationStateV2;bytes:string;hash:string}|undefined>(tx.objectStore(STORES.operationArtifacts).get(id))
    await transactionDone(tx)
    if(!stored||stored.id!==id)throw new Error('RecoveryRekeyOperationStateV2 is missing.')
    validateRecoveryRekeyOperationStateV2(stored.value)
    const bytes=new TextDecoder().decode(canonicalBytes(stored.value as never)),hash=await recoveryRekeyOperationStateHashV2(stored.value)
    if(stored.bytes!==bytes||stored.hash!==hash)throw new Error('RecoveryRekeyOperationStateV2 readback integrity failed.')
    return structuredClone(stored.value)
  }

  async loadBoundRecoveryRekeyOperation(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<RecoveryRekeyOperationStateV2|null>{
    const state=await this.loadState(rootKey,epochSalt,epochId),ref=state.recovery_operation_state_ref
    if(!ref)return null
    const operation=await this.loadRecoveryRekeyOperation(ref.operation_id),hash=await recoveryRekeyOperationStateHashV2(operation)
    if(operation.epoch_id!==epochId||operation.stage!==ref.state||hash!==ref.state_record_hash)throw new Error('RecoveryRekeyOperationStateV2 StateV6 binding failed.')
    return operation
  }

  private async recoveryOperationsForEpoch(epochId:string):Promise<RecoveryRekeyOperationStateV2[]>{
    const db=await openDatabase(),tx=db.transaction(STORES.operationArtifacts,'readonly')
    const records=await requestResult<Array<{id:string;value:unknown;bytes:string;hash:string}>>(tx.objectStore(STORES.operationArtifacts).getAll())
    await transactionDone(tx)
    const result:RecoveryRekeyOperationStateV2[]=[]
    for(const record of records){
      if(!record.id.startsWith('recovery-rekey:'))continue
      const value=record.value as RecoveryRekeyOperationStateV2
      validateRecoveryRekeyOperationStateV2(value)
      if(value.epoch_id!==epochId)continue
      const bytes=new TextDecoder().decode(canonicalBytes(value as never)),hash=await recoveryRekeyOperationStateHashV2(value)
      if(bytes!==record.bytes||hash!==record.hash)throw new Error('RecoveryRekeyOperationStateV2 stored integrity failed.')
      result.push(structuredClone(value))
    }
    return result
  }

  async initializeRecoveryRekeyOperationBinding(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    expectedOperationGeneration:number,
    operation:RecoveryRekeyOperationStateV2,
  ):Promise<EpochLocalSecurityStateV6>{
    validateRecoveryRekeyOperationStateV2(operation)
    if(operation.operation_origin==='local_rekey'&&operation.stage!=='new_material_staged')throw new Error('Local Recovery-Rekey must start at new_material_staged.')
    if(operation.operation_origin==='remote_pending_rekey_adoption'&&operation.stage!=='transition_durable')throw new Error('Remote Pending-Rekey adoption must start at transition_durable.')
    return withDiaryLockV2((await this.loadState(rootKey,epochSalt,operation.epoch_id)).diary_id,async()=>{
      await this.verifyLocalJournal(rootKey,epochSalt,operation.epoch_id)
      const current=await this.loadState(rootKey,epochSalt,operation.epoch_id)
      if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during Recovery-Rekey binding.')
      if(current.epoch_id!==operation.epoch_id||current.epoch_status!=='active'||current.writer_status!=='writer_active')throw new Error('Recovery-Rekey requires the active local Writer.')
      if(current.rotation_state_ref&&!TERMINAL_ROTATION_OPERATION_STATES_V2.has(current.rotation_state_ref.state))throw new Error('Recovery-Rekey is blocked by a non-terminal Rotation operation.')
      if(current.writer_operation_state_ref&&!TERMINAL_WRITER_GRANT_OPERATION_STATES_V2.has(current.writer_operation_state_ref.state))throw new Error('Recovery-Rekey is blocked by a WriterGrant operation.')
      if(current.migration_state_ref!==null)throw new Error('Recovery-Rekey is blocked by migration state.')
      if(operation.operation_origin==='remote_pending_rekey_adoption'){
        if(!current.recovery_rekey_rotation_required||current.recovery_rekey_transition_id!==operation.transition_id
          ||current.recovery_generation!==operation.to_recovery_generation||current.recovery_urs_id!==operation.to_recovery_urs_id
          ||current.recovery_takeover_key_id!==operation.to_recovery_takeover_key_id)throw new Error('Remote Pending-Rekey adoption does not match authenticated current Recovery state.')
      }else{
        if(operation.supersedes_transition_id===null){
          if(current.recovery_rekey_rotation_required)throw new Error('A local Recovery-Rekey over Pending-Rekey must explicitly supersede the current transition.')
        }else if(!current.recovery_rekey_rotation_required||current.recovery_rekey_transition_id!==operation.supersedes_transition_id)throw new Error('Recovery-Rekey supersession does not bind the authenticated current transition.')
      }
      const existingRef=current.recovery_operation_state_ref
      if(existingRef){
        const existing=await this.loadRecoveryRekeyOperation(existingRef.operation_id)
        if(existing.stage!==existingRef.state||await recoveryRekeyOperationStateHashV2(existing)!==existingRef.state_record_hash)throw new Error('Existing Recovery-Rekey StateV6 binding failed.')
        if(operation.operation_origin!=='local_rekey'||operation.supersedes_transition_id!==existing.transition_id
          ||TERMINAL_RECOVERY_OPERATION_STATES_V2.has(existing.stage)||!['transition_durable','source_backup_verified','successor_rotation_required'].includes(existing.stage))throw new Error('Recovery-Rekey supersession requires the exact current post-durable pending operation.')
      }
      const hash=await recoveryRekeyOperationStateHashV2(operation),bytes=new TextDecoder().decode(canonicalBytes(operation as never)),id=this.recoveryRekeyRecordId(operation.operation_id)
      const db=await openDatabase(),readTx=db.transaction(STORES.operationArtifacts,'readonly')
      const prior=await requestResult<{id:string;value:RecoveryRekeyOperationStateV2;bytes:string;hash:string}|undefined>(readTx.objectStore(STORES.operationArtifacts).get(id))
      await transactionDone(readTx)
      if(prior&&(prior.bytes!==bytes||prior.hash!==hash))throw new Error('RecoveryRekeyOperationStateV2 operation ID collision.')
      const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,recovery_operation_state_ref:{operation_id:operation.operation_id,state:operation.stage,state_record_hash:hash}}
      validateEpochLocalSecurityStateV6(next)
      const tag=await localStateTagV6(rootKey,epochSalt,next),tx=db.transaction([STORES.operationArtifacts,STORES.states],'readwrite')
      tx.objectStore(STORES.operationArtifacts).put({id,value:structuredClone(operation),bytes,hash})
      tx.objectStore(STORES.states).put({id:next.epoch_id,state:structuredClone(next),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,operation.epoch_id)
    })
  }

  async advanceRecoveryRekeyOperationBinding(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    expectedOperationGeneration:number,
    expectedStage:RecoveryRekeyStageV2,
    next:RecoveryRekeyOperationStateV2,
  ):Promise<EpochLocalSecurityStateV6>{
    return withDiaryLockV2((await this.loadState(rootKey,epochSalt,epochId)).diary_id,async()=>{
      await this.verifyLocalJournal(rootKey,epochSalt,epochId)
      const current=await this.loadState(rootKey,epochSalt,epochId),operation=await this.loadRecoveryRekeyOperation(next.operation_id)
      if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during Recovery-Rekey transition.')
      const ref=current.recovery_operation_state_ref,priorHash=await recoveryRekeyOperationStateHashV2(operation)
      if(!ref||ref.operation_id!==operation.operation_id||ref.state!==operation.stage||ref.state_record_hash!==priorHash)throw new Error('RecoveryRekeyOperationStateV2 current StateV6 binding failed.')
      if(operation.stage!==expectedStage)throw new Error('RecoveryRekeyOperationStateV2 stage changed before transition.')
      advanceRecoveryRekeyOperationStateV2(operation,next)
      if(next.stage==='stale'){
        if(operation.artifact_publish_attempted){
          const anchor=current.remote_anchor
          if(anchor===null||anchor.anchor_profile!==operation.authority_anchor_before_transition.anchor_profile
            ||anchor.covered_row_count<=operation.authority_anchor_before_transition.covered_row_count)throw new Error('Post-publish Recovery-Rekey stale requires authenticated prefix advancement beyond the transition anchor.')
        }
      }
      if(next.stage==='transition_durable'){
        if(!current.recovery_rekey_rotation_required||current.recovery_rekey_transition_id!==operation.transition_id
          ||current.recovery_generation!==operation.to_recovery_generation||current.recovery_urs_id!==operation.to_recovery_urs_id
          ||current.recovery_takeover_key_id!==operation.to_recovery_takeover_key_id)throw new Error('Recovery-Rekey durable transition lacks authenticated canonical Recovery evidence.')
        const readTx=(await openDatabase()).transaction(STORES.outbox,'readonly')
        const entry=await requestResult<V2OutboxEntry|undefined>(readTx.objectStore(STORES.outbox).get(`${epochId}:${operation.transition_envelope.envelope_id}`))
        await transactionDone(readTx)
        if(operation.operation_origin==='local_rekey'){
          if(!entry)throw new Error('Recovery-Rekey durable transition is missing its local outbox evidence.')
          await verifyOutboxTag(rootKey,epochSalt,entry)
          if(entry.status!=='durable'||entry.authority===null)throw new Error('Recovery-Rekey durable transition requires canonical durable writer-authorized outbox evidence.')
        }
      }
      if(next.stage==='completed'&&current.epoch_status!=='retired')throw new Error('Recovery-Rekey cannot complete before the Source epoch is locally retired.')

      const nextHash=await recoveryRekeyOperationStateHashV2(next),nextBytes=new TextDecoder().decode(canonicalBytes(next as never)),db=await openDatabase()
      let stateRef:{operation_id:string;state:string;state_record_hash:string}={operation_id:next.operation_id,state:next.stage,state_record_hash:nextHash}
      const writes:Array<{id:string;value:RecoveryRekeyOperationStateV2;bytes:string;hash:string}>=[]

      if(next.stage==='transition_durable'&&operation.supersedes_transition_id!==null){
        const priorOps=await this.recoveryOperationsForEpoch(epochId)
        const old=priorOps.find(item=>item.operation_id!==operation.operation_id&&item.transition_id===operation.supersedes_transition_id&&!TERMINAL_RECOVERY_OPERATION_STATES_V2.has(item.stage))
        if(old){
          const superseded=advanceRecoveryRekeyOperationStateV2(old,{...old,stage:'superseded',superseded_by_transition_id:operation.transition_id})
          const oldHash=await recoveryRekeyOperationStateHashV2(superseded)
          writes.push({id:this.recoveryRekeyRecordId(old.operation_id),value:superseded,bytes:new TextDecoder().decode(canonicalBytes(superseded as never)),hash:oldHash})
        }
      }

      if(next.stage==='stale'&&operation.supersedes_transition_id!==null&&current.recovery_rekey_rotation_required&&current.recovery_rekey_transition_id===operation.supersedes_transition_id){
        const priorOps=await this.recoveryOperationsForEpoch(epochId)
        const old=priorOps.find(item=>item.operation_id!==operation.operation_id&&item.transition_id===operation.supersedes_transition_id&&!TERMINAL_RECOVERY_OPERATION_STATES_V2.has(item.stage))
        if(old){
          const oldHash=await recoveryRekeyOperationStateHashV2(old)
          stateRef={operation_id:old.operation_id,state:old.stage,state_record_hash:oldHash}
        }
      }

      writes.push({id:this.recoveryRekeyRecordId(next.operation_id),value:structuredClone(next),bytes:nextBytes,hash:nextHash})
      const nextState:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,recovery_operation_state_ref:stateRef}
      validateEpochLocalSecurityStateV6(nextState)
      const tag=await localStateTagV6(rootKey,epochSalt,nextState),tx=db.transaction([STORES.operationArtifacts,STORES.states],'readwrite')
      for(const record of writes)tx.objectStore(STORES.operationArtifacts).put(record)
      tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(nextState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,epochId)
    })
  }

  async initializeNativeSourceRotationBundle(args:{
    rootKey:Uint8Array
    epochSalt:Uint8Array
    expectedOperationGeneration:number
    operation:RotationOperationStateV2
    artifactId:string
    artifactValue:unknown
  }):Promise<EpochLocalSecurityStateV6>{
    validateRotationOperationStateV2(args.operation)
    if(args.operation.rotation_kind==='profile_upgrade'||args.operation.stage!=='source_frozen_verified')throw new Error('Native Source rotation bundle must start at source_frozen_verified.')
    if(!args.artifactId)throw new Error('Native Source rotation freeze artifact ID is required.')
    return withDiaryLockV2((await this.loadState(args.rootKey,args.epochSalt,args.operation.source_epoch_id)).diary_id,async()=>{
      await this.verifyLocalJournal(args.rootKey,args.epochSalt,args.operation.source_epoch_id)
      const current=await this.loadState(args.rootKey,args.epochSalt,args.operation.source_epoch_id)
      if(current.operation_generation!==args.expectedOperationGeneration)throw new Error('Stale StateV6 generation during native Source rotation freeze.')
      if(current.epoch_id!==args.operation.source_epoch_id||current.epoch_status!=='active'||current.writer_status!=='writer_active')throw new Error('Native Source rotation freeze requires the active local Writer.')
      if(current.rotation_state_ref&&!TERMINAL_ROTATION_OPERATION_STATES_V2.has(current.rotation_state_ref.state))throw new Error('Another non-terminal Rotation operation is already bound.')
      if(current.writer_operation_state_ref&&!TERMINAL_WRITER_GRANT_OPERATION_STATES_V2.has(current.writer_operation_state_ref.state))throw new Error('Native Source rotation is blocked by WriterGrant operation.')
      if(current.migration_state_ref!==null)throw new Error('Native Source rotation is blocked by migration state.')
      if(args.operation.rotation_kind==='normal'){
        if(current.recovery_rekey_rotation_required||current.recovery_rekey_transition_id!==null||args.operation.source_recovery_transition_id!==null)throw new Error('Normal native Source rotation is forbidden while Recovery-Rekey is pending.')
        if(current.recovery_operation_state_ref){
          const recoveryOperation=await this.loadRecoveryRekeyOperation(current.recovery_operation_state_ref.operation_id)
          if(recoveryOperation.stage!==current.recovery_operation_state_ref.state
            ||await recoveryRekeyOperationStateHashV2(recoveryOperation)!==current.recovery_operation_state_ref.state_record_hash)throw new Error('Native Source rotation RecoveryRekeyOperationStateV2 binding failed.')
          if(!TERMINAL_RECOVERY_OPERATION_STATES_V2.has(recoveryOperation.stage))throw new Error('Normal native Source rotation is blocked by non-terminal Recovery-Rekey.')
        }
      }else{
        if(!current.recovery_rekey_rotation_required||current.recovery_rekey_transition_id===null
          ||args.operation.source_recovery_transition_id!==current.recovery_rekey_transition_id)throw new Error('Recovery-rekey native Source rotation does not bind the authenticated current transition.')
        const recoveryRef=current.recovery_operation_state_ref
        if(!recoveryRef)throw new Error('Recovery-rekey native Source rotation requires a bound RecoveryRekeyOperationStateV2.')
        const recoveryOperation=await this.loadRecoveryRekeyOperation(recoveryRef.operation_id)
        if(recoveryOperation.stage!==recoveryRef.state||await recoveryRekeyOperationStateHashV2(recoveryOperation)!==recoveryRef.state_record_hash
          ||recoveryOperation.stage!=='successor_rotation_required'||recoveryOperation.transition_id!==args.operation.source_recovery_transition_id)throw new Error('Recovery-rekey native Source rotation requires the exact successor_rotation_required Phase-A state.')
      }
      const opHash=await rotationOperationStateHashV2(args.operation),artifactBytes=new TextDecoder().decode(canonicalBytes(args.artifactValue as never)),artifactHash=base64Url(await sha256(canonicalBytes(args.artifactValue as never)))
      const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,rotation_state_ref:{operation_id:args.operation.operation_id,state:args.operation.stage,state_record_hash:opHash}}
      validateEpochLocalSecurityStateV6(next)
      const tag=await localStateTagV6(args.rootKey,args.epochSalt,next),db=await openDatabase(),readTx=db.transaction([STORES.rotationOperations,STORES.operationArtifacts],'readonly')
      const [priorOp,priorArtifact]=await Promise.all([
        requestResult<unknown>(readTx.objectStore(STORES.rotationOperations).get(args.operation.operation_id)),
        requestResult<unknown>(readTx.objectStore(STORES.operationArtifacts).get(args.artifactId)),
      ])
      await transactionDone(readTx)
      if(priorOp!==undefined||priorArtifact!==undefined)throw new Error('Native Source rotation freeze bundle collides with existing operation state.')
      const tx=db.transaction([STORES.rotationOperations,STORES.operationArtifacts,STORES.states],'readwrite')
      tx.objectStore(STORES.rotationOperations).add({id:args.operation.operation_id,state:structuredClone(args.operation),hash:opHash})
      tx.objectStore(STORES.operationArtifacts).add({id:args.artifactId,value:structuredClone(args.artifactValue),bytes:artifactBytes,hash:artifactHash})
      tx.objectStore(STORES.states).put({id:next.epoch_id,state:structuredClone(next),tag})
      await transactionDone(tx)
      const [op,artifact,state]=await Promise.all([this.loadRotationOperation(args.operation.operation_id),this.operationArtifact<unknown>(args.artifactId),this.loadState(args.rootKey,args.epochSalt,next.epoch_id)])
      if(op.stage!=='source_frozen_verified'||artifact===null||state.rotation_state_ref?.state_record_hash!==opHash)throw new Error('Native Source rotation freeze bundle readback failed.')
      return state
    })
  }

  async initializeRotationOperation(state:RotationOperationStateV2):Promise<RotationOperationStateV2>{
    validateRotationOperationStateV2(state)
    const hash=await rotationOperationStateHashV2(state),db=await openDatabase(),readTx=db.transaction(STORES.rotationOperations,'readonly')
    const existing=await requestResult<{id:string;state:RotationOperationStateV2;hash:string}|undefined>(readTx.objectStore(STORES.rotationOperations).get(state.operation_id))
    await transactionDone(readTx)
    if(existing){
      if(existing.hash!==hash||await rotationOperationStateHashV2(existing.state)!==hash)throw new Error('Existing RotationOperationStateV2 does not match the requested operation.')
      return structuredClone(existing.state)
    }
    const tx=db.transaction(STORES.rotationOperations,'readwrite')
    tx.objectStore(STORES.rotationOperations).add({id:state.operation_id,state:structuredClone(state),hash})
    await transactionDone(tx)
    return this.loadRotationOperation(state.operation_id)
  }

  async loadRotationOperation(operationId:string):Promise<RotationOperationStateV2>{
    fixedBase64Url(operationId,32,'operation_id')
    const db=await openDatabase(),tx=db.transaction(STORES.rotationOperations,'readonly')
    const stored=await requestResult<{id:string;state:RotationOperationStateV2;hash:string}|undefined>(tx.objectStore(STORES.rotationOperations).get(operationId))
    await transactionDone(tx)
    if(!stored||stored.id!==operationId)throw new Error('RotationOperationStateV2 is missing.')
    validateRotationOperationStateV2(stored.state)
    if(stored.hash!==await rotationOperationStateHashV2(stored.state))throw new Error('RotationOperationStateV2 readback hash failed.')
    return structuredClone(stored.state)
  }

  async advanceRotationOperation(expectedStage:RotationOperationStageV2,next:RotationOperationStateV2):Promise<RotationOperationStateV2>{
    const current=await this.loadRotationOperation(next.operation_id)
    if(current.stage!==expectedStage)throw new Error('RotationOperationStateV2 stage changed before transition.')
    advanceRotationOperationStateV2(current,next)
    const hash=await rotationOperationStateHashV2(next),db=await openDatabase(),tx=db.transaction(STORES.rotationOperations,'readwrite')
    tx.objectStore(STORES.rotationOperations).put({id:next.operation_id,state:structuredClone(next),hash})
    await transactionDone(tx)
    return this.loadRotationOperation(next.operation_id)
  }

  async bindRotationOperationToState(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    operation:RotationOperationStateV2,
    expectedOperationGeneration:number,
  ):Promise<EpochLocalSecurityStateV6>{
    const persisted=await this.loadRotationOperation(operation.operation_id)
    if(await rotationOperationStateHashV2(persisted)!==await rotationOperationStateHashV2(operation))throw new Error('RotationOperationStateV2 binding mismatch.')
    const current=await this.loadState(rootKey,epochSalt,epochId)
    if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during rotation-operation binding.')
    if(current.epoch_id!==operation.successor_epoch_id)throw new Error('Rotation operation does not target this successor epoch.')
    if(current.rotation_state_ref&&current.rotation_state_ref.operation_id!==operation.operation_id)throw new Error('Another rotation operation is already bound to this epoch.')
    const hash=await rotationOperationStateHashV2(operation)
    const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,rotation_state_ref:{operation_id:operation.operation_id,state:operation.stage,state_record_hash:hash}}
    validateEpochLocalSecurityStateV6(next)
    const tag=await localStateTagV6(rootKey,epochSalt,next),db=await openDatabase(),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(next),tag})
    await transactionDone(tx)
    return this.loadState(rootKey,epochSalt,epochId)
  }

  async bindSourceRotationOperationToState(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    operation:RotationOperationStateV2,
    expectedOperationGeneration:number,
  ):Promise<EpochLocalSecurityStateV6>{
    const persisted=await this.loadRotationOperation(operation.operation_id)
    if(await rotationOperationStateHashV2(persisted)!==await rotationOperationStateHashV2(operation))throw new Error('Source RotationOperationStateV2 binding mismatch.')
    const current=await this.loadState(rootKey,epochSalt,epochId)
    if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale Source StateV6 generation during rotation binding.')
    if(current.epoch_id!==operation.source_epoch_id||epochId!==operation.source_epoch_id)throw new Error('Rotation operation does not bind this Source epoch.')
    if(current.rotation_state_ref&&current.rotation_state_ref.operation_id!==operation.operation_id&&!TERMINAL_ROTATION_OPERATION_STATES_V2.has(current.rotation_state_ref.state))throw new Error('Another Rotation operation is already bound to the Source epoch.')
    const hash=await rotationOperationStateHashV2(operation),next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,rotation_state_ref:{operation_id:operation.operation_id,state:operation.stage,state_record_hash:hash}}
    validateEpochLocalSecurityStateV6(next)
    const tag=await localStateTagV6(rootKey,epochSalt,next),db=await openDatabase(),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(next),tag});await transactionDone(tx)
    return this.loadState(rootKey,epochSalt,epochId)
  }

  async switchNativeRotationEpochStates(args:{
    operation:RotationOperationStateV2
    sourceRootKey:Uint8Array
    sourceEpochSalt:Uint8Array
    successorRootKey:Uint8Array
    successorEpochSalt:Uint8Array
  }):Promise<void>{
    if(args.operation.stage!=='activated_backup_verified')throw new Error('Native v2 rotation requires activated_backup_verified before local StateV6 switch.')
    if(args.operation.rotation_kind==='profile_upgrade')throw new Error('Profile upgrade cannot use the native v2 StateV6 switch.')
    const source=await this.loadState(args.sourceRootKey,args.sourceEpochSalt,args.operation.source_epoch_id)
    const successor=await this.loadState(args.successorRootKey,args.successorEpochSalt,args.operation.successor_epoch_id)
    if(source.diary_id!==successor.diary_id)throw new Error('Native v2 rotation local source/successor diary mismatch.')
    const hash=await rotationOperationStateHashV2(args.operation)
    if(source.rotation_state_ref?.operation_id!==args.operation.operation_id||source.rotation_state_ref.state!==args.operation.stage||source.rotation_state_ref.state_record_hash!==hash
      ||successor.rotation_state_ref?.operation_id!==args.operation.operation_id||successor.rotation_state_ref.state!==args.operation.stage||successor.rotation_state_ref.state_record_hash!==hash)throw new Error('Native v2 rotation StateV6 operation bindings are not switch-ready.')
    if(source.epoch_status==='retired'&&successor.epoch_status==='active')return
    if(source.epoch_status!=='active'||successor.epoch_status!=='remote_bound')throw new Error('Native v2 rotation local source/successor lifecycle mismatch.')
    if(!successor.remote_anchor||successor.verified_writer_generation===null||successor.verified_writer_grant_id===null||successor.verified_writer_device_id===null||successor.verified_writer_key_id===null)throw new Error('Native v2 rotation Successor lacks final canonical authority.')
    const localWriter=successor.writer_device_id===successor.verified_writer_device_id&&successor.writer_signing_key_id===successor.verified_writer_key_id
    const sourceNext:EpochLocalSecurityStateV6={...source,epoch_status:'retired',writer_status:'read_only',writer_generation:null,writer_grant_id:null,operation_generation:source.operation_generation+1}
    const successorNext:EpochLocalSecurityStateV6={...successor,epoch_status:'active',writer_status:localWriter?'writer_active':'read_only',writer_generation:localWriter?successor.verified_writer_generation:null,writer_grant_id:localWriter?successor.verified_writer_grant_id:null,operation_generation:successor.operation_generation+1}
    validateEpochLocalSecurityStateV6(sourceNext);validateEpochLocalSecurityStateV6(successorNext)
    const sourceTag=await localStateTagV6(args.sourceRootKey,args.sourceEpochSalt,sourceNext),successorTag=await localStateTagV6(args.successorRootKey,args.successorEpochSalt,successorNext)
    const db=await openDatabase(),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).put({id:sourceNext.epoch_id,state:structuredClone(sourceNext),tag:sourceTag})
    tx.objectStore(STORES.states).put({id:successorNext.epoch_id,state:structuredClone(successorNext),tag:successorTag})
    await transactionDone(tx)
    const [sourceRead,successorRead]=await Promise.all([this.loadState(args.sourceRootKey,args.sourceEpochSalt,sourceNext.epoch_id),this.loadState(args.successorRootKey,args.successorEpochSalt,successorNext.epoch_id)])
    if(sourceRead.epoch_status!=='retired'||successorRead.epoch_status!=='active')throw new Error('Native v2 rotation local StateV6 switch readback failed.')
  }

  async persistActivationLineageCache(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    cache:ActivationLineageCacheV2,
    expectedOperationGeneration:number,
  ):Promise<EpochLocalSecurityStateV6>{
    const lineage=await openActivationLineageCacheV2({cache,rootKey,epochSalt,diaryId:cache.diary_id,epochId:cache.epoch_id,manifestFingerprint:cache.manifest_fingerprint})
    if(!lineage.length)throw new Error('A profile-upgrade ActivationLineageCacheV2 must not be empty.')
    const current=await this.loadState(rootKey,epochSalt,cache.epoch_id)
    if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during ActivationLineageCacheV2 persistence.')
    if(current.diary_id!==cache.diary_id||current.manifest_fingerprint!==cache.manifest_fingerprint)throw new Error('ActivationLineageCacheV2 does not bind the local epoch.')
    const cacheHash=await activationLineageCacheHashV2(cache),db=await openDatabase()
    const readTx=db.transaction(STORES.lineageCaches,'readonly')
    const existing=await requestResult<{id:string;cache:ActivationLineageCacheV2;hash:string}|undefined>(readTx.objectStore(STORES.lineageCaches).get(cache.cache_id))
    await transactionDone(readTx)
    const encoded=new TextDecoder().decode(canonicalBytes(cache as never))
    if(existing&&(
      existing.hash!==cacheHash
      ||new TextDecoder().decode(canonicalBytes(existing.cache as never))!==encoded
    ))throw new Error('ActivationLineageCacheV2 immutable identity collision.')
    const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1,activation_lineage_cache_ref:{cache_id:cache.cache_id,cache_record_hash:cacheHash}}
    validateEpochLocalSecurityStateV6(next)
    const tag=await localStateTagV6(rootKey,epochSalt,next),tx=db.transaction([STORES.lineageCaches,STORES.states],'readwrite')
    if(!existing)tx.objectStore(STORES.lineageCaches).add({id:cache.cache_id,cache:structuredClone(cache),hash:cacheHash})
    tx.objectStore(STORES.states).put({id:cache.epoch_id,state:structuredClone(next),tag})
    await transactionDone(tx)
    const verifyTx=db.transaction(STORES.lineageCaches,'readonly')
    const readback=await requestResult<{id:string;cache:ActivationLineageCacheV2;hash:string}|undefined>(verifyTx.objectStore(STORES.lineageCaches).get(cache.cache_id))
    await transactionDone(verifyTx)
    if(!readback||readback.hash!==cacheHash||new TextDecoder().decode(canonicalBytes(readback.cache as never))!==encoded)throw new Error('ActivationLineageCacheV2 persistent readback mismatch.')
    await openActivationLineageCacheV2({cache:readback.cache,rootKey,epochSalt,diaryId:cache.diary_id,epochId:cache.epoch_id,manifestFingerprint:cache.manifest_fingerprint})
    return this.loadState(rootKey,epochSalt,cache.epoch_id)
  }

  async loadActivationLineageCache(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
  ):Promise<ActivationLineageCacheV2>{
    const state=await this.loadState(rootKey,epochSalt,epochId),ref=state.activation_lineage_cache_ref
    if(!ref)throw new Error('ActivationLineageCacheV2 reference is missing.')
    const db=await openDatabase(),tx=db.transaction(STORES.lineageCaches,'readonly')
    const stored=await requestResult<{id:string;cache:ActivationLineageCacheV2;hash:string}|undefined>(tx.objectStore(STORES.lineageCaches).get(ref.cache_id))
    await transactionDone(tx)
    if(!stored||stored.hash!==ref.cache_record_hash||stored.hash!==await activationLineageCacheHashV2(stored.cache))throw new Error('ActivationLineageCacheV2 reference/hash mismatch.')
    await openActivationLineageCacheV2({cache:stored.cache,rootKey,epochSalt,diaryId:state.diary_id,epochId:state.epoch_id,manifestFingerprint:state.manifest_fingerprint})
    return structuredClone(stored.cache)
  }

  async initializeState(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6):Promise<void>{
    validateEpochLocalSecurityStateV6(state)
    const db=await openDatabase(),tag=await localStateTagV6(rootKey,epochSalt,state),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).add({id:state.epoch_id,state:structuredClone(state),tag})
    await transactionDone(tx)
    await this.loadState(rootKey,epochSalt,state.epoch_id)
  }

  async loadState(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<EpochLocalSecurityStateV6>{
    const db=await openDatabase(),tx=db.transaction(STORES.states,'readonly')
    const stored=await requestResult<{id:string;state:EpochLocalSecurityStateV6;tag:string}|undefined>(tx.objectStore(STORES.states).get(epochId))
    await transactionDone(tx)
    if(!stored)throw new Error('EpochLocalSecurityStateV6 is missing.')
    validateEpochLocalSecurityStateV6(stored.state)
    await verifyLocalStateTagV6(rootKey,epochSalt,stored.state,stored.tag)
    if(stored.id!==stored.state.epoch_id||stored.id!==epochId)throw new Error('EpochLocalSecurityStateV6 identity mismatch.')
    return structuredClone(stored.state)
  }

  async replaceState(rootKey:Uint8Array,epochSalt:Uint8Array,expectedOperationGeneration:number,next:EpochLocalSecurityStateV6):Promise<void>{
    validateEpochLocalSecurityStateV6(next)
    const db=await openDatabase(),current=await this.loadState(rootKey,epochSalt,next.epoch_id)
    if(current.operation_generation!==expectedOperationGeneration||next.operation_generation!==expectedOperationGeneration+1)throw new Error('Stale EpochLocalSecurityStateV6 generation.')
    assertStateTransition(current,next)
    const tag=await localStateTagV6(rootKey,epochSalt,next),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).put({id:next.epoch_id,state:structuredClone(next),tag})
    await transactionDone(tx)
    await this.loadState(rootKey,epochSalt,next.epoch_id)
  }

  async loadPersistedRecoveryArtifactV6(
    urs:Uint8Array,
    diaryId:string,
    epochId:string,
    recoveryArtifactId:string,
  ):Promise<VerifiedPersistedRecoveryArtifactV6>{
    fixedBase64Url(recoveryArtifactId,16,'recovery_artifact_id')
    const id=`${epochId}:${recoveryArtifactId}`,db=await openDatabase(),tx=db.transaction(STORES.recoveryArtifacts,'readonly')
    const stored=await requestResult<{id:string;artifactBytes:string;artifactSha256:string;familyLocator:string;artifactLocator:string}|undefined>(tx.objectStore(STORES.recoveryArtifacts).get(id))
    await transactionDone(tx)
    if(!stored||stored.id!==id)throw new Error('Persisted RecoveryArtifactV6 is missing.')
    const artifact=parseCanonicalJson(new TextEncoder().encode(stored.artifactBytes)) as unknown as RecoveryArtifactV6
    const opened=await openRecoveryArtifactV6(artifact,urs)
    if(opened.payload.diary_id!==diaryId||opened.payload.epoch_id!==epochId||artifact.recovery_artifact_id!==recoveryArtifactId)throw new Error('Persisted RecoveryArtifactV6 context mismatch.')
    const hash=await recoveryArtifactHashV6(artifact),family=await recoveryFamilyLocatorV6(urs),locator=await recoveryArtifactLocatorV6(urs,diaryId,epochId)
    if(hash!==stored.artifactSha256||family!==stored.familyLocator||locator!==stored.artifactLocator)throw new Error('Persisted RecoveryArtifactV6 locator/hash integrity failed.')
    return new VerifiedPersistedRecoveryArtifactV6(structuredClone(artifact),hash,family,locator,diaryId,epochId,VERIFIED_PERSISTED_RECOVERY_ARTIFACT_TOKEN)
  }

  async persistRecoveryArtifactV6(urs:Uint8Array,diaryId:string,epochId:string,artifact:RecoveryArtifactV6):Promise<VerifiedPersistedRecoveryArtifactV6>{
    const payload=(await openRecoveryArtifactV6(artifact,urs)).payload
    if(payload.diary_id!==diaryId||payload.epoch_id!==epochId)throw new Error('RecoveryArtifactV6 persistence context mismatch.')
    const artifactSha256=await recoveryArtifactHashV6(artifact)
    const familyLocator=await recoveryFamilyLocatorV6(urs),artifactLocator=await recoveryArtifactLocatorV6(urs,diaryId,epochId)
    const artifactBytes=new TextDecoder().decode(canonicalBytes(artifact as never))
    const id=`${epochId}:${artifact.recovery_artifact_id}`
    const db=await openDatabase(),tx=db.transaction(STORES.recoveryArtifacts,'readwrite')
    const existing=await requestResult<{id:string;artifactBytes:string;artifactSha256:string;familyLocator:string;artifactLocator:string}|undefined>(tx.objectStore(STORES.recoveryArtifacts).get(id))
    if(existing){
      if(existing.artifactBytes!==artifactBytes||existing.artifactSha256!==artifactSha256||existing.familyLocator!==familyLocator||existing.artifactLocator!==artifactLocator){
        tx.abort()
        throw new Error('RecoveryArtifactV6 immutable persistence collision.')
      }
    }else tx.objectStore(STORES.recoveryArtifacts).add({id,artifactBytes,artifactSha256,familyLocator,artifactLocator})
    await transactionDone(tx)
    const readTx=db.transaction(STORES.recoveryArtifacts,'readonly')
    const readback=await requestResult<{id:string;artifactBytes:string;artifactSha256:string;familyLocator:string;artifactLocator:string}|undefined>(readTx.objectStore(STORES.recoveryArtifacts).get(id))
    await transactionDone(readTx)
    if(!readback||readback.artifactBytes!==artifactBytes||readback.artifactSha256!==artifactSha256||readback.familyLocator!==familyLocator||readback.artifactLocator!==artifactLocator)throw new Error('RecoveryArtifactV6 persistent readback mismatch.')
    await openRecoveryArtifactV6(artifact,urs)
    return new VerifiedPersistedRecoveryArtifactV6(structuredClone(artifact),artifactSha256,familyLocator,artifactLocator,diaryId,epochId,VERIFIED_PERSISTED_RECOVERY_ARTIFACT_TOKEN)
  }

  async persistRecoveryTakeoverStaging(staging:RecoveryTakeoverStagingV2,urs:Uint8Array):Promise<VerifiedRecoveryTakeoverStagingV2>{
    const verified=await verifyRecoveryTakeoverStagingV2(staging,urs)
    if(!isVerifiedRecoveryTakeoverStagingV2(verified))throw new Error('RecoveryTakeoverStagingV2 verification failed.')
    const id=`${staging.epoch_id}:${staging.recovery_generation}:${staging.recovery_takeover_key_id}:${staging.manifest_fingerprint}`
    const db=await openDatabase(),tx=db.transaction(STORES.recoveryStaging,'readwrite')
    const existing=await requestResult<{id:string;staging:RecoveryTakeoverStagingV2}|undefined>(tx.objectStore(STORES.recoveryStaging).get(id))
    if(existing){
      if(new TextDecoder().decode(canonicalBytes(existing.staging as never))!==new TextDecoder().decode(canonicalBytes(staging as never))){
        tx.abort()
        throw new Error('RecoveryTakeoverStagingV2 immutable identity collision.')
      }
    }else tx.objectStore(STORES.recoveryStaging).add({id,staging:structuredClone(staging)})
    await transactionDone(tx)
    const readTx=db.transaction(STORES.recoveryStaging,'readonly')
    const readback=await requestResult<{id:string;staging:RecoveryTakeoverStagingV2}|undefined>(readTx.objectStore(STORES.recoveryStaging).get(id))
    await transactionDone(readTx)
    if(!readback||new TextDecoder().decode(canonicalBytes(readback.staging as never))!==new TextDecoder().decode(canonicalBytes(staging as never)))throw new Error('RecoveryTakeoverStagingV2 persistent readback mismatch.')
    return verifyRecoveryTakeoverStagingV2(readback.staging,urs)
  }

  async loadRecoveryTakeoverStagingMaterial(args:{
    epochId:string
    recoveryGeneration:number
    recoveryTakeoverKeyId:string
    manifestFingerprint:string
    urs:Uint8Array
  }):Promise<{verified:VerifiedRecoveryTakeoverStagingV2;privateKeyPkcs8:Uint8Array}>{
    const id=`${args.epochId}:${args.recoveryGeneration}:${args.recoveryTakeoverKeyId}:${args.manifestFingerprint}`
    const db=await openDatabase(),tx=db.transaction(STORES.recoveryStaging,'readonly')
    const stored=await requestResult<{id:string;staging:RecoveryTakeoverStagingV2}|undefined>(tx.objectStore(STORES.recoveryStaging).get(id))
    await transactionDone(tx)
    if(!stored)throw new Error('RecoveryTakeoverStagingV2 is missing.')
    return openRecoveryTakeoverStagingV2(stored.staging,args.urs)
  }

  async deleteRecoveryTakeoverStaging(args:{
    epochId:string
    recoveryGeneration:number
    recoveryTakeoverKeyId:string
    manifestFingerprint:string
    urs:Uint8Array
  }):Promise<void>{
    const opened=await this.loadRecoveryTakeoverStagingMaterial(args)
    if(opened.verified.staging.epoch_id!==args.epochId)throw new Error('RecoveryTakeoverStagingV2 deletion binding mismatch.')
    const id=`${args.epochId}:${args.recoveryGeneration}:${args.recoveryTakeoverKeyId}:${args.manifestFingerprint}`,db=await openDatabase(),tx=db.transaction(STORES.recoveryStaging,'readwrite')
    tx.objectStore(STORES.recoveryStaging).delete(id)
    await transactionDone(tx)
    const check=db.transaction(STORES.recoveryStaging,'readonly')
    const remaining=await requestResult<unknown>(check.objectStore(STORES.recoveryStaging).get(id))
    await transactionDone(check)
    if(remaining!==undefined)throw new Error('RecoveryTakeoverStagingV2 deletion readback failed.')
  }

  async persistWriterKey(entry:StoredWriterDeviceKeyV2,diaryId:string,epochId:string):Promise<void>{
    await validateStoredWriterDeviceKeyV2(entry,diaryId,epochId)
    const db=await openDatabase(),readTx=db.transaction(STORES.writerKeys,'readonly')
    const existing=await requestResult<StoredWriterDeviceKeyV2|undefined>(readTx.objectStore(STORES.writerKeys).get(entry.writer_signing_key_id))
    await transactionDone(readTx)
    if(existing){
      await validateStoredWriterDeviceKeyV2(existing,diaryId,epochId)
      if(existing.writer_device_id!==entry.writer_device_id||existing.writer_public_key!==entry.writer_public_key)throw new Error('Writer key ID collision in local key store.')
      return
    }
    const writeTx=db.transaction(STORES.writerKeys,'readwrite')
    writeTx.objectStore(STORES.writerKeys).add(entry)
    await transactionDone(writeTx)
  }

  async loadWriterKey(writerSigningKeyId:string,diaryId:string,epochId:string):Promise<StoredWriterDeviceKeyV2|null>{
    const db=await openDatabase(),tx=db.transaction(STORES.writerKeys,'readonly')
    const entry=await requestResult<StoredWriterDeviceKeyV2|undefined>(tx.objectStore(STORES.writerKeys).get(writerSigningKeyId))
    await transactionDone(tx)
    if(!entry)return null
    await validateStoredWriterDeviceKeyV2(entry,diaryId,epochId)
    return entry
  }

  async reserveEnvelope(epochId:string,remoteRows:ReadonlyArray<readonly string[]> = []):Promise<EnvelopeReservationV6>{
    const db=await openDatabase()
    const envelopeId=base64Url(randomBytes(32)),iv=base64Url(randomBytes(12))
    if(remoteRows.some(row=>row[1]===iv))throw new Error('EnvelopeV6 IV reuse against verified remote history is a security anomaly.')
    const reservation:EnvelopeReservationV6={id:`${epochId}:${envelopeId}`,epoch_id:epochId,envelope_id:envelopeId,iv,state:'reserved'}
    const checkTx=db.transaction(STORES.reservations,'readonly')
    const idRequest=checkTx.objectStore(STORES.reservations).get(reservation.id)
    const ivRequest=checkTx.objectStore(STORES.reservations).index('byEpochIv').get([epochId,iv])
    const [existingId,existingIv]=await Promise.all([
      requestResult<EnvelopeReservationV6|undefined>(idRequest),
      requestResult<EnvelopeReservationV6|undefined>(ivRequest),
    ])
    await transactionDone(checkTx)
    if(existingId)throw new Error('EnvelopeV6 envelope_id collision is a security anomaly.')
    if(existingIv)throw new Error('EnvelopeV6 IV reuse across envelope IDs is a security anomaly.')
    const tx=db.transaction(STORES.reservations,'readwrite')
    try{tx.objectStore(STORES.reservations).add(reservation);await transactionDone(tx)}
    catch(error){
      if(error instanceof DOMException&&error.name==='ConstraintError')throw new Error('EnvelopeV6 reservation collision is a security anomaly.',{cause:error})
      throw error
    }
    return reservation
  }

  async commitReservedEnvelope(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    expectedOperationGeneration:number,
    reservation:EnvelopeReservationV6,
    envelope:PreparedEnvelope,
    authority:PreparedEnvelopeAuthorityV2|null,
    ceremonyOwner?:V2OutboxCeremonyOwner,
  ):Promise<EpochLocalSecurityStateV6>{
    if(reservation.state!=='reserved'||reservation.envelope_id!==envelope.envelopeId||reservation.iv!==envelope.iv)throw new Error('Prepared envelope does not match its one-shot reservation.')
    const db=await openDatabase(),current=await this.loadState(rootKey,epochSalt,reservation.epoch_id)
    if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale local-state generation before envelope commit.')
    const reservationId=reservation.id
    const checkTx=db.transaction(STORES.reservations,'readonly')
    const storedReservation=await requestResult<EnvelopeReservationV6|undefined>(checkTx.objectStore(STORES.reservations).get(reservationId))
    await transactionDone(checkTx)
    if(!storedReservation||storedReservation.state!=='reserved'||storedReservation.envelope_id!==envelope.envelopeId||storedReservation.iv!==envelope.iv)throw new Error('Envelope reservation is missing, consumed or changed.')
    await assertAuthorityMatchesEnvelope(rootKey,epochSalt,current.diary_id,current.epoch_id,envelope,authority)

    const sequence=current.local_journal_count+1
    const nextState:EpochLocalSecurityStateV6={
      ...current,
      operation_generation:current.operation_generation+1,
      local_journal_count:sequence,
      local_journal_hash:await localJournalNextV2(current.local_journal_hash,sequence,envelope),
    }
    validateEpochLocalSecurityStateV6(nextState)
    const tag=await localStateTagV6(rootKey,epochSalt,nextState)
    const outboxCore:V2OutboxEntryCore={id:reservationId,epoch_id:reservation.epoch_id,envelope_id:envelope.envelopeId,status:'prepared',authority:structuredClone(authority),...(ceremonyOwner?{ceremony_owner:ceremonyOwner}:{})}
    const outboxEntry:V2OutboxEntry={...outboxCore,tag:await outboxTag(rootKey,epochSalt,outboxCore)}
    const tx=db.transaction([STORES.reservations,STORES.envelopes,STORES.outbox,STORES.states],'readwrite')
    tx.objectStore(STORES.reservations).put({...storedReservation,state:'sealed'} satisfies EnvelopeReservationV6)
    tx.objectStore(STORES.envelopes).add({...envelope,id:reservationId,epoch_id:reservation.epoch_id,local_sequence:sequence} satisfies PersistedEnvelopeV6)
    tx.objectStore(STORES.outbox).add(outboxEntry)
    tx.objectStore(STORES.states).put({id:reservation.epoch_id,state:structuredClone(nextState),tag})
    await transactionDone(tx)
    return this.loadState(rootKey,epochSalt,reservation.epoch_id)
  }


  async commitVerifiedDispositions(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    expectedOperationGeneration:number,
    nextState:EpochLocalSecurityStateV6,
    acceptedEnvelopeIds:ReadonlySet<string>,
    staleWriterEnvelopeIds:ReadonlySet<string>,
    context:VerifiedDispositionContextV2,
  ):Promise<EpochLocalSecurityStateV6>{
    return withDiaryLockV2(nextState.diary_id,async()=>{
      await this.verifyLocalJournal(rootKey,epochSalt,nextState.epoch_id)
      const current=await this.loadState(rootKey,epochSalt,nextState.epoch_id)
      if(current.operation_generation!==expectedOperationGeneration||nextState.operation_generation!==expectedOperationGeneration+1)throw new Error('Stale StateV6 generation during verified disposition commit.')
      assertStateTransition(current,nextState)
      const [entries,envelopes]=await Promise.all([
        this.outbox(rootKey,epochSalt,nextState.epoch_id),
        this.envelopes(nextState.epoch_id),
      ])
      const localById=new Map(envelopes.map(envelope=>[envelope.envelopeId,envelope]))
      for(const row of context.remote_rows){
        const local=localById.get(row[0]??'')
        if(local&&(row.length!==3||row[1]!==local.iv||row[2]!==local.ciphertext))throw new Error('Remote envelope_id collides with different immutable local bytes.')
      }
      const updated=entries.map(entry=>{
        let status:V2OutboxStatus=entry.status
        if(context.preserve_ceremony_owned&&entry.ceremony_owner!==undefined)return entry
        if(acceptedEnvelopeIds.has(entry.envelope_id))status='durable'
        else if(staleWriterEnvelopeIds.has(entry.envelope_id))status='stale_writer_pending'
        else if(entry.status!=='durable'&&entry.authority!==null&&(context.source_epoch_sealed
          ||context.recovery_rekey_rotation_required
          ||!sameAuthority(entry.authority,context.current_writer)))status='stale_writer_pending'
        assertOutboxTransition(entry.status,status)
        return{...entry,status}
      })
      const staleCount=updated.filter(entry=>entry.status==='stale_writer_pending').length
      const finalState={...nextState,stale_writer_pending_count:staleCount}
      validateEpochLocalSecurityStateV6(finalState)
      assertStateTransition(current,finalState)
      const tag=await localStateTagV6(rootKey,epochSalt,finalState),db=await openDatabase()
      const authenticatedUpdated:V2OutboxEntry[]=[]
      for(const entry of updated){
        const core:V2OutboxEntryCore={id:entry.id,epoch_id:entry.epoch_id,envelope_id:entry.envelope_id,status:entry.status,authority:structuredClone(entry.authority),...(entry.ceremony_owner?{ceremony_owner:entry.ceremony_owner}:{})}
        authenticatedUpdated.push({...core,tag:await outboxTag(rootKey,epochSalt,core)})
      }
      const tx=db.transaction([STORES.outbox,STORES.states],'readwrite')
      for(const entry of authenticatedUpdated)tx.objectStore(STORES.outbox).put(entry)
      tx.objectStore(STORES.states).put({id:finalState.epoch_id,state:structuredClone(finalState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,finalState.epoch_id)
    })
  }

  async updateOutboxStatus(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    envelopeId:string,
    expectedOperationGeneration:number,
    status:'pending'|'stale_writer_pending',
  ):Promise<EpochLocalSecurityStateV6>{
    const current=await this.loadState(rootKey,epochSalt,epochId)
    return withDiaryLockV2(current.diary_id,async()=>{
      await this.verifyLocalJournal(rootKey,epochSalt,epochId)
      const fresh=await this.loadState(rootKey,epochSalt,epochId)
      if(fresh.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during outbox update.')
      const db=await openDatabase(),readTx=db.transaction(STORES.outbox,'readonly')
      const entry=await requestResult<V2OutboxEntry|undefined>(readTx.objectStore(STORES.outbox).get(`${epochId}:${envelopeId}`))
      await transactionDone(readTx)
      if(!entry)throw new Error('V2 outbox envelope is missing.')
      await verifyOutboxTag(rootKey,epochSalt,entry)
      assertOutboxTransition(entry.status,status)
      const entries=await this.outbox(rootKey,epochSalt,epochId)
      const nextEntries=entries.map(item=>item.id===entry.id?{...item,status}:item)
      const staleCount=nextEntries.filter(item=>item.status==='stale_writer_pending').length
      const nextState={...fresh,operation_generation:fresh.operation_generation+1,stale_writer_pending_count:staleCount}
      const tag=await localStateTagV6(rootKey,epochSalt,nextState)
      const nextCore:V2OutboxEntryCore={id:entry.id,epoch_id:entry.epoch_id,envelope_id:entry.envelope_id,status,authority:structuredClone(entry.authority),...(entry.ceremony_owner?{ceremony_owner:entry.ceremony_owner}:{})}
      const nextEntry:V2OutboxEntry={...nextCore,tag:await outboxTag(rootKey,epochSalt,nextCore)}
      const tx=db.transaction([STORES.outbox,STORES.states],'readwrite')
      tx.objectStore(STORES.outbox).put(nextEntry)
      tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(nextState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,epochId)
    })
  }

  async envelopeAuthority(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string,envelope:PreparedEnvelope):Promise<PreparedEnvelopeAuthorityV2|null>{
    const db=await openDatabase(),tx=db.transaction([STORES.outbox,STORES.envelopes],'readonly')
    const id=`${epochId}:${envelope.envelopeId}`
    const entryRequest=tx.objectStore(STORES.outbox).get(id)
    const storedRequest=tx.objectStore(STORES.envelopes).get(id)
    const [entry,stored]=await Promise.all([
      requestResult<V2OutboxEntry|undefined>(entryRequest),
      requestResult<PersistedEnvelopeV6|undefined>(storedRequest),
    ])
    await transactionDone(tx)
    if(!entry&&!stored)return null
    if(!entry||!stored)throw new Error('V2 prepared envelope binding is incomplete.')
    await verifyOutboxTag(rootKey,epochSalt,entry)
    if(stored.envelopeId!==envelope.envelopeId
      ||stored.iv!==envelope.iv
      ||stored.ciphertext!==envelope.ciphertext
      ||stored.bytesHash!==envelope.bytesHash)throw new Error('Prepared envelope bytes do not match immutable local persistence.')
    const state=await this.loadState(rootKey,epochSalt,epochId)
    await assertAuthorityMatchesEnvelope(rootKey,epochSalt,state.diary_id,epochId,envelope,entry.authority)
    return entry.authority===null?null:structuredClone(entry.authority)
  }

  async outbox(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<V2OutboxEntry[]>{
    const db=await openDatabase(),tx=db.transaction(STORES.outbox,'readonly')
    const entries=await requestResult<V2OutboxEntry[]>(tx.objectStore(STORES.outbox).index('byEpoch').getAll(epochId))
    await transactionDone(tx)
    for(const entry of entries)await verifyOutboxTag(rootKey,epochSalt,entry)
    return entries.map(entry=>structuredClone(entry))
  }

  async verifyLocalJournal(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<void>{
    const state=await this.loadState(rootKey,epochSalt,epochId)
    const db=await openDatabase(),tx=db.transaction([STORES.envelopes,STORES.outbox,STORES.reservations],'readonly')
    const envelopeRequest=tx.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId)
    const outboxRequest=tx.objectStore(STORES.outbox).index('byEpoch').getAll(epochId)
    const reservationRequest=tx.objectStore(STORES.reservations).index('byEpoch').getAll(epochId)
    const [stored,entries,reservations]=await Promise.all([
      requestResult<PersistedEnvelopeV6[]>(envelopeRequest),
      requestResult<V2OutboxEntry[]>(outboxRequest),
      requestResult<EnvelopeReservationV6[]>(reservationRequest),
    ])
    await transactionDone(tx)
    let hash=await localJournalInitialV2(state.diary_id,state.epoch_id)
    let count=0
    const outboxById=new Map<string,V2OutboxEntry>()
    const reservationsById=new Map(reservations.map(reservation=>[reservation.id,reservation]))
    for(const entry of entries){
      await verifyOutboxTag(rootKey,epochSalt,entry)
      if(entry.epoch_id!==epochId||entry.id!==`${epochId}:${entry.envelope_id}`||outboxById.has(entry.id))throw new Error('V2 outbox identity is corrupt.')
      outboxById.set(entry.id,entry)
    }
    for(const envelope of stored.sort((a,b)=>a.local_sequence-b.local_sequence)){
      count+=1
      if(envelope.local_sequence!==count)throw new Error('V2 local envelope journal sequence is corrupt.')
      if(envelope.epoch_id!==epochId||envelope.id!==`${epochId}:${envelope.envelopeId}`)throw new Error('V2 local envelope identity is corrupt.')
      const entry=outboxById.get(envelope.id)
      if(!entry||entry.envelope_id!==envelope.envelopeId)throw new Error('V2 immutable envelope/outbox bijection failed.')
      const reservation=reservationsById.get(envelope.id)
      if(!reservation
        ||reservation.state!=='sealed'
        ||reservation.epoch_id!==epochId
        ||reservation.envelope_id!==envelope.envelopeId
        ||reservation.iv!==envelope.iv)throw new Error('V2 sealed envelope/reservation binding failed.')
      hash=await localJournalNextV2(hash,count,envelope)
    }
    if(outboxById.size!==stored.length)throw new Error('V2 immutable envelope/outbox bijection failed.')
    const envelopeIds=new Set(stored.map(envelope=>envelope.id))
    for(const reservation of reservations){
      if(reservation.state==='sealed'&&!envelopeIds.has(reservation.id))throw new Error('V2 sealed reservation references a missing immutable envelope.')
    }
    const staleCount=entries.filter(entry=>entry.status==='stale_writer_pending').length
    if(staleCount!==state.stale_writer_pending_count)throw new Error('V2 stale-writer quarantine count is inconsistent with authenticated outbox.')
    if(count!==state.local_journal_count||hash!==state.local_journal_hash)throw new Error('V2 local envelope journal hash failed.')
  }

  async envelopes(epochId:string):Promise<PreparedEnvelope[]>{
    const db=await openDatabase(),tx=db.transaction(STORES.envelopes,'readonly')
    const stored=await requestResult<PersistedEnvelopeV6[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId))
    await transactionDone(tx)
    return stored.sort((a,b)=>a.local_sequence-b.local_sequence).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash}))
  }
}

export const __v2LocalPersistenceTesting={
  async reset():Promise<void>{
    if(databasePromise){const db=await databasePromise;db.close();databasePromise=null}
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(DATABASE_NAME);request.addEventListener('success',()=>resolve(),{once:true});request.addEventListener('error',()=>reject(request.error),{once:true});request.addEventListener('blocked',()=>reject(new Error('V2 security database reset blocked.')),{once:true})})
  },
  STORES,
  openDatabase,
}
