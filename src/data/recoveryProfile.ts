import { base64Url, decodeUtf8, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSalt, sha256 } from '../security/crypto/core'
import { envelopeRow, openEnvelope, type PreparedEnvelope } from '../security/envelopes'
import { createBestEffortRootWrap, journalInitial, journalNext, openBestEffortRootWrap, stateTag, verifyStateTag, type EpochLocalSecurityStateV5, type RootWrap } from '../security/localState'
import type { RecoveredRootCandidate, RecoveryArtifact, RecoveryPersistenceProof } from '../security/recovery'
import { validateRevisionGraphV1, type RevisionV1 } from '../security/revisions'
import { validateDomainData } from '../security/domainSchemaValidator'
import { createAnchorV1 } from '../sync/core/prefix'
import type { VerifiedRecoveryBootstrap } from '../sync/core/remoteVerifier'

const SECURE_DATABASE_VERSION_FLOOR = 9
const SECURE_DATABASE_VERSION_CEILING = 10
const DEFAULT_DATABASE_NAME = 'eds-diary'
const LEGACY_PLAINTEXT_STORES = ['painEntries','medicationEntries','medicationPrescriptions','activityEntries','settings'] as const
const STORES = {
  context:'epochContexts',wraps:'rootWraps',wrappingKeys:'wrappingKeys',reservations:'envelopeReservations',
  envelopes:'envelopes',outbox:'outbox',state:'epochSecurityState',migration:'migrationState',operations:'operationState',
} as const
const ACTIVE_CONTEXT = 'active'

type Row = readonly [string,string,string]
interface StoredEnvelope extends PreparedEnvelope {id:string;epochId:string;localSeq:number;rowBytes:string}

function requestResult<T>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.addEventListener('success',()=>resolve(request.result),{once:true});request.addEventListener('error',()=>reject(request.error??new Error('IndexedDB request failed.')),{once:true})})}
function transactionDone(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.addEventListener('complete',()=>resolve(),{once:true});tx.addEventListener('abort',()=>reject(tx.error??new Error('IndexedDB transaction aborted.')),{once:true});tx.addEventListener('error',()=>reject(tx.error??new Error('IndexedDB transaction failed.')),{once:true})})}

function applyRecoverySchema(db:IDBDatabase):void{
  for(const name of Object.values(STORES))if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'id'});if(name===STORES.envelopes||name===STORES.outbox)store.createIndex('byEpoch','epochId')}
}
function recoverySchemaReady(db:IDBDatabase):boolean{return Object.values(STORES).every(name=>db.objectStoreNames.contains(name))&&!db.objectStoreNames.contains('revisions')}
function recoveryBootstrapSchemaOnly(db:IDBDatabase):boolean{
  const expected=new Set<string>(Object.values(STORES)),actual=Array.from(db.objectStoreNames)
  return recoverySchemaReady(db)&&actual.length===expected.size&&actual.every(name=>expected.has(name))
}
function openRecoveryDatabase(name:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const fail=(error:unknown)=>reject(error instanceof Error?error:new Error('Recovery database open failed.'))
  const request=indexedDB.open(name)
  request.addEventListener('upgradeneeded',()=>applyRecoverySchema(request.result))
  request.addEventListener('error',()=>fail(request.error??new Error('Recovery database open failed.')),{once:true})
  request.addEventListener('success',()=>{
    const current=request.result
    if(current.objectStoreNames.contains('revisions')){current.close();fail(new Error('Recovery activation requires a fresh local profile; historical plaintext revisions are present.'));return}
    if(current.version>SECURE_DATABASE_VERSION_CEILING){current.close();fail(new Error('Recovery database was created by a newer app version and cannot be opened safely.'));return}
    if(current.version>=SECURE_DATABASE_VERSION_FLOOR){
      if(recoverySchemaReady(current)){resolve(current);return}
      current.close();fail(new Error('Recovery database schema is not a supported secure profile.'));return
    }
    if(!recoveryBootstrapSchemaOnly(current)){current.close();fail(new Error('Recovery activation requires a fresh local profile; an existing legacy or foreign database schema is present.'));return}
    const version=SECURE_DATABASE_VERSION_FLOOR
    current.close()
    const upgrade=indexedDB.open(name,version)
    upgrade.addEventListener('upgradeneeded',()=>applyRecoverySchema(upgrade.result))
    upgrade.addEventListener('success',()=>{if(!recoverySchemaReady(upgrade.result)){upgrade.result.close();fail(new Error('Recovery database schema upgrade readback failed.'));return}resolve(upgrade.result)},{once:true})
    upgrade.addEventListener('error',()=>fail(upgrade.error??new Error('Recovery database schema upgrade failed.')),{once:true})
    upgrade.addEventListener('blocked',()=>fail(new Error('Recovery database schema upgrade is blocked by another open app tab. Close other tabs and retry.')),{once:true})
  },{once:true})
})}
async function deleteRecoveryDatabase(name:string):Promise<void>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.addEventListener('success',()=>resolve(),{once:true});request.addEventListener('error',()=>reject(request.error??new Error('Recovery database cleanup failed.')),{once:true});request.addEventListener('blocked',()=>reject(new Error('Recovery database cleanup was blocked.')),{once:true})})}

async function assertFresh(db:IDBDatabase):Promise<void>{const names=[...Object.values(STORES),...LEGACY_PLAINTEXT_STORES.filter(name=>db.objectStoreNames.contains(name))],tx=db.transaction(names,'readonly');for(const name of names){const count=await requestResult(tx.objectStore(name).count());if(count!==0){tx.abort();throw new Error('Recovery activation requires a fresh local profile.')}}await transactionDone(tx)}
function sameBytes(left:Uint8Array,right:Uint8Array):boolean{return left.byteLength===right.byteLength&&left.every((byte,index)=>byte===right[index])}

export interface RecoveredProfileOptions {databaseName?:string;cleanupAfterVerify?:boolean;recoveryArtifact?:RecoveryArtifact}

/** Reads the stable recovery artifact persisted by a successful fresh-profile
 * restore.  Rotation-created artifacts remain available through the rotation
 * repository; this stable slot exists specifically because a restored profile
 * has no prior local rotation_state_ref. */
export async function storedRecoveredRecoveryArtifact(databaseName=DEFAULT_DATABASE_NAME):Promise<RecoveryArtifact|null>{
  const db=await openRecoveryDatabase(databaseName)
  try{
    const contextTx=db.transaction(STORES.context,'readonly'),context=await requestResult<{epochId:string}|undefined>(contextTx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await transactionDone(contextTx)
    if(!context)return null
    const tx=db.transaction(STORES.operations,'readonly'),item=await requestResult<{value:RecoveryArtifact}|undefined>(tx.objectStore(STORES.operations).get(`recovery-artifact:${context.epochId}`));await transactionDone(tx)
    return item?.value??null
  }finally{db.close()}
}

/** Persists a verified recovery bootstrap into an otherwise-empty IndexedDB profile,
 * then opens the freshly persisted root wrap and verifies state MAC, journal and
 * every envelope before returning a positive activation proof. */
export async function persistRecoveredProfile(candidate:RecoveredRootCandidate,bootstrap:VerifiedRecoveryBootstrap,schemas:Readonly<Record<string,unknown>>,options:RecoveredProfileOptions={}):Promise<RecoveryPersistenceProof>{
  const databaseName=options.databaseName??DEFAULT_DATABASE_NAME,db=await openRecoveryDatabase(databaseName)
  try{
    await assertFresh(db)
    const payload=candidate.payload,wrapId=base64Url(randomBytes(16)),wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),wrap=await createBestEffortRootWrap(candidate.rootKey,wrappingKey,{diary_id:payload.diary_id,epoch_id:payload.epoch_id,key_id:payload.key_id,manifest_fingerprint:payload.manifest_fingerprint},fromBase64Url(wrapId)),opened=await openBestEffortRootWrap(wrap,wrappingKey)
    if(!sameBytes(opened,candidate.rootKey))throw new Error('Fresh recovery root-wrap readback failed.')

    const rows=bootstrap.verified.snapshot.rows,byId=new Map<string,string>(),envelopes:StoredEnvelope[]=[];let journal=await journalInitial(payload.diary_id,payload.epoch_id),sequence=0
    for(const raw of rows){if(raw.length!==3)throw new Error('Verified recovery row has invalid shape.');const row=raw as Row,rowBytes=decodeUtf8(canonicalBytes([...row])),prior=byId.get(row[0]);if(prior!==undefined){if(prior!==rowBytes)throw new Error('Recovery envelope ID exists with different bytes.');continue}byId.set(row[0],rowBytes);const envelope:PreparedEnvelope={envelopeId:row[0],iv:row[1],ciphertext:row[2],bytesHash:base64Url(await sha256(canonicalBytes([...row])))},revision=await openEnvelope(candidate.rootKey,await deriveEpochSalt(fromBase64Url(payload.diary_id),fromBase64Url(payload.epoch_id)),{diaryId:payload.diary_id,epochId:payload.epoch_id},envelope);if(revision.record_status==='active')validateDomainData(schemas[revision.record_schema],revision.record_data);sequence++;journal=await journalNext(journal,sequence,envelope);envelopes.push({...envelope,id:envelope.envelopeId,epochId:payload.epoch_id,localSeq:sequence,rowBytes})}

    const revisions:RevisionV1[]=[];const epochSalt=await deriveEpochSalt(fromBase64Url(payload.diary_id),fromBase64Url(payload.epoch_id));for(const envelope of envelopes)revisions.push(await openEnvelope(candidate.rootKey,epochSalt,{diaryId:payload.diary_id,epochId:payload.epoch_id},envelope));validateRevisionGraphV1(revisions)
    const remoteBinding=bootstrap.remoteBinding,remoteAnchor=remoteBinding?await createAnchorV1(payload.diary_id,payload.epoch_id,rows):null,state:EpochLocalSecurityStateV5={local_state_version:5,diary_id:payload.diary_id,epoch_id:payload.epoch_id,key_id:payload.key_id,manifest_fingerprint:payload.manifest_fingerprint,recovery_generation:payload.recovery_generation,recovery_urs_commitment:candidate.recoveryCommitment,remote_binding:remoteBinding,remote_anchor:remoteAnchor,epoch_status:remoteBinding?'active':'local_offline',operation_generation:0,rotation_state_ref:null,migration_state_ref:null,local_journal_count:sequence,local_journal_hash:journal},tag=await stateTag(candidate.rootKey,epochSalt,state),context={id:ACTIVE_CONTEXT,diaryId:payload.diary_id,epochId:payload.epoch_id,keyId:payload.key_id,manifestFingerprint:payload.manifest_fingerprint,wrapId}
    const tx=db.transaction([STORES.context,STORES.wraps,STORES.wrappingKeys,STORES.state,STORES.envelopes,STORES.outbox,STORES.operations],'readwrite');tx.objectStore(STORES.context).add(context);tx.objectStore(STORES.wraps).add({id:payload.epoch_id,wrap});tx.objectStore(STORES.wrappingKeys).add({id:wrapId,key:wrappingKey});tx.objectStore(STORES.state).add({id:payload.epoch_id,state,tag});if(options.recoveryArtifact)tx.objectStore(STORES.operations).put({id:`recovery-artifact:${payload.epoch_id}`,value:structuredClone(options.recoveryArtifact)});for(const envelope of envelopes){tx.objectStore(STORES.envelopes).add(envelope);tx.objectStore(STORES.outbox).add({id:envelope.envelopeId,epochId:payload.epoch_id,envelopeId:envelope.envelopeId,rowBytes:envelope.rowBytes,status:remoteBinding?'durable':'pending'})}await transactionDone(tx)

    const read=db.transaction([STORES.context,STORES.wraps,STORES.wrappingKeys,STORES.state,STORES.envelopes],'readonly'),storedContext=await requestResult<{id:string;diaryId:string;epochId:string;keyId:string;manifestFingerprint:string;wrapId:string}|undefined>(read.objectStore(STORES.context).get(ACTIVE_CONTEXT)),storedWrap=await requestResult<{id:string;wrap:RootWrap}|undefined>(read.objectStore(STORES.wraps).get(payload.epoch_id)),storedKey=await requestResult<{id:string;key:CryptoKey}|undefined>(read.objectStore(STORES.wrappingKeys).get(wrapId)),storedState=await requestResult<{id:string;state:EpochLocalSecurityStateV5;tag:string}|undefined>(read.objectStore(STORES.state).get(payload.epoch_id)),storedEnvelopes=await requestResult<StoredEnvelope[]>(read.objectStore(STORES.envelopes).index('byEpoch').getAll(payload.epoch_id));await transactionDone(read)
    if(!storedContext||storedContext.epochId!==payload.epoch_id||!storedWrap||!storedKey||!storedState)throw new Error('Fresh recovery persistence readback failed.')
    const reopened=await openBestEffortRootWrap(storedWrap.wrap,storedKey.key);if(!sameBytes(reopened,candidate.rootKey))throw new Error('Fresh recovery unlock failed.');await verifyStateTag(reopened,epochSalt,storedState.state,storedState.tag)
    let readbackJournal=await journalInitial(payload.diary_id,payload.epoch_id),readbackCount=0;const readbackRevisions:RevisionV1[]=[];for(const envelope of storedEnvelopes.sort((a,b)=>a.localSeq-b.localSeq)){readbackCount++;if(envelope.localSeq!==readbackCount||envelope.rowBytes!==decodeUtf8(canonicalBytes([...envelopeRow(envelope)])))throw new Error('Fresh recovery journal row mismatch.');readbackJournal=await journalNext(readbackJournal,readbackCount,envelope);readbackRevisions.push(await openEnvelope(reopened,epochSalt,{diaryId:payload.diary_id,epochId:payload.epoch_id},envelope))}validateRevisionGraphV1(readbackRevisions);if(readbackCount!==storedState.state.local_journal_count||readbackJournal!==storedState.state.local_journal_hash)throw new Error('Fresh recovery journal hash mismatch.')
    if(options.recoveryArtifact){const artifactTx=db.transaction(STORES.operations,'readonly'),storedArtifact=await requestResult<{value:RecoveryArtifact}|undefined>(artifactTx.objectStore(STORES.operations).get(`recovery-artifact:${payload.epoch_id}`));await transactionDone(artifactTx);if(!storedArtifact||decodeUtf8(canonicalBytes(storedArtifact.value as never))!==decodeUtf8(canonicalBytes(options.recoveryArtifact as never)))throw new Error('Fresh recovery artifact readback failed.')}
    return{rootWrapReadback:true,stateMacVerified:true,envelopeJournalVerified:true}
  }finally{
    db.close()
    if(options.cleanupAfterVerify)await deleteRecoveryDatabase(databaseName)
  }
}
