import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { base64Url, concatBytes, fixedBase64Url, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { randomBytes, sha256 } from '../crypto/core'
import type { PreparedEnvelope } from '../envelopes'
import { revisionSigningBytesV2, signEd25519V2, verifyEd25519V2 } from './crypto'
import type { PreparedEnvelopeRowV2, RecoveryActivationProofV2, V2RotationActivationEntryV2 } from './recovery'
import type {
  EpochMigrationV2,
  RemoteAnchorV2,
  RevisionV2,
  RotationAnnouncementV2,
  SourceWriterAuthorityV2,
  SuccessorActivationConfirmationV2,
  WriterContextV2,
} from './types'
import { validateEpochMigrationV2, validateRevisionV2, validateRotationAnnouncementV2, validateSuccessorActivationConfirmationV2 } from './validators'
import type { CanonicalFullResultV2, WriterAuthoritySnapshotV2 } from './verifier'

export interface NativeV2SourceSnapshot {
  heads:readonly RevisionV2[]
  semantic_snapshot_hash:string
  lineage_snapshot_hash:string
  active_head_count:number
  tombstone_head_count:number
}

function byteCompare(left:Uint8Array,right:Uint8Array):number{
  const length=Math.min(left.byteLength,right.byteLength)
  for(let index=0;index<length;index+=1)if(left[index]!==right[index])return left[index]!-right[index]!
  return left.byteLength-right.byteLength
}
function canonicalCompare(left:unknown,right:unknown):number{return byteCompare(canonicalBytes(left as never),canonicalBytes(right as never))}
function exactEqual(left:unknown,right:unknown):boolean{return canonicalCompare(left,right)===0}
function randomId(bytes:16|32):string{return base64Url(randomBytes(bytes))}
function rowOf(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):PreparedEnvelopeRowV2{
  return{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext}
}
function writerAuthority(writer:WriterAuthoritySnapshotV2):SourceWriterAuthorityV2{
  return{
    writer_generation:writer.writer_generation,
    writer_grant_id:writer.writer_grant_id,
    writer_device_id:writer.writer_device_id,
    writer_key_id:writer.writer_key_id,
  }
}

export async function nativeV2SourceSnapshot(result:CanonicalFullResultV2):Promise<NativeV2SourceSnapshot>{
  const heads:RevisionV2[]=[]
  for(const ids of result.accepted_revision_graph.heads_by_record.values()){
    for(const id of ids){
      const revision=result.accepted_revision_graph.revisions.get(id)
      if(!revision)throw new Error('Native v2 source head is missing from the accepted graph.')
      if(revision.record_status!=='control')heads.push(revision)
    }
  }
  heads.sort((a,b)=>byteCompare(fixedBase64Url(a.revision_id,32),fixedBase64Url(b.revision_id,32)))
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

export async function copyV2HeadForRotation(args:{
  diaryId:string
  successorEpochId:string
  sourceEpochId:string
  sourceHead:RevisionV2
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  revisionId?:string
}):Promise<RevisionV2>{
  if(args.sourceHead.record_status==='control')throw new Error('Native v2 rotation copies only non-control source heads.')
  const revision:RevisionV2={
    record_type:args.sourceHead.record_type,
    record_schema:args.sourceHead.record_schema,
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

export async function createNativeV2MigrationRevision(args:{
  diaryId:string
  successorEpochId:string
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV2
  sourceSnapshot:NativeV2SourceSnapshot
  sourceWriter:WriterAuthoritySnapshotV2
  rotationKind:'normal'|'recovery_rekey'
  recoveryTransitionId:string|null
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  migrationId?:string
  recordId?:string
  revisionId?:string
}):Promise<{migration:EpochMigrationV2;revision:RevisionV2<EpochMigrationV2>}>{
  if((args.rotationKind==='normal')!==(args.recoveryTransitionId===null))throw new Error('Native v2 migration rotation/recovery-transition mismatch.')
  const migration:EpochMigrationV2={
    migration_id:args.migrationId??randomId(32),
    migration_kind:args.rotationKind,
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
    source_writer_authority:writerAuthority(args.sourceWriter),
    source_recovery_transition_id:args.recoveryTransitionId,
  }
  validateEpochMigrationV2(migration)
  const revision:RevisionV2<EpochMigrationV2>={
    record_type:'epoch_migration',record_schema:'epoch-migration-sw-v2',
    record_id:args.recordId??randomId(16),revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],record_status:'control',record_data:migration,migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,writer_context:{...args.writerContext},writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.successorEpochId,revision))
  await validateRevisionV2(revision)
  return{migration,revision}
}

export async function createRotationAnnouncementRevisionV2(args:{
  diaryId:string
  sourceEpochId:string
  successorEpochId:string
  successorCreationLocator:string
  successorManifestFingerprint:string
  rotationKind:'normal'|'recovery_rekey'
  sourceWriter:WriterAuthoritySnapshotV2
  successorRecoveryGeneration:number
  sourceAnchor:RemoteAnchorV2
  successorStagingAnchor:RemoteAnchorV2
  recoveryTransitionId:string|null
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  rotationId?:string
  recordId?:string
  revisionId?:string
}):Promise<{announcement:RotationAnnouncementV2;revision:RevisionV2<RotationAnnouncementV2>}>{
  const announcement:RotationAnnouncementV2={
    rotation_id:args.rotationId??randomId(32),from_epoch_id:args.sourceEpochId,successor_epoch_id:args.successorEpochId,
    successor_creation_locator:args.successorCreationLocator,successor_manifest_fingerprint:args.successorManifestFingerprint,
    rotation_kind:args.rotationKind,source_writer_generation:args.sourceWriter.writer_generation,
    source_writer_grant_id:args.sourceWriter.writer_grant_id,successor_recovery_generation:args.successorRecoveryGeneration,
    source_anchor_before_announcement:structuredClone(args.sourceAnchor),successor_staging_anchor:structuredClone(args.successorStagingAnchor),
    recovery_transition_id:args.recoveryTransitionId,
  }
  validateRotationAnnouncementV2(announcement)
  const context:WriterContextV2={
    writer_generation:args.sourceWriter.writer_generation,writer_grant_id:args.sourceWriter.writer_grant_id,
    writer_device_id:args.sourceWriter.writer_device_id,writer_key_id:args.sourceWriter.writer_key_id,
  }
  const revision:RevisionV2<RotationAnnouncementV2>={
    record_type:'rotation_announcement',record_schema:'rotation-announcement-sw-v2',
    record_id:args.recordId??randomId(16),revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],record_status:'control',record_data:announcement,migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,writer_context:context,writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.sourceEpochId,revision))
  await validateRevisionV2(revision)
  return{announcement,revision}
}

export async function sourceAnnouncementEnvelopeHashV2(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Promise<string>{
  return base64Url(await sha256(concatBytes(
    utf8('eds-diary/source-announcement-envelope/v2'),new Uint8Array([0]),
    canonicalBytes([envelope.envelopeId,envelope.iv,envelope.ciphertext] as never),
  )))
}

export async function createV2RotationConfirmationRevision(args:{
  diaryId:string
  successorEpochId:string
  successorManifestFingerprint:string
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV2
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
    confirmation_id:args.confirmationId??randomId(32),activation_kind:'v2_rotation',source_profile:SINGLE_WRITER_V2_PROFILE,
    source_epoch_id:args.sourceEpochId,source_manifest_fingerprint:args.sourceManifestFingerprint,
    source_anchor_before_announcement:structuredClone(args.sourceAnchor),successor_epoch_id:args.successorEpochId,
    successor_manifest_fingerprint:args.successorManifestFingerprint,successor_staging_anchor:structuredClone(args.successorStagingAnchor),
    source_announcement_envelope_sha256:await sourceAnnouncementEnvelopeHashV2(args.announcementEnvelope),
  }
  validateSuccessorActivationConfirmationV2(confirmation)
  const revision:RevisionV2<SuccessorActivationConfirmationV2>={
    record_type:'successor_activation_confirmation',record_schema:'successor-activation-confirmation-sw-v2',
    record_id:args.recordId??randomId(16),revision_id:args.revisionId??randomId(32),
    parent_revision_ids:[],record_status:'control',record_data:confirmation,migration_origin:null,
    protocol_created_at:args.protocolCreatedAt,writer_context:{...args.writerContext},writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.successorEpochId,revision))
  await validateRevisionV2(revision)
  return{confirmation,revision}
}

function recoveryActivationProofSigningBytes(proof:Omit<RecoveryActivationProofV2,'activation_signature'>):Uint8Array{
  return concatBytes(utf8('eds-diary/recovery-activation-proof/v2'),new Uint8Array([0]),canonicalBytes(proof as never))
}

export async function createRecoveryActivationProofV2(args:{
  sourceEpochId:string
  sourceManifestFingerprint:string
  sourceAnchor:RemoteAnchorV2
  successorStagingAnchor:RemoteAnchorV2
  sourceWriter:WriterAuthoritySnapshotV2
  successorEpochId:string
  successorManifestFingerprint:string
  successorRecoveryGeneration:number
  rotationKind:'normal'|'recovery_rekey'
  recoveryTransitionId:string|null
  announcementEnvelope:PreparedEnvelope
  confirmationEnvelope:PreparedEnvelope
  sourceWriterPrivateKey:CryptoKey
}):Promise<RecoveryActivationProofV2>{
  const core:Omit<RecoveryActivationProofV2,'activation_signature'>={
    format:'recovery-activation-proof-v2',version:2,source_profile:SINGLE_WRITER_V2_PROFILE,
    source_epoch_id:args.sourceEpochId,source_manifest_fingerprint:args.sourceManifestFingerprint,
    source_anchor_before_announcement:structuredClone(args.sourceAnchor),successor_staging_anchor:structuredClone(args.successorStagingAnchor),
    source_writer_generation:args.sourceWriter.writer_generation,source_writer_grant_id:args.sourceWriter.writer_grant_id,
    source_writer_device_id:args.sourceWriter.writer_device_id,source_writer_key_id:args.sourceWriter.writer_key_id,
    successor_epoch_id:args.successorEpochId,successor_manifest_fingerprint:args.successorManifestFingerprint,
    successor_recovery_generation:args.successorRecoveryGeneration,rotation_kind:args.rotationKind,
    recovery_transition_id:args.recoveryTransitionId,announcement_envelope:rowOf(args.announcementEnvelope),
    successor_confirmation_envelope:rowOf(args.confirmationEnvelope),
  }
  return{...core,activation_signature:await signEd25519V2(args.sourceWriterPrivateKey,recoveryActivationProofSigningBytes(core))}
}
export async function recoveryActivationProofHashV2(proof:RecoveryActivationProofV2):Promise<string>{
  return base64Url(await sha256(canonicalBytes(proof as never)))
}
export function extendActivationLineageV2(sourceRootKey:Uint8Array,sourceLineage:readonly unknown[],proof:RecoveryActivationProofV2):V2RotationActivationEntryV2[]{
  if(sourceRootKey.byteLength!==32)throw new Error('Native v2 rotation source RK must contain 32 bytes.')
  const entry:V2RotationActivationEntryV2={kind:'v2_rotation',source_profile:SINGLE_WRITER_V2_PROFILE,source_root_key:base64Url(sourceRootKey),proof}
  return[...(structuredClone(sourceLineage) as V2RotationActivationEntryV2[]),entry]
}
export async function activationLineageHashV2(lineage:readonly unknown[]):Promise<string>{
  return base64Url(await sha256(canonicalBytes(lineage as never)))
}
export async function verifyRecoveryActivationProofV2(args:{
  proof:RecoveryActivationProofV2
  source:CanonicalFullResultV2
  announcementEnvelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>
  confirmationEnvelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>
}):Promise<void>{
  const {proof,source}=args
  if(source.epoch_id!==proof.source_epoch_id||source.manifest_fingerprint!==proof.source_manifest_fingerprint
    ||!exactEqual(source.remote_anchor,proof.source_anchor_before_announcement))throw new Error('RecoveryActivationProofV2 source binding mismatch.')
  const writer=source.current_writer
  if(writer.source_epoch_sealed
    ||writer.writer_generation!==proof.source_writer_generation||writer.writer_grant_id!==proof.source_writer_grant_id
    ||writer.writer_device_id!==proof.source_writer_device_id||writer.writer_key_id!==proof.source_writer_key_id)throw new Error('RecoveryActivationProofV2 Writer binding mismatch.')
  if(!exactEqual(rowOf(args.announcementEnvelope),proof.announcement_envelope)
    ||!exactEqual(rowOf(args.confirmationEnvelope),proof.successor_confirmation_envelope))throw new Error('RecoveryActivationProofV2 prepared-envelope binding mismatch.')
  const {activation_signature,...core}=proof
  if(!await verifyEd25519V2(fixedBase64Url(writer.writer_public_key,32,'source_writer_public_key'),activation_signature,recoveryActivationProofSigningBytes(core)))throw new Error('RecoveryActivationProofV2 signature mismatch.')
}

function successorMigrationCopies(result:CanonicalFullResultV2,sourceEpochId:string):RevisionV2[]{
  const copies:RevisionV2[]=[]
  for(const revision of result.accepted_revision_graph.revisions.values()){
    if(revision.record_status==='control'||revision.migration_origin===null)continue
    if(revision.migration_origin.sources.some(source=>source.source_epoch_id===sourceEpochId))copies.push(revision)
  }
  return copies
}
export async function verifyNativeV2MigrationIntegrity(args:{
  source:CanonicalFullResultV2
  successor:CanonicalFullResultV2
  rotationKind:'normal'|'recovery_rekey'
  recoveryTransitionId:string|null
}):Promise<NativeV2SourceSnapshot>{
  const migration=args.successor.accepted_epoch_migration
  if(!migration||migration.migration_kind!==args.rotationKind)throw new Error('Native v2 rotation requires one accepted matching EpochMigrationV2.')
  validateEpochMigrationV2(migration)
  if(migration.source.source_epoch_id!==args.source.epoch_id
    ||migration.source.source_manifest_fingerprint!==args.source.manifest_fingerprint
    ||!exactEqual(migration.source.source_anchor,args.source.remote_anchor))throw new Error('Native v2 Migration source binding mismatch.')
  const snapshot=await nativeV2SourceSnapshot(args.source)
  if(migration.source.source_semantic_snapshot_hash!==snapshot.semantic_snapshot_hash
    ||migration.source.source_lineage_snapshot_hash!==snapshot.lineage_snapshot_hash
    ||migration.result_semantic_snapshot_hash!==snapshot.semantic_snapshot_hash
    ||migration.active_head_count!==snapshot.active_head_count
    ||migration.tombstone_head_count!==snapshot.tombstone_head_count)throw new Error('Native v2 Migration snapshot mismatch.')
  if(!migration.source_writer_authority||!exactEqual(migration.source_writer_authority,writerAuthority(args.source.current_writer)))throw new Error('Native v2 Migration Writer authority mismatch.')
  if(migration.source_recovery_transition_id!==args.recoveryTransitionId)throw new Error('Native v2 Migration Recovery transition mismatch.')
  const sourceByRevision=new Map(snapshot.heads.map(head=>[head.revision_id,head])),claimed=new Set<string>()
  const copies=successorMigrationCopies(args.successor,args.source.epoch_id)
  if(copies.length!==snapshot.heads.length)throw new Error('Native v2 migration provenance copy-count mismatch.')
  for(const target of copies){
    if(target.parent_revision_ids.length!==0||!target.migration_origin||target.migration_origin.sources.length!==1)throw new Error('Native v2 migration provenance mismatch.')
    const origin=target.migration_origin.sources[0]!
    if(origin.source_epoch_id!==args.source.epoch_id||origin.source_record_id!==target.record_id||origin.source_revision_ids.length!==1)throw new Error('Native v2 migration provenance mismatch.')
    const sourceHead=sourceByRevision.get(origin.source_revision_ids[0]!)
    if(!sourceHead||claimed.has(sourceHead.revision_id)||target.revision_id===sourceHead.revision_id)throw new Error('Native v2 migration provenance is not bijective.')
    if(target.record_type!==sourceHead.record_type||target.record_schema!==sourceHead.record_schema||target.record_id!==sourceHead.record_id
      ||target.record_status!==sourceHead.record_status||!exactEqual(target.record_data,sourceHead.record_data))throw new Error('Native v2 copied head changed Fachsemantik.')
    claimed.add(sourceHead.revision_id)
  }
  if(claimed.size!==snapshot.heads.length)throw new Error('Native v2 migration provenance is incomplete.')
  return snapshot
}
