import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { RemoteAnchorV2 } from './types'
import { base64Url, concatBytes, fixedBase64Url, uint64be, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { hmacSha256, sha256 } from '../crypto/core'
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
  id(ref.cache_id,32,'activation_lineage_cache_ref.cache_id')
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
  if(state.writer_status==='read_only'){
    if(generation!==null||grantId!==null)throw new Error('read_only state must not carry current writer generation/grant.')
  }else{
    if(state.epoch_status!=='active')throw new Error('writer_active requires epoch_status=active.')
    if(generation===null||grantId===null||verifiedDevice===null||verifiedKey===null||verifiedGeneration===null||verifiedGrant===null)throw new Error('writer_active requires a fully verified writer authority.')
    if(state.writer_device_id!==verifiedDevice||state.writer_signing_key_id!==verifiedKey||generation!==verifiedGeneration||grantId!==verifiedGrant)throw new Error('writer_active local authority does not match verified authority.')
  }
  if(state.epoch_status==='orphaned'&&state.writer_status!=='read_only')throw new Error('orphaned epochs must be read_only.')
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
  const entryHash=await sha256(canonicalBytes(row as string[]))
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
