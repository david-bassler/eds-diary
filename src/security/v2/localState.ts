import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { RemoteAnchorV2 } from './types'
import { arrayBuffer, base64Url, concatBytes, fixedBase64Url, fromBase64Url, randomBytes, uint64be, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, derivePassphraseMaterial, hkdfSha256, hmacSha256, sha256, validatePassphrase } from '../crypto/core'
import { deriveLocalStateMacKeyV2 } from './crypto'
import type { RecoveryCredentialHistoryEntryV2 } from './verifier'

export type EpochStatusV6 = 'local_offline'|'remote_bound'|'active'|'offline_restored'|'retired'|'orphaned'
export type WriterStatusV2 = 'writer_active'|'read_only'

export interface SecurityStateRefV2 {
  operation_id:string
  state:string
  state_record_hash:string
}

export interface ActivationLineageCacheRefV2 {
  cache_id:string
  cache_record_hash:string
}

export interface RemoteBindingV2 {
  storage_provider_id:typeof GOOGLE_DRIVE_SHEETS_PROVIDER
  sync_profile:typeof SINGLE_WRITER_V2_PROFILE
  remote_resource_id:string
  remote_identity_binding:string
}

export interface RootWrapIdentityV6 {
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
}
interface RootWrapBaseV6 extends RootWrapIdentityV6 {
  local_wrap_version:6
  wrap_id:string
  wrap_iv:string
  wrapped_root_key:string
}
export interface BestEffortRootWrapV6 extends RootWrapBaseV6 {
  mode:'best-effort'
  mode_metadata:Record<string,never>
}
export interface PassphraseRootWrapV6 extends RootWrapBaseV6 {
  mode:'passphrase'
  mode_metadata:{passphrase_profile:'argon2id-v6-1';passphrase_salt:string}
}
export interface PrfRootWrapV6 extends RootWrapBaseV6 {
  mode:'prf'
  mode_metadata:{prf_profile:'webauthn-prf-v6-1';credential_id:string;prf_eval_input:string;prf_wrap_salt:string;rp_id:string}
}
export type RootWrapV6=BestEffortRootWrapV6|PassphraseRootWrapV6|PrfRootWrapV6

export interface EpochLocalSecurityStateV6 {
  local_state_version:6
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_rekey_rotation_required:boolean
  recovery_rekey_transition_id:string|null
  remote_binding:RemoteBindingV2|null
  remote_anchor:RemoteAnchorV2|null
  epoch_status:EpochStatusV6
  operation_generation:number
  rotation_state_ref:SecurityStateRefV2|null
  migration_state_ref:null
  writer_operation_state_ref:SecurityStateRefV2|null
  recovery_operation_state_ref:SecurityStateRefV2|null
  activation_lineage_cache_ref:ActivationLineageCacheRefV2|null
  local_journal_count:number
  local_journal_hash:string
  writer_status:WriterStatusV2
  writer_device_id:string
  writer_signing_key_id:string
  writer_generation:number|null
  writer_grant_id:string|null
  verified_writer_device_id:string|null
  verified_writer_key_id:string|null
  verified_writer_generation:number|null
  verified_writer_grant_id:string|null
  recovery_takeover_key_id:string
  recovery_credential_history_sha256:string
  stale_writer_pending_count:number
}

const TOP_LEVEL_KEYS = [
  'local_state_version','diary_id','epoch_id','key_id','manifest_fingerprint',
  'recovery_generation','recovery_urs_commitment','recovery_urs_id',
  'recovery_rekey_rotation_required','recovery_rekey_transition_id','remote_binding',
  'remote_anchor','epoch_status','operation_generation','rotation_state_ref',
  'migration_state_ref','writer_operation_state_ref','recovery_operation_state_ref',
  'activation_lineage_cache_ref','local_journal_count','local_journal_hash',
  'writer_status','writer_device_id','writer_signing_key_id','writer_generation',
  'writer_grant_id','verified_writer_device_id','verified_writer_key_id',
  'verified_writer_generation','verified_writer_grant_id','recovery_takeover_key_id',
  'recovery_credential_history_sha256','stale_writer_pending_count',
] as const

const ROTATION_TERMINAL = new Set(['switched','stale','cutover_race','post_activation_superseded'])
const WRITER_OPERATION_TERMINAL = new Set(['durable','stale'])
const RECOVERY_OPERATION_TERMINAL = new Set(['completed','stale','superseded'])

function object(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`)
  return value as Record<string,unknown>
}
function exact(value:Record<string,unknown>,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} has unknown or missing properties.`)
}
function safeInteger(value:unknown,min:number,label:string):number{
  if(!Number.isSafeInteger(value)||Number(value)<min)throw new Error(`${label} is invalid.`)
  return Number(value)
}
function id(value:unknown,bytes:number,label:string):string{
  if(typeof value!=='string')throw new Error(`${label} must be a string.`)
  fixedBase64Url(value,bytes,label)
  return value
}
function nonEmpty(value:unknown,label:string):string{
  if(typeof value!=='string'||value.length===0)throw new Error(`${label} must be a non-empty string.`)
  return value
}
function nullableId(value:unknown,bytes:number,label:string):string|null{
  if(value===null)return null
  return id(value,bytes,label)
}
function validateOperationRef(value:unknown,label:string):SecurityStateRefV2|null{
  if(value===null)return null
  const ref=object(value,label);exact(ref,['operation_id','state','state_record_hash'],label)
  id(ref.operation_id,32,`${label}.operation_id`)
  nonEmpty(ref.state,`${label}.state`)
  id(ref.state_record_hash,32,`${label}.state_record_hash`)
  return value as SecurityStateRefV2
}
function validateCacheRef(value:unknown):ActivationLineageCacheRefV2|null{
  if(value===null)return null
  const ref=object(value,'activation_lineage_cache_ref');exact(ref,['cache_id','cache_record_hash'],'activation_lineage_cache_ref')
  id(ref.cache_id,16,'activation_lineage_cache_ref.cache_id')
  id(ref.cache_record_hash,32,'activation_lineage_cache_ref.cache_record_hash')
  return value as ActivationLineageCacheRefV2
}
function validateRemoteBinding(value:unknown):RemoteBindingV2|null{
  if(value===null)return null
  const binding=object(value,'remote_binding')
  exact(binding,['storage_provider_id','sync_profile','remote_resource_id','remote_identity_binding'],'remote_binding')
  if(binding.storage_provider_id!==GOOGLE_DRIVE_SHEETS_PROVIDER||binding.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('remote_binding profile mismatch.')
  nonEmpty(binding.remote_resource_id,'remote_binding.remote_resource_id')
  nonEmpty(binding.remote_identity_binding,'remote_binding.remote_identity_binding')
  return value as RemoteBindingV2
}
function validateRemoteAnchor(value:unknown):RemoteAnchorV2|null{
  if(value===null)return null
  const anchor=object(value,'remote_anchor');exact(anchor,['anchor_profile','covered_row_count','prefix_hash'],'remote_anchor')
  if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('remote_anchor profile mismatch.')
  safeInteger(anchor.covered_row_count,0,'remote_anchor.covered_row_count')
  id(anchor.prefix_hash,32,'remote_anchor.prefix_hash')
  return value as RemoteAnchorV2
}

export function validateEpochLocalSecurityStateV6(value:unknown):EpochLocalSecurityStateV6{
  const state=object(value,'EpochLocalSecurityStateV6')
  exact(state,TOP_LEVEL_KEYS,'EpochLocalSecurityStateV6')
  if(state.local_state_version!==6)throw new Error('local_state_version must be 6.')
  id(state.diary_id,16,'diary_id');id(state.epoch_id,16,'epoch_id');id(state.key_id,16,'key_id');id(state.manifest_fingerprint,32,'manifest_fingerprint')
  safeInteger(state.recovery_generation,0,'recovery_generation')
  id(state.recovery_urs_commitment,32,'recovery_urs_commitment')
  id(state.recovery_urs_id,32,'recovery_urs_id')
  if(typeof state.recovery_rekey_rotation_required!=='boolean')throw new Error('recovery_rekey_rotation_required must be boolean.')
  const transition=nullableId(state.recovery_rekey_transition_id,32,'recovery_rekey_transition_id')
  if(state.recovery_rekey_rotation_required!==(transition!==null))throw new Error('Pending-Rekey state is inconsistent.')
  validateRemoteBinding(state.remote_binding)
  validateRemoteAnchor(state.remote_anchor)
  if(!['local_offline','remote_bound','active','offline_restored','retired','orphaned'].includes(String(state.epoch_status)))throw new Error('Invalid epoch_status.')
  safeInteger(state.operation_generation,0,'operation_generation')
  validateOperationRef(state.rotation_state_ref,'rotation_state_ref')
  if(state.migration_state_ref!==null)throw new Error('migration_state_ref must be null in v2.')
  validateOperationRef(state.writer_operation_state_ref,'writer_operation_state_ref')
  validateOperationRef(state.recovery_operation_state_ref,'recovery_operation_state_ref')
  validateCacheRef(state.activation_lineage_cache_ref)
  safeInteger(state.local_journal_count,0,'local_journal_count');id(state.local_journal_hash,32,'local_journal_hash')
  if(state.writer_status!=='writer_active'&&state.writer_status!=='read_only')throw new Error('Invalid writer_status.')
  id(state.writer_device_id,16,'writer_device_id');id(state.writer_signing_key_id,32,'writer_signing_key_id')
  const generation=state.writer_generation===null?null:safeInteger(state.writer_generation,1,'writer_generation')
  const grantId=nullableId(state.writer_grant_id,32,'writer_grant_id')
  const verifiedValues=[state.verified_writer_device_id,state.verified_writer_key_id,state.verified_writer_generation,state.verified_writer_grant_id]
  const verifiedNullCount=verifiedValues.filter(entry=>entry===null).length
  if(verifiedNullCount!==0&&verifiedNullCount!==4)throw new Error('Verified writer fields must be jointly null or jointly set.')
  const verifiedDevice=nullableId(state.verified_writer_device_id,16,'verified_writer_device_id')
  const verifiedKey=nullableId(state.verified_writer_key_id,32,'verified_writer_key_id')
  const verifiedGeneration=state.verified_writer_generation===null?null:safeInteger(state.verified_writer_generation,1,'verified_writer_generation')
  const verifiedGrant=nullableId(state.verified_writer_grant_id,32,'verified_writer_grant_id')
  id(state.recovery_takeover_key_id,32,'recovery_takeover_key_id')
  id(state.recovery_credential_history_sha256,32,'recovery_credential_history_sha256')
  safeInteger(state.stale_writer_pending_count,0,'stale_writer_pending_count')

  const remoteBinding=validateRemoteBinding(state.remote_binding)
  const remoteAnchor=validateRemoteAnchor(state.remote_anchor)
  const verifiedSet=verifiedNullCount===0
  if((remoteAnchor!==null)!==verifiedSet)throw new Error('remote_anchor and verified writer cache must become bound together.')
  if(remoteBinding===null&&remoteAnchor!==null)throw new Error('A verified remote_anchor requires a remote_binding.')
  if(state.epoch_status==='active'&&(remoteBinding===null||remoteAnchor===null||!verifiedSet))throw new Error('active v2 epoch requires a bound fully verified remote state.')
  if(state.epoch_status==='orphaned'&&state.writer_status!=='read_only')throw new Error('orphaned epochs must be read_only.')
  if(state.writer_status==='read_only'){
    if(generation!==null||grantId!==null)throw new Error('read_only state must not carry current writer generation/grant.')
  }else{
    if(state.epoch_status!=='active')throw new Error('writer_active requires epoch_status=active.')
    if(generation===null||grantId===null||verifiedDevice===null||verifiedKey===null||verifiedGeneration===null||verifiedGrant===null)throw new Error('writer_active requires a fully verified writer authority.')
    if(state.writer_device_id!==verifiedDevice||state.writer_signing_key_id!==verifiedKey||generation!==verifiedGeneration||grantId!==verifiedGrant)throw new Error('writer_active local authority does not match verified authority.')
  }
  return value as EpochLocalSecurityStateV6
}

export function hasBlockingNormalWriteOperationV2(state:EpochLocalSecurityStateV6):boolean{
  if(state.rotation_state_ref&&!ROTATION_TERMINAL.has(state.rotation_state_ref.state))return true
  if(state.writer_operation_state_ref&&!WRITER_OPERATION_TERMINAL.has(state.writer_operation_state_ref.state))return true
  if(state.recovery_operation_state_ref&&!RECOVERY_OPERATION_TERMINAL.has(state.recovery_operation_state_ref.state))return true
  return false
}

export async function recoveryCredentialHistoryHashV2(history:readonly RecoveryCredentialHistoryEntryV2[]):Promise<string>{
  return base64Url(await sha256(canonicalBytes(history as never)))
}

export async function journalInitialV2(diaryId:string,epochId:string):Promise<string>{
  const diary=fixedBase64Url(diaryId,16,'diary_id'),epoch=fixedBase64Url(epochId,16,'epoch_id')
  return base64Url(await sha256(concatBytes(utf8('eds-diary/local-journal/v6'),new Uint8Array([0]),diary,epoch)))
}

export async function journalNextV2(previousHash:string,index:number,row:readonly [string,string,string]):Promise<string>{
  const previous=fixedBase64Url(previousHash,32,'local_journal_hash')
  if(!Number.isSafeInteger(index)||index<1)throw new Error('Journal index is invalid.')
  const entryHash=await sha256(canonicalBytes(row as unknown as string[]))
  return base64Url(await sha256(concatBytes(previous,uint64be(index),entryHash)))
}

export async function localStateTagV6(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6):Promise<string>{
  validateEpochLocalSecurityStateV6(state)
  const key=await deriveLocalStateMacKeyV2(rootKey,epochSalt)
  return base64Url(await hmacSha256(key,canonicalBytes(state as never)))
}

export async function verifyLocalStateTagV6(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6,tag:string):Promise<void>{
  const expected=await localStateTagV6(rootKey,epochSalt,state)
  fixedBase64Url(tag,32,'local_state_tag')
  if(expected!==tag)throw new Error('EpochLocalSecurityStateV6 MAC verification failed.')
}


function assertRootWrapIdentityV6(identity:RootWrapIdentityV6):void{
  fixedBase64Url(identity.diary_id,16,'diary_id')
  fixedBase64Url(identity.epoch_id,16,'epoch_id')
  fixedBase64Url(identity.key_id,16,'key_id')
  fixedBase64Url(identity.manifest_fingerprint,32,'manifest_fingerprint')
}
function assertRootKeyV6(rootKey:Uint8Array):void{if(rootKey.byteLength!==32)throw new Error('RootWrapV6 root key must contain exactly 32 bytes.')}
function assertBestEffortWrapKeyV6(key:CryptoKey):void{
  const usages=[...key.usages].sort().join(',')
  if(key.type!=='secret'||key.algorithm.name!=='AES-GCM'||key.extractable||usages!=='decrypt,encrypt')throw new Error('Invalid RootWrapV6 best-effort wrapping key.')
}
function rootWrapHeaderV6(wrap:RootWrapV6):Record<string,unknown>{
  return{
    local_wrap_version:wrap.local_wrap_version,
    mode:wrap.mode,
    diary_id:wrap.diary_id,
    epoch_id:wrap.epoch_id,
    key_id:wrap.key_id,
    manifest_fingerprint:wrap.manifest_fingerprint,
    wrap_id:wrap.wrap_id,
    mode_metadata:wrap.mode_metadata,
  }
}
function rootWrapAadV6(wrap:RootWrapV6):Uint8Array{return canonicalBytes(rootWrapHeaderV6(wrap) as never)}
async function passphraseKekV6(passphrase:string,salt:Uint8Array,identity:RootWrapIdentityV6):Promise<Uint8Array>{
  validatePassphrase(passphrase)
  if(salt.byteLength!==16)throw new Error('RootWrapV6 passphrase salt must contain 16 bytes.')
  assertRootWrapIdentityV6(identity)
  const zero=new Uint8Array([0]),diary=fixedBase64Url(identity.diary_id,16),epoch=fixedBase64Url(identity.epoch_id,16),key=fixedBase64Url(identity.key_id,16)
  const argonBase=await derivePassphraseMaterial(passphrase,salt)
  const hkdfSalt=await sha256(concatBytes(utf8('eds-diary/local-passphrase-salt/v6'),zero,diary,epoch))
  const context=concatBytes(utf8('eds-diary/local-passphrase-wrap/v6'),zero,diary,epoch,key)
  return hkdfSha256(argonBase,hkdfSalt,context)
}
async function prfKekV6(prfOutput:Uint8Array,wrapSalt:Uint8Array,identity:RootWrapIdentityV6,credentialId:Uint8Array):Promise<Uint8Array>{
  if(prfOutput.byteLength!==32||wrapSalt.byteLength!==32||!credentialId.byteLength)throw new Error('Invalid RootWrapV6 PRF material.')
  assertRootWrapIdentityV6(identity)
  const zero=new Uint8Array([0]),diary=fixedBase64Url(identity.diary_id,16),epoch=fixedBase64Url(identity.epoch_id,16),key=fixedBase64Url(identity.key_id,16),credentialHash=await sha256(credentialId)
  const context=concatBytes(utf8('eds-diary/local-prf-wrap/v6'),zero,diary,epoch,key,credentialHash)
  return hkdfSha256(prfOutput,wrapSalt,context)
}

export async function createBestEffortRootWrapV6(rootKey:Uint8Array,wrappingKey:CryptoKey,identity:RootWrapIdentityV6,wrapId=randomBytes(16),iv=randomBytes(12)):Promise<BestEffortRootWrapV6>{
  assertRootKeyV6(rootKey);assertBestEffortWrapKeyV6(wrappingKey);assertRootWrapIdentityV6(identity)
  if(wrapId.byteLength!==16||iv.byteLength!==12)throw new Error('Invalid RootWrapV6 randomness.')
  const draft:BestEffortRootWrapV6={local_wrap_version:6,mode:'best-effort',...identity,wrap_id:base64Url(wrapId),wrap_iv:base64Url(iv),wrapped_root_key:'',mode_metadata:{}}
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:arrayBuffer(iv),additionalData:arrayBuffer(rootWrapAadV6(draft)),tagLength:128},wrappingKey,arrayBuffer(rootKey))
  return{...draft,wrapped_root_key:base64Url(new Uint8Array(ciphertext))}
}

export async function openBestEffortRootWrapV6(wrap:RootWrapV6,wrappingKey:CryptoKey):Promise<Uint8Array>{
  if(wrap.mode!=='best-effort'||Object.keys(wrap.mode_metadata).length!==0)throw new Error('RootWrapV6 is not best-effort mode.')
  assertBestEffortWrapKeyV6(wrappingKey);validateRootWrapV6(wrap)
  const plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:arrayBuffer(fixedBase64Url(wrap.wrap_iv,12,'wrap_iv')),additionalData:arrayBuffer(rootWrapAadV6(wrap)),tagLength:128},wrappingKey,arrayBuffer(fromBase64Url(wrap.wrapped_root_key))))
  assertRootKeyV6(plaintext);return plaintext
}

export async function createPassphraseRootWrapV6(rootKey:Uint8Array,passphrase:string,identity:RootWrapIdentityV6,wrapId=randomBytes(16),passphraseSalt=randomBytes(16),iv=randomBytes(12)):Promise<PassphraseRootWrapV6>{
  assertRootKeyV6(rootKey);assertRootWrapIdentityV6(identity)
  if(wrapId.byteLength!==16||passphraseSalt.byteLength!==16||iv.byteLength!==12)throw new Error('Invalid RootWrapV6 passphrase randomness.')
  const draft:PassphraseRootWrapV6={local_wrap_version:6,mode:'passphrase',...identity,wrap_id:base64Url(wrapId),wrap_iv:base64Url(iv),wrapped_root_key:'',mode_metadata:{passphrase_profile:'argon2id-v6-1',passphrase_salt:base64Url(passphraseSalt)}}
  const encrypted=await aesGcmEncrypt(await passphraseKekV6(passphrase,passphraseSalt,identity),rootKey,rootWrapAadV6(draft),iv)
  return{...draft,wrapped_root_key:base64Url(encrypted.ciphertext)}
}

export async function openPassphraseRootWrapV6(wrap:RootWrapV6,passphrase:string):Promise<Uint8Array>{
  if(wrap.mode!=='passphrase'||wrap.mode_metadata.passphrase_profile!=='argon2id-v6-1')throw new Error('RootWrapV6 is not passphrase mode.')
  validateRootWrapV6(wrap)
  const plaintext=await aesGcmDecrypt(await passphraseKekV6(passphrase,fixedBase64Url(wrap.mode_metadata.passphrase_salt,16,'passphrase_salt'),wrap),fromBase64Url(wrap.wrapped_root_key),rootWrapAadV6(wrap),fixedBase64Url(wrap.wrap_iv,12,'wrap_iv'))
  assertRootKeyV6(plaintext);return plaintext
}

export interface PrfWrapEnrollmentMaterialV6 {credentialId:Uint8Array;prfEvalInput:Uint8Array;prfOutput:Uint8Array;rpId:string}
export async function createPrfRootWrapV6(rootKey:Uint8Array,material:PrfWrapEnrollmentMaterialV6,identity:RootWrapIdentityV6,wrapId=randomBytes(16),wrapSalt=randomBytes(32),iv=randomBytes(12)):Promise<PrfRootWrapV6>{
  assertRootKeyV6(rootKey);assertRootWrapIdentityV6(identity)
  if(wrapId.byteLength!==16||material.prfEvalInput.byteLength!==32||material.prfOutput.byteLength!==32||wrapSalt.byteLength!==32||iv.byteLength!==12||!material.credentialId.byteLength||!material.rpId)throw new Error('Invalid RootWrapV6 PRF enrollment material.')
  const draft:PrfRootWrapV6={local_wrap_version:6,mode:'prf',...identity,wrap_id:base64Url(wrapId),wrap_iv:base64Url(iv),wrapped_root_key:'',mode_metadata:{prf_profile:'webauthn-prf-v6-1',credential_id:base64Url(material.credentialId),prf_eval_input:base64Url(material.prfEvalInput),prf_wrap_salt:base64Url(wrapSalt),rp_id:material.rpId}}
  const encrypted=await aesGcmEncrypt(await prfKekV6(material.prfOutput,wrapSalt,identity,material.credentialId),rootKey,rootWrapAadV6(draft),iv)
  return{...draft,wrapped_root_key:base64Url(encrypted.ciphertext)}
}

export async function openPrfRootWrapV6(wrap:RootWrapV6,assertedCredentialId:Uint8Array,prfOutput:Uint8Array):Promise<Uint8Array>{
  if(wrap.mode!=='prf'||wrap.mode_metadata.prf_profile!=='webauthn-prf-v6-1')throw new Error('RootWrapV6 is not PRF mode.')
  validateRootWrapV6(wrap)
  const expected=fromBase64Url(wrap.mode_metadata.credential_id)
  if(expected.byteLength!==assertedCredentialId.byteLength||expected.some((byte,index)=>byte!==assertedCredentialId[index]))throw new Error('RootWrapV6 WebAuthn credential mismatch.')
  const plaintext=await aesGcmDecrypt(await prfKekV6(prfOutput,fixedBase64Url(wrap.mode_metadata.prf_wrap_salt,32,'prf_wrap_salt'),wrap,expected),fromBase64Url(wrap.wrapped_root_key),rootWrapAadV6(wrap),fixedBase64Url(wrap.wrap_iv,12,'wrap_iv'))
  assertRootKeyV6(plaintext);return plaintext
}

export function validateRootWrapV6(value:unknown):RootWrapV6{
  const wrap=object(value,'RootWrapV6')
  exact(wrap,['local_wrap_version','mode','diary_id','epoch_id','key_id','manifest_fingerprint','wrap_id','wrap_iv','wrapped_root_key','mode_metadata'],'RootWrapV6')
  if(wrap.local_wrap_version!==6)throw new Error('RootWrapV6 local_wrap_version mismatch.')
  const identity:RootWrapIdentityV6={diary_id:id(wrap.diary_id,16,'diary_id'),epoch_id:id(wrap.epoch_id,16,'epoch_id'),key_id:id(wrap.key_id,16,'key_id'),manifest_fingerprint:id(wrap.manifest_fingerprint,32,'manifest_fingerprint')}
  assertRootWrapIdentityV6(identity);id(wrap.wrap_id,16,'wrap_id');id(wrap.wrap_iv,12,'wrap_iv')
  if(typeof wrap.wrapped_root_key!=='string'){throw new Error('RootWrapV6 wrapped_root_key is invalid.')} const wrappedBytes=fromBase64Url(wrap.wrapped_root_key);if(wrappedBytes.byteLength!==48||base64Url(wrappedBytes)!==wrap.wrapped_root_key)throw new Error('RootWrapV6 wrapped_root_key is not canonical 48-byte ciphertext.')
  const metadata=object(wrap.mode_metadata,'mode_metadata')
  if(wrap.mode==='best-effort'){
    exact(metadata,[],'mode_metadata')
  }else if(wrap.mode==='passphrase'){
    exact(metadata,['passphrase_profile','passphrase_salt'],'mode_metadata')
    if(metadata.passphrase_profile!=='argon2id-v6-1')throw new Error('RootWrapV6 passphrase profile mismatch.')
    id(metadata.passphrase_salt,16,'passphrase_salt')
  }else if(wrap.mode==='prf'){
    exact(metadata,['prf_profile','credential_id','prf_eval_input','prf_wrap_salt','rp_id'],'mode_metadata')
    if(metadata.prf_profile!=='webauthn-prf-v6-1'||typeof metadata.credential_id!=='string'||!fromBase64Url(metadata.credential_id).byteLength||base64Url(fromBase64Url(metadata.credential_id))!==metadata.credential_id||typeof metadata.rp_id!=='string'||!metadata.rp_id)throw new Error('RootWrapV6 PRF metadata mismatch.')
    id(metadata.prf_eval_input,32,'prf_eval_input');id(metadata.prf_wrap_salt,32,'prf_wrap_salt')
  }else throw new Error('Invalid RootWrapV6 mode.')
  return value as RootWrapV6
}
