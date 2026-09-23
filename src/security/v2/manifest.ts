import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes, sha256 } from '../crypto/core'
import { deriveManifestKeyV2, recoveryTakeoverKeyIdV2, writerKeyIdV2 } from './crypto'
import { V2_SCHEMA_REGISTRY_HASH, schemaRegistryHashV2 } from './schemaRegistry'
import { SINGLE_WRITER_V2_SCHEMA_ALLOWLIST } from './types'
import type { VerifiedManifestTrustRootV2 } from './verifier'

export interface ManifestContextV6 {diaryId:string;epochId:string}
export interface ManifestCellsV6 {
  format:'sync-v6'
  version:'6'
  manifestIv:string
  manifestCiphertext:string
}
export interface RecoveryCredentialHistoryEntryV6 {
  recovery_generation:number
  recovery_urs_id:string
  recovery_takeover_key_id:string
}
export interface ProtectedManifestV6 {
  diary_id:string
  epoch_id:string
  key_id:string
  creation_locator:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_credential_history:RecoveryCredentialHistoryEntryV6[]
  diary_marker:'epoch-manifest-v6'
  crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6'
  sync_profile:typeof SINGLE_WRITER_V2_PROFILE
  created_at:string
  google_account_binding:string
  predecessor_epochs:Array<{epoch_id:string;manifest_fingerprint:string}>
  record_schema_allowlist:string[]
  record_schema_registry_hash:string
  protocol_limits:{
    max_payload_bytes:16380
    padding_buckets:[1024,2048,4096,8192,16384]
    max_unique_envelopes:100000
    max_unique_canonical_bytes:134217728
    max_remote_physical_rows:100000
    max_remote_physical_canonical_bytes:134217728
    max_canonical_row_bytes:21936
    max_activation_lineage_entries:128
    max_recovery_credential_history_entries:128
    max_recovery_artifact_ciphertext_bytes:1048576
    recovery_grid_chunk_chars:32000
    max_recovery_grid_chunks:44
  }
  epoch_start_authority_mode:'genesis_grant_required'|'carried_from_predecessor'
  epoch_start_writer_generation:number
  epoch_start_writer_grant_id:string
  epoch_start_writer_device_id:string
  epoch_start_writer_key_id:string
  epoch_start_writer_public_key:string
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
}

export const V6_PROTOCOL_LIMITS:ProtectedManifestV6['protocol_limits']={
  max_payload_bytes:16380,
  padding_buckets:[1024,2048,4096,8192,16384],
  max_unique_envelopes:100000,
  max_unique_canonical_bytes:134217728,
  max_remote_physical_rows:100000,
  max_remote_physical_canonical_bytes:134217728,
  max_canonical_row_bytes:21936,
  max_activation_lineage_entries:128,
  max_recovery_credential_history_entries:128,
  max_recovery_artifact_ciphertext_bytes:1048576,
  recovery_grid_chunk_chars:32000,
  max_recovery_grid_chunks:44,
}

const MANIFEST_KEYS=[
  'diary_id','epoch_id','key_id','creation_locator','recovery_generation',
  'recovery_urs_commitment','recovery_urs_id','recovery_credential_history',
  'diary_marker','crypto_suite','sync_profile','created_at','google_account_binding',
  'predecessor_epochs','record_schema_allowlist','record_schema_registry_hash',
  'protocol_limits','epoch_start_authority_mode','epoch_start_writer_generation',
  'epoch_start_writer_grant_id','epoch_start_writer_device_id','epoch_start_writer_key_id',
  'epoch_start_writer_public_key','recovery_takeover_key_id','recovery_takeover_public_key',
] as const

function exactKeys(value:object,expected:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...expected].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function validTimestamp(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false
  try{return new Date(value).toISOString()===value}catch{return false}
}
function equalCanonical(left:unknown,right:unknown):boolean{
  return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))
}
function aad(context:ManifestContextV6):Uint8Array{
  return canonicalBytes({
    format:'sync-v6',
    protocol_version:6,
    sync_profile:SINGLE_WRITER_V2_PROFILE,
    diary_id:context.diaryId,
    epoch_id:context.epochId,
  })
}

export async function validateProtectedManifestV6(payload:ProtectedManifestV6,context:ManifestContextV6):Promise<void>{
  if(!payload||typeof payload!=='object')throw new Error('ManifestV6 schema mismatch.')
  exactKeys(payload,MANIFEST_KEYS,'ManifestV6')
  fixedBase64Url(context.diaryId,16,'diary_id');fixedBase64Url(context.epochId,16,'epoch_id')
  if(payload.diary_id!==context.diaryId||payload.epoch_id!==context.epochId)throw new Error('ManifestV6 context mismatch.')
  if(payload.diary_marker!=='epoch-manifest-v6'||payload.crypto_suite!=='A256GCM-HKDF-SHA256-ED25519-v6'||payload.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('ManifestV6 profile mismatch.')
  fixedBase64Url(payload.key_id,16,'key_id')
  fixedBase64Url(payload.creation_locator,16,'creation_locator')
  fixedBase64Url(payload.recovery_urs_commitment,32,'recovery_urs_commitment')
  fixedBase64Url(payload.recovery_urs_id,32,'recovery_urs_id')
  fixedBase64Url(payload.google_account_binding,32,'google_account_binding')
  fixedBase64Url(payload.record_schema_registry_hash,32,'record_schema_registry_hash')
  fixedBase64Url(payload.epoch_start_writer_grant_id,32,'epoch_start_writer_grant_id')
  fixedBase64Url(payload.epoch_start_writer_device_id,16,'epoch_start_writer_device_id')
  const writerPublic=fixedBase64Url(payload.epoch_start_writer_public_key,32,'epoch_start_writer_public_key')
  fixedBase64Url(payload.epoch_start_writer_key_id,32,'epoch_start_writer_key_id')
  const takeoverPublic=fixedBase64Url(payload.recovery_takeover_public_key,32,'recovery_takeover_public_key')
  fixedBase64Url(payload.recovery_takeover_key_id,32,'recovery_takeover_key_id')
  if(await writerKeyIdV2(writerPublic)!==payload.epoch_start_writer_key_id)throw new Error('ManifestV6 Writer key binding mismatch.')
  if(await recoveryTakeoverKeyIdV2(takeoverPublic)!==payload.recovery_takeover_key_id)throw new Error('ManifestV6 Recovery takeover key binding mismatch.')
  if(!Number.isSafeInteger(payload.recovery_generation)||payload.recovery_generation<0)throw new Error('ManifestV6 recovery generation mismatch.')
  if(!Number.isSafeInteger(payload.epoch_start_writer_generation)||payload.epoch_start_writer_generation<1)throw new Error('ManifestV6 Writer generation mismatch.')
  if(!validTimestamp(payload.created_at))throw new Error('ManifestV6 created_at is not canonical.')
  if(!Array.isArray(payload.record_schema_allowlist)||payload.record_schema_allowlist.join('\0')!==SINGLE_WRITER_V2_SCHEMA_ALLOWLIST.join('\0'))throw new Error('ManifestV6 schema allowlist mismatch.')
  if(payload.record_schema_registry_hash!==V2_SCHEMA_REGISTRY_HASH||payload.record_schema_registry_hash!==await schemaRegistryHashV2())throw new Error('ManifestV6 schema registry hash mismatch.')
  if(!equalCanonical(payload.protocol_limits,V6_PROTOCOL_LIMITS))throw new Error('ManifestV6 protocol limits mismatch.')
  if(!Array.isArray(payload.predecessor_epochs)||payload.predecessor_epochs.length>1)throw new Error('ManifestV6 predecessor mismatch.')
  for(const predecessor of payload.predecessor_epochs){
    if(!predecessor||typeof predecessor!=='object')throw new Error('ManifestV6 predecessor schema mismatch.')
    exactKeys(predecessor,['epoch_id','manifest_fingerprint'],'ManifestV6 predecessor')
    fixedBase64Url(predecessor.epoch_id,16,'predecessor_epoch_id')
    fixedBase64Url(predecessor.manifest_fingerprint,32,'predecessor_manifest_fingerprint')
  }
  if(payload.predecessor_epochs.length===0&&payload.epoch_start_authority_mode!=='genesis_grant_required')throw new Error('ManifestV6 native genesis authority mode mismatch.')
  if(payload.epoch_start_authority_mode==='carried_from_predecessor'&&payload.predecessor_epochs.length!==1)throw new Error('ManifestV6 carried authority requires one predecessor.')
  if(payload.epoch_start_authority_mode==='genesis_grant_required'&&payload.epoch_start_writer_generation!==1)throw new Error('ManifestV6 genesis Writer generation must be one.')
  if(!Array.isArray(payload.recovery_credential_history)||payload.recovery_credential_history.length<1||payload.recovery_credential_history.length>128)throw new Error('ManifestV6 recovery credential history bound mismatch.')
  const ursIds=new Set<string>(),takeoverIds=new Set<string>()
  let priorGeneration=-1
  for(const entry of payload.recovery_credential_history){
    if(!entry||typeof entry!=='object')throw new Error('ManifestV6 recovery credential history schema mismatch.')
    exactKeys(entry,['recovery_generation','recovery_urs_id','recovery_takeover_key_id'],'ManifestV6 recovery credential history entry')
    if(!Number.isSafeInteger(entry.recovery_generation)||entry.recovery_generation<0||entry.recovery_generation<=priorGeneration)throw new Error('ManifestV6 recovery credential history ordering mismatch.')
    fixedBase64Url(entry.recovery_urs_id,32,'recovery_history_urs_id')
    fixedBase64Url(entry.recovery_takeover_key_id,32,'recovery_history_takeover_key_id')
    if(ursIds.has(entry.recovery_urs_id)||takeoverIds.has(entry.recovery_takeover_key_id))throw new Error('ManifestV6 recovery credential history reuse.')
    ursIds.add(entry.recovery_urs_id);takeoverIds.add(entry.recovery_takeover_key_id);priorGeneration=entry.recovery_generation
  }
  const last=payload.recovery_credential_history.at(-1)!
  if(last.recovery_generation!==payload.recovery_generation||last.recovery_urs_id!==payload.recovery_urs_id||last.recovery_takeover_key_id!==payload.recovery_takeover_key_id)throw new Error('ManifestV6 recovery credential history tail mismatch.')
}

export function parseManifestCellsV6(cells:readonly string[]):ManifestCellsV6{
  if(cells.length!==4||cells[0]!=='sync-v6'||cells[1]!=='6')throw new Error('Invalid ManifestV6 header.')
  fixedBase64Url(cells[2]!,12,'manifest_iv')
  const ciphertext=fromBase64Url(cells[3]!)
  if(ciphertext.byteLength<16||ciphertext.byteLength>65_536)throw new Error('ManifestV6 ciphertext length is invalid.')
  return{format:'sync-v6',version:'6',manifestIv:cells[2]!,manifestCiphertext:cells[3]!}
}
export function manifestCellsArrayV6(cells:ManifestCellsV6):readonly[string,string,string,string]{
  parseManifestCellsV6([cells.format,cells.version,cells.manifestIv,cells.manifestCiphertext])
  return[cells.format,cells.version,cells.manifestIv,cells.manifestCiphertext]
}
export async function prepareManifestV6(
  rootKey:Uint8Array,
  epochSalt:Uint8Array,
  context:ManifestContextV6,
  payload:ProtectedManifestV6,
  iv=randomBytes(12),
):Promise<ManifestCellsV6>{
  await validateProtectedManifestV6(payload,context)
  const encrypted=await aesGcmEncrypt(await deriveManifestKeyV2(rootKey,epochSalt),canonicalBytes(payload as never),aad(context),iv)
  return{format:'sync-v6',version:'6',manifestIv:base64Url(encrypted.iv),manifestCiphertext:base64Url(encrypted.ciphertext)}
}
export async function openManifestV6(
  rootKey:Uint8Array,
  epochSalt:Uint8Array,
  context:ManifestContextV6,
  cells:ManifestCellsV6,
):Promise<ProtectedManifestV6>{
  parseManifestCellsV6(manifestCellsArrayV6(cells))
  const plain=await aesGcmDecrypt(
    await deriveManifestKeyV2(rootKey,epochSalt),
    fromBase64Url(cells.manifestCiphertext),
    aad(context),
    fixedBase64Url(cells.manifestIv,12,'manifest_iv'),
  )
  const payload=parseCanonicalJson(plain) as unknown as ProtectedManifestV6
  await validateProtectedManifestV6(payload,context)
  return payload
}
export async function manifestFingerprintV6(cells:ManifestCellsV6):Promise<string>{
  parseManifestCellsV6(manifestCellsArrayV6(cells))
  return base64Url(await sha256(canonicalBytes({
    format:'sync-v6',
    protocol_version:6,
    manifest_iv:cells.manifestIv,
    manifest_ciphertext:cells.manifestCiphertext,
  })))
}
export async function manifestTrustRootV6(cells:ManifestCellsV6,payload:ProtectedManifestV6):Promise<VerifiedManifestTrustRootV2>{
  await validateProtectedManifestV6(payload,{diaryId:payload.diary_id,epochId:payload.epoch_id})
  return{
    diary_id:payload.diary_id,
    epoch_id:payload.epoch_id,
    manifest_fingerprint:await manifestFingerprintV6(cells),
    predecessor_epochs:payload.predecessor_epochs.map(value=>({...value})),
    epoch_start_authority_mode:payload.epoch_start_authority_mode,
    epoch_start_writer_generation:payload.epoch_start_writer_generation,
    epoch_start_writer_grant_id:payload.epoch_start_writer_grant_id,
    epoch_start_writer_device_id:payload.epoch_start_writer_device_id,
    epoch_start_writer_key_id:payload.epoch_start_writer_key_id,
    epoch_start_writer_public_key:payload.epoch_start_writer_public_key,
    recovery_generation:payload.recovery_generation,
    recovery_urs_commitment:payload.recovery_urs_commitment,
    recovery_urs_id:payload.recovery_urs_id,
    recovery_credential_history:payload.recovery_credential_history.map(value=>({...value})),
    recovery_takeover_key_id:payload.recovery_takeover_key_id,
    recovery_takeover_public_key:payload.recovery_takeover_public_key,
  }
}
