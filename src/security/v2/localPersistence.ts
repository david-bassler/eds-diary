import { base64Url, equalBytes, fixedBase64Url, fromBase64Url, randomBytes } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { hmacSha256 } from '../crypto/core'
import { deriveLocalStateMacKeyV2 } from './crypto'
import { openRevisionEnvelopeV2 } from './envelopes'
import type { PreparedEnvelope } from '../envelopes'
import { localJournalInitialV2, localJournalNextV2, localStateTagV6, validateEpochLocalSecurityStateV6, validateStoredWriterDeviceKeyV2, verifyLocalStateTagV6, withDiaryLockV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from './localState'
import { isVerifiedRecoveryTakeoverStagingV2, verifyRecoveryTakeoverStagingV2, type RecoveryTakeoverStagingV2, type VerifiedRecoveryTakeoverStagingV2 } from './recoveryStaging'
import { openRecoveryArtifactV6, recoveryArtifactHashV6, recoveryArtifactLocatorV6, recoveryFamilyLocatorV6, type RecoveryArtifactV6 } from './recovery'
import { activationLineageCacheHashV2, openActivationLineageCacheV2, type ActivationLineageCacheV2 } from './activationLineageCache'
import { advanceRotationOperationStateV2, rotationOperationStateHashV2, validateRotationOperationStateV2, type RotationOperationStateV2, type RotationOperationStageV2 } from './profileUpgrade'
import { openBestEffortRootWrapV6, validateRootWrapV6, type RootWrapV6 } from './rootWrap'

const DATABASE_NAME='eds-diary-v2-security'
const DATABASE_VERSION=7
const STORES={states:'epochSecurityStateV6',writerKeys:'writerDeviceKeysV2',reservations:'envelopeReservationsV6',envelopes:'envelopesV6',outbox:'outboxV6',recoveryStaging:'recoveryTakeoverStagingV2',recoveryArtifacts:'recoveryArtifactsV6',rotationOperations:'rotationOperationsV2',lineageCaches:'activationLineageCachesV2',rootWraps:'rootWrapsV6',rootWrappingKeys:'rootWrappingKeysV6'} as const

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
}
export type V2OutboxStatus='prepared'|'pending'|'durable'|'stale_writer_pending'
export interface V2OutboxEntryCore {
  id:string
  epoch_id:string
  envelope_id:string
  status:V2OutboxStatus
  authority:PreparedEnvelopeAuthorityV2|null
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
      if(!db.objectStoreNames.contains(STORES.lineageCaches))db.createObjectStore(STORES.lineageCaches,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.rootWraps))db.createObjectStore(STORES.rootWraps,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.rootWrappingKeys))db.createObjectStore(STORES.rootWrappingKeys,{keyPath:'id'})
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
    const outboxCore:V2OutboxEntryCore={id:reservationId,epoch_id:reservation.epoch_id,envelope_id:envelope.envelopeId,status:'prepared',authority:structuredClone(authority)}
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
        const core:V2OutboxEntryCore={id:entry.id,epoch_id:entry.epoch_id,envelope_id:entry.envelope_id,status:entry.status,authority:structuredClone(entry.authority)}
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
      const nextCore:V2OutboxEntryCore={id:entry.id,epoch_id:entry.epoch_id,envelope_id:entry.envelope_id,status,authority:structuredClone(entry.authority)}
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
