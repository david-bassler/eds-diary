import { base64Url, concatBytes, equalBytes, fixedBase64Url, fromBase64Url, uint64be, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { hmacSha256, sha256 } from '../crypto/core'
import { deriveLocalStateMacKeyV2, signEd25519V2, verifyEd25519V2, writerKeyIdV2 } from './crypto'
import type { RemoteAnchorV2 } from './types'
import type { RecoveryCredentialHistoryEntryV2 } from './verifier'
import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { PreparedEnvelope } from '../envelopes'

export type EpochStatusV6='local_offline'|'remote_bound'|'active'|'offline_restored'|'retired'|'orphaned'
export type WriterStatusV2='writer_active'|'read_only'

export interface SecurityStateRefV2 {operation_id:string;state:string;state_record_hash:string}
export interface ActivationLineageCacheRefV2 {cache_id:string;cache_record_hash:string}
export interface RemoteBindingV2 {
  storage_provider_id:typeof GOOGLE_DRIVE_SHEETS_PROVIDER
  sync_profile:typeof SINGLE_WRITER_V2_PROFILE
  remote_resource_id:string
  remote_identity_binding:string
}

export interface EpochLocalSecurityStateV6 {
  local_state_version:6
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string|null
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
  recovery_takeover_key_id:string|null
  recovery_credential_history_sha256:string|null
  stale_writer_pending_count:number
}

export interface StoredWriterDeviceKeyV2 {
  writer_signing_key_id:string
  writer_device_id:string
  writer_public_key:string
  private_key:CryptoKey
}

const STATE_KEYS = [
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

function exactObject(value:unknown,keys:readonly string[],label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`)
  const record=value as Record<string,unknown>
  if(Object.keys(record).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} has unknown or missing properties.`)
  return record
}
function safe(value:unknown,min:number,label:string):number{
  if(!Number.isSafeInteger(value)||Number(value)<min)throw new Error(`${label} is invalid.`)
  return Number(value)
}
function nullableId(value:unknown,bytes:number,label:string):string|null{
  if(value===null)return null
  if(typeof value!=='string')throw new Error(`${label} is invalid.`)
  fixedBase64Url(value,bytes,label)
  return value
}
function stateRef(value:unknown,label:string):SecurityStateRefV2|null{
  if(value===null)return null
  const ref=exactObject(value,['operation_id','state','state_record_hash'],label)
  if(typeof ref.operation_id!=='string'||!ref.operation_id||typeof ref.state!=='string'||!ref.state)throw new Error(`${label} identity is invalid.`)
  if(typeof ref.state_record_hash!=='string')throw new Error(`${label}.state_record_hash is invalid.`)
  fixedBase64Url(ref.state_record_hash,32,`${label}.state_record_hash`)
  return value as SecurityStateRefV2
}
function anchor(value:unknown):RemoteAnchorV2|null{
  if(value===null)return null
  const a=exactObject(value,['anchor_profile','covered_row_count','prefix_hash'],'remote_anchor')
  if(a.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('remote_anchor profile mismatch.')
  safe(a.covered_row_count,0,'remote_anchor.covered_row_count')
  if(typeof a.prefix_hash!=='string')throw new Error('remote_anchor.prefix_hash is invalid.')
  fixedBase64Url(a.prefix_hash,32,'remote_anchor.prefix_hash')
  return value as RemoteAnchorV2
}

export function validateEpochLocalSecurityStateV6(value:unknown):EpochLocalSecurityStateV6{
  const state=exactObject(value,STATE_KEYS,'EpochLocalSecurityStateV6')
  if(state.local_state_version!==6)throw new Error('EpochLocalSecurityStateV6 version mismatch.')
  for(const [key,bytes] of [['diary_id',16],['epoch_id',16],['key_id',16],['manifest_fingerprint',32],['recovery_urs_commitment',32],['writer_device_id',16],['writer_signing_key_id',32],['local_journal_hash',32]] as const){
    if(typeof state[key]!=='string')throw new Error(`${key} is invalid.`)
    fixedBase64Url(state[key] as string,bytes,key)
  }
  safe(state.recovery_generation,0,'recovery_generation')
  safe(state.operation_generation,0,'operation_generation')
  safe(state.local_journal_count,0,'local_journal_count')
  safe(state.stale_writer_pending_count,0,'stale_writer_pending_count')
  nullableId(state.recovery_urs_id,32,'recovery_urs_id')
  nullableId(state.recovery_rekey_transition_id,32,'recovery_rekey_transition_id')
  nullableId(state.recovery_takeover_key_id,32,'recovery_takeover_key_id')
  nullableId(state.recovery_credential_history_sha256,32,'recovery_credential_history_sha256')
  if(typeof state.recovery_rekey_rotation_required!=='boolean')throw new Error('recovery_rekey_rotation_required is invalid.')
  if(state.recovery_rekey_rotation_required!==(state.recovery_rekey_transition_id!==null))throw new Error('Pending-Rekey state is inconsistent.')

  if(state.remote_binding!==null){
    const binding=exactObject(state.remote_binding,['storage_provider_id','sync_profile','remote_resource_id','remote_identity_binding'],'remote_binding')
    if(binding.storage_provider_id!==GOOGLE_DRIVE_SHEETS_PROVIDER||binding.sync_profile!==SINGLE_WRITER_V2_PROFILE||typeof binding.remote_resource_id!=='string'||!binding.remote_resource_id||typeof binding.remote_identity_binding!=='string'||!binding.remote_identity_binding)throw new Error('remote_binding is invalid.')
  }
  anchor(state.remote_anchor)
  if(!['local_offline','remote_bound','active','offline_restored','retired','orphaned'].includes(String(state.epoch_status)))throw new Error('epoch_status is invalid.')
  stateRef(state.rotation_state_ref,'rotation_state_ref')
  if(state.migration_state_ref!==null)throw new Error('migration_state_ref must be null in v2.')
  stateRef(state.writer_operation_state_ref,'writer_operation_state_ref')
  stateRef(state.recovery_operation_state_ref,'recovery_operation_state_ref')
  if(state.activation_lineage_cache_ref!==null){
    const ref=exactObject(state.activation_lineage_cache_ref,['cache_id','cache_record_hash'],'activation_lineage_cache_ref')
    if(typeof ref.cache_id!=='string'||!ref.cache_id||typeof ref.cache_record_hash!=='string')throw new Error('activation_lineage_cache_ref is invalid.')
    fixedBase64Url(ref.cache_record_hash,32,'activation_lineage_cache_ref.cache_record_hash')
  }

  if(state.writer_status!=='writer_active'&&state.writer_status!=='read_only')throw new Error('writer_status is invalid.')
  const verified=[state.verified_writer_device_id,state.verified_writer_key_id,state.verified_writer_generation,state.verified_writer_grant_id]
  const verifiedNull=verified.every((entry)=>entry===null)
  const verifiedSet=verified.every((entry)=>entry!==null)
  if(!verifiedNull&&!verifiedSet)throw new Error('Verified writer authority must be all-null or fully set.')
  if(verifiedSet){
    nullableId(state.verified_writer_device_id,16,'verified_writer_device_id')
    nullableId(state.verified_writer_key_id,32,'verified_writer_key_id')
    safe(state.verified_writer_generation,1,'verified_writer_generation')
    nullableId(state.verified_writer_grant_id,32,'verified_writer_grant_id')
    if(state.recovery_urs_id===null||state.recovery_takeover_key_id===null||state.recovery_credential_history_sha256===null)throw new Error('Bound Full Verify must persist current recovery freshness fields.')
  }
  if(state.epoch_status==='active'){
    if(state.remote_binding===null||state.remote_anchor===null||!verifiedSet)throw new Error('active EpochLocalSecurityStateV6 requires bound remote anchor and verified Writer authority.')
  }
  if(state.epoch_status!=='active'&&state.writer_status==='writer_active')throw new Error('Only an active epoch may be writer_active.')
  if(state.writer_status==='writer_active'){
    if(state.epoch_status!=='active')throw new Error('writer_active requires active epoch_status.')
    if(state.writer_generation===null||state.writer_grant_id===null)throw new Error('writer_active requires writer generation/grant.')
    safe(state.writer_generation,1,'writer_generation')
    nullableId(state.writer_grant_id,32,'writer_grant_id')
    if(!verifiedSet||state.writer_generation!==state.verified_writer_generation||state.writer_grant_id!==state.verified_writer_grant_id||state.writer_device_id!==state.verified_writer_device_id||state.writer_signing_key_id!==state.verified_writer_key_id)throw new Error('writer_active must exactly match verified remote authority.')
  }else if(state.writer_generation!==null||state.writer_grant_id!==null){
    throw new Error('read_only must not retain active writer generation/grant.')
  }
  if(state.epoch_status==='orphaned'&&state.writer_status!=='read_only')throw new Error('orphaned epochs are permanently read_only.')
  return value as EpochLocalSecurityStateV6
}

export async function recoveryCredentialHistoryHashV2(history:readonly RecoveryCredentialHistoryEntryV2[]):Promise<string>{
  return base64Url(await sha256(canonicalBytes(history as never)))
}

export async function localJournalInitialV2(diaryId:string,epochId:string):Promise<string>{
  return base64Url(await sha256(concatBytes(utf8('eds-diary/local-journal/v6'),new Uint8Array([0]),fixedBase64Url(diaryId,16),fixedBase64Url(epochId,16))))
}
export async function localJournalNextV2(previous:string,sequence:number,envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Promise<string>{
  if(!Number.isSafeInteger(sequence)||sequence<1)throw new Error('Local journal sequence is invalid.')
  const entry=await sha256(canonicalBytes([envelope.envelopeId,envelope.iv,envelope.ciphertext]))
  return base64Url(await sha256(concatBytes(fixedBase64Url(previous,32),uint64be(sequence),entry)))
}

export async function localStateTagV6(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6):Promise<string>{
  validateEpochLocalSecurityStateV6(state)
  return base64Url(await hmacSha256(await deriveLocalStateMacKeyV2(rootKey,epochSalt),canonicalBytes(state as never)))
}
export async function verifyLocalStateTagV6(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6,tag:string):Promise<void>{
  const expected=fromBase64Url(await localStateTagV6(rootKey,epochSalt,state))
  if(!equalBytes(fixedBase64Url(tag,32,'local_state_tag'),expected))throw new Error('EpochLocalSecurityStateV6 MAC failed.')
}

export function writerDeviceKeyCheckBytesV2(diaryId:string,epochId:string,writerDeviceId:string,rawPublicKey:Uint8Array):Uint8Array{
  if(rawPublicKey.byteLength!==32)throw new Error('Writer public key must contain exactly 32 bytes.')
  return concatBytes(
    utf8('eds-diary/writer-device-key-check/v2'),
    new Uint8Array([0]),
    fixedBase64Url(diaryId,16,'diary_id'),
    fixedBase64Url(epochId,16,'epoch_id'),
    fixedBase64Url(writerDeviceId,16,'writer_device_id'),
    rawPublicKey,
  )
}

export async function validateStoredWriterDeviceKeyV2(entry:StoredWriterDeviceKeyV2,diaryId:string,epochId:string):Promise<void>{
  const exact=exactObject(entry,['writer_signing_key_id','writer_device_id','writer_public_key','private_key'],'StoredWriterDeviceKeyV2')
  if(typeof exact.writer_signing_key_id!=='string'||typeof exact.writer_device_id!=='string'||typeof exact.writer_public_key!=='string')throw new Error('Stored writer-key identifiers are invalid.')
  fixedBase64Url(entry.writer_signing_key_id,32,'writer_signing_key_id')
  fixedBase64Url(entry.writer_device_id,16,'writer_device_id')
  const raw=fixedBase64Url(entry.writer_public_key,32,'writer_public_key')
  if(await writerKeyIdV2(raw)!==entry.writer_signing_key_id)throw new Error('Stored writer key ID does not match public key.')
  const key=entry.private_key
  if(!(key instanceof CryptoKey)||key.type!=='private'||key.extractable||key.algorithm.name!=='Ed25519'||key.usages.length!==1||key.usages[0]!=='sign')throw new Error('Stored writer private key is invalid.')
  const challenge=writerDeviceKeyCheckBytesV2(diaryId,epochId,entry.writer_device_id,raw)
  const signature=await signEd25519V2(key,challenge)
  if(!await verifyEd25519V2(raw,signature,challenge))throw new Error('Stored writer keypair binding failed.')
}


export async function withDiaryLockV2<T>(diaryId:string,operation:()=>Promise<T>):Promise<T>{
  const manager=globalThis.navigator?.locks
  if(!manager){
    if(typeof window!=='undefined')throw new Error('Web Locks are required for secure v2 mutations.')
    return operation()
  }
  return manager.request(`eds-diary/security/${diaryId}`,{mode:'exclusive'},operation)
}
