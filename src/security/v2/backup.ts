import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes, sha256 } from '../crypto/core'
import { deriveBackupKeyV2 } from './crypto'
import { createAnchorV2 } from './prefix'
import { manifestFingerprintV6, manifestTrustRootV6, openManifestV6, parseManifestCellsV6, type ProtectedManifestV6 } from './manifest'
import { openRecoveryArtifactV6, recoveryArtifactHashV6, type PreparedEnvelopeRowV2, type RecoveryArtifactV6, type RecoveryPayloadV6 } from './recovery'
import { openRevisionEnvelopeV2, V2_PADDING_BUCKETS } from './envelopes'
import { TransferableSingleWriterV2Verifier, type CanonicalFullResultV2 } from './verifier'
import type { RemoteAnchorV2 } from './types'

export const MAX_BACKUP_V6_BYTES=256*1024*1024
export const MAX_BACKUP_V6_UNION_COUNT=100_000
export const MAX_BACKUP_V6_CANONICAL_BYTES=134_217_728
type Row=readonly[string,string,string]

export interface BackupWriterAuthorityV6 {
  writer_generation:number
  writer_grant_id:string
  writer_device_id:string
  writer_key_id:string
  writer_public_key:string
}
export interface BackupManifestV6 {
  backup_id:string
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
  remote_anchor_at_export:RemoteAnchorV2
  writer_authority_at_export:BackupWriterAuthorityV6
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
  recovery_credential_history_sha256:string
  recovery_rekey_rotation_required:boolean
  recovery_rekey_transition_id:string|null
  activation_lineage_sha256:string
  recovery_authority_transition_proof_sha256:string|null
  activation_state:'staged'|'activated'
  recovery_artifact_sha256:string
  record_row_count:number
  record_rows_canonical_bytes:number
  record_prefix_hash:string
  epoch_manifest_public_sha256:string
  record_rows_jcs_sha256:string
  pending_outbox_count:number
  pending_outbox_rows_canonical_bytes:number
  pending_outbox_rows_jcs_sha256:string
  stale_writer_pending_count:number
  stale_writer_pending_rows_canonical_bytes:number
  stale_writer_pending_rows_jcs_sha256:string
  unique_union_count:number
  unique_union_canonical_bytes:number
  created_at:string
}
export interface SyncBackupV6 {
  format:'sync-backup-v6'
  backup_format_version:6
  backup_id:string
  backup_manifest_iv:string
  backup_manifest_ciphertext:string
  epoch_manifest_public:readonly[string,string,string,string]
  recovery_artifact:RecoveryArtifactV6
  record_rows:readonly Row[]
  pending_outbox_rows:readonly Row[]
  stale_writer_pending_rows:readonly Row[]
}
export interface BackupContextV6 {
  rootKey:Uint8Array
  epochSalt:Uint8Array
  urs:Uint8Array
  diaryId:string
  epochId:string
  keyId:string
  epochManifestPublic:readonly[string,string,string,string]
  canonical:CanonicalFullResultV2
  recoveryArtifact:RecoveryArtifactV6
  recordRows:readonly Row[]
  pendingOutboxRows:readonly Row[]
  staleWriterPendingRows:readonly Row[]
  activationState:'staged'|'activated'
  createdAt:string
}
export interface BackupRestoreResultV6 {
  canonical:CanonicalFullResultV2
  activation_state:'staged'|'activated'
  access:'read_only'
  pending_outbox_rows:readonly Row[]
  stale_writer_pending_rows:readonly Row[]
}

const BACKUP_KEYS=['format','backup_format_version','backup_id','backup_manifest_iv','backup_manifest_ciphertext','epoch_manifest_public','recovery_artifact','record_rows','pending_outbox_rows','stale_writer_pending_rows'] as const
const MANIFEST_KEYS=[
  'backup_id','diary_id','epoch_id','key_id','manifest_fingerprint','remote_anchor_at_export',
  'writer_authority_at_export','recovery_generation','recovery_urs_commitment','recovery_urs_id',
  'recovery_takeover_key_id','recovery_takeover_public_key','recovery_credential_history_sha256',
  'recovery_rekey_rotation_required','recovery_rekey_transition_id','activation_lineage_sha256',
  'recovery_authority_transition_proof_sha256','activation_state','recovery_artifact_sha256',
  'record_row_count','record_rows_canonical_bytes','record_prefix_hash','epoch_manifest_public_sha256',
  'record_rows_jcs_sha256','pending_outbox_count','pending_outbox_rows_canonical_bytes',
  'pending_outbox_rows_jcs_sha256','stale_writer_pending_count','stale_writer_pending_rows_canonical_bytes',
  'stale_writer_pending_rows_jcs_sha256','unique_union_count','unique_union_canonical_bytes','created_at',
] as const
const WRITER_KEYS=['writer_generation','writer_grant_id','writer_device_id','writer_key_id','writer_public_key'] as const

function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function validTimestamp(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false
  try{return new Date(value).toISOString()===value}catch{return false}
}
function backupAad(id:string):Uint8Array{return canonicalBytes({format:'sync-backup-v6',backup_format_version:6,backup_id:id})}
async function digest(value:unknown):Promise<string>{return base64Url(await sha256(canonicalBytes(value as never)))}
function canonicalEqual(left:unknown,right:unknown):boolean{return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))}
function rowBytes(rows:readonly Row[]):number{return rows.reduce((sum,row)=>sum+canonicalBytes([...row]).byteLength,0)}
function validateRow(row:readonly string[],label:string):asserts row is Row{
  if(row.length!==3||row.some(cell=>typeof cell!=='string'||cell.length===0))throw new Error(`${label} row schema mismatch.`)
  if(row[0]!.length+row[1]!.length+row[2]!.length+10>21_936)throw new Error(`${label} canonical row bound exceeded.`)
  fixedBase64Url(row[0]!,32);fixedBase64Url(row[1]!,12)
  const bucket=fromBase64Url(row[2]!).byteLength-16
  if(!V2_PADDING_BUCKETS.includes(bucket as (typeof V2_PADDING_BUCKETS)[number]))throw new Error(`${label} ciphertext bucket mismatch.`)
  if(canonicalBytes([...row]).byteLength>21_936)throw new Error(`${label} canonical row bound exceeded.`)
}
function validateRows(value:unknown,label:string):asserts value is readonly Row[]{
  if(!Array.isArray(value)||value.length>MAX_BACKUP_V6_UNION_COUNT)throw new Error(`${label} count bound exceeded.`)
  for(const row of value){if(!Array.isArray(row))throw new Error(`${label} row schema mismatch.`);validateRow(row,label)}
}
function unionStats(groups:readonly (readonly Row[])[]):{count:number;bytes:number}{
  const byId=new Map<string,string>(),rows=new Map<string,Row>()
  for(const group of groups)for(const row of group){
    const encoded=JSON.stringify(row),prior=byId.get(row[0])
    if(prior!==undefined&&prior!==encoded)throw new Error('Duplicate envelope_id has different bytes.')
    byId.set(row[0],encoded);rows.set(row[0],row)
  }
  const bytes=[...rows.values()].reduce((sum,row)=>sum+canonicalBytes([...row]).byteLength,0)
  if(rows.size>MAX_BACKUP_V6_UNION_COUNT||bytes>MAX_BACKUP_V6_CANONICAL_BYTES)throw new Error('BackupV6 unique union bound exceeded.')
  return{count:rows.size,bytes}
}
function sameWriter(result:CanonicalFullResultV2,writer:BackupWriterAuthorityV6):boolean{
  const current=result.current_writer
  return current.writer_generation===writer.writer_generation&&current.writer_grant_id===writer.writer_grant_id&&current.writer_device_id===writer.writer_device_id&&current.writer_key_id===writer.writer_key_id&&current.writer_public_key===writer.writer_public_key
}

const STALE_DISPOSITIONS=new Set([
  'stale_writer_rejected',
  'stale_grant_rejected',
  'stale_recovery_transition_rejected',
  'stale_rotation_announcement_rejected',
  'rekey_rotation_required_rejected',
  'stale_after_seal_rejected',
])
function lineageLeaf(payload:RecoveryPayloadV6):{staging:RemoteAnchorV2;confirmation:PreparedEnvelopeRowV2}|null{
  const entry=payload.activation_lineage.at(-1)
  if(!entry)return null
  return entry.kind==='profile_upgrade'
    ?{staging:entry.successor_staging_anchor,confirmation:entry.successor_confirmation_envelope}
    :{staging:entry.proof.successor_staging_anchor,confirmation:entry.proof.successor_confirmation_envelope}
}
function sameRow(left:readonly string[],right:PreparedEnvelopeRowV2):boolean{
  return left.length===3&&left[0]===right.envelope_id&&left[1]===right.iv&&left[2]===right.ciphertext
}
async function validateBackupActivationBoundary(
  manifest:ProtectedManifestV6,
  artifact:RecoveryPayloadV6,
  canonical:CanonicalFullResultV2,
  rows:readonly Row[],
  activationState:'staged'|'activated',
):Promise<void>{
  const nonNative=manifest.predecessor_epochs.length===1
  const leaf=lineageLeaf(artifact)
  if(!nonNative){
    if(artifact.activation_lineage.length!==0)throw new Error('Native BackupV6 must not contain ActivationLineageV2.')
    if(activationState!=='activated'||canonical.activation_state!=='native_active')throw new Error('Native BackupV6 activation state mismatch.')
    return
  }
  if(!leaf)throw new Error('Non-native BackupV6 requires ActivationLineageV2.')
  if(!canonicalEqual(artifact.remote_anchor,leaf.staging))throw new Error('RecoveryArtifactV6 anchor must equal the Successor staging anchor.')
  if(activationState==='staged'){
    if(!canonicalEqual(canonical.remote_anchor,leaf.staging)||canonical.accepted_activation_confirmation!==null||canonical.activation_state!=='staged_confirmation_missing')throw new Error('Staged BackupV6 does not end exactly at the Successor staging anchor.')
    return
  }
  if(canonical.accepted_activation_confirmation===null||canonical.activation_state!=='cross_epoch_evidence_present')throw new Error('Activated BackupV6 is missing canonical SuccessorActivationConfirmationV2 evidence.')
  const firstAfterStaging=rows[leaf.staging.covered_row_count]
  if(!firstAfterStaging||!sameRow(firstAfterStaging,leaf.confirmation))throw new Error('Activated BackupV6 does not contain the prepared Confirmation immediately after staging.')
  let activationCount=leaf.staging.covered_row_count+1
  while(activationCount<rows.length&&sameRow(rows[activationCount]!,leaf.confirmation))activationCount+=1
  const activationAnchor=await createAnchorV2(manifest.diary_id,manifest.epoch_id,rows.slice(0,activationCount))
  if(canonical.remote_anchor.covered_row_count<activationAnchor.covered_row_count)throw new Error('Activated BackupV6 remote prefix does not cover its activation anchor.')
}

async function verifyBackupLocalRows(
  rootKey:Uint8Array,
  trustRoot:Awaited<ReturnType<typeof manifestTrustRootV6>>,
  recordRows:readonly Row[],
  pendingRows:readonly Row[],
  staleRows:readonly Row[],
):Promise<void>{
  const verifier=new TransferableSingleWriterV2Verifier()
  const remoteById=new Map<string,string>()
  for(const row of recordRows)remoteById.set(row[0],JSON.stringify(row))
  for(const row of pendingRows){
    if(remoteById.has(row[0]))throw new Error('BackupV6 pending row is already present in the remote record set.')
    const result=await verifier.verifyCanonicalFull(trustRoot,rootKey,[...recordRows,row])
    const disposition=result.dispositions.at(-1)?.disposition
    if(disposition!=='accepted')throw new Error('BackupV6 pending row is not valid under current Writer authority.')
  }
  for(const row of staleRows){
    const remote=remoteById.get(row[0])
    if(remote!==undefined){
      if(remote!==JSON.stringify(row))throw new Error('Duplicate envelope_id has different bytes.')
      const remoteResult=await verifier.verifyCanonicalFull(trustRoot,rootKey,recordRows)
      const disposition=remoteResult.dispositions.find(item=>item.envelope_id===row[0])?.disposition
      if(!disposition||!STALE_DISPOSITIONS.has(disposition))throw new Error('BackupV6 stale row is not quarantined by canonical remote semantics.')
      continue
    }
    const result=await verifier.verifyCanonicalFull(trustRoot,rootKey,[...recordRows,row])
    const disposition=result.dispositions.at(-1)?.disposition
    if(!disposition||!STALE_DISPOSITIONS.has(disposition))throw new Error('BackupV6 stale row is not a valid stale/quarantined v2 envelope.')
  }
}

async function buildManifest(context:BackupContextV6,backupId:string):Promise<BackupManifestV6>{
  if(context.canonical.diary_id!==context.diaryId||context.canonical.epoch_id!==context.epochId)throw new Error('BackupV6 canonical identity mismatch.')
  const manifestCells=parseManifestCellsV6(context.epochManifestPublic),fingerprint=await manifestFingerprintV6(manifestCells)
  if(fingerprint!==context.canonical.manifest_fingerprint)throw new Error('BackupV6 manifest fingerprint mismatch.')
  const manifestPayload=await openManifestV6(context.rootKey,context.epochSalt,{diaryId:context.diaryId,epochId:context.epochId},manifestCells)
  if(manifestPayload.key_id!==context.keyId)throw new Error('BackupV6 key binding mismatch.')
  const trustRoot=await manifestTrustRootV6(manifestCells,manifestPayload)
  const canonical=await new TransferableSingleWriterV2Verifier().verifyCanonicalFull(trustRoot,context.rootKey,context.recordRows)
  if(!canonicalEqual(canonical.remote_anchor,context.canonical.remote_anchor)
    ||!sameWriter(canonical,{
      writer_generation:context.canonical.current_writer.writer_generation,
      writer_grant_id:context.canonical.current_writer.writer_grant_id,
      writer_device_id:context.canonical.current_writer.writer_device_id,
      writer_key_id:context.canonical.current_writer.writer_key_id,
      writer_public_key:context.canonical.current_writer.writer_public_key,
    })
    ||!canonicalEqual(canonical.current_recovery,context.canonical.current_recovery)
    ||!canonicalEqual(canonical.recovery_credential_history,context.canonical.recovery_credential_history))throw new Error('BackupV6 supplied canonical state does not match record_rows replay.')
  await verifyBackupLocalRows(context.rootKey,trustRoot,context.recordRows,context.pendingOutboxRows,context.staleWriterPendingRows)
  const artifact=(await openRecoveryArtifactV6(context.recoveryArtifact,context.urs)).payload
  await validateBackupActivationBoundary(manifestPayload,artifact,canonical,context.recordRows,context.activationState)
  if(artifact.diary_id!==context.diaryId||artifact.epoch_id!==context.epochId||artifact.key_id!==context.keyId||artifact.RK_epoch!==base64Url(context.rootKey)||artifact.manifest_fingerprint!==fingerprint||artifact.google_account_binding!==manifestPayload.google_account_binding)throw new Error('BackupV6 recovery artifact binding mismatch.')
  const artifactAdvancedRecovery=artifact.recovery_generation>manifestPayload.recovery_generation
  if(artifact.recovery_generation<manifestPayload.recovery_generation
    ||artifactAdvancedRecovery!==(artifact.recovery_authority_transition_proof!==null))throw new Error('BackupV6 RecoveryArtifactV6 transition-proof requirement mismatch.')
  const recovery=canonical.current_recovery
  if(artifact.recovery_generation!==recovery.recovery_generation||artifact.recovery_urs_commitment!==recovery.recovery_urs_commitment||artifact.recovery_urs_id!==recovery.recovery_urs_id||artifact.recovery_takeover_key_id!==recovery.recovery_takeover_key_id||artifact.recovery_takeover_public_key!==recovery.recovery_takeover_public_key)throw new Error('BackupV6 recovery end-state mismatch.')
  if(!canonicalEqual(artifact.recovery_credential_history,canonical.recovery_credential_history))throw new Error('BackupV6 recovery credential history mismatch.')
  const anchor=await createAnchorV2(context.diaryId,context.epochId,context.recordRows)
  if(anchor.prefix_hash!==canonical.remote_anchor.prefix_hash||anchor.covered_row_count!==canonical.remote_anchor.covered_row_count)throw new Error('BackupV6 canonical anchor mismatch.')
  if(artifact.remote_anchor.covered_row_count>context.recordRows.length)throw new Error('BackupV6 recovery artifact anchor is ahead of export.')
  const artifactAnchor=await createAnchorV2(context.diaryId,context.epochId,context.recordRows.slice(0,artifact.remote_anchor.covered_row_count))
  if(!canonicalEqual(artifact.remote_anchor,artifactAnchor))throw new Error('BackupV6 recovery artifact anchor is not a prefix of export.')
  const recordBytes=rowBytes(context.recordRows),pendingBytes=rowBytes(context.pendingOutboxRows),staleBytes=rowBytes(context.staleWriterPendingRows)
  if(recordBytes>MAX_BACKUP_V6_CANONICAL_BYTES||pendingBytes>MAX_BACKUP_V6_CANONICAL_BYTES||staleBytes>MAX_BACKUP_V6_CANONICAL_BYTES)throw new Error('BackupV6 category byte bound exceeded.')
  const union=unionStats([context.recordRows,context.pendingOutboxRows,context.staleWriterPendingRows])
  const writer:BackupWriterAuthorityV6={
    writer_generation:canonical.current_writer.writer_generation,
    writer_grant_id:canonical.current_writer.writer_grant_id,
    writer_device_id:canonical.current_writer.writer_device_id,
    writer_key_id:canonical.current_writer.writer_key_id,
    writer_public_key:canonical.current_writer.writer_public_key,
  }
  return{
    backup_id:backupId,diary_id:context.diaryId,epoch_id:context.epochId,key_id:context.keyId,manifest_fingerprint:fingerprint,
    remote_anchor_at_export:anchor,writer_authority_at_export:writer,
    recovery_generation:recovery.recovery_generation,recovery_urs_commitment:recovery.recovery_urs_commitment,recovery_urs_id:recovery.recovery_urs_id,
    recovery_takeover_key_id:recovery.recovery_takeover_key_id,recovery_takeover_public_key:recovery.recovery_takeover_public_key,
    recovery_credential_history_sha256:await digest(artifact.recovery_credential_history),
    recovery_rekey_rotation_required:recovery.recovery_rekey_rotation_required,recovery_rekey_transition_id:recovery.recovery_rekey_transition_id,
    activation_lineage_sha256:await digest(artifact.activation_lineage),
    recovery_authority_transition_proof_sha256:artifact.recovery_authority_transition_proof===null?null:await digest(artifact.recovery_authority_transition_proof),
    activation_state:context.activationState,recovery_artifact_sha256:await recoveryArtifactHashV6(context.recoveryArtifact),
    record_row_count:context.recordRows.length,record_rows_canonical_bytes:recordBytes,record_prefix_hash:anchor.prefix_hash,
    epoch_manifest_public_sha256:await digest(context.epochManifestPublic),record_rows_jcs_sha256:await digest(context.recordRows),
    pending_outbox_count:context.pendingOutboxRows.length,pending_outbox_rows_canonical_bytes:pendingBytes,pending_outbox_rows_jcs_sha256:await digest(context.pendingOutboxRows),
    stale_writer_pending_count:context.staleWriterPendingRows.length,stale_writer_pending_rows_canonical_bytes:staleBytes,stale_writer_pending_rows_jcs_sha256:await digest(context.staleWriterPendingRows),
    unique_union_count:union.count,unique_union_canonical_bytes:union.bytes,created_at:context.createdAt,
  }
}

export async function createBackupV6(context:BackupContextV6,id=randomBytes(32),iv=randomBytes(12)):Promise<SyncBackupV6>{
  if(!validTimestamp(context.createdAt))throw new Error('BackupV6 created_at is not canonical.')
  validateRows(context.recordRows,'record_rows');validateRows(context.pendingOutboxRows,'pending_outbox_rows');validateRows(context.staleWriterPendingRows,'stale_writer_pending_rows')
  const backup_id=base64Url(id),manifest=await buildManifest(context,backup_id)
  const encrypted=await aesGcmEncrypt(await deriveBackupKeyV2(context.rootKey,context.epochSalt,id),canonicalBytes(manifest as never),backupAad(backup_id),iv)
  const backup:SyncBackupV6={
    format:'sync-backup-v6',backup_format_version:6,backup_id,
    backup_manifest_iv:base64Url(encrypted.iv),backup_manifest_ciphertext:base64Url(encrypted.ciphertext),
    epoch_manifest_public:[...context.epochManifestPublic] as [string,string,string,string],
    recovery_artifact:structuredClone(context.recoveryArtifact),
    record_rows:context.recordRows.map(row=>[...row] as Row),
    pending_outbox_rows:context.pendingOutboxRows.map(row=>[...row] as Row),
    stale_writer_pending_rows:context.staleWriterPendingRows.map(row=>[...row] as Row),
  }
  if(canonicalBytes(backup as never).byteLength>MAX_BACKUP_V6_BYTES)throw new Error('BackupV6 document size bound exceeded.')
  return backup
}

function validateBackupManifestV6(manifest:BackupManifestV6):void{
  if(!manifest||typeof manifest!=='object')throw new Error('BackupV6 manifest schema mismatch.')
  exact(manifest,MANIFEST_KEYS,'BackupV6 manifest')
  fixedBase64Url(manifest.backup_id,32);fixedBase64Url(manifest.diary_id,16);fixedBase64Url(manifest.epoch_id,16);fixedBase64Url(manifest.key_id,16);fixedBase64Url(manifest.manifest_fingerprint,32)
  exact(manifest.writer_authority_at_export,WRITER_KEYS,'BackupV6 writer authority')
  if(!Number.isSafeInteger(manifest.writer_authority_at_export.writer_generation)||manifest.writer_authority_at_export.writer_generation<1)throw new Error('BackupV6 Writer generation mismatch.')
  fixedBase64Url(manifest.writer_authority_at_export.writer_grant_id,32);fixedBase64Url(manifest.writer_authority_at_export.writer_device_id,16);fixedBase64Url(manifest.writer_authority_at_export.writer_key_id,32);fixedBase64Url(manifest.writer_authority_at_export.writer_public_key,32)
  fixedBase64Url(manifest.recovery_urs_commitment,32);fixedBase64Url(manifest.recovery_urs_id,32);fixedBase64Url(manifest.recovery_takeover_key_id,32);fixedBase64Url(manifest.recovery_takeover_public_key,32)
  fixedBase64Url(manifest.recovery_credential_history_sha256,32);fixedBase64Url(manifest.activation_lineage_sha256,32);if(manifest.recovery_authority_transition_proof_sha256!==null)fixedBase64Url(manifest.recovery_authority_transition_proof_sha256,32)
  fixedBase64Url(manifest.recovery_artifact_sha256,32);fixedBase64Url(manifest.record_prefix_hash,32);fixedBase64Url(manifest.epoch_manifest_public_sha256,32);fixedBase64Url(manifest.record_rows_jcs_sha256,32);fixedBase64Url(manifest.pending_outbox_rows_jcs_sha256,32);fixedBase64Url(manifest.stale_writer_pending_rows_jcs_sha256,32)
  for(const value of [manifest.recovery_generation,manifest.record_row_count,manifest.record_rows_canonical_bytes,manifest.pending_outbox_count,manifest.pending_outbox_rows_canonical_bytes,manifest.stale_writer_pending_count,manifest.stale_writer_pending_rows_canonical_bytes,manifest.unique_union_count,manifest.unique_union_canonical_bytes])if(!Number.isSafeInteger(value)||value<0)throw new Error('BackupV6 numeric field mismatch.')
  if(manifest.activation_state!=='staged'&&manifest.activation_state!=='activated')throw new Error('BackupV6 activation state mismatch.')
  if(manifest.recovery_rekey_rotation_required!==(manifest.recovery_rekey_transition_id!==null))throw new Error('BackupV6 Recovery-rekey fence mismatch.')
  if(manifest.recovery_rekey_transition_id!==null)fixedBase64Url(manifest.recovery_rekey_transition_id,32)
  if(!validTimestamp(manifest.created_at))throw new Error('BackupV6 created_at is not canonical.')
}

export async function testRestoreBackupV6(
  context:{rootKey:Uint8Array;epochSalt:Uint8Array;urs:Uint8Array;diaryId:string;epochId:string;keyId:string},
  backup:SyncBackupV6,
  verifier:TransferableSingleWriterV2Verifier,
):Promise<BackupRestoreResultV6>{
  if(!(verifier instanceof TransferableSingleWriterV2Verifier))throw new Error('Production TransferableSingleWriterV2Verifier is required.')
  if(!backup||typeof backup!=='object')throw new Error('BackupV6 document is invalid.')
  exact(backup,BACKUP_KEYS,'BackupV6')
  if(backup.format!=='sync-backup-v6'||backup.backup_format_version!==6)throw new Error('BackupV6 format mismatch.')
  if(canonicalBytes(backup as never).byteLength>MAX_BACKUP_V6_BYTES)throw new Error('BackupV6 document size bound exceeded.')
  const id=fixedBase64Url(backup.backup_id,32),iv=fixedBase64Url(backup.backup_manifest_iv,12)
  const cipher=fromBase64Url(backup.backup_manifest_ciphertext);if(cipher.byteLength<16||cipher.byteLength>65_536)throw new Error('BackupV6 manifest ciphertext bound exceeded.')
  if(!Array.isArray(backup.epoch_manifest_public)||backup.epoch_manifest_public.length!==4||backup.epoch_manifest_public.some(cell=>typeof cell!=='string'))throw new Error('BackupV6 embedded ManifestV6 schema mismatch.')
  validateRows(backup.record_rows,'record_rows');validateRows(backup.pending_outbox_rows,'pending_outbox_rows');validateRows(backup.stale_writer_pending_rows,'stale_writer_pending_rows')
  const plain=await aesGcmDecrypt(await deriveBackupKeyV2(context.rootKey,context.epochSalt,id),cipher,backupAad(backup.backup_id),iv)
  const manifest=parseCanonicalJson(plain) as unknown as BackupManifestV6;validateBackupManifestV6(manifest)
  if(manifest.backup_id!==backup.backup_id||manifest.diary_id!==context.diaryId||manifest.epoch_id!==context.epochId||manifest.key_id!==context.keyId)throw new Error('BackupV6 identity binding mismatch.')
  const manifestCells=parseManifestCellsV6(backup.epoch_manifest_public),fingerprint=await manifestFingerprintV6(manifestCells)
  if(fingerprint!==manifest.manifest_fingerprint)throw new Error('BackupV6 ManifestV6 fingerprint mismatch.')
  const manifestPayload=await openManifestV6(context.rootKey,context.epochSalt,{diaryId:context.diaryId,epochId:context.epochId},manifestCells)
  if(manifestPayload.key_id!==context.keyId)throw new Error('BackupV6 ManifestV6 key mismatch.')
  if(manifest.epoch_manifest_public_sha256!==await digest(backup.epoch_manifest_public)||manifest.record_rows_jcs_sha256!==await digest(backup.record_rows)||manifest.pending_outbox_rows_jcs_sha256!==await digest(backup.pending_outbox_rows)||manifest.stale_writer_pending_rows_jcs_sha256!==await digest(backup.stale_writer_pending_rows))throw new Error('BackupV6 category hash mismatch.')
  if(manifest.record_row_count!==backup.record_rows.length||manifest.record_rows_canonical_bytes!==rowBytes(backup.record_rows)||manifest.pending_outbox_count!==backup.pending_outbox_rows.length||manifest.pending_outbox_rows_canonical_bytes!==rowBytes(backup.pending_outbox_rows)||manifest.stale_writer_pending_count!==backup.stale_writer_pending_rows.length||manifest.stale_writer_pending_rows_canonical_bytes!==rowBytes(backup.stale_writer_pending_rows))throw new Error('BackupV6 category count/byte mismatch.')
  const union=unionStats([backup.record_rows,backup.pending_outbox_rows,backup.stale_writer_pending_rows])
  if(manifest.unique_union_count!==union.count||manifest.unique_union_canonical_bytes!==union.bytes)throw new Error('BackupV6 unique union mismatch.')
  const trustRoot=await manifestTrustRootV6(manifestCells,manifestPayload),canonical=await verifier.verifyCanonicalFull(trustRoot,context.rootKey,backup.record_rows)
  await verifyBackupLocalRows(context.rootKey,trustRoot,backup.record_rows,backup.pending_outbox_rows,backup.stale_writer_pending_rows)
  if(!canonicalEqual(canonical.remote_anchor,manifest.remote_anchor_at_export)||canonical.remote_anchor.prefix_hash!==manifest.record_prefix_hash)throw new Error('BackupV6 RemoteAnchorV2 mismatch.')
  if(!sameWriter(canonical,manifest.writer_authority_at_export))throw new Error('BackupV6 Writer authority mismatch.')
  const recovery=canonical.current_recovery
  if(recovery.recovery_generation!==manifest.recovery_generation||recovery.recovery_urs_commitment!==manifest.recovery_urs_commitment||recovery.recovery_urs_id!==manifest.recovery_urs_id||recovery.recovery_takeover_key_id!==manifest.recovery_takeover_key_id||recovery.recovery_takeover_public_key!==manifest.recovery_takeover_public_key||recovery.recovery_rekey_rotation_required!==manifest.recovery_rekey_rotation_required||recovery.recovery_rekey_transition_id!==manifest.recovery_rekey_transition_id)throw new Error('BackupV6 Recovery state mismatch.')
  const artifact=(await openRecoveryArtifactV6(backup.recovery_artifact,context.urs)).payload
  await validateBackupActivationBoundary(manifestPayload,artifact,canonical,backup.record_rows,manifest.activation_state)
  if(artifact.diary_id!==context.diaryId
    ||artifact.epoch_id!==context.epochId
    ||artifact.key_id!==context.keyId
    ||artifact.RK_epoch!==base64Url(context.rootKey)
    ||artifact.manifest_fingerprint!==fingerprint
    ||artifact.google_account_binding!==manifestPayload.google_account_binding
    ||artifact.recovery_generation!==recovery.recovery_generation
    ||artifact.recovery_urs_commitment!==recovery.recovery_urs_commitment
    ||artifact.recovery_urs_id!==recovery.recovery_urs_id
    ||artifact.recovery_takeover_key_id!==recovery.recovery_takeover_key_id
    ||artifact.recovery_takeover_public_key!==recovery.recovery_takeover_public_key
    ||!canonicalEqual(artifact.recovery_credential_history,canonical.recovery_credential_history))throw new Error('BackupV6 RecoveryArtifactV6 binding mismatch.')
  const artifactAdvancedRecovery=artifact.recovery_generation>manifestPayload.recovery_generation
  if(artifact.recovery_generation<manifestPayload.recovery_generation
    ||artifactAdvancedRecovery!==(artifact.recovery_authority_transition_proof!==null))throw new Error('BackupV6 RecoveryArtifactV6 transition-proof requirement mismatch.')
  if(manifest.recovery_artifact_sha256!==await recoveryArtifactHashV6(backup.recovery_artifact)||manifest.recovery_credential_history_sha256!==await digest(artifact.recovery_credential_history)||manifest.activation_lineage_sha256!==await digest(artifact.activation_lineage)||(artifact.recovery_authority_transition_proof===null?manifest.recovery_authority_transition_proof_sha256!==null:manifest.recovery_authority_transition_proof_sha256!==await digest(artifact.recovery_authority_transition_proof)))throw new Error('BackupV6 RecoveryArtifactV6 hashes mismatch.')
  if(artifact.remote_anchor.covered_row_count>backup.record_rows.length||!canonicalEqual(artifact.remote_anchor,await createAnchorV2(context.diaryId,context.epochId,backup.record_rows.slice(0,artifact.remote_anchor.covered_row_count))))throw new Error('BackupV6 RecoveryArtifactV6 anchor mismatch.')
  // Local rows are restored only as local material. Full external activation
  // proof is deliberately not inferred from an "activated" bit in the backup.
  for(const row of [...backup.pending_outbox_rows,...backup.stale_writer_pending_rows]){
    await openRevisionEnvelopeV2(context.rootKey,context.epochSalt,{diaryId:context.diaryId,epochId:context.epochId},{envelopeId:row[0],iv:row[1],ciphertext:row[2]})
  }
  return{canonical,activation_state:manifest.activation_state,access:'read_only',pending_outbox_rows:backup.pending_outbox_rows,stale_writer_pending_rows:backup.stale_writer_pending_rows}
}
