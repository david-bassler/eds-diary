import { base64Url, decodeUtf8, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSalt, sha256 } from '../security/crypto/core'
import { envelopeRow, openEnvelope, prepareEnvelope, type PreparedEnvelope } from '../security/envelopes'
import {
  createBestEffortRootWrap,
  createPassphraseRootWrap,
  createPrfRootWrap,
  journalInitial,
  journalNext,
  openBestEffortRootWrap,
  openPassphraseRootWrap,
  openPrfRootWrap,
  stateTag,
  verifyStateTag,
  withDiaryLock,
  type EpochLocalSecurityStateV5,
  type RemoteBindingV1,
  type PrfWrapEnrollmentMaterial,
  type RootWrap,
} from '../security/localState'
import { createMergeRevisionV1, legacyRecordId, singletonRecordId, validateRevisionGraphV1, type RevisionV1 } from '../security/revisions'
import type { CreationPersistence, CreationState } from '../sync/core/creation'
import type { CoordinatorStore } from '../sync/core/coordinator'
import { SINGLE_WRITER_V1_PROFILE, type RemoteAnchorState, type VerifiedRemoteState } from '../sync/core/contracts'
import type { RemoteAnchorV1 } from '../sync/core/prefix'
import { rotationStateHash, type RotationPersistence, type RotationState } from '../security/rotation'
import { advanceRotationOperationStateV2, rotationOperationStateHashV2, validateRotationOperationStateV2, type RotationOperationStateV2 } from '../security/v2/profileUpgrade'
import { validateDomainData } from '../security/domainSchemaValidator'
import painEntrySchema from '../security/schemas/pain-entry.v1.schema.json'
import activityEntrySchema from '../security/schemas/activity-entry.v1.schema.json'
import medicationEntrySchema from '../security/schemas/medication-entry.v1.schema.json'
import medicationPrescriptionSchema from '../security/schemas/medication-prescription.v1.schema.json'
import painTypeSettingsSchema from '../security/schemas/pain-type-settings.v1.schema.json'
import activityTypeSettingsSchema from '../security/schemas/activity-type-settings.v1.schema.json'
import epochMigrationSchema from '../security/schemas/epoch-migration-sw.v1.schema.json'
import rotationAnnouncementSchema from '../security/schemas/rotation-announcement-sw.v1.schema.json'
import { validateRevisionV1 } from '../security/revisions'
import {
  createBestEffortRootWrapV6,
  createPassphraseRootWrapV6,
  createPrfRootWrapV6,
  generateBestEffortWrappingKeyV6,
  openBestEffortRootWrapV6,
  openPassphraseRootWrapV6,
  openPrfRootWrapV6,
  validateRootWrapV6,
  type RootWrapIdentityV6,
  type RootWrapV6,
} from '../security/v2/rootWrap'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'

const DATABASE_NAME = 'eds-diary'
const SECURE_DATABASE_VERSION_FLOOR = 9
const SECURE_DATABASE_VERSION_CEILING = 10

export const LOCAL_STORES = {
  painEntries: 'painEntries', medicationEntries: 'medicationEntries',
  medicationPrescriptions: 'medicationPrescriptions', activityEntries: 'activityEntries', settings: 'settings',
} as const
export type LocalStoreName = (typeof LOCAL_STORES)[keyof typeof LOCAL_STORES]

const LEGACY_STORES = Object.values(LOCAL_STORES)
const STORES = {
  context: 'epochContexts', wraps: 'rootWraps', wrappingKeys: 'wrappingKeys', reservations: 'envelopeReservations',
  envelopes: 'envelopes', outbox: 'outbox', state: 'epochSecurityState',
  migration: 'migrationState', operations: 'operationState',
} as const
const LEGACY_ACTIVITY_TYPES = 'eds-diary-activity-types-v1'
const ACTIVE_CONTEXT = 'active'
const ACTIVE_PROTOCOL_SELECTION = 'active-protocol-selection'

export interface EpochContext { id:'active'; diaryId:string; epochId:string; keyId:string; manifestFingerprint:string; wrapId:string }
interface StoredEnvelope extends PreparedEnvelope { id:string; epochId:string; localSeq:number; rowBytes:string }
export type OutboxStatus = 'prepared'|'pending'|'remote_seen'|'durable'
export interface StoredOutbox { id:string; epochId:string; envelopeId:string; rowBytes:string; status:OutboxStatus }
interface StoredState { id:string; state:EpochLocalSecurityStateV5; tag:string }
interface MigrationState { id:'legacy-v1'; operationId:string; phase:'inventory'|'backfill'|'verify'|'cutover'; sourceKeys:string[]; completedKeys:string[]; legacyDirtyGeneration:number; verified:boolean; sourceFingerprint?:string; stablePasses?:number }

const STORE_PROFILE: Record<LocalStoreName,{recordType:string;recordSchema:string}> = {
  painEntries:{recordType:'pain_entry',recordSchema:'pain-entry/v1'},
  activityEntries:{recordType:'activity_entry',recordSchema:'activity-entry/v1'},
  medicationEntries:{recordType:'medication_entry',recordSchema:'medication-entry/v1'},
  medicationPrescriptions:{recordType:'medication_prescription',recordSchema:'medication-prescription/v1'},
  settings:{recordType:'pain_type_settings',recordSchema:'pain-type-settings/v1'},
}
const DOMAIN_SCHEMAS:Readonly<Record<string,unknown>>={
  'pain-entry/v1':painEntrySchema,'activity-entry/v1':activityEntrySchema,
  'medication-entry/v1':medicationEntrySchema,'medication-prescription/v1':medicationPrescriptionSchema,
  'pain-type-settings/v1':painTypeSettingsSchema,'activity-type-settings/v1':activityTypeSettingsSchema,
  'epoch-migration-sw-v1':epochMigrationSchema,'rotation-announcement-sw-v1':rotationAnnouncementSchema,
}
function profileFor(store:LocalStoreName,id?:string):{recordType:string;recordSchema:string}{if(store!==LOCAL_STORES.settings)return STORE_PROFILE[store];return id==='activity-types'||id==='activity-type-settings'?{recordType:'activity_type_settings',recordSchema:'activity-type-settings/v1'}:STORE_PROFILE.settings}

let databasePromise:Promise<IDBDatabase>|null=null
let readyPromise:Promise<void>|null=null
let legacyMigrationTestingHook:((pass:number)=>Promise<void>)|null=null
type LocalUnlockFactor={mode:'passphrase';passphrase:string}|{mode:'prf';credentialId:Uint8Array;prfEvalInput:Uint8Array;prfOutput:Uint8Array;rpId:string}
const unlockedRoots=new Map<string,Uint8Array>()
const unlockFactors=new Map<string,LocalUnlockFactor>()
export class LocalUnlockRequiredError extends Error{constructor(readonly mode:'passphrase'|'prf'){super(`Local root key requires ${mode} unlock.`);this.name='LocalUnlockRequiredError'}}

function result<T>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.addEventListener('success',()=>resolve(request.result),{once:true});request.addEventListener('error',()=>reject(request.error??new Error('IndexedDB request failed.')),{once:true})})}
function complete(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.addEventListener('complete',()=>resolve(),{once:true});tx.addEventListener('abort',()=>reject(tx.error??new Error('IndexedDB transaction aborted.')),{once:true});tx.addEventListener('error',()=>reject(tx.error??new Error('IndexedDB transaction failed.')),{once:true})})}
function applyCurrentSchema(db:IDBDatabase,tx:IDBTransaction|null):void{
  if(db.objectStoreNames.contains('revisions'))db.deleteObjectStore('revisions')
  for(const name of Object.values(STORES))if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'id'});if(name===STORES.envelopes||name===STORES.outbox)store.createIndex('byEpoch','epochId')}
  if(tx&&db.objectStoreNames.contains(STORES.operations)){const operations=tx.objectStore(STORES.operations),cursor=operations.openCursor();cursor.addEventListener('success',()=>{const current=cursor.result;if(!current)return;if(typeof current.key==='string'&&current.key.startsWith('rotation-artifact:revision:'))current.delete();current.continue()})}
}
function trackDatabase(db:IDBDatabase):IDBDatabase{db.addEventListener('versionchange',()=>{db.close();databasePromise=null});return db}
function secureSchemaReady(db:IDBDatabase):boolean{return Object.values(STORES).every(name=>db.objectStoreNames.contains(name))&&!db.objectStoreNames.contains('revisions')}
function openDatabase():Promise<IDBDatabase>{
  if(databasePromise)return databasePromise
  databasePromise=new Promise((resolve,reject)=>{
    const fail=(error:unknown)=>{databasePromise=null;reject(error instanceof Error?error:new Error('Database open failed.'))}
    const request=indexedDB.open(DATABASE_NAME)
    request.addEventListener('upgradeneeded',()=>applyCurrentSchema(request.result,request.transaction))
    request.addEventListener('error',()=>fail(request.error??new Error('Database open failed.')),{once:true})
    request.addEventListener('success',()=>{
      const current=request.result
      if(current.version>SECURE_DATABASE_VERSION_CEILING){current.close();fail(new Error('Local database was created by a newer app version and cannot be opened safely.'));return}
      if(current.version>=SECURE_DATABASE_VERSION_FLOOR&&secureSchemaReady(current)){resolve(trackDatabase(current));return}
      const nextVersion=Math.max(current.version+1,SECURE_DATABASE_VERSION_FLOOR)
      if(nextVersion>SECURE_DATABASE_VERSION_CEILING){current.close();fail(new Error('Local database schema cannot be repaired within this app version.'));return}
      current.close()
      const upgrade=indexedDB.open(DATABASE_NAME,nextVersion)
      upgrade.addEventListener('upgradeneeded',()=>applyCurrentSchema(upgrade.result,upgrade.transaction))
      upgrade.addEventListener('success',()=>resolve(trackDatabase(upgrade.result)),{once:true})
      upgrade.addEventListener('error',()=>fail(upgrade.error??new Error('Database schema upgrade failed.')),{once:true})
      upgrade.addEventListener('blocked',()=>fail(new Error('Database schema upgrade is blocked by another open app tab. Close other tabs and retry.')),{once:true})
    },{once:true})
  })
  return databasePromise
}
async function wrappingKey(db:IDBDatabase,wrapId:string):Promise<CryptoKey>{const tx=db.transaction(STORES.wrappingKeys,'readonly'),existing=await result<{id:string;key:CryptoKey}|undefined>(tx.objectStore(STORES.wrappingKeys).get(wrapId));await complete(tx);if(existing)return existing.key;const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const write=db.transaction(STORES.wrappingKeys,'readwrite');write.objectStore(STORES.wrappingKeys).add({id:wrapId,key});await complete(write);return key}
async function initialContext(db:IDBDatabase):Promise<{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityStateV5}>{
  const diaryId=base64Url(randomBytes(16)),epochId=base64Url(randomBytes(16)),keyId=base64Url(randomBytes(16)),rootKey=randomBytes(32),wrapId=base64Url(randomBytes(16)),manifestFingerprint=base64Url(await sha256(canonicalBytes(['local-offline-v5',diaryId,epochId,keyId])))
  const context:EpochContext={id:ACTIVE_CONTEXT,diaryId,epochId,keyId,manifestFingerprint,wrapId},key=await wrappingKey(db,wrapId),wrap=await createBestEffortRootWrap(rootKey,key,{diary_id:diaryId,epoch_id:epochId,key_id:keyId,manifest_fingerprint:manifestFingerprint},fromBase64Url(wrapId)),epochSalt=await deriveEpochSalt(fromBase64Url(diaryId),fromBase64Url(epochId))
  const recovery_urs_commitment=base64Url(await sha256(canonicalBytes(['local-offline-recovery-v5',diaryId,epochId,keyId])))
  const state:EpochLocalSecurityStateV5={local_state_version:5,diary_id:diaryId,epoch_id:epochId,key_id:keyId,manifest_fingerprint:manifestFingerprint,recovery_generation:0,recovery_urs_commitment,remote_binding:null,remote_anchor:null,epoch_status:'local_offline',operation_generation:0,rotation_state_ref:null,migration_state_ref:null,local_journal_count:0,local_journal_hash:await journalInitial(diaryId,epochId)}
  const tag=await stateTag(rootKey,epochSalt,state),tx=db.transaction([STORES.context,STORES.wraps,STORES.state],'readwrite');tx.objectStore(STORES.context).add(context);tx.objectStore(STORES.wraps).add({id:epochId,wrap});tx.objectStore(STORES.state).add({id:epochId,state,tag} satisfies StoredState);await complete(tx);return{context,rootKey,state}
}
async function readEpochRecords(db:IDBDatabase,context:EpochContext):Promise<{wrap:RootWrap;stored:StoredState}>{const tx=db.transaction([STORES.wraps,STORES.state],'readonly'),wrapRequest=tx.objectStore(STORES.wraps).get(context.epochId),stateRequest=tx.objectStore(STORES.state).get(context.epochId),[storedWrap,stored]=await Promise.all([result<{id:string;wrap:RootWrap}|undefined>(wrapRequest),result<StoredState|undefined>(stateRequest)]);await complete(tx);if(!storedWrap||!stored)throw new Error('Incomplete local epoch security state.');return{wrap:storedWrap.wrap,stored}}
function sameBytes(left:Uint8Array,right:Uint8Array):boolean{return left.byteLength===right.byteLength&&left.every((byte,index)=>byte===right[index])}
function assertEpochIdentityBindings(context:EpochContext,wrap:RootWrap,state:EpochLocalSecurityStateV5):void{
  if(context.diaryId!==state.diary_id||context.epochId!==state.epoch_id||context.keyId!==state.key_id||context.manifestFingerprint!==state.manifest_fingerprint)throw new Error('Epoch context does not match authenticated local security state.')
  if(context.wrapId!==wrap.wrap_id||context.diaryId!==wrap.diary_id||context.epochId!==wrap.epoch_id||context.keyId!==wrap.key_id||context.manifestFingerprint!==wrap.manifest_fingerprint)throw new Error('Epoch context does not match the active root wrap.')
}
async function openStoredRoot(db:IDBDatabase,context:EpochContext,wrap:RootWrap):Promise<Uint8Array>{const cached=unlockedRoots.get(context.epochId);if(cached)return new Uint8Array(cached);let rootKey:Uint8Array;if(wrap.mode==='best-effort')rootKey=await openBestEffortRootWrap(wrap,await wrappingKey(db,context.wrapId));else if(wrap.mode==='passphrase'){const factor=unlockFactors.get(context.diaryId);if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase');rootKey=await openPassphraseRootWrap(wrap,factor.passphrase)}else{const factor=unlockFactors.get(context.diaryId);if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf');const expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input);if(!sameBytes(expectedInput,factor.prfEvalInput)||wrap.mode_metadata.rp_id!==factor.rpId)throw new LocalUnlockRequiredError('prf');rootKey=await openPrfRootWrap(wrap,factor.credentialId,factor.prfOutput)}unlockedRoots.set(context.epochId,new Uint8Array(rootKey));return rootKey}
async function loadEpoch(db:IDBDatabase):Promise<{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityStateV5;epochSalt:Uint8Array}>{
  const contextTx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(contextTx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(contextTx);if(!context){const made=await initialContext(db);unlockedRoots.set(made.context.epochId,new Uint8Array(made.rootKey));return{...made,epochSalt:await deriveEpochSalt(fromBase64Url(made.context.diaryId),fromBase64Url(made.context.epochId))}}
  const {wrap,stored}=await readEpochRecords(db,context);assertEpochIdentityBindings(context,wrap,stored.state);const rootKey=await openStoredRoot(db,context,wrap),epochSalt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,epochSalt,stored.state,stored.tag);return{context,rootKey,state:stored.state,epochSalt}
}
export interface PreparedSuccessorRootWrapV6 {wrap:RootWrapV6;bestEffortWrappingKey:CryptoKey|null}
export async function prepareSuccessorRootWrapV6ForActiveMode(rootKey:Uint8Array,identity:RootWrapIdentityV6,wrapId:Uint8Array):Promise<PreparedSuccessorRootWrapV6>{
  const db=await openDatabase(),active=await loadEpoch(db),records=await readEpochRecords(db,active.context)
  if(active.context.diaryId!==identity.diary_id)throw new Error('RootWrapV6 successor diary does not match the active v1 diary.')
  if(wrapId.byteLength!==16)throw new Error('RootWrapV6 wrap_id must contain 16 bytes.')
  if(records.wrap.mode==='passphrase'){
    const factor=unlockFactors.get(identity.diary_id)
    if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase')
    const wrap=await createPassphraseRootWrapV6(rootKey,factor.passphrase,identity,wrapId)
    if(base64Url(await openPassphraseRootWrapV6(wrap,factor.passphrase))!==base64Url(rootKey))throw new Error('RootWrapV6 passphrase readback failed.')
    return{wrap,bestEffortWrappingKey:null}
  }
  if(records.wrap.mode==='prf'){
    const factor=unlockFactors.get(identity.diary_id)
    if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf')
    const wrap=await createPrfRootWrapV6(rootKey,{credentialId:factor.credentialId,prfEvalInput:factor.prfEvalInput,prfOutput:factor.prfOutput,rpId:factor.rpId},identity,wrapId)
    if(base64Url(await openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput))!==base64Url(rootKey))throw new Error('RootWrapV6 PRF readback failed.')
    return{wrap,bestEffortWrappingKey:null}
  }
  const key=await generateBestEffortWrappingKeyV6(),wrap=await createBestEffortRootWrapV6(rootKey,key,identity,wrapId)
  if(base64Url(await openBestEffortRootWrapV6(wrap,key))!==base64Url(rootKey))throw new Error('RootWrapV6 best-effort readback failed.')
  return{wrap,bestEffortWrappingKey:key}
}
export async function prepareNativeV2SuccessorRootWrapV6ForActiveMode(
  sourceRootKey:Uint8Array,
  source:PreparedSuccessorRootWrapV6,
  rootKey:Uint8Array,
  identity:RootWrapIdentityV6,
  wrapId:Uint8Array,
):Promise<PreparedSuccessorRootWrapV6>{
  validateRootWrapV6(source.wrap)
  if(sourceRootKey.byteLength!==32||wrapId.byteLength!==16)throw new Error('Native v2 RootWrap inheritance input is invalid.')
  const selected=await activeProtocolSelectionV2()
  if(!selected
    ||selected.diary_id!==source.wrap.diary_id
    ||selected.epoch_id!==source.wrap.epoch_id
    ||selected.manifest_fingerprint!==source.wrap.manifest_fingerprint)throw new Error('Native v2 RootWrap Source is not the active v2 protocol selection.')
  if(identity.diary_id!==source.wrap.diary_id||identity.epoch_id===source.wrap.epoch_id)throw new Error('Native v2 Successor RootWrap identity does not extend the active v2 diary.')

  if(source.wrap.mode==='best-effort'){
    if(!source.bestEffortWrappingKey)throw new Error('Native v2 Source best-effort wrapping key is missing.')
    if(!sameBytes(await openBestEffortRootWrapV6(source.wrap,source.bestEffortWrappingKey),sourceRootKey))throw new Error('Native v2 Source RootWrap does not open to the authenticated Source root.')
    const key=await generateBestEffortWrappingKeyV6(),wrap=await createBestEffortRootWrapV6(rootKey,key,identity,wrapId)
    if(!sameBytes(await openBestEffortRootWrapV6(wrap,key),rootKey))throw new Error('Native v2 Successor best-effort RootWrap readback failed.')
    return{wrap,bestEffortWrappingKey:key}
  }

  if(source.bestEffortWrappingKey)throw new Error('Native v2 strong Source RootWrap unexpectedly carries a best-effort key.')
  const preferred=unlockFactors.get(source.wrap.diary_id)
  const candidates=preferred?[preferred,...unlockFactors.values()]:[...unlockFactors.values()]
  if(source.wrap.mode==='passphrase'){
    for(const factor of candidates){
      if(factor.mode!=='passphrase')continue
      try{
        if(!sameBytes(await openPassphraseRootWrapV6(source.wrap,factor.passphrase),sourceRootKey))continue
        unlockFactors.set(source.wrap.diary_id,factor)
        const wrap=await createPassphraseRootWrapV6(rootKey,factor.passphrase,identity,wrapId)
        if(!sameBytes(await openPassphraseRootWrapV6(wrap,factor.passphrase),rootKey))throw new Error('Native v2 Successor passphrase RootWrap readback failed.')
        return{wrap,bestEffortWrappingKey:null}
      }catch{/* try another already-unlocked local factor */}
    }
    throw new LocalUnlockRequiredError('passphrase')
  }

  for(const factor of candidates){
    if(factor.mode!=='prf')continue
    try{
      if(!sameBytes(await openPrfRootWrapV6(source.wrap,factor.credentialId,factor.prfOutput),sourceRootKey))continue
      unlockFactors.set(source.wrap.diary_id,factor)
      const wrap=await createPrfRootWrapV6(rootKey,{credentialId:factor.credentialId,prfEvalInput:factor.prfEvalInput,prfOutput:factor.prfOutput,rpId:factor.rpId},identity,wrapId)
      if(!sameBytes(await openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput),rootKey))throw new Error('Native v2 Successor PRF RootWrap readback failed.')
      return{wrap,bestEffortWrappingKey:null}
    }catch{/* try another already-unlocked local factor */}
  }
  throw new LocalUnlockRequiredError('prf')
}

export async function prepareReadOnlyJoinRootWrapV6ForActiveMode(rootKey:Uint8Array,identity:RootWrapIdentityV6,wrapId:Uint8Array):Promise<PreparedSuccessorRootWrapV6>{
  const db=await openDatabase(),active=await loadEpoch(db),records=await readEpochRecords(db,active.context)
  if(wrapId.byteLength!==16)throw new Error('RootWrapV6 wrap_id must contain 16 bytes.')
  if(records.wrap.mode==='passphrase'){
    const factor=unlockFactors.get(active.context.diaryId)
    if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase')
    const wrap=await createPassphraseRootWrapV6(rootKey,factor.passphrase,identity,wrapId)
    if(base64Url(await openPassphraseRootWrapV6(wrap,factor.passphrase))!==base64Url(rootKey))throw new Error('Join RootWrapV6 passphrase readback failed.')
    return{wrap,bestEffortWrappingKey:null}
  }
  if(records.wrap.mode==='prf'){
    const factor=unlockFactors.get(active.context.diaryId)
    if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf')
    const wrap=await createPrfRootWrapV6(rootKey,{credentialId:factor.credentialId,prfEvalInput:factor.prfEvalInput,prfOutput:factor.prfOutput,rpId:factor.rpId},identity,wrapId)
    if(base64Url(await openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput))!==base64Url(rootKey))throw new Error('Join RootWrapV6 PRF readback failed.')
    return{wrap,bestEffortWrappingKey:null}
  }
  const key=await generateBestEffortWrappingKeyV6(),wrap=await createBestEffortRootWrapV6(rootKey,key,identity,wrapId)
  if(base64Url(await openBestEffortRootWrapV6(wrap,key))!==base64Url(rootKey))throw new Error('Join RootWrapV6 best-effort readback failed.')
  return{wrap,bestEffortWrappingKey:key}
}

export async function openReadOnlyJoinRootWrapV6WithActiveMode(prepared:PreparedSuccessorRootWrapV6):Promise<Uint8Array>{
  const wrap=prepared.wrap
  if(wrap.mode==='best-effort'){
    if(!prepared.bestEffortWrappingKey)throw new Error('Join RootWrapV6 best-effort wrapping key is missing.')
    return openBestEffortRootWrapV6(wrap,prepared.bestEffortWrappingKey)
  }
  const active=await loadEpoch(await openDatabase()),factor=unlockFactors.get(active.context.diaryId)
  if(wrap.mode==='passphrase'){
    if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase')
    return openPassphraseRootWrapV6(wrap,factor.passphrase)
  }
  if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf')
  const expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input)
  if(!sameBytes(expectedInput,factor.prfEvalInput)||wrap.mode_metadata.rp_id!==factor.rpId)throw new LocalUnlockRequiredError('prf')
  return openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput)
}

export async function openSuccessorRootWrapV6WithActiveMode(prepared:PreparedSuccessorRootWrapV6):Promise<Uint8Array>{
  const wrap=prepared.wrap
  if(wrap.mode==='best-effort'){
    if(!prepared.bestEffortWrappingKey)throw new Error('RootWrapV6 best-effort wrapping key is missing.')
    return openBestEffortRootWrapV6(wrap,prepared.bestEffortWrappingKey)
  }
  const factor=unlockFactors.get(wrap.diary_id)
  if(wrap.mode==='passphrase'){
    if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase')
    return openPassphraseRootWrapV6(wrap,factor.passphrase)
  }
  if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf')
  const expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input)
  if(!sameBytes(expectedInput,factor.prfEvalInput)||wrap.mode_metadata.rp_id!==factor.rpId)throw new LocalUnlockRequiredError('prf')
  return openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput)
}

export interface LocalRootWrapStatus{initialized:boolean;mode:'best-effort'|'passphrase'|'prf';locked:boolean;credentialId?:string;prfEvalInput?:string;rpId?:string}

async function selectedV2LocalProtection():Promise<{
  selection:ActiveProtocolSelectionV2
  store:IndexedDbV2LocalSecurityStore
  prepared:PreparedSuccessorRootWrapV6
}|null>{
  const selection=await activeProtocolSelectionV2()
  if(!selection)return null
  const store=new IndexedDbV2LocalSecurityStore(),prepared=await store.loadRootWrapV6(selection.epoch_id),wrap=prepared.wrap
  if(wrap.diary_id!==selection.diary_id||wrap.epoch_id!==selection.epoch_id||wrap.manifest_fingerprint!==selection.manifest_fingerprint)throw new Error('Active v2 protocol selection does not match RootWrapV6.')
  return{selection,store,prepared}
}
async function verifySelectedV2Root(
  value:NonNullable<Awaited<ReturnType<typeof selectedV2LocalProtection>>>,
  rootKey:Uint8Array,
):Promise<void>{
  const salt=await deriveEpochSaltV2(fixedBase64Url(value.selection.diary_id,16),fixedBase64Url(value.selection.epoch_id,16))
  const state=await value.store.loadState(rootKey,salt,value.selection.epoch_id)
  if(state.diary_id!==value.selection.diary_id||state.epoch_id!==value.selection.epoch_id
    ||state.manifest_fingerprint!==value.selection.manifest_fingerprint||state.key_id!==value.prepared.wrap.key_id)throw new Error('RootWrapV6 does not authenticate the active StateV6 identity.')
}
async function v2WrapUnlocked(
  value:NonNullable<Awaited<ReturnType<typeof selectedV2LocalProtection>>>,
):Promise<boolean>{
  const wrap=value.prepared.wrap
  if(wrap.mode==='best-effort'){
    if(!value.prepared.bestEffortWrappingKey)throw new Error('Active v2 best-effort wrapping key is missing.')
    await verifySelectedV2Root(value,await openBestEffortRootWrapV6(wrap,value.prepared.bestEffortWrappingKey))
    return true
  }
  const factor=unlockFactors.get(value.selection.diary_id)
  let rootKey:Uint8Array
  try{
    if(wrap.mode==='passphrase'){
      if(!factor||factor.mode!=='passphrase')return false
      rootKey=await openPassphraseRootWrapV6(wrap,factor.passphrase)
    }else{
      if(!factor||factor.mode!=='prf')return false
      const expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input)
      if(!sameBytes(expectedInput,factor.prfEvalInput)||wrap.mode_metadata.rp_id!==factor.rpId)return false
      rootKey=await openPrfRootWrapV6(wrap,factor.credentialId,factor.prfOutput)
    }
  }catch{return false}
  await verifySelectedV2Root(value,rootKey)
  return !await retainedV1NeedsStrongCatchup(value.selection.diary_id)
}
async function retainedV1ContextForDiary(diaryId:string):Promise<EpochContext|null>{
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly')
  const context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT))
  await complete(tx)
  return context?.diaryId===diaryId?context:null
}
async function retainedV1NeedsStrongCatchup(diaryId:string):Promise<boolean>{
  const context=await retainedV1ContextForDiary(diaryId)
  if(!context)return false
  const {wrap}=await readEpochRecords(await openDatabase(),context)
  return wrap.mode==='best-effort'
}
async function strengthenRetainedV1WithPassphraseIfNeeded(diaryId:string,passphrase:string):Promise<void>{
  if(!await retainedV1NeedsStrongCatchup(diaryId))return
  const factor:LocalUnlockFactor={mode:'passphrase',passphrase}
  await replaceActiveRootWrap(
    loaded=>createPassphraseRootWrap(loaded.rootKey,passphrase,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),
    factor,
  )
}
async function strengthenRetainedV1WithPrfIfNeeded(diaryId:string,material:PrfWrapEnrollmentMaterial):Promise<void>{
  if(!await retainedV1NeedsStrongCatchup(diaryId))return
  const factor:LocalUnlockFactor={mode:'prf',credentialId:new Uint8Array(material.credentialId),prfEvalInput:new Uint8Array(material.prfEvalInput),prfOutput:new Uint8Array(material.prfOutput),rpId:material.rpId}
  await replaceActiveRootWrap(
    loaded=>createPrfRootWrap(loaded.rootKey,material,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),
    factor,
  )
}

export async function localRootWrapStatus():Promise<LocalRootWrapStatus>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    const wrap=v2.prepared.wrap,locked=!await v2WrapUnlocked(v2)
    if(wrap.mode==='prf')return{initialized:true,mode:'prf',locked,credentialId:wrap.mode_metadata.credential_id,prfEvalInput:wrap.mode_metadata.prf_eval_input,rpId:wrap.mode_metadata.rp_id}
    return{initialized:true,mode:wrap.mode,locked}
  }
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),done=complete(tx),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await done
  if(!context)return{initialized:false,mode:'best-effort',locked:false}
  const {wrap}=await readEpochRecords(db,context)
  if(wrap.mode==='prf')return{initialized:true,mode:'prf',locked:!unlockedRoots.has(context.epochId),credentialId:wrap.mode_metadata.credential_id,prfEvalInput:wrap.mode_metadata.prf_eval_input,rpId:wrap.mode_metadata.rp_id}
  return{initialized:true,mode:wrap.mode,locked:wrap.mode!=='best-effort'&&!unlockedRoots.has(context.epochId)}
}
export async function unlockActiveRootWithPassphrase(passphrase:string):Promise<void>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    if(v2.prepared.wrap.mode!=='passphrase')throw new Error('Active RootWrapV6 is not passphrase mode.')
    const rootKey=await openPassphraseRootWrapV6(v2.prepared.wrap,passphrase)
    await verifySelectedV2Root(v2,rootKey)
    unlockFactors.set(v2.selection.diary_id,{mode:'passphrase',passphrase})
    await strengthenRetainedV1WithPassphraseIfNeeded(v2.selection.diary_id,passphrase)
    return
  }
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)throw new Error('No active epoch exists.');const{wrap,stored}=await readEpochRecords(db,context);if(wrap.mode!=='passphrase')throw new Error('Active root wrap is not passphrase mode.');const rootKey=await openPassphraseRootWrap(wrap,passphrase),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,salt,stored.state,stored.tag);unlockFactors.set(context.diaryId,{mode:'passphrase',passphrase});unlockedRoots.set(context.epochId,new Uint8Array(rootKey));readyPromise=null
}
export async function unlockActiveRootWithPrf(assertedCredentialId:Uint8Array,prfOutput:Uint8Array):Promise<void>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    const wrap=v2.prepared.wrap
    if(wrap.mode!=='prf')throw new Error('Active RootWrapV6 is not PRF mode.')
    const expectedCredential=fromBase64Url(wrap.mode_metadata.credential_id),expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input)
    if(!sameBytes(expectedCredential,assertedCredentialId))throw new Error('PRF credential ID does not match active RootWrapV6.')
    const rootKey=await openPrfRootWrapV6(wrap,assertedCredentialId,prfOutput)
    await verifySelectedV2Root(v2,rootKey)
    const material:PrfWrapEnrollmentMaterial={credentialId:new Uint8Array(assertedCredentialId),prfEvalInput:expectedInput,prfOutput:new Uint8Array(prfOutput),rpId:wrap.mode_metadata.rp_id}
    unlockFactors.set(v2.selection.diary_id,{mode:'prf',...material})
    await strengthenRetainedV1WithPrfIfNeeded(v2.selection.diary_id,material)
    return
  }
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)throw new Error('No active epoch exists.');const{wrap,stored}=await readEpochRecords(db,context);if(wrap.mode!=='prf')throw new Error('Active root wrap is not PRF mode.');const evalInput=fromBase64Url(wrap.mode_metadata.prf_eval_input),rootKey=await openPrfRootWrap(wrap,assertedCredentialId,prfOutput),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,salt,stored.state,stored.tag);unlockFactors.set(context.diaryId,{mode:'prf',credentialId:new Uint8Array(assertedCredentialId),prfEvalInput:evalInput,prfOutput:new Uint8Array(prfOutput),rpId:wrap.mode_metadata.rp_id});unlockedRoots.set(context.epochId,new Uint8Array(rootKey));readyPromise=null
}
export async function lockActiveRoot():Promise<void>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    unlockFactors.clear()
    unlockedRoots.clear()
    readyPromise=null
    return
  }
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)return;unlockedRoots.delete(context.epochId);unlockFactors.delete(context.diaryId);readyPromise=null
}
async function replaceActiveRootWrap(create:(loaded:Awaited<ReturnType<typeof loadEpoch>>)=>Promise<RootWrap>,factor:LocalUnlockFactor):Promise<void>{const db=await openDatabase(),initial=await loadEpoch(db);await withDiaryLock(initial.context.diaryId,async()=>{const current=await loadEpoch(db),oldContext=current.context,wrap=await create(current),context={...oldContext,wrapId:wrap.wrap_id},state={...current.state,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,state),tx=db.transaction([STORES.context,STORES.wraps,STORES.wrappingKeys,STORES.state],'readwrite');tx.objectStore(STORES.context).put(context);tx.objectStore(STORES.wraps).put({id:context.epochId,wrap});tx.objectStore(STORES.wrappingKeys).delete(oldContext.wrapId);tx.objectStore(STORES.state).put({id:current.context.epochId,state,tag} satisfies StoredState);await complete(tx);unlockFactors.set(context.diaryId,factor);unlockedRoots.set(context.epochId,new Uint8Array(current.rootKey))})}
export async function enrollActivePassphraseRootWrap(passphrase:string):Promise<void>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    const rootKey=await openSuccessorRootWrapV6WithActiveMode(v2.prepared)
    await verifySelectedV2Root(v2,rootKey)
    const wrapId=randomBytes(16),identity={diary_id:v2.prepared.wrap.diary_id,epoch_id:v2.prepared.wrap.epoch_id,key_id:v2.prepared.wrap.key_id,manifest_fingerprint:v2.prepared.wrap.manifest_fingerprint}
    const wrap=await createPassphraseRootWrapV6(rootKey,passphrase,identity,wrapId)
    if(!sameBytes(await openPassphraseRootWrapV6(wrap,passphrase),rootKey))throw new Error('Active v2 passphrase RootWrapV6 readback failed.')
    await v2.store.replaceRootWrapV6(v2.prepared.wrap.wrap_id,wrap,null)
    unlockFactors.set(v2.selection.diary_id,{mode:'passphrase',passphrase})
    await strengthenRetainedV1WithPassphraseIfNeeded(v2.selection.diary_id,passphrase)
    return
  }
  const factor:LocalUnlockFactor={mode:'passphrase',passphrase}
  await replaceActiveRootWrap(async loaded=>createPassphraseRootWrap(loaded.rootKey,passphrase,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),factor)
}
export async function enrollActivePrfRootWrap(material:PrfWrapEnrollmentMaterial):Promise<void>{
  const v2=await selectedV2LocalProtection()
  if(v2){
    const rootKey=await openSuccessorRootWrapV6WithActiveMode(v2.prepared)
    await verifySelectedV2Root(v2,rootKey)
    const wrapId=randomBytes(16),identity={diary_id:v2.prepared.wrap.diary_id,epoch_id:v2.prepared.wrap.epoch_id,key_id:v2.prepared.wrap.key_id,manifest_fingerprint:v2.prepared.wrap.manifest_fingerprint}
    const wrap=await createPrfRootWrapV6(rootKey,material,identity,wrapId)
    if(!sameBytes(await openPrfRootWrapV6(wrap,material.credentialId,material.prfOutput),rootKey))throw new Error('Active v2 PRF RootWrapV6 readback failed.')
    await v2.store.replaceRootWrapV6(v2.prepared.wrap.wrap_id,wrap,null)
    unlockFactors.set(v2.selection.diary_id,{mode:'prf',credentialId:new Uint8Array(material.credentialId),prfEvalInput:new Uint8Array(material.prfEvalInput),prfOutput:new Uint8Array(material.prfOutput),rpId:material.rpId})
    await strengthenRetainedV1WithPrfIfNeeded(v2.selection.diary_id,material)
    return
  }
  const factor:LocalUnlockFactor={mode:'prf',credentialId:new Uint8Array(material.credentialId),prfEvalInput:new Uint8Array(material.prfEvalInput),prfOutput:new Uint8Array(material.prfOutput),rpId:material.rpId}
  await replaceActiveRootWrap(async loaded=>createPrfRootWrap(loaded.rootKey,material,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),factor)
}

function revisionData(value:Record<string,unknown>):unknown{const copy={...value};delete copy.id;delete copy.status;return value.status==='deleted'?null:copy}
function normalizedLegacyValue(store:LocalStoreName,value:Record<string,unknown>):Record<string,unknown>{if(store!==LOCAL_STORES.painEntries)return value;const normalized={...value};for(const field of ['startedAt','endedAt','createdAt','updatedAt']){const raw=normalized[field];if(typeof raw==='string'&&raw!==''){const parsed=new Date(raw);if(Number.isNaN(parsed.getTime()))throw new Error(`Legacy pain timestamp ${field} is not parseable.`);normalized[field]=parsed.toISOString()}else if(raw!==undefined&&typeof raw!=='string')throw new Error(`Legacy pain timestamp ${field} has the wrong type.`)}return normalized}
async function recordIdentity(context:EpochContext,store:LocalStoreName,id:string):Promise<string>{const profile=profileFor(store,id);return store===LOCAL_STORES.settings?singletonRecordId(context.diaryId,profile.recordType as 'pain_type_settings'|'activity_type_settings'):legacyRecordId(context.diaryId,profile.recordType,id)}
function compareProtocolIds(left:string,right:string):number{const a=fromBase64Url(left),b=fromBase64Url(right),length=Math.min(a.byteLength,b.byteLength);for(let index=0;index<length;index++){const delta=a[index]!-b[index]!;if(delta!==0)return delta}return a.byteLength-b.byteLength}
function sortedRevisionIds(ids:Iterable<string>):string[]{return [...ids].sort(compareProtocolIds)}
async function verifiedEnvelopeRevisions(db:IDBDatabase):Promise<RevisionV1[]>{
  await verifyLocalIntegrityFor(db)
  const loaded=await loadEpoch(db),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId));await complete(tx)
  const revisions:RevisionV1[]=[]
  for(const item of items.sort((a,b)=>a.localSeq-b.localSeq))revisions.push(await openEnvelope(loaded.rootKey,loaded.epochSalt,{diaryId:loaded.context.diaryId,epochId:loaded.context.epochId},item))
  validateRevisionGraphV1(revisions)
  return revisions
}
async function persistRevision(db:IDBDatabase,store:LocalStoreName,value:Record<string,unknown>,fixedRevisionId?:string,writeMode:'normal'|'merge'|'merge-stage'|'test-branch'='normal',explicitParents:readonly string[]=[]):Promise<void>{
  const loaded=await loadEpoch(db),rotationStep=loaded.state.rotation_state_ref?.state,frozen=rotationStep!==undefined&&['source_frozen_verified','recovery_secret_verified','successor_planned','successor_bound','copying','successor_verified','recovery_verified','backup_verified','announcement_pending','announcement_prepared','recovery_artifact_verified','staged_backup_verified','announcement_unknown','announcement_durable','confirmation_unknown','confirmation_durable','activated_backup_verified','cutover_race','post_activation_superseded','profile_upgrade_source_race'].includes(rotationStep);if(loaded.state.epoch_status==='retired'||frozen)throw new Error('Epoch is frozen for rotation.')
  const id=String(value.id??'');if(!id)throw new Error('Record id is required.');const revisions=await verifiedEnvelopeRevisions(db),profile=profileFor(store,id),canonicalInput=revisions.some(revision=>revision.record_id===id&&revision.record_type===profile.recordType&&revision.record_schema===profile.recordSchema),recordId=canonicalInput?id:await recordIdentity(loaded.context,store,id);if(!canonicalInput)await rememberMapping(db,store,recordId,id)
  const graph=validateRevisionGraphV1(revisions),heads=sortedRevisionIds(graph.headsByRecord.get(recordId)??[]),revisionId=fixedRevisionId??base64Url(randomBytes(32));if(writeMode==='normal'&&heads.length>1)throw new UnresolvedRecordConflictError(recordId,heads);if(writeMode==='merge'&&heads.length<2)throw new Error('Record does not have multiple heads to merge.');if((writeMode==='merge'||writeMode==='merge-stage')&&value.status==='deleted')throw new Error('Explicit merge requires an active merged value.');if(writeMode==='test-branch'&&import.meta.env.MODE!=='test')throw new Error('Test branch writes are unavailable in production.');const parents=writeMode==='test-branch'||writeMode==='merge-stage'?sortedRevisionIds(explicitParents):heads
  if(writeMode==='merge-stage'&&(parents.length<2||parents.length>8||parents.some(parent=>!heads.includes(parent))))throw new Error('Staged merge parents must be current heads of the record.')
  if(revisions.some(existing=>existing.revision_id===revisionId))return
  const recordData=revisionData(value),createdAt=new Date().toISOString(),revision:RevisionV1=writeMode==='merge'||writeMode==='merge-stage'?createMergeRevisionV1(revisionId,parents.map(parent=>{const found=graph.revisions.get(parent);if(!found)throw new Error('Merge parent is missing.');return found}),recordData,createdAt):{record_type:profile.recordType,record_schema:profile.recordSchema,record_id:recordId,revision_id:revisionId,parent_revision_ids:parents,record_status:value.status==='deleted'?'deleted':'active',record_data:recordData,migration_origin:null,protocol_created_at:createdAt}
  validateRevisionV1(revision);validateRevisionGraphV1([...revisions,revision])
  if(revision.record_status==='deleted'){if(revision.record_data!==null)throw new Error('Deleted records must contain null data.')}else validateDomainData(DOMAIN_SCHEMAS[revision.record_schema],revision.record_data)
  let reserved=false
  await prepareEnvelope(loaded.rootKey,loaded.epochSalt,{diaryId:loaded.context.diaryId,epochId:loaded.context.epochId},revision,{
    reserve:async envelopeId=>{const tx=db.transaction(STORES.reservations,'readwrite');tx.objectStore(STORES.reservations).add({id:envelopeId,epochId:loaded.context.epochId,status:'reserved'});await complete(tx);reserved=true},
    verifyReservation:async envelopeId=>{const tx=db.transaction(STORES.reservations,'readonly'),found=await result<{id:string}|undefined>(tx.objectStore(STORES.reservations).get(envelopeId));await complete(tx);if(!found||!reserved)throw new Error('Envelope reservation readback failed.')},
    persist:async envelope=>{
      const current=await loadEpoch(db);if(current.state.operation_generation!==loaded.state.operation_generation)throw new Error('Stale local mutation generation.')
      const sequence=current.state.local_journal_count+1,nextState={...current.state,local_journal_count:sequence,local_journal_hash:await journalNext(current.state.local_journal_hash,sequence,envelope),operation_generation:current.state.operation_generation+1},rowBytes=decodeUtf8(canonicalBytes([...envelopeRow(envelope)]))
      const tag=await stateTag(loaded.rootKey,loaded.epochSalt,nextState),tx=db.transaction([STORES.envelopes,STORES.outbox,STORES.reservations,STORES.state],'readwrite');tx.objectStore(STORES.envelopes).add({...envelope,id:envelope.envelopeId,epochId:loaded.context.epochId,localSeq:sequence,rowBytes} satisfies StoredEnvelope);tx.objectStore(STORES.outbox).add({id:envelope.envelopeId,epochId:loaded.context.epochId,envelopeId:envelope.envelopeId,rowBytes,status:'prepared'} satisfies StoredOutbox);tx.objectStore(STORES.reservations).put({id:envelope.envelopeId,epochId:loaded.context.epochId,status:'consumed'});tx.objectStore(STORES.state).put({id:loaded.context.epochId,state:nextState,tag} satisfies StoredState);await complete(tx)
    },
  })
}
export class UnresolvedRecordConflictError extends Error{constructor(readonly recordId:string,readonly headRevisionIds:readonly string[]){super(`Record ${recordId} has ${headRevisionIds.length} unresolved heads.`);this.name='UnresolvedRecordConflictError'}}
function logicalAppId(revision:RevisionV1,store:LocalStoreName):string{if(store===LOCAL_STORES.settings){if(revision.record_type==='activity_type_settings')return'activity-types';if(revision.record_type==='pain_type_settings')return'custom-pain-types'}return revision.record_id}
async function readValues<T>(db:IDBDatabase,store:LocalStoreName):Promise<T[]>{await verifyLocalIntegrityFor(db);const loaded=await loadEpoch(db),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId));await complete(tx);const revisions:RevisionV1[]=[];for(const item of items.sort((a,b)=>a.localSeq-b.localSeq)){const revision=await openEnvelope(loaded.rootKey,loaded.epochSalt,{diaryId:loaded.context.diaryId,epochId:loaded.context.epochId},item);if(revision.record_status==='active')validateDomainData(DOMAIN_SCHEMAS[revision.record_schema],revision.record_data);revisions.push(revision)}const graph=validateRevisionGraphV1(revisions),allowed=store===LOCAL_STORES.settings?new Set(['pain_type_settings','activity_type_settings']):new Set([STORE_PROFILE[store].recordType]);for(const [recordId,ids] of graph.headsByRecord){const first=graph.revisions.get(sortedRevisionIds(ids)[0]!);if(first&&allowed.has(first.record_type)&&ids.size>1)throw new UnresolvedRecordConflictError(recordId,sortedRevisionIds(ids))}const output:T[]=[];for(const ids of graph.headsByRecord.values())for(const revisionId of ids){const revision=graph.revisions.get(revisionId);if(!revision||!allowed.has(revision.record_type))continue;const data=(revision.record_data??{}) as Record<string,unknown>,status=revision.record_status==='deleted'?{status:'deleted'}:{};output.push({id:logicalAppId(revision,store),...data,...status} as T)}return output}
async function rememberMapping(db:IDBDatabase,store:LocalStoreName,recordId:string,legacyId:string):Promise<void>{const id=`map:${store}:${recordId}`,read=db.transaction(STORES.migration,'readonly'),existing=await result<{id:string;legacyId:string}|undefined>(read.objectStore(STORES.migration).get(id));await complete(read);if(existing&&existing.legacyId!==legacyId)throw new Error('Fatal deterministic legacy record ID collision.');const tx=db.transaction(STORES.migration,'readwrite');tx.objectStore(STORES.migration).put({id,legacyId});await complete(tx)}
async function inventory(db:IDBDatabase):Promise<Array<{key:string;store:LocalStoreName;value:Record<string,unknown>}>>{const entries:Array<{key:string;store:LocalStoreName;value:Record<string,unknown>}>=[];for(const store of LEGACY_STORES){if(!db.objectStoreNames.contains(store))continue;const tx=db.transaction(store,'readonly'),values=await result<Record<string,unknown>[]>(tx.objectStore(store).getAll());await complete(tx);for(const value of values)entries.push({key:`idb:${store}:${String(value.id)}`,store,value:normalizedLegacyValue(store,value)})}const raw=globalThis.localStorage?.getItem(LEGACY_ACTIVITY_TYPES);if(raw){const value=JSON.parse(raw) as unknown;if(!Array.isArray(value))throw new Error('Legacy activity types are malformed.');entries.push({key:'localStorage:activity-types',store:LOCAL_STORES.settings,value:{id:'activity-types',values:value}})}return entries}
async function migrationHash(value:MigrationState):Promise<string>{return base64Url(await sha256(canonicalBytes(value as never)))}
async function saveMigration(db:IDBDatabase,value:MigrationState):Promise<void>{const loaded=await loadEpoch(db),hash=await migrationHash(value),state={...loaded.state,migration_state_ref:{operation_id:value.operationId,state:value.phase,state_record_hash:hash},operation_generation:loaded.state.operation_generation+1},tag=await stateTag(loaded.rootKey,loaded.epochSalt,state),tx=db.transaction([STORES.migration,STORES.state],'readwrite');tx.objectStore(STORES.migration).put(value);tx.objectStore(STORES.state).put({id:loaded.context.epochId,state,tag} satisfies StoredState);await complete(tx);const checked=await loadEpoch(db),read=db.transaction(STORES.migration,'readonly'),stored=await result<MigrationState|undefined>(read.objectStore(STORES.migration).get('legacy-v1'));await complete(read);if(!stored||checked.state.migration_state_ref?.state_record_hash!==await migrationHash(stored))throw new Error('Migration state readback failed.')}
type LegacySource={key:string;store:LocalStoreName;value:Record<string,unknown>}
async function legacyFingerprint(items:readonly LegacySource[]):Promise<string>{const stable=[...items].sort((a,b)=>a.key.localeCompare(b.key)).map(item=>[item.key,item.store,item.value]);return base64Url(await sha256(canonicalBytes(stable as never)))}
function legacyTarget(key:string):{store:LocalStoreName;id:string}{if(key==='localStorage:activity-types')return{store:LOCAL_STORES.settings,id:'activity-types'};if(!key.startsWith('idb:'))throw new Error('Unknown legacy source key.');const tail=key.slice(4),separator=tail.indexOf(':');if(separator<1)throw new Error('Malformed legacy source key.');const store=tail.slice(0,separator) as LocalStoreName,id=tail.slice(separator+1);if(!LEGACY_STORES.includes(store)||!id)throw new Error('Malformed legacy source key.');return{store,id}}
async function migratedVisibleId(context:EpochContext,store:LocalStoreName,legacyId:string):Promise<string>{if(store!==LOCAL_STORES.settings)return recordIdentity(context,store,legacyId);const profile=profileFor(store,legacyId);return profile.recordType==='activity_type_settings'?'activity-types':'custom-pain-types'}
function sameCanonical(left:unknown,right:unknown):boolean{return decodeUtf8(canonicalBytes(left as never))===decodeUtf8(canonicalBytes(right as never))}
async function verifyLegacyTarget(db:IDBDatabase,item:LegacySource):Promise<void>{const context=(await loadEpoch(db)).context,legacyId=String(item.value.id),expectedId=await migratedVisibleId(context,item.store,legacyId),values=await readValues<Record<string,unknown>>(db,item.store),target=values.find(value=>String(value.id)===expectedId);if(!target)throw new Error('Legacy target verification failed.');if(item.value.status==='deleted'){if(target.status!=='deleted')throw new Error('Legacy tombstone target verification failed.');return}const expected={...item.value,id:expectedId},actual={...target};if(!Object.prototype.hasOwnProperty.call(expected,'status'))delete actual.status;if(!sameCanonical(expected,actual))throw new Error('Legacy target bytes changed during migration.')}
async function sealLegacyPlaintextStorage(db:IDBDatabase):Promise<void>{
  const legacyStores=LEGACY_STORES.filter(name=>db.objectStoreNames.contains(name)),storage=globalThis.localStorage
  if(legacyStores.length){const tx=db.transaction(legacyStores,'readwrite');for(const name of legacyStores)tx.objectStore(name).clear();await complete(tx);const verify=db.transaction(legacyStores,'readonly'),counts=legacyStores.map(name=>result(verify.objectStore(name).count()));if((await Promise.all(counts)).some(count=>count!==0)){verify.abort();throw new Error('Legacy plaintext store cleanup readback failed.')}await complete(verify)}
  storage?.removeItem(LEGACY_ACTIVITY_TYPES)
  if(storage&&storage.getItem(LEGACY_ACTIVITY_TYPES)!==null)throw new Error('Legacy plaintext localStorage cleanup failed.')
  if(!legacyStores.length)return

  const nextVersion=db.version+1
  if(nextVersion>SECURE_DATABASE_VERSION_CEILING)throw new Error('Legacy plaintext schema cannot be sealed by this app version.')
  databasePromise=null
  db.close()
  await new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,nextVersion);let settled=false
    const fail=(error:Error)=>{if(settled)return;settled=true;reject(error)}
    request.addEventListener('upgradeneeded',()=>{for(const name of LEGACY_STORES)if(request.result.objectStoreNames.contains(name))request.result.deleteObjectStore(name);if(request.result.objectStoreNames.contains('revisions'))request.result.deleteObjectStore('revisions')})
    request.addEventListener('blocked',()=>fail(new Error('Legacy plaintext storage sealing is blocked by another open app tab. Close other tabs and retry.')),{once:true})
    request.addEventListener('error',()=>fail(request.error??new Error('Legacy plaintext storage sealing failed.')),{once:true})
    request.addEventListener('success',()=>{request.result.close();if(settled)return;settled=true;resolve()},{once:true})
  })
  const checked=await openDatabase()
  if(LEGACY_STORES.some(name=>checked.objectStoreNames.contains(name))||checked.objectStoreNames.contains('revisions'))throw new Error('Legacy plaintext schema fence readback failed.')
}
async function migrateLegacy():Promise<void>{const db=await openDatabase(),initial=await loadEpoch(db);await withDiaryLock(initial.context.diaryId,async()=>{let loaded=await loadEpoch(db);const tx=db.transaction(STORES.migration,'readonly');let migration=await result<MigrationState|undefined>(tx.objectStore(STORES.migration).get('legacy-v1'));await complete(tx);if(migration){const ref=loaded.state.migration_state_ref;if(!ref||ref.operation_id!==migration.operationId||ref.state!==migration.phase||ref.state_record_hash!==await migrationHash(migration))throw new Error('Authenticated migration state binding failed.');if(migration.verified&&migration.phase==='cutover'){await sealLegacyPlaintextStorage(db);return}}else{const first=await inventory(db),fingerprint=await legacyFingerprint(first);migration={id:'legacy-v1',operationId:base64Url(await sha256(canonicalBytes(['legacy-v1',loaded.context.diaryId,loaded.context.epochId]))),phase:'inventory',sourceKeys:first.map(item=>item.key),completedKeys:[],legacyDirtyGeneration:0,verified:false,sourceFingerprint:fingerprint,stablePasses:0};await saveMigration(db,migration)}
    for(let pass=0;pass<32;pass++){
      const before=await inventory(db),beforeFingerprint=await legacyFingerprint(before),beforeKeys=new Set(before.map(item=>item.key)),knownKeys=[...new Set([...migration.sourceKeys,...beforeKeys])].sort();migration={...migration,phase:'backfill',sourceKeys:knownKeys,completedKeys:[],verified:false,sourceFingerprint:beforeFingerprint,stablePasses:0};await saveMigration(db,migration)
      for(const item of before){loaded=await loadEpoch(db);const recordId=await recordIdentity(loaded.context,item.store,String(item.value.id)),revisionId=base64Url(await sha256(canonicalBytes(['legacy-migration-v2',migration.operationId,item.key,item.value] as never)));await rememberMapping(db,item.store,recordId,String(item.value.id));await persistRevision(db,item.store,item.value,revisionId);migration={...migration,completedKeys:[...migration.completedKeys,item.key]};await saveMigration(db,migration)}
      for(const key of knownKeys){if(beforeKeys.has(key))continue;const target=legacyTarget(key),recordId=await recordIdentity((await loadEpoch(db)).context,target.store,target.id),revisionId=base64Url(await sha256(canonicalBytes(['legacy-migration-v2-delete',migration.operationId,key,beforeFingerprint])));await rememberMapping(db,target.store,recordId,target.id);await persistRevision(db,target.store,{id:target.id,status:'deleted'},revisionId);migration={...migration,completedKeys:[...migration.completedKeys,key]};await saveMigration(db,migration)}
      if(legacyMigrationTestingHook)await legacyMigrationTestingHook(pass)
      const after=await inventory(db),afterFingerprint=await legacyFingerprint(after),changed=afterFingerprint!==beforeFingerprint;const afterKeys=[...new Set([...migration.sourceKeys,...after.map(item=>item.key)])].sort();migration={...migration,phase:'verify',sourceKeys:afterKeys,legacyDirtyGeneration:migration.legacyDirtyGeneration+(changed?1:0),sourceFingerprint:afterFingerprint,stablePasses:changed?0:1};await saveMigration(db,migration);if(changed)continue
      for(const item of after)await verifyLegacyTarget(db,item)
      const afterSet=new Set(after.map(item=>item.key));for(const key of afterKeys){if(afterSet.has(key))continue;const target=legacyTarget(key),context=(await loadEpoch(db)).context,expectedId=await migratedVisibleId(context,target.store,target.id),values=await readValues<Record<string,unknown>>(db,target.store),value=values.find(item=>String(item.id)===expectedId);if(!value||value.status!=='deleted')throw new Error('Deleted legacy source was not preserved as a tombstone.')}
      const finalInventory=await inventory(db),finalFingerprint=await legacyFingerprint(finalInventory);if(finalFingerprint!==afterFingerprint){migration={...migration,legacyDirtyGeneration:migration.legacyDirtyGeneration+1,sourceFingerprint:finalFingerprint,stablePasses:0};await saveMigration(db,migration);continue}
      migration={...migration,phase:'cutover',verified:true,sourceFingerprint:finalFingerprint,stablePasses:2};await saveMigration(db,migration);await sealLegacyPlaintextStorage(db);return
    }
    throw new Error('Legacy source did not stabilize during encrypted migration.')
  })}
async function ready():Promise<void>{
  if(!readyPromise)readyPromise=migrateLegacy().catch(error=>{readyPromise=null;throw error})
  return readyPromise
}

export async function getAllRecords<T>(storeName:LocalStoreName):Promise<T[]>{await ready();return readValues<T>(await openDatabase(),storeName)}
export async function getRecord<T>(storeName:LocalStoreName,id:string):Promise<T|undefined>{return(await getAllRecords<T&{id:string}>(storeName)).find(value=>value.id===id)}
export interface RecordConflictHead<T=unknown>{revisionId:string;status:'active'|'deleted';data:T|null}
export interface RecordConflict<T=unknown>{recordId:string;heads:readonly RecordConflictHead<T>[]}
export interface StoreRecordConflict<T=unknown> extends RecordConflict<T>{store:LocalStoreName;id:string}
export async function listRecordConflicts():Promise<StoreRecordConflict[]> {await ready();const db=await openDatabase(),revisions=await verifiedEnvelopeRevisions(db),graph=validateRevisionGraphV1(revisions),output:StoreRecordConflict[]=[];for(const [recordId,ids] of graph.headsByRecord){if(ids.size<2)continue;const headIds=sortedRevisionIds(ids),first=graph.revisions.get(headIds[0]!);if(!first||first.record_status==='control')continue;const store=(Object.keys(STORE_PROFILE) as LocalStoreName[]).find(candidate=>candidate===LOCAL_STORES.settings?['pain_type_settings','activity_type_settings'].includes(first.record_type):STORE_PROFILE[candidate].recordType===first.record_type);if(!store)continue;output.push({store,id:logicalAppId(first,store),recordId,heads:headIds.map(revisionId=>{const revision=graph.revisions.get(revisionId)!;return{revisionId,status:revision.record_status as 'active'|'deleted',data:revision.record_data}})})}return output}
async function lookupRecordId(context:EpochContext,revisions:readonly RevisionV1[],store:LocalStoreName,id:string):Promise<string>{const profile=profileFor(store,id);if(store===LOCAL_STORES.settings)return recordIdentity(context,store,id);return revisions.some(revision=>revision.record_id===id&&revision.record_type===profile.recordType&&revision.record_schema===profile.recordSchema)?id:recordIdentity(context,store,id)}
export async function getRecordConflict<T=unknown>(storeName:LocalStoreName,id:string):Promise<RecordConflict<T>|null>{await ready();const db=await openDatabase(),loaded=await loadEpoch(db),revisions=await verifiedEnvelopeRevisions(db),recordId=await lookupRecordId(loaded.context,revisions,storeName,id),graph=validateRevisionGraphV1(revisions),headIds=sortedRevisionIds(graph.headsByRecord.get(recordId)??[]);if(headIds.length<2)return null;const heads=headIds.map(revisionId=>{const revision=graph.revisions.get(revisionId);if(!revision||revision.record_status==='control')throw new Error('Conflict head is missing or invalid.');return{revisionId,status:revision.record_status,data:revision.record_data as T|null}});return{recordId,heads}}
export async function mergeRecord<T extends{id:string}>(storeName:LocalStoreName,value:T):Promise<void>{await ready();const db=await openDatabase(),loaded=await loadEpoch(db);await withDiaryLock(loaded.context.diaryId,async()=>{const input=value as unknown as Record<string,unknown>;for(;;){const current=await loadEpoch(db),revisions=await verifiedEnvelopeRevisions(db),recordId=await lookupRecordId(current.context,revisions,storeName,String(value.id)),heads=sortedRevisionIds(validateRevisionGraphV1(revisions).headsByRecord.get(recordId)??[]);if(heads.length<=8){await persistRevision(db,storeName,input,undefined,'merge');return}await persistRevision(db,storeName,input,undefined,'merge-stage',heads.slice(0,8))}})}
export function putRecord<T extends{id:string}>(storeName:LocalStoreName,value:T):Promise<void>{return putRecords(storeName,[value])}
export async function putRecords<T extends{id:string}>(storeName:LocalStoreName,values:readonly T[]):Promise<void>{if(!values.length)return;await ready();const db=await openDatabase(),loaded=await loadEpoch(db);await withDiaryLock(loaded.context.diaryId,async()=>{for(const value of values)await persistRevision(db,storeName,value as unknown as Record<string,unknown>)})}

async function loadEpochFor(db:IDBDatabase,epochId:string,wrapId?:string):Promise<{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityStateV5;epochSalt:Uint8Array}>{const active=await loadEpoch(db);if(active.context.epochId===epochId)return active;if(!wrapId)throw new Error('A staged epoch requires its wrap identifier.');const tx=db.transaction(STORES.state,'readonly'),stored=await result<StoredState|undefined>(tx.objectStore(STORES.state).get(epochId));await complete(tx);if(!stored)throw new Error('Epoch state missing.');const rootKey=await new IndexedDbRotationRepository().successorRoot(epochId,wrapId),epochSalt=await deriveEpochSalt(fromBase64Url(stored.state.diary_id),fromBase64Url(epochId));await verifyStateTag(rootKey,epochSalt,stored.state,stored.tag);return{context:{id:'active',diaryId:stored.state.diary_id,epochId,keyId:stored.state.key_id,manifestFingerprint:stored.state.manifest_fingerprint,wrapId},rootKey,state:stored.state,epochSalt}}


export async function commitVerifiedPull(epochId:string,verified:VerifiedRemoteState,anchor:RemoteAnchorV1,expectedGeneration:number,wrapId?:string):Promise<number>{if(verified.profileId!==SINGLE_WRITER_V1_PROFILE)throw new Error('Verified pull profile does not match local v1 persistence.');if(verified.staleWriterEnvelopeIds.size)throw new Error('v1 verifier returned an impossible stale-writer disposition.');const remoteRows=verified.snapshot.rows;const db=await openDatabase(),loaded=await loadEpochFor(db,epochId,wrapId);return withDiaryLock(loaded.context.diaryId,async()=>{const current=await loadEpochFor(db,epochId,wrapId);if(current.state.operation_generation!==expectedGeneration)throw new Error('Stale verified pull generation.');if(anchor.covered_row_count!==remoteRows.length)throw new Error('Verified pull anchor does not cover the supplied snapshot.');const read=db.transaction([STORES.envelopes,STORES.outbox],'readonly'),storedRequest=read.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId),outboxRequest=read.objectStore(STORES.outbox).index('byEpoch').getAll(epochId),[stored,outbox]=await Promise.all([result<StoredEnvelope[]>(storedRequest),result<StoredOutbox[]>(outboxRequest)]);await complete(read);const localById=new Map(stored.map(item=>[item.envelopeId,item] as const)),remoteById=new Map<string,string>(),additions:StoredEnvelope[]=[];let sequence=current.state.local_journal_count,hash=current.state.local_journal_hash;for(const row of remoteRows){if(row.length!==3)throw new Error('Invalid verified remote row.');const [envelopeId,iv,ciphertext]=row,rowBytes=decodeUtf8(canonicalBytes([...row])),priorRemote=remoteById.get(envelopeId);if(priorRemote!==undefined){if(priorRemote!==rowBytes)throw new Error('Envelope ID exists with different bytes.');continue}remoteById.set(envelopeId,rowBytes);const prior=localById.get(envelopeId);if(prior){if(prior.rowBytes!==rowBytes)throw new Error('Envelope ID exists with different bytes.');continue}const envelope:PreparedEnvelope={envelopeId,iv,ciphertext,bytesHash:base64Url(await sha256(canonicalBytes([envelopeId,iv,ciphertext])))},revision=await openEnvelope(current.rootKey,current.epochSalt,{diaryId:current.context.diaryId,epochId:current.context.epochId},envelope);if(revision.record_status==='active')validateDomainData(DOMAIN_SCHEMAS[revision.record_schema],revision.record_data);sequence++;hash=await journalNext(hash,sequence,envelope);additions.push({...envelope,id:envelopeId,epochId,localSeq:sequence,rowBytes})}const durable=outbox.filter(item=>{const remote=remoteById.get(item.envelopeId);if(remote!==undefined&&remote!==item.rowBytes)throw new Error('Envelope ID exists with different bytes.');if(remote===item.rowBytes&&!verified.acceptedEnvelopeIds.has(item.envelopeId))throw new Error('Physically present envelope is not semantically accepted by the verified profile.');return remote===item.rowBytes&&verified.acceptedEnvelopeIds.has(item.envelopeId)}),state={...current.state,remote_anchor:anchor,local_journal_count:sequence,local_journal_hash:hash,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,state),tx=db.transaction([STORES.envelopes,STORES.outbox,STORES.state],'readwrite');for(const item of additions)tx.objectStore(STORES.envelopes).add(item);for(const item of durable)tx.objectStore(STORES.outbox).put({...item,status:'durable'});tx.objectStore(STORES.state).put({id:epochId,state,tag} satisfies StoredState);await complete(tx);return state.operation_generation})}

export async function commitDurableAck(epochId:string,envelopeId:string,expectedGeneration:number,anchor:EpochLocalSecurityStateV5['remote_anchor'],wrapId?:string):Promise<void>{const db=await openDatabase(),loaded=await loadEpochFor(db,epochId,wrapId);await withDiaryLock(loaded.context.diaryId,async()=>{const current=await loadEpochFor(db,epochId,wrapId);if(current.state.operation_generation!==expectedGeneration)throw new Error('Stale network completion.');const read=db.transaction(STORES.outbox,'readonly'),outbox=await result<StoredOutbox|undefined>(read.objectStore(STORES.outbox).get(envelopeId));await complete(read);if(!outbox||outbox.epochId!==epochId)throw new Error('Outbox item missing.');const state={...current.state,remote_anchor:anchor,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,state),tx=db.transaction([STORES.outbox,STORES.state],'readwrite');tx.objectStore(STORES.outbox).put({...outbox,status:'durable'});tx.objectStore(STORES.state).put({id:epochId,state,tag} satisfies StoredState);await complete(tx)})}

export async function transitionOutbox(envelopeId:string,status:'pending'|'remote_seen',expectedGeneration:number,epochId?:string,wrapId?:string):Promise<number>{const db=await openDatabase(),active=await loadEpoch(db),target=epochId??active.context.epochId,loaded=await loadEpochFor(db,target,wrapId);return withDiaryLock(loaded.context.diaryId,async()=>{const current=await loadEpochFor(db,target,wrapId);if(current.state.operation_generation!==expectedGeneration)throw new Error('Stale network completion.');const read=db.transaction([STORES.outbox,STORES.envelopes],'readonly'),outboxRequest=read.objectStore(STORES.outbox).get(envelopeId),envelopeRequest=read.objectStore(STORES.envelopes).get(envelopeId),[stored,envelope]=await Promise.all([result<StoredOutbox|undefined>(outboxRequest),result<StoredEnvelope|undefined>(envelopeRequest)]);await complete(read);if(!envelope||envelope.epochId!==target)throw new Error('Immutable envelope missing.');const item=stored??{id:envelopeId,epochId:target,envelopeId,rowBytes:envelope.rowBytes,status:'prepared'};if(status==='pending'){if(item.status==='pending'||item.status==='remote_seen')return current.state.operation_generation;if(item.status!=='prepared'&&item.status!=='durable')throw new Error('Invalid outbox transition.')}else{if(item.status==='remote_seen')return current.state.operation_generation;if(item.status!=='pending')throw new Error('Invalid outbox transition.')}const state={...current.state,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,state),tx=db.transaction([STORES.outbox,STORES.state],'readwrite');tx.objectStore(STORES.outbox).put({...item,status});tx.objectStore(STORES.state).put({id:target,state,tag} satisfies StoredState);await complete(tx);return state.operation_generation})}

/** Immutable envelopes decide existence; authenticated prefix coverage decides
 * whether an already-present remote row still needs local durable reconciliation. */
export async function pendingEnvelopes(verified:VerifiedRemoteState,epochId?:string,wrapId?:string):Promise<PreparedEnvelope[]>{if(verified.profileId!==SINGLE_WRITER_V1_PROFILE)throw new Error('Verified pending profile does not match local v1 persistence.');if(verified.staleWriterEnvelopeIds.size)throw new Error('v1 verifier returned an impossible stale-writer disposition.');const remoteRows=verified.snapshot.rows;const db=await openDatabase(),active=await loadEpoch(db),target=epochId??active.context.epochId,loaded=await loadEpochFor(db,target,wrapId),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(target));await complete(tx);const canonicalRemote=remoteRows.map(row=>({id:row[0]??'',bytes:decodeUtf8(canonicalBytes([...row]))})),remoteById=new Map<string,string>();for(const row of canonicalRemote){const prior=remoteById.get(row.id);if(prior!==undefined&&prior!==row.bytes)throw new Error('Envelope ID exists with different bytes.');remoteById.set(row.id,row.bytes)}const covered=loaded.state.remote_anchor?.covered_row_count??0;return items.filter(item=>{const remote=remoteById.get(item.envelopeId);if(remote!==undefined&&remote!==item.rowBytes)throw new Error('Envelope ID exists with different bytes.');if(remote===undefined)return true;const durablyCovered=canonicalRemote.slice(0,covered).some(row=>row.id===item.envelopeId&&row.bytes===item.rowBytes);if(durablyCovered&&!verified.acceptedEnvelopeIds.has(item.envelopeId))throw new Error('Covered remote envelope is not semantically accepted by the verified profile.');return!durablyCovered}).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash}))}

function requireRemoteAnchorV1(anchor:RemoteAnchorState):RemoteAnchorV1{
  if(anchor.anchor_profile!==SINGLE_WRITER_V1_PROFILE)throw new Error('Coordinator anchor profile does not match single-writer-v1.')
  return anchor as RemoteAnchorV1
}
export class IndexedDbCoordinatorStore implements CoordinatorStore {
  constructor(private readonly epochId:string,private readonly wrapId?:string){}
  async readAnchor():Promise<RemoteAnchorState|null>{return(await loadEpochFor(await openDatabase(),this.epochId,this.wrapId)).state.remote_anchor}
  pending(verified:VerifiedRemoteState):Promise<readonly PreparedEnvelope[]>{return pendingEnvelopes(verified,this.epochId,this.wrapId)}
  async generation():Promise<number>{return(await loadEpochFor(await openDatabase(),this.epochId,this.wrapId)).state.operation_generation}
  commitVerifiedPull(verified:VerifiedRemoteState,anchor:RemoteAnchorState,expectedGeneration:number):Promise<number>{return commitVerifiedPull(this.epochId,verified,requireRemoteAnchorV1(anchor),expectedGeneration,this.wrapId)}
  markPending(envelopeId:string,expectedGeneration:number):Promise<number>{return transitionOutbox(envelopeId,'pending',expectedGeneration,this.epochId,this.wrapId)}
  markRemoteSeen(envelopeId:string,expectedGeneration:number):Promise<number>{return transitionOutbox(envelopeId,'remote_seen',expectedGeneration,this.epochId,this.wrapId)}
  commitDurable(envelopeId:string,anchor:RemoteAnchorState,expectedGeneration:number):Promise<void>{return commitDurableAck(this.epochId,envelopeId,expectedGeneration,requireRemoteAnchorV1(anchor),this.wrapId)}
}

export async function activeEpochSyncContext():Promise<{diaryId:string;epochId:string;rootKey:Uint8Array;state:EpochLocalSecurityStateV5}>{await ready();const loaded=await loadEpoch(await openDatabase());return{diaryId:loaded.context.diaryId,epochId:loaded.context.epochId,rootKey:loaded.rootKey,state:loaded.state}}
export async function activeEpochVerifierMaterial():Promise<{localEnvelopes:PreparedEnvelope[];localHeadRevisionIds:ReadonlySet<string>}>{const db=await openDatabase();await verifyLocalIntegrityFor(db);const loaded=await loadEpoch(db),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId));await complete(tx);const localEnvelopes=items.sort((a,b)=>a.localSeq-b.localSeq).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash})),revisions=await verifiedEnvelopeRevisions(db),graph=validateRevisionGraphV1(revisions);return{localEnvelopes,localHeadRevisionIds:new Set([...graph.headsByRecord.values()].flatMap(ids=>[...ids]))}}

export const DOMAIN_SCHEMA_REGISTRY:Readonly<Record<string,unknown>>=DOMAIN_SCHEMAS
export interface VerifiedEpochMaterial {context:EpochContext;state:EpochLocalSecurityStateV5;rootKey:Uint8Array;epochSalt:Uint8Array;envelopes:PreparedEnvelope[];revisions:RevisionV1[]}
export interface ActiveProtocolSelectionV2 {
  id:typeof ACTIVE_PROTOCOL_SELECTION
  sync_profile:'google-sheets-transferable-single-writer-v2'
  diary_id:string
  epoch_id:string
  manifest_fingerprint:string
  operation_id:string
}

export async function persistProfileUpgradeSourceOperationV2(operation:RotationOperationStateV2,expectedSourceOperationGeneration?:number):Promise<void>{
  validateRotationOperationStateV2(operation)
  const db=await openDatabase(),loaded=await loadEpoch(db)
  if(loaded.context.epochId!==operation.source_epoch_id)throw new Error('Profile-upgrade operation Source is not the active v1 epoch.')
  const hash=await rotationOperationStateHashV2(operation)
  await withDiaryLock(loaded.context.diaryId,async()=>{
    const current=await loadEpoch(db)
    if(current.context.epochId!==operation.source_epoch_id)throw new Error('Active v1 Source changed during profile-upgrade operation persistence.')
    if(expectedSourceOperationGeneration!==undefined&&current.state.operation_generation!==expectedSourceOperationGeneration)throw new Error('v1 Source changed after final profile-upgrade verification; retry from a new full verify.')
    const ref=current.state.rotation_state_ref
    if(ref&&ref.operation_id!==operation.operation_id)throw new Error('Another v1 rotation operation is already bound to the Source.')
    const read=db.transaction(STORES.operations,'readonly')
    const prior=await result<{state:RotationOperationStateV2;hash:string}|undefined>(read.objectStore(STORES.operations).get(`profile-upgrade-v2:${current.context.diaryId}`))
    await complete(read)
    if(prior){
      validateRotationOperationStateV2(prior.state)
      if(prior.hash!==await rotationOperationStateHashV2(prior.state)
        ||!ref
        ||ref.operation_id!==prior.state.operation_id
        ||ref.state_record_hash!==prior.hash)throw new Error('Existing v1 profile-upgrade operation binding is corrupt.')
      advanceRotationOperationStateV2(prior.state,operation)
    }else if(ref)throw new Error('v1 profile-upgrade state ref exists without its operation record.')
    else if(operation.stage!=='source_frozen_verified')throw new Error('A new profile-upgrade operation must start at source_frozen_verified.')
    const next={...current.state,rotation_state_ref:{operation_id:operation.operation_id,state:operation.stage,state_record_hash:hash},operation_generation:current.state.operation_generation+1}
    const tag=await stateTag(current.rootKey,current.epochSalt,next),tx=db.transaction([STORES.operations,STORES.state],'readwrite')
    tx.objectStore(STORES.operations).put({id:`profile-upgrade-v2:${current.context.diaryId}`,state:structuredClone(operation),hash})
    tx.objectStore(STORES.state).put({id:current.context.epochId,state:next,tag} satisfies StoredState)
    await complete(tx)
  })
}
export async function loadProfileUpgradeSourceOperationV2():Promise<RotationOperationStateV2|null>{
  const db=await openDatabase(),loaded=await loadEpoch(db),tx=db.transaction(STORES.operations,'readonly')
  const stored=await result<{state:RotationOperationStateV2;hash:string}|undefined>(tx.objectStore(STORES.operations).get(`profile-upgrade-v2:${loaded.context.diaryId}`))
  await complete(tx)
  if(!stored)return null
  validateRotationOperationStateV2(stored.state)
  if(stored.hash!==await rotationOperationStateHashV2(stored.state))throw new Error('Profile-upgrade operation-state hash failed.')
  const ref=loaded.state.rotation_state_ref
  const sourceRaceRef=stored.state.stage==='stale'&&ref?.state==='profile_upgrade_source_race'
  if(!ref||ref.operation_id!==stored.state.operation_id||(!sourceRaceRef&&ref.state!==stored.state.stage)||ref.state_record_hash!==stored.hash)throw new Error('v1 Source profile-upgrade state binding failed.')
  return structuredClone(stored.state)
}
export async function activeProtocolSelectionV2():Promise<ActiveProtocolSelectionV2|null>{
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly')
  const value=await result<ActiveProtocolSelectionV2|undefined>(tx.objectStore(STORES.context).get(ACTIVE_PROTOCOL_SELECTION))
  await complete(tx)
  return value??null
}
export async function atomicSelectRotatedV2(args:{
  operation:RotationOperationStateV2
  diaryId:string
  sourceManifestFingerprint:string
  successorManifestFingerprint:string
}):Promise<void>{
  if(args.operation.stage!=='activated_backup_verified')throw new Error('Native v2 rotation selection requires activated_backup_verified.')
  if(args.operation.rotation_kind==='profile_upgrade')throw new Error('Profile upgrade cannot use native v2 selection.')
  fixedBase64Url(args.diaryId,16,'diary_id');fixedBase64Url(args.sourceManifestFingerprint,32,'source_manifest_fingerprint');fixedBase64Url(args.successorManifestFingerprint,32,'successor_manifest_fingerprint')
  const db=await openDatabase(),tx=db.transaction(STORES.context,'readwrite'),store=tx.objectStore(STORES.context)
  const prior=await result<ActiveProtocolSelectionV2|undefined>(store.get(ACTIVE_PROTOCOL_SELECTION))
  if(!prior){tx.abort();throw new Error('Native v2 rotation requires an existing active v2 protocol selection.')}
  const successor:ActiveProtocolSelectionV2={
    id:ACTIVE_PROTOCOL_SELECTION,sync_profile:'google-sheets-transferable-single-writer-v2',
    diary_id:args.diaryId,epoch_id:args.operation.successor_epoch_id,manifest_fingerprint:args.successorManifestFingerprint,operation_id:args.operation.operation_id,
  }
  if(prior.epoch_id===successor.epoch_id){
    if(new TextDecoder().decode(canonicalBytes(prior as never))!==new TextDecoder().decode(canonicalBytes(successor as never))){tx.abort();throw new Error('Native v2 rotation successor selection conflicts with an existing selection.')}
    await complete(tx);return
  }
  if(prior.sync_profile!=='google-sheets-transferable-single-writer-v2'||prior.diary_id!==args.diaryId||prior.epoch_id!==args.operation.source_epoch_id||prior.manifest_fingerprint!==args.sourceManifestFingerprint){tx.abort();throw new Error('Native v2 rotation active Source selection changed before switch.')}
  store.put(successor)
  await complete(tx)
  const check=await activeProtocolSelectionV2()
  if(!check||new TextDecoder().decode(canonicalBytes(check as never))!==new TextDecoder().decode(canonicalBytes(successor as never)))throw new Error('Native v2 rotation active selection readback failed.')
}

async function assertReadOnlyJoinPlaceholderFresh(db:IDBDatabase,source:Awaited<ReturnType<typeof loadEpoch>>):Promise<void>{
  if(source.state.epoch_status!=='local_offline'
    ||source.state.remote_binding!==null
    ||source.state.remote_anchor!==null
    ||source.state.rotation_state_ref!==null
    ||source.state.local_journal_count!==0)throw new Error('Read-only Join requires a fresh local profile; existing local diary state must be imported or merged explicitly.')
  if(source.state.migration_state_ref!==null){
    const tx=db.transaction(STORES.migration,'readonly')
    const migration=await result<MigrationState|undefined>(tx.objectStore(STORES.migration).get('legacy-v1'))
    await complete(tx)
    const ref=source.state.migration_state_ref
    if(!migration||!migration.verified||migration.phase!=='cutover'
      ||migration.sourceKeys.length!==0||migration.completedKeys.length!==0
      ||ref.operation_id!==migration.operationId||ref.state!=='cutover'
      ||ref.state_record_hash!==await migrationHash(migration))throw new Error('Read-only Join requires a fresh local profile; legacy migration evidence is not an empty verified cutover.')
  }
  const tx=db.transaction([STORES.envelopes,STORES.outbox,STORES.operations],'readonly')
  const envelopeRequest=tx.objectStore(STORES.envelopes).index('byEpoch').getAll(source.context.epochId)
  const outboxRequest=tx.objectStore(STORES.outbox).index('byEpoch').getAll(source.context.epochId)
  const operationRequest=tx.objectStore(STORES.operations).getAll()
  const [envelopes,outbox,operations]=await Promise.all([result<StoredEnvelope[]>(envelopeRequest),result<StoredOutbox[]>(outboxRequest),result<unknown[]>(operationRequest)])
  await complete(tx)
  if(envelopes.length||outbox.length||operations.length)throw new Error('Read-only Join refuses to overwrite non-empty local persistence.')
}

export async function assertReadOnlyJoinLocalProfileIsFresh():Promise<void>{
  await ready()
  const db=await openDatabase(),source=await loadEpoch(db)
  await assertReadOnlyJoinPlaceholderFresh(db,source)
}
export async function atomicSelectReadOnlyJoinV2(args:{
  joinId:string
  diaryId:string
  epochId:string
  manifestFingerprint:string
}):Promise<void>{
  fixedBase64Url(args.joinId,32,'join_id');fixedBase64Url(args.diaryId,16,'diary_id');fixedBase64Url(args.epochId,16,'epoch_id');fixedBase64Url(args.manifestFingerprint,32,'manifest_fingerprint')
  await ready()
  const db=await openDatabase(),initial=await loadEpoch(db)
  await withDiaryLock(initial.context.diaryId,async()=>{
    const source=await loadEpoch(db)
    const selectedTx=db.transaction(STORES.context,'readonly')
    const prior=await result<ActiveProtocolSelectionV2|undefined>(selectedTx.objectStore(STORES.context).get(ACTIVE_PROTOCOL_SELECTION))
    await complete(selectedTx)
    const selection:ActiveProtocolSelectionV2={id:ACTIVE_PROTOCOL_SELECTION,sync_profile:'google-sheets-transferable-single-writer-v2',diary_id:args.diaryId,epoch_id:args.epochId,manifest_fingerprint:args.manifestFingerprint,operation_id:args.joinId}
    if(prior){
      if(new TextDecoder().decode(canonicalBytes(prior as never))!==new TextDecoder().decode(canonicalBytes(selection as never)))throw new Error('A different v2 epoch is already selected locally.')
      if(source.state.epoch_status!=='retired')throw new Error('v2 Join selection exists without a retired local placeholder epoch.')
      return
    }
    await assertReadOnlyJoinPlaceholderFresh(db,source)
    const retired={...source.state,epoch_status:'retired' as const,operation_generation:source.state.operation_generation+1}
    const tag=await stateTag(source.rootKey,source.epochSalt,retired)
    const tx=db.transaction([STORES.context,STORES.state],'readwrite')
    tx.objectStore(STORES.context).add(selection)
    tx.objectStore(STORES.state).put({id:source.context.epochId,state:retired,tag} satisfies StoredState)
    await complete(tx)
  })
}

export async function markV1ProfileUpgradeSourceRace(operation:RotationOperationStateV2):Promise<void>{
  if(operation.stage!=='stale')throw new Error('Profile-upgrade Source race terminal state must be stale.')
  const db=await openDatabase(),initial=await loadEpoch(db)
  await withDiaryLock(initial.context.diaryId,async()=>{
    const current=await loadEpoch(db)
    if(current.context.epochId!==operation.source_epoch_id)throw new Error('Profile-upgrade Source race epoch mismatch.')
    const hash=await rotationOperationStateHashV2(operation)
    const ref={operation_id:operation.operation_id,state:'profile_upgrade_source_race',state_record_hash:hash}
    const next={...current.state,epoch_status:'retired' as const,rotation_state_ref:ref,operation_generation:current.state.operation_generation+1}
    const tag=await stateTag(current.rootKey,current.epochSalt,next),tx=db.transaction([STORES.operations,STORES.state],'readwrite')
    tx.objectStore(STORES.operations).put({id:`profile-upgrade-v2:${current.context.diaryId}`,state:structuredClone(operation),hash})
    tx.objectStore(STORES.state).put({id:current.context.epochId,state:next,tag} satisfies StoredState)
    await complete(tx)
  })
}

export async function atomicSelectV2AndRetireV1(args:{
  operation:RotationOperationStateV2
  diaryId:string
  successorEpochId:string
  successorManifestFingerprint:string
}):Promise<void>{
  if(args.operation.stage!=='activated_backup_verified')throw new Error('Profile upgrade requires activated_backup_verified before local switch.')
  if(args.operation.successor_epoch_id!==args.successorEpochId||args.operation.successor_manifest_fingerprint!==args.successorManifestFingerprint)throw new Error('Profile-upgrade switch successor binding mismatch.')
  const db=await openDatabase(),initial=await loadEpoch(db)
  await withDiaryLock(initial.context.diaryId,async()=>{
    const source=await loadEpoch(db)
    if(source.context.diaryId!==args.diaryId||source.context.epochId!==args.operation.source_epoch_id)throw new Error('Profile-upgrade Source changed before atomic local switch.')
    const selectedTx=db.transaction(STORES.context,'readonly')
    const prior=await result<ActiveProtocolSelectionV2|undefined>(selectedTx.objectStore(STORES.context).get(ACTIVE_PROTOCOL_SELECTION))
    await complete(selectedTx)
    const selection:ActiveProtocolSelectionV2={id:ACTIVE_PROTOCOL_SELECTION,sync_profile:'google-sheets-transferable-single-writer-v2',diary_id:args.diaryId,epoch_id:args.successorEpochId,manifest_fingerprint:args.successorManifestFingerprint,operation_id:args.operation.operation_id}
    if(prior){
      if(new TextDecoder().decode(canonicalBytes(prior as never))!==new TextDecoder().decode(canonicalBytes(selection as never)))throw new Error('A different v2 epoch is already selected locally.')
      if(source.state.epoch_status!=='retired')throw new Error('v2 protocol selection exists without retired v1 Source.')
      return
    }
    const hash=await rotationOperationStateHashV2(args.operation)
    if(source.state.rotation_state_ref?.operation_id!==args.operation.operation_id||source.state.rotation_state_ref.state_record_hash!==hash)throw new Error('v1 Source is not bound to the final profile-upgrade operation state.')
    const retired={...source.state,epoch_status:'retired' as const,operation_generation:source.state.operation_generation+1},tag=await stateTag(source.rootKey,source.epochSalt,retired),tx=db.transaction([STORES.context,STORES.state],'readwrite')
    tx.objectStore(STORES.context).add(selection)
    tx.objectStore(STORES.state).put({id:source.context.epochId,state:retired,tag} satisfies StoredState)
    await complete(tx)
  })
}

export class IndexedDbRotationRepository {
  constructor(private readonly envelopeFault?: (point:'after-reservation'|'after-encryption',envelopeId:string,iv?:string)=>void|Promise<void>){}
  async putArtifact(id:string,value:unknown):Promise<void>{const db=await openDatabase(),initial=await loadEpoch(db);await withDiaryLock(initial.context.diaryId,async()=>{const current=await loadEpoch(db);if(current.context.diaryId!==initial.context.diaryId)throw new Error('Active diary changed before rotation artifact persistence.');const tx=db.transaction(STORES.operations,'readwrite');tx.objectStore(STORES.operations).put({id:`rotation-artifact:${id}`,value:structuredClone(value)});await complete(tx)})}
  async artifact<T>(id:string):Promise<T|null>{const db=await openDatabase(),tx=db.transaction(STORES.operations,'readonly'),value=await result<{value:T}|undefined>(tx.objectStore(STORES.operations).get(`rotation-artifact:${id}`));await complete(tx);return value?.value??null}
  async verifiedActiveEpoch():Promise<VerifiedEpochMaterial>{const db=await openDatabase();await verifyLocalIntegrityFor(db);const loaded=await loadEpoch(db),tx=db.transaction(STORES.envelopes,'readonly'),stored=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId));await complete(tx);const envelopes=stored.sort((a,b)=>a.localSeq-b.localSeq).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash})),revisions=[] as RevisionV1[];for(const envelope of envelopes)revisions.push(await openEnvelope(loaded.rootKey,loaded.epochSalt,{diaryId:loaded.context.diaryId,epochId:loaded.context.epochId},envelope));validateRevisionGraphV1(revisions);return{...loaded,envelopes,revisions}}
  async verifiedEpoch(context:EpochContext):Promise<VerifiedEpochMaterial>{const db=await openDatabase(),loaded=await loadEpochFor(db,context.epochId,context.wrapId),tx=db.transaction(STORES.envelopes,'readonly'),stored=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(context.epochId));await complete(tx);let hash=await journalInitial(context.diaryId,context.epochId),count=0;const envelopes=stored.sort((a,b)=>a.localSeq-b.localSeq).map(item=>{count++;if(item.localSeq!==count||item.rowBytes!==decodeUtf8(canonicalBytes([...envelopeRow(item)])))throw new Error('Local envelope journal corruption.');return{envelopeId:item.envelopeId,iv:item.iv,ciphertext:item.ciphertext,bytesHash:item.bytesHash}});for(const envelope of envelopes)hash=await journalNext(hash,envelopes.indexOf(envelope)+1,envelope);if(count!==loaded.state.local_journal_count||hash!==loaded.state.local_journal_hash)throw new Error('Local envelope journal hash failed.');const revisions:RevisionV1[]=[];for(const envelope of envelopes)revisions.push(await openEnvelope(loaded.rootKey,loaded.epochSalt,{diaryId:context.diaryId,epochId:context.epochId},envelope));validateRevisionGraphV1(revisions);return{...loaded,envelopes,revisions}}
  async persistSuccessor(input:{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityStateV5}):Promise<void>{
    const db=await openDatabase()
    await withDiaryLock(input.context.diaryId,async()=>{
      const existingTx=db.transaction([STORES.wraps,STORES.state],'readonly'),existingWrap=await result<{wrap:RootWrap}|undefined>(existingTx.objectStore(STORES.wraps).get(input.context.epochId)),existingState=await result<StoredState|undefined>(existingTx.objectStore(STORES.state).get(input.context.epochId));await complete(existingTx)
      if(existingWrap||existingState){if(!existingWrap||!existingState)throw new Error('Incomplete staged successor state.');const context={...input.context,wrapId:existingWrap.wrap.wrap_id},opened=await openStoredRoot(db,context,existingWrap.wrap),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));if(base64Url(opened)!==base64Url(input.rootKey))throw new Error('Existing successor root-wrap does not match the planned root.');await verifyStateTag(opened,salt,existingState.state,existingState.tag);return}
      const activeTx=db.transaction([STORES.context,STORES.wraps],'readonly'),activeContext=await result<EpochContext|undefined>(activeTx.objectStore(STORES.context).get(ACTIVE_CONTEXT)),sourceStored=activeContext?await result<{wrap:RootWrap}|undefined>(activeTx.objectStore(STORES.wraps).get(activeContext.epochId)):undefined;await complete(activeTx);if(activeContext&&activeContext.diaryId!==input.context.diaryId)throw new Error('Active diary changed before successor persistence.')
      let wrap:RootWrap
      if(sourceStored?.wrap.mode==='passphrase'){const factor=unlockFactors.get(input.context.diaryId);if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase');wrap=await createPassphraseRootWrap(input.rootKey,factor.passphrase,{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint},fromBase64Url(input.context.wrapId))}
      else if(sourceStored?.wrap.mode==='prf'){const factor=unlockFactors.get(input.context.diaryId);if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf');wrap=await createPrfRootWrap(input.rootKey,{credentialId:factor.credentialId,prfEvalInput:factor.prfEvalInput,prfOutput:factor.prfOutput,rpId:factor.rpId},{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint},fromBase64Url(input.context.wrapId))}
      else{const key=await wrappingKey(db,input.context.wrapId);wrap=await createBestEffortRootWrap(input.rootKey,key,{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint},fromBase64Url(input.context.wrapId));const opened=await openBestEffortRootWrap(wrap,key);if(base64Url(opened)!==base64Url(input.rootKey))throw new Error('Successor root-wrap readback failed.')}
      const context={...input.context,wrapId:wrap.wrap_id},salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId)),tag=await stateTag(input.rootKey,salt,input.state),tx=db.transaction([STORES.wraps,STORES.state],'readwrite');tx.objectStore(STORES.wraps).put({id:context.epochId,wrap});tx.objectStore(STORES.state).put({id:context.epochId,state:input.state,tag} satisfies StoredState);await complete(tx);unlockedRoots.set(context.epochId,new Uint8Array(input.rootKey));const check=db.transaction([STORES.wraps,STORES.state],'readonly'),storedWrap=await result<{wrap:RootWrap}|undefined>(check.objectStore(STORES.wraps).get(context.epochId)),state=await result<StoredState|undefined>(check.objectStore(STORES.state).get(context.epochId));await complete(check);if(!storedWrap||!state)throw new Error('Successor staging readback failed.');await verifyStateTag(input.rootKey,salt,state.state,state.tag);await openStoredRoot(db,context,storedWrap.wrap)
    })
  }
  async successorRoot(epochId:string,wrapId:string):Promise<Uint8Array>{const db=await openDatabase(),tx=db.transaction(STORES.wraps,'readonly'),stored=await result<{wrap:RootWrap}|undefined>(tx.objectStore(STORES.wraps).get(epochId));await complete(tx);if(!stored)throw new Error('Successor root wrap missing.');const context:EpochContext={id:'active',diaryId:stored.wrap.diary_id,epochId,keyId:stored.wrap.key_id,manifestFingerprint:stored.wrap.manifest_fingerprint,wrapId};return openStoredRoot(db,context,stored.wrap)}
  async rotationRevision(_id:string,create:()=>RevisionV1):Promise<RevisionV1>{const revision=create();validateRevisionV1(revision);return revision}
  async prepareRotationEnvelope(_operationId:string,context:EpochContext,revision:RevisionV1):Promise<PreparedEnvelope>{const db=await openDatabase(),rootKey=await this.successorRoot(context.epochId,context.wrapId),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId)),all=await this.successorEnvelopes(context.epochId);for(const envelope of all){const opened=await openEnvelope(rootKey,salt,{diaryId:context.diaryId,epochId:context.epochId},envelope);if(opened.revision_id===revision.revision_id){if(decodeUtf8(canonicalBytes(opened as never))!==decodeUtf8(canonicalBytes(revision as never)))throw new Error('Revision ID exists with different bytes.');return envelope}}return prepareEnvelope(rootKey,salt,{diaryId:context.diaryId,epochId:context.epochId},revision,{reserve:async envelopeId=>withDiaryLock(context.diaryId,async()=>{await loadEpochFor(db,context.epochId,context.wrapId);const tx=db.transaction(STORES.reservations,'readwrite');tx.objectStore(STORES.reservations).add({id:envelopeId,epochId:context.epochId,status:'reserved'});await complete(tx)}),verifyReservation:async envelopeId=>{const tx=db.transaction(STORES.reservations,'readonly'),found=await result<{id:string;epochId:string;status:string}|undefined>(tx.objectStore(STORES.reservations).get(envelopeId));await complete(tx);if(!found||found.epochId!==context.epochId||found.status!=='reserved')throw new Error('Envelope reservation readback failed.')},afterReservation:async envelopeId=>this.envelopeFault?.('after-reservation',envelopeId),afterEncryption:async envelope=>this.envelopeFault?.('after-encryption',envelope.envelopeId,envelope.iv),persist:async envelope=>withDiaryLock(context.diaryId,async()=>{const current=await loadEpochFor(db,context.epochId,context.wrapId),rowBytes=decodeUtf8(canonicalBytes([...envelopeRow(envelope)])),check=db.transaction(STORES.envelopes,'readonly'),prior=await result<StoredEnvelope|undefined>(check.objectStore(STORES.envelopes).get(envelope.envelopeId));await complete(check);if(prior){if(prior.rowBytes!==rowBytes)throw new Error('Envelope ID exists with different bytes.');return}const sequence=current.state.local_journal_count+1,next={...current.state,local_journal_count:sequence,local_journal_hash:await journalNext(current.state.local_journal_hash,sequence,envelope),operation_generation:current.state.operation_generation+1},tag=await stateTag(rootKey,salt,next),tx=db.transaction([STORES.envelopes,STORES.outbox,STORES.reservations,STORES.state],'readwrite');tx.objectStore(STORES.envelopes).add({...envelope,id:envelope.envelopeId,epochId:context.epochId,localSeq:sequence,rowBytes} satisfies StoredEnvelope);tx.objectStore(STORES.outbox).add({id:envelope.envelopeId,epochId:context.epochId,envelopeId:envelope.envelopeId,rowBytes,status:'prepared'} satisfies StoredOutbox);tx.objectStore(STORES.reservations).put({id:envelope.envelopeId,epochId:context.epochId,status:'consumed'});tx.objectStore(STORES.state).put({id:context.epochId,state:next,tag} satisfies StoredState);await complete(tx)})})}
  async bindRemote(context:EpochContext,binding:RemoteBindingV1):Promise<void>{const db=await openDatabase();await withDiaryLock(context.diaryId,async()=>{const loaded=await loadEpochFor(db,context.epochId,context.wrapId);if(loaded.state.remote_binding){if(loaded.state.remote_binding.provider_id!==binding.provider_id||loaded.state.remote_binding.remote_resource_id!==binding.remote_resource_id||loaded.state.remote_binding.remote_identity_binding!==binding.remote_identity_binding)throw new Error('Successor remote binding changed.');return}const state={...loaded.state,remote_binding:structuredClone(binding),operation_generation:loaded.state.operation_generation+1},tag=await stateTag(loaded.rootKey,loaded.epochSalt,state),tx=db.transaction(STORES.state,'readwrite');tx.objectStore(STORES.state).put({id:context.epochId,state,tag} satisfies StoredState);await complete(tx)})}
  async successorEnvelopes(epochId:string):Promise<PreparedEnvelope[]>{const db=await openDatabase(),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId));await complete(tx);return items.sort((a,b)=>a.localSeq-b.localSeq).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash}))}
  async atomicSwitch(successor:EpochContext,rotation:RotationState,mode:'normal'|'remote_enablement'='normal'):Promise<void>{
    const db=await openDatabase(),initial=await loadEpoch(db)
    await withDiaryLock(initial.context.diaryId,async()=>{
      const source=await loadEpoch(db),successorMaterial=await loadEpochFor(db,successor.epochId,successor.wrapId),sourceMaterial=await loadEpochFor(db,source.context.epochId,source.context.wrapId)
      if(rotation.step!=='announcement_durable'||sourceMaterial.state.rotation_state_ref?.state!=='announcement_durable')throw new Error('Epoch migration is not durably ready to switch.')
      if(mode==='normal'){
        const frozenAnchor=rotation.sourceAnchor as RemoteAnchorV1|undefined
        if(!sourceMaterial.state.remote_anchor||!frozenAnchor||sourceMaterial.state.remote_anchor.covered_row_count!==frozenAnchor.covered_row_count+1)throw new Error('Source announcement is not the unique row after the frozen prefix.')
      }else if(sourceMaterial.state.remote_binding!==null||sourceMaterial.state.remote_anchor!==null||sourceMaterial.state.epoch_status!=='local_offline')throw new Error('Remote enablement source is no longer local-only.')
      if(!successorMaterial.state.remote_binding||!successorMaterial.state.remote_anchor)throw new Error('Successor binding or verified anchor is missing.')
      const hash=await rotationStateHash(rotation),ref={operation_id:rotation.rotationId,state:rotation.step,state_record_hash:hash},oldState={...sourceMaterial.state,epoch_status:'retired' as const,operation_generation:sourceMaterial.state.operation_generation+1},newState={...successorMaterial.state,epoch_status:'active' as const,rotation_state_ref:ref,operation_generation:successorMaterial.state.operation_generation+1},oldTag=await stateTag(sourceMaterial.rootKey,sourceMaterial.epochSalt,oldState),newTag=await stateTag(successorMaterial.rootKey,successorMaterial.epochSalt,newState),tx=db.transaction([STORES.context,STORES.state],'readwrite')
      tx.objectStore(STORES.context).put(successor);tx.objectStore(STORES.state).put({id:source.context.epochId,state:oldState,tag:oldTag} satisfies StoredState);tx.objectStore(STORES.state).put({id:successor.epochId,state:newState,tag:newTag} satisfies StoredState);await complete(tx)
    })
  }
}

async function verifyLocalIntegrityFor(db:IDBDatabase):Promise<void>{const loaded=await loadEpoch(db),tx=db.transaction(STORES.envelopes,'readonly'),items=await result<StoredEnvelope[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId));await complete(tx);let hash=await journalInitial(loaded.context.diaryId,loaded.context.epochId),count=0;for(const item of items.sort((a,b)=>a.localSeq-b.localSeq)){count++;if(item.localSeq!==count||item.rowBytes!==decodeUtf8(canonicalBytes([...envelopeRow(item)])))throw new Error('Local envelope journal corruption.');hash=await journalNext(hash,count,item)}if(count!==loaded.state.local_journal_count||hash!==loaded.state.local_journal_hash)throw new Error('Local envelope journal hash failed.')}
export async function verifyLocalIntegrity():Promise<void>{return verifyLocalIntegrityFor(await openDatabase())}
export interface ActiveRemoteDurabilityStatus {remoteBound:boolean;pendingEnvelopeCount:number;totalEnvelopeCount:number}
export async function activeRemoteDurabilityStatus():Promise<ActiveRemoteDurabilityStatus>{
  await ready()
  const db=await openDatabase(),loaded=await loadEpoch(db),tx=db.transaction([STORES.envelopes,STORES.outbox],'readonly'),envelopesRequest=tx.objectStore(STORES.envelopes).index('byEpoch').getAll(loaded.context.epochId),outboxRequest=tx.objectStore(STORES.outbox).index('byEpoch').getAll(loaded.context.epochId),[envelopes,outbox]=await Promise.all([result<StoredEnvelope[]>(envelopesRequest),result<StoredOutbox[]>(outboxRequest)]);await complete(tx)
  return{remoteBound:loaded.state.remote_binding!==null,pendingEnvelopeCount:outbox.filter(item=>item.status!=='durable').length,totalEnvelopeCount:envelopes.length}
}
export async function storedRotationArtifact<T>(suffix:'recovery'|'backup'):Promise<T|null>{const db=await openDatabase(),loaded=await loadEpoch(db),operationId=loaded.state.rotation_state_ref?.operation_id;if(!operationId)return null;const tx=db.transaction(STORES.operations,'readonly'),item=await result<{value:T}|undefined>(tx.objectStore(STORES.operations).get(`rotation-artifact:${operationId}:${suffix}`));await complete(tx);return item?.value??null}
async function resetDatabaseForTesting():Promise<void>{if(import.meta.env.MODE!=='test')throw new Error('Database reset is test-only.');if(databasePromise){const db=await databasePromise;db.close()}databasePromise=null;readyPromise=null;legacyMigrationTestingHook=null;unlockedRoots.clear();unlockFactors.clear()}
function setLegacyMigrationHookForTesting(hook:((pass:number)=>Promise<void>)|null):void{if(import.meta.env.MODE!=='test')throw new Error('Migration hook is test-only.');legacyMigrationTestingHook=hook}
async function appendTestBranch(store:LocalStoreName,value:{id:string}&Record<string,unknown>,parentRevisionId:string):Promise<void>{if(import.meta.env.MODE!=='test')throw new Error('Test branch writes are unavailable in production.');await ready();const db=await openDatabase(),loaded=await loadEpoch(db);await withDiaryLock(loaded.context.diaryId,async()=>persistRevision(db,store,value,undefined,'test-branch',[parentRevisionId]))}
async function revisionsForTesting():Promise<RevisionV1[]>{if(import.meta.env.MODE!=='test')throw new Error('Revision inspection is test-only.');await ready();return verifiedEnvelopeRevisions(await openDatabase())}
export const __localDatabaseTesting={openDatabase,loadEpoch,STORES,resetForTesting:resetDatabaseForTesting,setLegacyMigrationHook:setLegacyMigrationHookForTesting,appendTestBranch,revisions:revisionsForTesting}

export function indexedDbCreationPersistence():CreationPersistence{return{async read(locator){const db=await openDatabase(),tx=db.transaction(STORES.operations,'readonly'),value=await result<{id:string;state:CreationState;hash:string}|undefined>(tx.objectStore(STORES.operations).get(`creation:${locator}`));await complete(tx);if(!value)return null;if(value.hash!==base64Url(await sha256(canonicalBytes(value.state as never))))throw new Error('Creation operation state hash failed.');return value.state},async write(state){const db=await openDatabase(),loaded=await loadEpoch(db);await withDiaryLock(loaded.context.diaryId,async()=>{const current=await loadEpoch(db);if(state.operationGeneration!==undefined&&state.operationGeneration!==current.state.operation_generation)throw new Error('Stale creation callback generation.');const next={...current.state,operation_generation:current.state.operation_generation+1},bound={...state,operationGeneration:next.operation_generation},hash=base64Url(await sha256(canonicalBytes(bound as never))),tag=await stateTag(current.rootKey,current.epochSalt,next),tx=db.transaction([STORES.operations,STORES.state],'readwrite');tx.objectStore(STORES.operations).put({id:`creation:${state.locator}`,state:structuredClone(bound),hash});tx.objectStore(STORES.state).put({id:current.context.epochId,state:next,tag} satisfies StoredState);await complete(tx);const checked=await loadEpoch(db);if(checked.state.operation_generation!==bound.operationGeneration)throw new Error('Creation generation readback failed.')})}}}
export function indexedDbRotationPersistence():RotationPersistence{return{async read(){const db=await openDatabase(),loaded=await loadEpoch(db),tx=db.transaction(STORES.operations,'readonly'),value=await result<{id:string;state:RotationState;hash:string}|undefined>(tx.objectStore(STORES.operations).get(`rotation:${loaded.context.diaryId}`));await complete(tx);if(!value)return null;const ref=loaded.state.rotation_state_ref;if(await rotationStateHash(value.state)!==value.hash||!ref||ref.operation_id!==value.state.rotationId||ref.state!==value.state.step||ref.state_record_hash!==value.hash)throw new Error('Authenticated rotation state binding failed.');return value.state},async write(rotation,hash){const db=await openDatabase(),loaded=await loadEpoch(db);await withDiaryLock(loaded.context.diaryId,async()=>{const current=await loadEpoch(db);if(await rotationStateHash(rotation)!==hash)throw new Error('Rotation state hash mismatch.');const ref={operation_id:rotation.rotationId,state:rotation.step,state_record_hash:hash},next={...current.state,rotation_state_ref:ref,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,next),tx=db.transaction([STORES.operations,STORES.state],'readwrite');tx.objectStore(STORES.operations).put({id:`rotation:${loaded.context.diaryId}`,state:structuredClone(rotation),hash});tx.objectStore(STORES.state).put({id:current.context.epochId,state:next,tag} satisfies StoredState);await complete(tx)})},async readBack(){const db=await openDatabase(),loaded=await loadEpoch(db),tx=db.transaction(STORES.operations,'readonly'),value=await result<{state:RotationState;hash:string}|undefined>(tx.objectStore(STORES.operations).get(`rotation:${loaded.context.diaryId}`));await complete(tx);if(!value||await rotationStateHash(value.state)!==value.hash||loaded.state.rotation_state_ref?.state_record_hash!==value.hash)throw new Error('Rotation state missing or corrupt after persistence.');return value}}}
