import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { RemoteAnchorV1 } from '../../sync/core/prefix'
import { base64Url, concatBytes, fixedBase64Url, fromBase64Url, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { randomBytes, sha256 } from '../crypto/core'
import type { PreparedEnvelope } from '../envelopes'
import { validateRevisionGraphV1, type RevisionV1 } from '../revisions'
import { revisionSigningBytesV2, signEd25519V2 } from './crypto'
import { createAnchorV2 } from './prefix'
import type { PreparedEnvelopeRowV2, ProfileUpgradeActivationEntryV2 } from './recovery'
import {
  type EpochMigrationV2,
  type RemoteAnchorV2,
  type RevisionV2,
  type SuccessorActivationConfirmationV2,
  type WriterContextV2,
  type WriterGrantV2,
} from './types'
import { validateEpochMigrationV2, validateRevisionV2 } from './validators'
import type { CanonicalFullResultV2 } from './verifier'

export interface ProfileUpgradeSourceSnapshotV2 {
  heads: readonly RevisionV1[]
  semantic_snapshot_hash: string
  lineage_snapshot_hash: string
  active_head_count: number
  tombstone_head_count: number
}

function byteCompare(left:Uint8Array,right:Uint8Array):number{
  const length=Math.min(left.byteLength,right.byteLength)
  for(let index=0;index<length;index+=1)if(left[index]!==right[index])return left[index]!-right[index]!
  return left.byteLength-right.byteLength
}
function canonicalCompare(left:unknown,right:unknown):number{return byteCompare(canonicalBytes(left as never),canonicalBytes(right as never))}
function exactEqual(left:unknown,right:unknown):boolean{return canonicalCompare(left,right)===0}
function rowOf(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):PreparedEnvelopeRowV2{
  return{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext}
}
function randomId(bytes:16|32):string{return base64Url(randomBytes(bytes))}

export async function profileUpgradeSourceSnapshotV2(revisions:readonly RevisionV1[]):Promise<ProfileUpgradeSourceSnapshotV2>{
  const graph=validateRevisionGraphV1(revisions)
  const heads=[...graph.headsByRecord.values()]
    .flatMap(ids=>[...ids].map(id=>graph.revisions.get(id)!))
    .filter(revision=>revision.record_status!=='control')
    .sort((a,b)=>byteCompare(fixedBase64Url(a.revision_id,32),fixedBase64Url(b.revision_id,32)))

  const semanticEntries=heads.map(revision=>({
    record_type:revision.record_type,
    record_schema:revision.record_schema,
    record_id:revision.record_id,
    record_status:revision.record_status,
    record_data:revision.record_data,
  })).sort(canonicalCompare)

  const lineageEntries=heads.map(revision=>({
    record_id:revision.record_id,
    revision_id:revision.revision_id,
    parent_revision_ids:[...revision.parent_revision_ids].sort((a,b)=>byteCompare(fixedBase64Url(a,32),fixedBase64Url(b,32))),
  })).sort((a,b)=>byteCompare(fixedBase64Url(a.revision_id,32),fixedBase64Url(b.revision_id,32)))

  return{
    heads,
    semantic_snapshot_hash:base64Url(await sha256(canonicalBytes(semanticEntries as never))),
    lineage_snapshot_hash:base64Url(await sha256(canonicalBytes(lineageEntries as never))),
    active_head_count:heads.filter(revision=>revision.record_status==='active').length,
    tombstone_head_count:heads.filter(revision=>revision.record_status==='deleted').length,
  }
}

export async function createProfileUpgradeGenesisGrantRevisionV2(args:{
  diaryId:string
  epochId:string
  writerDeviceId:string
  writerKeyId:string
  writerPublicKey:string
  recoveryGeneration:number
  protocolCreatedAt:string
  grantId?:string
  recordId?:string
  revisionId?:string
}):Promise<{grant:WriterGrantV2;revision:RevisionV2<WriterGrantV2>}>{
  const grant:WriterGrantV2={
    grant_id:args.grantId??randomId(32),
    writer_generation:1,
    writer_device_id:args.writerDeviceId,
    writer_key_id:args.writerKeyId,
    writer_public_key:args.writerPublicKey,
    previous_grant_id:null,
    previous_writer_generation:0,
    recovery_generation:args.recoveryGeneration,
    reason:'initial',
    authority_anchor:await createAnchorV2(args.diaryId,args.epochId,[]),
    authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null},
  }
  const revision:RevisionV2<WriterGrantV2>={
    record_type:'writer_grant',
    record_schema:'writer-grant-sw-v2',
    record_id:args.recordId??randomId(16),
    revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],
    record_status:'control',
    record_data:grant,
    migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,
    writer_context:null,
    writer_signature:null,
  }
  await validateRevisionV2(revision)
  return{grant,revision}
}

export async function copyV1HeadForProfileUpgradeV2(args:{
  diaryId:string
  successorEpochId:string
  sourceEpochId:string
  sourceHead:RevisionV1
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  revisionId?:string
}):Promise<RevisionV2>{
  if(args.sourceHead.record_status==='control')throw new Error('Profile upgrade copies only non-control Source heads.')
  const revision:RevisionV2={
    record_type:args.sourceHead.record_type as RevisionV2['record_type'],
    record_schema:args.sourceHead.record_schema as RevisionV2['record_schema'],
    record_id:args.sourceHead.record_id,
    revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],
    record_status:args.sourceHead.record_status,
    record_data:structuredClone(args.sourceHead.record_data),
    migration_origin:{sources:[{
      source_epoch_id:args.sourceEpochId,
      source_record_id:args.sourceHead.record_id,
      source_revision_ids:[args.sourceHead.revision_id],
    }]},
    protocol_created_at:args.protocolCreatedAt,
    writer_context:{...args.writerContext},
    writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.successorEpochId,revision))
  await validateRevisionV2(revision)
  return revision
}

export async function createProfileUpgradeMigrationRevisionV2(args:{
  diaryId:string
  successorEpochId:string
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV1
  sourceSnapshot:ProfileUpgradeSourceSnapshotV2
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  migrationId?:string
  recordId?:string
  revisionId?:string
}):Promise<{migration:EpochMigrationV2;revision:RevisionV2<EpochMigrationV2>}>{
  const migration:EpochMigrationV2={
    migration_id:args.migrationId??randomId(32),
    migration_kind:'profile_upgrade',
    source:{
      source_epoch_id:args.sourceEpochId,
      source_manifest_fingerprint:args.sourceManifestFingerprint,
      source_anchor:structuredClone(args.sourceAnchor),
      source_lineage_snapshot_hash:args.sourceSnapshot.lineage_snapshot_hash,
      source_semantic_snapshot_hash:args.sourceSnapshot.semantic_snapshot_hash,
    },
    result_semantic_snapshot_hash:args.sourceSnapshot.semantic_snapshot_hash,
    active_head_count:args.sourceSnapshot.active_head_count,
    tombstone_head_count:args.sourceSnapshot.tombstone_head_count,
    source_writer_authority:null,
    source_recovery_transition_id:null,
  }
  validateEpochMigrationV2(migration)
  const revision:RevisionV2<EpochMigrationV2>={
    record_type:'epoch_migration',
    record_schema:'epoch-migration-sw-v2',
    record_id:args.recordId??randomId(16),
    revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],
    record_status:'control',
    record_data:migration,
    migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,
    writer_context:{...args.writerContext},
    writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.successorEpochId,revision))
  await validateRevisionV2(revision)
  return{migration,revision}
}

export async function sourceAnnouncementEnvelopeHashV2(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Promise<string>{
  return base64Url(await sha256(concatBytes(
    utf8('eds-diary/source-announcement-envelope/v2'),
    new Uint8Array([0]),
    canonicalBytes([envelope.envelopeId,envelope.iv,envelope.ciphertext] as never),
  )))
}

export async function createProfileUpgradeConfirmationRevisionV2(args:{
  diaryId:string
  successorEpochId:string
  successorManifestFingerprint:string
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV1
  successorStagingAnchor:RemoteAnchorV2
  announcementEnvelope:PreparedEnvelope
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  confirmationId?:string
  recordId?:string
  revisionId?:string
}):Promise<{confirmation:SuccessorActivationConfirmationV2;revision:RevisionV2<SuccessorActivationConfirmationV2>}>{
  const confirmation:SuccessorActivationConfirmationV2={
    confirmation_id:args.confirmationId??randomId(32),
    activation_kind:'profile_upgrade',
    source_profile:SINGLE_WRITER_V1_PROFILE,
    source_epoch_id:args.sourceEpochId,
    source_manifest_fingerprint:args.sourceManifestFingerprint,
    source_anchor_before_announcement:structuredClone(args.sourceAnchor),
    successor_epoch_id:args.successorEpochId,
    successor_manifest_fingerprint:args.successorManifestFingerprint,
    successor_staging_anchor:structuredClone(args.successorStagingAnchor),
    source_announcement_envelope_sha256:await sourceAnnouncementEnvelopeHashV2(args.announcementEnvelope),
  }
  const revision:RevisionV2<SuccessorActivationConfirmationV2>={
    record_type:'successor_activation_confirmation',
    record_schema:'successor-activation-confirmation-sw-v2',
    record_id:args.recordId??randomId(16),
    revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],
    record_status:'control',
    record_data:confirmation,
    migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,
    writer_context:{...args.writerContext},
    writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.successorEpochId,revision))
  await validateRevisionV2(revision)
  return{confirmation,revision}
}

export function createProfileUpgradeActivationEntryV2(args:{
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceRootKey:Uint8Array
  sourceAnchor:RemoteAnchorV1
  successorEpochId:string
  successorManifestFingerprint:string
  successorStagingAnchor:RemoteAnchorV2
  announcementEnvelope:PreparedEnvelope
  confirmationEnvelope:PreparedEnvelope
}):ProfileUpgradeActivationEntryV2{
  if(args.sourceRootKey.byteLength!==32)throw new Error('Profile upgrade Source RK must contain 32 bytes.')
  return{
    kind:'profile_upgrade',
    source_profile:SINGLE_WRITER_V1_PROFILE,
    source_epoch_id:args.sourceEpochId,
    source_manifest_fingerprint:args.sourceManifestFingerprint,
    source_root_key:base64Url(args.sourceRootKey),
    source_anchor_before_announcement:structuredClone(args.sourceAnchor),
    successor_epoch_id:args.successorEpochId,
    successor_manifest_fingerprint:args.successorManifestFingerprint,
    successor_staging_anchor:structuredClone(args.successorStagingAnchor),
    announcement_envelope:rowOf(args.announcementEnvelope),
    successor_confirmation_envelope:rowOf(args.confirmationEnvelope),
  }
}
export async function profileUpgradeActivationEvidenceHashV2(entry:ProfileUpgradeActivationEntryV2):Promise<string>{
  return base64Url(await sha256(canonicalBytes(entry as never)))
}
export async function activationLineageHashV2(lineage:readonly ProfileUpgradeActivationEntryV2[]):Promise<string>{
  return base64Url(await sha256(canonicalBytes(lineage as never)))
}

function successorDomainHeads(result:CanonicalFullResultV2):RevisionV2[]{
  const heads:RevisionV2[]=[]
  for(const ids of result.accepted_revision_graph.heads_by_record.values())for(const id of ids){
    const revision=result.accepted_revision_graph.revisions.get(id)
    if(revision&&revision.record_status!=='control')heads.push(revision)
  }
  return heads
}

export async function verifyProfileUpgradeMigrationIntegrityV2(args:{
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV1
  sourceRevisions:readonly RevisionV1[]
  successor:CanonicalFullResultV2
}):Promise<ProfileUpgradeSourceSnapshotV2>{
  const migration=args.successor.accepted_epoch_migration
  if(!migration||migration.migration_kind!=='profile_upgrade')throw new Error('Profile upgrade requires exactly one accepted EpochMigrationV2.')
  validateEpochMigrationV2(migration)
  if(migration.source.source_epoch_id!==args.sourceEpochId
    ||migration.source.source_manifest_fingerprint!==args.sourceManifestFingerprint
    ||!exactEqual(migration.source.source_anchor,args.sourceAnchor))throw new Error('Profile upgrade Migration source binding mismatch.')

  const source=await profileUpgradeSourceSnapshotV2(args.sourceRevisions)
  if(migration.source.source_semantic_snapshot_hash!==source.semantic_snapshot_hash
    ||migration.source.source_lineage_snapshot_hash!==source.lineage_snapshot_hash
    ||migration.result_semantic_snapshot_hash!==source.semantic_snapshot_hash
    ||migration.active_head_count!==source.active_head_count
    ||migration.tombstone_head_count!==source.tombstone_head_count)throw new Error('Profile upgrade Migration snapshot mismatch.')

  const sourceByRevision=new Map(source.heads.map(head=>[head.revision_id,head]))
  const claimed=new Set<string>()
  const successorHeads=successorDomainHeads(args.successor)
  if(successorHeads.length!==source.heads.length)throw new Error('Profile upgrade migration provenance head-count mismatch.')
  for(const target of successorHeads){
    if(target.parent_revision_ids.length!==0||target.migration_origin===null||target.migration_origin.sources.length!==1)throw new Error('Profile upgrade migration provenance mismatch.')
    const origin=target.migration_origin.sources[0]!
    if(origin.source_epoch_id!==args.sourceEpochId||origin.source_record_id!==target.record_id||origin.source_revision_ids.length!==1)throw new Error('Profile upgrade migration provenance mismatch.')
    const sourceHead=sourceByRevision.get(origin.source_revision_ids[0]!)
    if(!sourceHead||claimed.has(sourceHead.revision_id)||target.revision_id===sourceHead.revision_id)throw new Error('Profile upgrade migration provenance is not bijective.')
    if(target.record_type!==sourceHead.record_type
      ||target.record_schema!==sourceHead.record_schema
      ||target.record_id!==sourceHead.record_id
      ||target.record_status!==sourceHead.record_status
      ||!exactEqual(target.record_data,sourceHead.record_data))throw new Error('Profile upgrade copied head changed Fachsemantik.')
    claimed.add(sourceHead.revision_id)
  }
  if(claimed.size!==source.heads.length)throw new Error('Profile upgrade migration provenance is incomplete.')
  return source
}

export const ROTATION_OPERATION_STAGES_V2=[
  'source_frozen_verified','successor_planned','successor_bound','copying','successor_verified',
  'announcement_prepared','recovery_artifact_verified','staged_backup_verified','announcement_unknown',
  'announcement_durable','confirmation_unknown','confirmation_durable','activated_backup_verified',
  'switched','stale','cutover_race','post_activation_superseded',
] as const
export type RotationOperationStageV2=typeof ROTATION_OPERATION_STAGES_V2[number]

export interface RotationOperationStateV2 {
  format:'rotation-operation-v2'
  version:2
  operation_id:string
  rotation_kind:'profile_upgrade'
  source_epoch_id:string
  successor_epoch_id:string
  stage:RotationOperationStageV2
  source_anchor_before_announcement:RemoteAnchorV1
  successor_staging_anchor:RemoteAnchorV2|null
  successor_activation_anchor:RemoteAnchorV2|null
  successor_creation_locator:string|null
  successor_manifest_fingerprint:string|null
  source_recovery_transition_id:null
  activation_lineage_sha256:string|null
  announcement_envelope:PreparedEnvelopeRowV2|null
  confirmation_envelope:PreparedEnvelopeRowV2|null
  activation_evidence_sha256:string|null
  recovery_artifact_id:string|null
  recovery_artifact_locator:string|null
  recovery_artifact_sha256:string|null
  staged_backup_id:string|null
  activated_backup_id:string|null
}

const STATE_KEYS=[
  'format','version','operation_id','rotation_kind','source_epoch_id','successor_epoch_id','stage',
  'source_anchor_before_announcement','successor_staging_anchor','successor_activation_anchor',
  'successor_creation_locator','successor_manifest_fingerprint','source_recovery_transition_id',
  'activation_lineage_sha256','announcement_envelope','confirmation_envelope',
  'activation_evidence_sha256','recovery_artifact_id','recovery_artifact_locator',
  'recovery_artifact_sha256','staged_backup_id','activated_backup_id',
] as const
const ORDER:RotationOperationStageV2[]=[
  'source_frozen_verified','successor_planned','successor_bound','copying','successor_verified',
  'announcement_prepared','recovery_artifact_verified','staged_backup_verified','announcement_unknown',
  'announcement_durable','confirmation_unknown','confirmation_durable','activated_backup_verified','switched',
]
function stageAtLeast(stage:RotationOperationStageV2,target:RotationOperationStageV2):boolean{
  const left=ORDER.indexOf(stage),right=ORDER.indexOf(target)
  return left>=0&&right>=0&&left>=right
}
function validateAnchorV1(anchor:RemoteAnchorV1):void{
  if(anchor.anchor_profile!==SINGLE_WRITER_V1_PROFILE||!Number.isSafeInteger(anchor.covered_row_count)||anchor.covered_row_count<0)throw new Error('RotationOperationStateV2 Source anchor mismatch.')
  fixedBase64Url(anchor.prefix_hash,32,'source_anchor_before_announcement.prefix_hash')
}
function validateAnchorV2(anchor:RemoteAnchorV2,label:string):void{
  if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE||!Number.isSafeInteger(anchor.covered_row_count)||anchor.covered_row_count<0)throw new Error(`${label} mismatch.`)
  fixedBase64Url(anchor.prefix_hash,32,`${label}.prefix_hash`)
}
function validateRow(row:PreparedEnvelopeRowV2,label:string):void{
  fixedBase64Url(row.envelope_id,32,`${label}.envelope_id`)
  fixedBase64Url(row.iv,12,`${label}.iv`)
  if(fromBase64Url(row.ciphertext).byteLength<16)throw new Error(`${label}.ciphertext is invalid.`)
}
export function validateRotationOperationStateV2(value:RotationOperationStateV2):RotationOperationStateV2{
  if(!value||typeof value!=='object'||Object.keys(value).sort().join('\0')!==[...STATE_KEYS].sort().join('\0'))throw new Error('RotationOperationStateV2 schema mismatch.')
  if(value.format!=='rotation-operation-v2'||value.version!==2||value.rotation_kind!=='profile_upgrade'||!ROTATION_OPERATION_STAGES_V2.includes(value.stage))throw new Error('RotationOperationStateV2 profile mismatch.')
  fixedBase64Url(value.operation_id,32,'operation_id');fixedBase64Url(value.source_epoch_id,16,'source_epoch_id');fixedBase64Url(value.successor_epoch_id,16,'successor_epoch_id')
  if(value.source_epoch_id===value.successor_epoch_id)throw new Error('RotationOperationStateV2 successor must differ from Source.')
  validateAnchorV1(value.source_anchor_before_announcement)
  if(value.source_recovery_transition_id!==null)throw new Error('Profile upgrade must not bind a recovery transition.')

  if(value.successor_creation_locator!==null)fixedBase64Url(value.successor_creation_locator,16,'successor_creation_locator')
  if(value.successor_manifest_fingerprint!==null)fixedBase64Url(value.successor_manifest_fingerprint,32,'successor_manifest_fingerprint')
  if(value.successor_staging_anchor!==null)validateAnchorV2(value.successor_staging_anchor,'successor_staging_anchor')
  if(value.successor_activation_anchor!==null)validateAnchorV2(value.successor_activation_anchor,'successor_activation_anchor')
  for(const [field,bytes] of [
    ['activation_lineage_sha256',32],['activation_evidence_sha256',32],['recovery_artifact_sha256',32],
    ['recovery_artifact_id',16],['recovery_artifact_locator',16],['staged_backup_id',32],['activated_backup_id',32],
  ] as const){const entry=value[field];if(entry!==null)fixedBase64Url(entry,bytes,field)}
  if(value.announcement_envelope!==null)validateRow(value.announcement_envelope,'announcement_envelope')
  if(value.confirmation_envelope!==null)validateRow(value.confirmation_envelope,'confirmation_envelope')

  if(stageAtLeast(value.stage,'successor_planned')&&value.successor_creation_locator===null)throw new Error('successor_creation_locator is required at successor_planned.')
  if(stageAtLeast(value.stage,'successor_bound')&&value.successor_manifest_fingerprint===null)throw new Error('successor_manifest_fingerprint is required at successor_bound.')
  if(stageAtLeast(value.stage,'successor_verified')&&value.successor_staging_anchor===null)throw new Error('successor_staging_anchor is required at successor_verified.')
  if(stageAtLeast(value.stage,'announcement_prepared')){
    if(value.announcement_envelope===null||value.confirmation_envelope===null||value.activation_evidence_sha256===null||value.activation_lineage_sha256===null||value.recovery_artifact_id===null||value.recovery_artifact_locator===null||value.recovery_artifact_sha256===null)throw new Error('announcement_prepared fields are incomplete.')
  }
  if(stageAtLeast(value.stage,'staged_backup_verified')&&value.staged_backup_id===null)throw new Error('staged_backup_id is required at staged_backup_verified.')
  if(stageAtLeast(value.stage,'confirmation_durable')&&value.successor_activation_anchor===null)throw new Error('successor_activation_anchor is required at confirmation_durable.')
  if(stageAtLeast(value.stage,'activated_backup_verified')&&value.activated_backup_id===null)throw new Error('activated_backup_id is required at activated_backup_verified.')
  return value
}

const ALLOWED=new Set([
  'source_frozen_verified->successor_planned','successor_planned->successor_bound','successor_bound->copying','copying->successor_verified',
  'successor_verified->announcement_prepared','announcement_prepared->recovery_artifact_verified','recovery_artifact_verified->staged_backup_verified',
  'staged_backup_verified->announcement_unknown','staged_backup_verified->announcement_durable','announcement_unknown->announcement_durable','announcement_unknown->stale',
  'announcement_durable->confirmation_unknown','announcement_durable->confirmation_durable','announcement_durable->cutover_race',
  'confirmation_unknown->confirmation_durable','confirmation_unknown->cutover_race','confirmation_durable->activated_backup_verified',
  'confirmation_durable->post_activation_superseded','activated_backup_verified->switched','activated_backup_verified->post_activation_superseded',
])
const IMMUTABLE_FIELDS=[
  'operation_id','rotation_kind','source_epoch_id','successor_epoch_id','source_anchor_before_announcement',
  'source_recovery_transition_id',
] as const
const ONCE_FIELDS=[
  'successor_creation_locator','successor_manifest_fingerprint','successor_staging_anchor','successor_activation_anchor',
  'activation_lineage_sha256','announcement_envelope','confirmation_envelope','activation_evidence_sha256',
  'recovery_artifact_id','recovery_artifact_locator','recovery_artifact_sha256','staged_backup_id','activated_backup_id',
] as const
function assertSame(left:unknown,right:unknown,label:string):void{if(!exactEqual(left,right))throw new Error(`RotationOperationStateV2 immutable field changed: ${label}.`)}
export function advanceRotationOperationStateV2(current:RotationOperationStateV2,next:RotationOperationStateV2):RotationOperationStateV2{
  validateRotationOperationStateV2(current);validateRotationOperationStateV2(next)
  const edge=`${current.stage}->${next.stage}`
  const beforeAnnouncement=!stageAtLeast(current.stage,'announcement_durable')&&current.stage!=='stale'&&current.stage!=='cutover_race'&&current.stage!=='post_activation_superseded'&&current.stage!=='switched'
  if(!ALLOWED.has(edge)&&!(next.stage==='stale'&&beforeAnnouncement))throw new Error(`Illegal RotationOperationStateV2 transition: ${edge}.`)
  for(const field of IMMUTABLE_FIELDS)assertSame(current[field],next[field],field)
  for(const field of ONCE_FIELDS)if(current[field]!==null)assertSame(current[field],next[field],field)
  return next
}

export async function rotationOperationStateHashV2(state:RotationOperationStateV2):Promise<string>{
  validateRotationOperationStateV2(state)
  return base64Url(await sha256(canonicalBytes(state as never)))
}


export type ProfileUpgradeAnnouncementOutcomeV2 =
  | {kind:'durable'}
  | {kind:'unknown'}
  | {kind:'stale'}
  | {kind:'source_race'}
export type ProfileUpgradeConfirmationOutcomeV2 =
  | {kind:'durable';activationAnchor:RemoteAnchorV2}
  | {kind:'unknown'}
  | {kind:'cutover_race'}
export type ProfileUpgradePostActivationOutcomeV2 =
  | {kind:'ready';activatedBackupId:string}
  | {kind:'superseded'}

export interface ProfileUpgradeOrchestratorV2Dependencies {
  load():Promise<RotationOperationStateV2>
  persist(current:RotationOperationStateV2,next:RotationOperationStateV2):Promise<RotationOperationStateV2>
  planSuccessor(state:RotationOperationStateV2):Promise<{creationLocator:string}>
  createOrReconcileSuccessor(state:RotationOperationStateV2):Promise<{manifestFingerprint:string}>
  copyAndVerifySuccessor(state:RotationOperationStateV2):Promise<{stagingAnchor:RemoteAnchorV2}>
  prepareActivation(state:RotationOperationStateV2):Promise<{
    announcementEnvelope:PreparedEnvelopeRowV2
    confirmationEnvelope:PreparedEnvelopeRowV2
    activationEvidenceSha256:string
    activationLineageSha256:string
    recoveryArtifactId:string
    recoveryArtifactLocator:string
    recoveryArtifactSha256:string
  }>
  publishAndVerifyRecoveryArtifact(state:RotationOperationStateV2):Promise<void>
  createAndVerifyStagedBackup(state:RotationOperationStateV2):Promise<{backupId:string}>
  publishOrReconcileAnnouncement(state:RotationOperationStateV2):Promise<ProfileUpgradeAnnouncementOutcomeV2>
  publishOrReconcileConfirmation(state:RotationOperationStateV2):Promise<ProfileUpgradeConfirmationOutcomeV2>
  createAndVerifyActivatedBackup(state:RotationOperationStateV2):Promise<ProfileUpgradePostActivationOutcomeV2>
  persistLineageAndReverifyBeforeSwitch(state:RotationOperationStateV2):Promise<'ready'|'superseded'>
  switchLocally(state:RotationOperationStateV2):Promise<void>
  orphanPreAnnouncementSuccessor(state:RotationOperationStateV2):Promise<void>
  markSourceRace(state:RotationOperationStateV2):Promise<void>
}

function withStage(state:RotationOperationStateV2,stage:RotationOperationStageV2,patch:Partial<RotationOperationStateV2>={}):RotationOperationStateV2{
  return validateRotationOperationStateV2({...state,...patch,stage})
}
async function transitionProfileUpgrade(
  deps:ProfileUpgradeOrchestratorV2Dependencies,
  current:RotationOperationStateV2,
  next:RotationOperationStateV2,
):Promise<RotationOperationStateV2>{
  advanceRotationOperationStateV2(current,next)
  return deps.persist(current,next)
}

/**
 * Closed crash/resume state machine for the v1 -> v2 profile-upgrade cutover.
 * All remote mutation is delegated to idempotent dependency methods whose
 * prepared bytes are already persisted in RotationOperationStateV2/artifacts.
 * A retry always begins by loading and validating the durable stage.
 */
export async function runProfileUpgradeStateMachineV2(
  deps:ProfileUpgradeOrchestratorV2Dependencies,
):Promise<RotationOperationStateV2>{
  for(;;){
    const state=validateRotationOperationStateV2(await deps.load())
    switch(state.stage){
      case 'source_frozen_verified':{
        const planned=await deps.planSuccessor(state)
        return runProfileUpgradeStateMachineV2({
          ...deps,
          load:async()=>transitionProfileUpgrade(deps,state,withStage(state,'successor_planned',{successor_creation_locator:planned.creationLocator})),
        })
      }
      case 'successor_planned':{
        const bound=await deps.createOrReconcileSuccessor(state)
        return runProfileUpgradeStateMachineV2({
          ...deps,
          load:async()=>transitionProfileUpgrade(deps,state,withStage(state,'successor_bound',{successor_manifest_fingerprint:bound.manifestFingerprint})),
        })
      }
      case 'successor_bound':{
        const copying=await transitionProfileUpgrade(deps,state,withStage(state,'copying'))
        const verified=await deps.copyAndVerifySuccessor(copying)
        await transitionProfileUpgrade(deps,copying,withStage(copying,'successor_verified',{successor_staging_anchor:verified.stagingAnchor}))
        continue
      }
      case 'copying':{
        const verified=await deps.copyAndVerifySuccessor(state)
        await transitionProfileUpgrade(deps,state,withStage(state,'successor_verified',{successor_staging_anchor:verified.stagingAnchor}))
        continue
      }
      case 'successor_verified':{
        const prepared=await deps.prepareActivation(state)
        await transitionProfileUpgrade(deps,state,withStage(state,'announcement_prepared',{
          announcement_envelope:prepared.announcementEnvelope,
          confirmation_envelope:prepared.confirmationEnvelope,
          activation_evidence_sha256:prepared.activationEvidenceSha256,
          activation_lineage_sha256:prepared.activationLineageSha256,
          recovery_artifact_id:prepared.recoveryArtifactId,
          recovery_artifact_locator:prepared.recoveryArtifactLocator,
          recovery_artifact_sha256:prepared.recoveryArtifactSha256,
        }))
        continue
      }
      case 'announcement_prepared':
        await deps.publishAndVerifyRecoveryArtifact(state)
        await transitionProfileUpgrade(deps,state,withStage(state,'recovery_artifact_verified'))
        continue
      case 'recovery_artifact_verified':{
        const backup=await deps.createAndVerifyStagedBackup(state)
        await transitionProfileUpgrade(deps,state,withStage(state,'staged_backup_verified',{staged_backup_id:backup.backupId}))
        continue
      }
      case 'staged_backup_verified':
      case 'announcement_unknown':{
        const outcome=await deps.publishOrReconcileAnnouncement(state)
        if(outcome.kind==='unknown'){
          if(state.stage==='staged_backup_verified'){
            return transitionProfileUpgrade(deps,state,withStage(state,'announcement_unknown'))
          }
          return state
        }
        if(outcome.kind==='stale'){
          const stale=await transitionProfileUpgrade(deps,state,withStage(state,'stale'))
          await deps.orphanPreAnnouncementSuccessor(stale)
          return stale
        }
        if(outcome.kind==='source_race'){
          const raced=await transitionProfileUpgrade(deps,state,withStage(state,'cutover_race'))
          await deps.markSourceRace(raced)
          return raced
        }
        await transitionProfileUpgrade(deps,state,withStage(state,'announcement_durable'))
        continue
      }
      case 'announcement_durable':
      case 'confirmation_unknown':{
        const outcome=await deps.publishOrReconcileConfirmation(state)
        if(outcome.kind==='unknown'){
          if(state.stage==='announcement_durable')return transitionProfileUpgrade(deps,state,withStage(state,'confirmation_unknown'))
          return state
        }
        if(outcome.kind==='cutover_race')return transitionProfileUpgrade(deps,state,withStage(state,'cutover_race'))
        await transitionProfileUpgrade(deps,state,withStage(state,'confirmation_durable',{successor_activation_anchor:outcome.activationAnchor}))
        continue
      }
      case 'confirmation_durable':{
        const outcome=await deps.createAndVerifyActivatedBackup(state)
        if(outcome.kind==='superseded')return transitionProfileUpgrade(deps,state,withStage(state,'post_activation_superseded'))
        await transitionProfileUpgrade(deps,state,withStage(state,'activated_backup_verified',{activated_backup_id:outcome.activatedBackupId}))
        continue
      }
      case 'activated_backup_verified':{
        const status=await deps.persistLineageAndReverifyBeforeSwitch(state)
        if(status==='superseded')return transitionProfileUpgrade(deps,state,withStage(state,'post_activation_superseded'))
        await deps.switchLocally(state)
        return transitionProfileUpgrade(deps,state,withStage(state,'switched'))
      }
      case 'switched':
      case 'stale':
      case 'cutover_race':
      case 'post_activation_superseded':
        return state
      default:{
        const impossible:never=state.stage
        throw new Error(`Unhandled profile-upgrade stage: ${impossible}`)
      }
    }
  }
}
