import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE, TransportError, type RemoteSnapshot, type VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import type { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { base64Url, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { sha256 } from '../security/crypto/core'
import type { PreparedEnvelope } from '../security/envelopes'
import {
  activeProtocolSelectionV2,
  atomicSelectRotatedV2,
  openReadOnlyJoinRootWrapV6WithActiveMode,
  openSuccessorRootWrapV6WithActiveMode,
  prepareSuccessorRootWrapV6ForActiveMode,
} from './localDatabase'
import {
  verifyActivationForJoin,
  verifyCurrentRecoveryTransitionForJoin,
  type ActiveCandidateV2,
} from './readOnlyJoinV2Service'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import {
  manifestCellsArrayV6,
  openManifestV6,
  parseManifestCellsV6,
  prepareManifestV6,
  manifestFingerprintV6,
  V6_PROTOCOL_LIMITS,
  type ProtectedManifestV6,
} from '../security/v2/manifest'
import {
  IndexedDbV2LocalSecurityStore,
  type EnvelopeReservationV6,
  type PreparedEnvelopeAuthorityV2,
} from '../security/v2/localPersistence'
import {
  localJournalInitialV2,
  recoveryCredentialHistoryHashV2,
  type EpochLocalSecurityStateV6,
  type StoredWriterDeviceKeyV2,
} from '../security/v2/localState'
import {
  createRecoveryArtifactV6,
  openRecoveryArtifactV6,
  recoveryArtifactHashV6,
  recoveryArtifactLocatorV6,
  type ActivationLineageV2,
  type RecoveryArtifactV6,
  type RecoveryPayloadV6,
} from '../security/v2/recovery'
import { createRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'
import { sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import {
  activationLineageHashV2,
  copyV2HeadForRotation,
  createNativeV2MigrationRevision,
  createRecoveryActivationProofV2,
  createRotationAnnouncementRevisionV2,
  createV2RotationConfirmationRevision,
  extendActivationLineageV2,
  nativeV2SourceSnapshot,
  recoveryActivationProofHashV2,
  verifyNativeV2MigrationIntegrity,
  verifyRecoveryActivationProofV2,
  type NativeV2SourceSnapshot,
} from '../security/v2/nativeRotation'
import {
  rotationOperationStateHashV2,
  runProfileUpgradeStateMachineV2,
  type ProfileUpgradeOrchestratorV2Dependencies,
  type RotationOperationStageV2,
  type RotationOperationStateV2,
} from '../security/v2/profileUpgrade'
import {
  SINGLE_WRITER_V2_SCHEMA_ALLOWLIST,
  type RevisionV2,
  type WriterContextV2,
} from '../security/v2/types'
import { V2_SCHEMA_REGISTRY_HASH } from '../security/v2/schemaRegistry'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import { assertExtendsAnchorV2, createAnchorV2 } from '../security/v2/prefix'
import { TransferableSingleWriterV2Verifier, type CanonicalFullResultV2, type WriterAuthoritySnapshotV2 } from '../security/v2/verifier'
import { createBackupV6, testRestoreBackupV6, type SyncBackupV6 } from '../security/v2/backup'
import { createActivationLineageCacheV2 } from '../security/v2/activationLineageCache'
import type { RecoveryRekeyOperationStateV2 } from '../security/v2/recoveryRekeyOperation'

type Row=readonly[string,string,string]

export type NativeRotationV2FaultPoint=
  | `after-${RotationOperationStageV2}`
  | 'after-source-freeze'
  | 'after-successor-plan'
  | 'after-source-append'
  | 'after-confirmation-append'
  | 'after-local-state-switch'
  | 'after-active-selection-switch'

interface NativeSourceFreezeArtifactV2 {
  format:'native-v2-source-freeze-v2'
  operation_id:string
  rotation_kind:'normal'|'recovery_rekey'
  recovery_transition_id:string|null
  diary_id:string
  source_epoch_id:string
  source_manifest_fingerprint:string
  source_remote_id:string
  source_account_binding:string
  source_anchor:CanonicalFullResultV2['remote_anchor']
  source_writer:WriterAuthoritySnapshotV2
  source_recovery:CanonicalFullResultV2['current_recovery']
  recovery_credential_history:CanonicalFullResultV2['recovery_credential_history']
  source_recovery_artifact_sha256:string
  source_activation_lineage:ActivationLineageV2
  source_activation_lineage_sha256:string
  source_semantic_snapshot_hash:string
  source_lineage_snapshot_hash:string
  source_active_head_count:number
  source_tombstone_head_count:number
  source_head_revision_ids:string[]
  created_at:string
}
interface NativeSuccessorPlanArtifactV2 {
  format:'native-v2-successor-plan-v2'
  operation_id:string
  rotation_kind:'normal'|'recovery_rekey'
  recovery_transition_id:string|null
  diary_id:string
  source_epoch_id:string
  successor_epoch_id:string
  key_id:string
  wrap_id:string
  creation_locator:string
  manifest_cells:[string,string,string,string]
  manifest_fingerprint:string
  writer_device_id:string
  writer_key_id:string
  writer_public_key:string
  writer_generation:number
  writer_grant_id:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
  recovery_credential_history:CanonicalFullResultV2['recovery_credential_history']
  source_recovery_artifact_sha256:string
  google_account_binding:string
  created_at:string
}
interface NativeSuccessorRemoteArtifactV2 {remote_id:string}
interface NativeActivationArtifactV2 {
  lineage:ActivationLineageV2
  proof:ActivationLineageV2[number] extends infer T ? T extends {kind:'v2_rotation';proof:infer P}?P:never:never
  recovery_artifact:RecoveryArtifactV6
}
interface NativeBackupArtifactV2 {backup:SyncBackupV6;anchor:CanonicalFullResultV2['remote_anchor']}

class NativeRotationPreCutoverStaleError extends Error {}
class NativeRotationCutoverRaceError extends Error {}

function same(a:unknown,b:unknown):boolean{return new TextDecoder().decode(canonicalBytes(a as never))===new TextDecoder().decode(canonicalBytes(b as never))}
function canonical(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Native v2 rotation requires a v2 canonical verifier result.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Native v2 rotation requires canonical_full.')
  return result
}
function asRow(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Row{return[envelope.envelopeId,envelope.iv,envelope.ciphertext]}
function preparedFromRow(row:Row):PreparedEnvelope{return{envelopeId:row[0],iv:row[1],ciphertext:row[2],bytesHash:''}}
function uniqueRows(rows:ReadonlyArray<readonly string[]>):Row[]{
  const byId=new Map<string,Row>(),ordered:Row[]=[]
  for(const row of rows){
    if(row.length!==3)throw new Error('Native v2 rotation remote row shape mismatch.')
    const candidate=[row[0]!,row[1]!,row[2]!] as Row,prior=byId.get(candidate[0])
    if(prior){if(!same(prior,candidate))throw new Error('Native v2 rotation envelope ID has different bytes.');continue}
    byId.set(candidate[0],candidate);ordered.push(candidate)
  }
  return ordered
}
function requirePlannedPrefix(actual:ReadonlyArray<readonly string[]>,planned:readonly Row[]):number{
  const unique=uniqueRows(actual)
  if(unique.length>planned.length)throw new Error('Native v2 Successor contains an unplanned semantic row.')
  for(let i=0;i<unique.length;i+=1)if(!same(unique[i],planned[i]))throw new Error('Native v2 Successor prefix differs from the persisted one-shot plan.')
  return unique.length
}
async function deterministicBytes(operationId:string,label:string,length:number):Promise<Uint8Array>{
  return(await sha256(canonicalBytes(['native-v2-rotation',operationId,label] as never))).slice(0,length)
}
async function deterministicId(operationId:string,label:string,length:number):Promise<string>{return base64Url(await deterministicBytes(operationId,label,length))}
function writerContext(writer:WriterAuthoritySnapshotV2):WriterContextV2{return{writer_generation:writer.writer_generation,writer_grant_id:writer.writer_grant_id,writer_device_id:writer.writer_device_id,writer_key_id:writer.writer_key_id}}
function writerAuthority(writer:WriterAuthoritySnapshotV2):PreparedEnvelopeAuthorityV2{return{writer_generation:writer.writer_generation,writer_grant_id:writer.writer_grant_id,writer_device_id:writer.writer_device_id,writer_key_id:writer.writer_key_id}}

export class ProductiveNativeRotationV2Service implements ProfileUpgradeOrchestratorV2Dependencies {
  private operationId:string|null=null
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly urs:Uint8Array,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly now:()=>string=()=>new Date().toISOString(),
    private readonly fault?:(point:NativeRotationV2FaultPoint)=>void|Promise<void>,
  ){
    if(session.profileId!==SINGLE_WRITER_V2_PROFILE||session.providerId!==GOOGLE_DRIVE_SHEETS_PROVIDER)throw new Error('Native v2 rotation requires the authenticated v2 provider session.')
    if(urs.byteLength!==32)throw new Error('Native v2 rotation requires the current 32-byte Recovery Key.')
  }

  private artifactId(suffix:string):string{return`${this.requireOperationId()}:native-rotation:${suffix}`}
  private requireOperationId():string{if(!this.operationId)throw new Error('Native v2 rotation operation is not initialized.');return this.operationId}
  private artifact<T>(suffix:string):Promise<T|null>{return this.store.operationArtifact<T>(this.artifactId(suffix))}
  private async putArtifact(suffix:string,value:unknown):Promise<void>{await this.store.putImmutableOperationArtifact(this.artifactId(suffix),value)}
  private async hit(stage:RotationOperationStageV2|NativeRotationV2FaultPoint):Promise<void>{await this.fault?.(String(stage).startsWith('after-')?stage as NativeRotationV2FaultPoint:`after-${stage}` as NativeRotationV2FaultPoint)}

  private async rootForEpoch(epochId:string):Promise<Uint8Array>{
    return openReadOnlyJoinRootWrapV6WithActiveMode(await this.store.loadRootWrapV6(epochId))
  }
  private async stateAndRoot(epochId:string):Promise<{state:EpochLocalSecurityStateV6;rootKey:Uint8Array;epochSalt:Uint8Array}>{
    const rootKey=await this.rootForEpoch(epochId),selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('No active v2 protocol selection exists.')
    const diaryId=selection.diary_id,epochSalt=await deriveEpochSaltV2(fixedBase64Url(diaryId,16),fixedBase64Url(epochId,16))
    return{state:await this.store.loadState(rootKey,epochSalt,epochId),rootKey,epochSalt}
  }

  private async sourceContext():Promise<{freeze:NativeSourceFreezeArtifactV2;state:EpochLocalSecurityStateV6;rootKey:Uint8Array;epochSalt:Uint8Array;transport:GoogleSheetsTransferableSingleWriterV2Transport;codec:GoogleSheetsTransferableSingleWriterV2ProfileCodec}>{
    const freeze=await this.artifact<NativeSourceFreezeArtifactV2>('source-freeze')
    if(!freeze)throw new Error('Native v2 Source freeze artifact is missing.')
    const rootKey=await this.rootForEpoch(freeze.source_epoch_id),epochSalt=await deriveEpochSaltV2(fixedBase64Url(freeze.diary_id,16),fixedBase64Url(freeze.source_epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,freeze.source_epoch_id)
    const binding=state.remote_binding
    if(!binding||binding.sync_profile!==SINGLE_WRITER_V2_PROFILE||binding.remote_resource_id!==freeze.source_remote_id||binding.remote_identity_binding!==freeze.source_account_binding)throw new Error('Native v2 Source remote binding changed.')
    const transport=await this.session.transportForEpoch(freeze.diary_id,freeze.source_epoch_id)
    if(await this.session.remoteIdentityBinding(transport)!==freeze.source_account_binding)throw new Error('Native v2 Source authenticated account changed.')
    const codec=await this.session.codecForEpoch(freeze.diary_id,freeze.source_epoch_id,rootKey,transport)
    return{freeze,state,rootKey,epochSalt,transport,codec}
  }

  private async sourceArtifact(context:Awaited<ReturnType<ProductiveNativeRotationV2Service['sourceContext']>>):Promise<{artifact:RecoveryArtifactV6;payload:RecoveryPayloadV6}>{
    const artifact=await this.session.loadRecoveryArtifact(this.urs,context.freeze.diary_id,context.freeze.source_epoch_id)
    if(await recoveryArtifactHashV6(artifact)!==context.freeze.source_recovery_artifact_sha256)throw new Error('Native v2 Source RecoveryArtifactV6 changed after freeze.')
    const opened=await openRecoveryArtifactV6(artifact,this.urs)
    if(base64Url(opened.rootKey)!==base64Url(context.rootKey))throw new Error('Native v2 Source RecoveryArtifactV6 root changed.')
    return{artifact,payload:opened.payload}
  }

  private async exactFrozenSource(allowAnnouncement:boolean):Promise<{context:Awaited<ReturnType<ProductiveNativeRotationV2Service['sourceContext']>>;snapshot:RemoteSnapshot;verified:VerifiedRemoteState;result:CanonicalFullResultV2;announcementCount:number}>{
    const context=await this.sourceContext(),operation=await this.load(),snapshot=await context.transport.read(context.freeze.source_remote_id)
    const prefix=snapshot.rows.slice(0,context.freeze.source_anchor.covered_row_count)
    if(!same(await createAnchorV2(context.freeze.diary_id,context.freeze.source_epoch_id,prefix),context.freeze.source_anchor))throw new Error('Native v2 frozen Source prefix changed.')
    const suffix=snapshot.rows.slice(context.freeze.source_anchor.covered_row_count),announcement=operation.announcement_envelope
    if(!suffix.length){
      const verified=await context.codec.verifyRemote(snapshot),result=canonical(verified)
      if(result.source_epoch_sealed)throw new NativeRotationPreCutoverStaleError('Native v2 Source became sealed before this rotation Announcement.')
      return{context,snapshot,verified,result,announcementCount:0}
    }
    if(!allowAnnouncement||!announcement)throw new NativeRotationPreCutoverStaleError('Native v2 Source advanced after freeze.')
    const expected:Row=[announcement.envelope_id,announcement.iv,announcement.ciphertext]
    if(!same(suffix[0],expected))throw new NativeRotationPreCutoverStaleError('Native v2 Source first post-freeze row is not the one-shot Announcement.')
    let count=0
    while(count<suffix.length&&same(suffix[count],expected))count+=1
    const verified=await context.codec.verifyRemote(snapshot),result=canonical(verified)
    if(!result.source_epoch_sealed||!verified.acceptedEnvelopeIds.has(announcement.envelope_id))throw new Error('Native v2 Source Announcement did not canonically seal the Source.')
    return{context,snapshot,verified,result,announcementCount:count}
  }

  private async reconcileSource(value:Awaited<ReturnType<ProductiveNativeRotationV2Service['exactFrozenSource']>>):Promise<EpochLocalSecurityStateV6>{
    const key=await this.store.loadWriterKey(value.context.state.writer_signing_key_id,value.context.state.diary_id,value.context.state.epoch_id)
    const current=await this.store.loadState(value.context.rootKey,value.context.epochSalt,value.context.state.epoch_id)
    const next=await stateAfterCanonicalVerifyV6(current,value.result,value.snapshot.rows,key!==null&&key.writer_device_id===current.writer_device_id)
    return this.store.commitVerifiedDispositions(value.context.rootKey,value.context.epochSalt,current.operation_generation,next,value.verified.acceptedEnvelopeIds,value.verified.staleWriterEnvelopeIds,{
      remote_rows:value.snapshot.rows,current_writer:{
        writer_generation:value.result.current_writer.writer_generation,writer_grant_id:value.result.current_writer.writer_grant_id,
        writer_device_id:value.result.current_writer.writer_device_id,writer_key_id:value.result.current_writer.writer_key_id,
      },source_epoch_sealed:value.result.source_epoch_sealed,recovery_rekey_rotation_required:value.result.current_recovery.recovery_rekey_rotation_required,
    })
  }

  private async freezeSource(kind:'normal'|'recovery_rekey',transitionId:string|null):Promise<RotationOperationStateV2>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('Native v2 rotation requires an active v2 selection.')
    const rootKey=await this.rootForEpoch(selection.epoch_id),epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
    let state=await this.store.loadState(rootKey,epochSalt,selection.epoch_id)
    if(state.diary_id!==selection.diary_id||state.manifest_fingerprint!==selection.manifest_fingerprint||state.epoch_status!=='active'||state.writer_status!=='writer_active'||!state.remote_binding||!state.remote_anchor)throw new Error('Native v2 rotation requires the active authenticated local Writer.')
    const binding=state.remote_binding
    if(state.writer_operation_state_ref&& !['durable','stale'].includes(state.writer_operation_state_ref.state))throw new Error('Native v2 rotation is blocked by a WriterGrant ceremony.')
    if(state.migration_state_ref!==null)throw new Error('Native v2 rotation is blocked by migration state.')
    const recoveryOp=state.recovery_operation_state_ref?await this.store.loadBoundRecoveryRekeyOperation(rootKey,epochSalt,state.epoch_id):null
    if(kind==='normal'){
      if(state.recovery_rekey_rotation_required||transitionId!==null)throw new Error('Normal v2 rotation is forbidden while Recovery-Rekey is pending.')
      if(recoveryOp&&!['completed','stale','superseded'].includes(recoveryOp.stage))throw new Error('Normal v2 rotation is blocked by a non-terminal Recovery-Rekey operation.')
    }else{
      if(!state.recovery_rekey_rotation_required||!state.recovery_rekey_transition_id||transitionId!==state.recovery_rekey_transition_id)throw new Error('Recovery-rekey rotation must bind the exact current Recovery transition.')
      if(!recoveryOp||recoveryOp.stage!=='successor_rotation_required'||recoveryOp.transition_id!==transitionId)throw new Error('Recovery-rekey rotation requires RecoveryRekeyOperationStateV2 successor_rotation_required.')
    }
    const unresolved=(await this.store.outbox(rootKey,epochSalt,state.epoch_id)).filter(entry=>entry.ceremony_owner===undefined&&entry.authority!==null&&(entry.status==='prepared'||entry.status==='pending'))
    if(unresolved.length)throw new Error('Native v2 rotation requires all normal Writer outbox rows to be canonically resolved before freeze.')

    const transport=await this.session.transportForEpoch(state.diary_id,state.epoch_id)
    if(await this.session.remoteIdentityBinding(transport)!==binding.remote_identity_binding)throw new Error('Native v2 Source authenticated identity changed.')
    const codec=await this.session.codecForEpoch(state.diary_id,state.epoch_id,rootKey,transport),snapshot=await transport.read(binding.remote_resource_id)
    const verified=await codec.verifyRemote(snapshot),result=canonical(verified)
    if(result.source_epoch_sealed||result.activation_state==='staged_confirmation_missing')throw new Error('Native v2 rotation Source is not an active fully activated epoch.')
    state=await this.reconcileSource({context:{freeze:{
      format:'native-v2-source-freeze-v2',operation_id:base64Url(new Uint8Array(32)),rotation_kind:kind,recovery_transition_id:transitionId,
      diary_id:state.diary_id,source_epoch_id:state.epoch_id,source_manifest_fingerprint:state.manifest_fingerprint,source_remote_id:binding.remote_resource_id,
      source_account_binding:binding.remote_identity_binding,source_anchor:result.remote_anchor,source_writer:result.current_writer,source_recovery:result.current_recovery,
      recovery_credential_history:result.recovery_credential_history,source_recovery_artifact_sha256:base64Url(new Uint8Array(32)),source_activation_lineage:[],
      source_activation_lineage_sha256:base64Url(new Uint8Array(32)),source_semantic_snapshot_hash:base64Url(new Uint8Array(32)),source_lineage_snapshot_hash:base64Url(new Uint8Array(32)),
      source_active_head_count:0,source_tombstone_head_count:0,source_head_revision_ids:[],created_at:this.now(),
    },state,rootKey,epochSalt,transport,codec},snapshot,verified,result,announcementCount:0})
    if(state.writer_status!=='writer_active'||state.writer_generation!==result.current_writer.writer_generation||state.writer_grant_id!==result.current_writer.writer_grant_id
      ||state.writer_device_id!==result.current_writer.writer_device_id||state.writer_signing_key_id!==result.current_writer.writer_key_id)throw new Error('Native v2 Source local Writer does not match fresh canonical authority.')
    const key=await this.store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
    if(!key||key.writer_device_id!==state.writer_device_id||key.writer_public_key!==result.current_writer.writer_public_key)throw new Error('Native v2 Source WriterDeviceKeyV2 is missing or changed.')

    const artifact=await this.session.loadRecoveryArtifact(this.urs,state.diary_id,state.epoch_id),opened=await openRecoveryArtifactV6(artifact,this.urs),manifest=await openManifestV6(rootKey,epochSalt,{diaryId:state.diary_id,epochId:state.epoch_id},parseManifestCellsV6(snapshot.manifest))
    if(base64Url(opened.rootKey)!==base64Url(rootKey)||opened.payload.manifest_fingerprint!==state.manifest_fingerprint||opened.payload.google_account_binding!==binding.remote_identity_binding
      ||opened.payload.recovery_generation!==result.current_recovery.recovery_generation||opened.payload.recovery_urs_commitment!==result.current_recovery.recovery_urs_commitment
      ||opened.payload.recovery_urs_id!==result.current_recovery.recovery_urs_id||opened.payload.recovery_takeover_key_id!==result.current_recovery.recovery_takeover_key_id
      ||opened.payload.recovery_takeover_public_key!==result.current_recovery.recovery_takeover_public_key||!same(opened.payload.recovery_credential_history,result.recovery_credential_history))throw new Error('Native v2 Source RecoveryArtifactV6 is not current.')
    await assertExtendsAnchorV2(opened.payload.remote_anchor,state.diary_id,state.epoch_id,snapshot.rows)
    const candidate:ActiveCandidateV2={artifact,artifactSha256:await recoveryArtifactHashV6(artifact),rootKey,payload:opened.payload,manifest,snapshot,verified,result,remoteId:binding.remote_resource_id,accountBinding:binding.remote_identity_binding}
    await verifyCurrentRecoveryTransitionForJoin(candidate);await verifyActivationForJoin(this.session,candidate)
    if(opened.payload.activation_lineage.length){
      const cache=await this.store.loadActivationLineageCache(rootKey,epochSalt,state.epoch_id)
      const openedCache=(await import('../security/v2/activationLineageCache')).openActivationLineageCacheV2
      const lineage=await openedCache({cache,rootKey,epochSalt,diaryId:state.diary_id,epochId:state.epoch_id,manifestFingerprint:state.manifest_fingerprint})
      if(!same(lineage,opened.payload.activation_lineage))throw new Error('Native v2 Source local ActivationLineageCacheV2 differs from RecoveryArtifactV6.')
    }else if(state.activation_lineage_cache_ref!==null)throw new Error('Native v2 Source unexpectedly references activation lineage for a native epoch.')

    const sourceSnapshot=await nativeV2SourceSnapshot(result),operationId=base64Url(randomBytes(32)),successorEpochId=base64Url(randomBytes(16)),createdAt=this.now()
    const freeze:NativeSourceFreezeArtifactV2={
      format:'native-v2-source-freeze-v2',operation_id:operationId,rotation_kind:kind,recovery_transition_id:transitionId,
      diary_id:state.diary_id,source_epoch_id:state.epoch_id,source_manifest_fingerprint:state.manifest_fingerprint,
      source_remote_id:binding.remote_resource_id,source_account_binding:binding.remote_identity_binding,
      source_anchor:{...result.remote_anchor},source_writer:{...result.current_writer},source_recovery:{...result.current_recovery},
      recovery_credential_history:result.recovery_credential_history.map(entry=>({...entry})),source_recovery_artifact_sha256:await recoveryArtifactHashV6(artifact),
      source_activation_lineage:structuredClone(opened.payload.activation_lineage),source_activation_lineage_sha256:await activationLineageHashV2(opened.payload.activation_lineage),
      source_semantic_snapshot_hash:sourceSnapshot.semantic_snapshot_hash,source_lineage_snapshot_hash:sourceSnapshot.lineage_snapshot_hash,
      source_active_head_count:sourceSnapshot.active_head_count,source_tombstone_head_count:sourceSnapshot.tombstone_head_count,
      source_head_revision_ids:sourceSnapshot.heads.map(head=>head.revision_id),created_at:createdAt,
    }
    const operation:RotationOperationStateV2={
      format:'rotation-operation-v2',version:2,operation_id:operationId,rotation_kind:kind,source_epoch_id:state.epoch_id,successor_epoch_id:successorEpochId,
      stage:'source_frozen_verified',source_anchor_before_announcement:{...result.remote_anchor},successor_staging_anchor:null,successor_activation_anchor:null,
      successor_creation_locator:null,successor_manifest_fingerprint:null,source_recovery_transition_id:transitionId,activation_lineage_sha256:null,
      announcement_envelope:null,confirmation_envelope:null,activation_evidence_sha256:null,recovery_artifact_id:null,recovery_artifact_locator:null,recovery_artifact_sha256:null,
      staged_backup_id:null,activated_backup_id:null,
    }
    this.operationId=operationId
    await this.store.initializeNativeSourceRotationBundle({rootKey,epochSalt,expectedOperationGeneration:state.operation_generation,operation,artifactId:this.artifactId('source-freeze'),artifactValue:freeze})
    await this.fault?.('after-source-freeze')
    return operation
  }

  async rotate(kind:'normal'|'recovery_rekey'='normal',transitionId:string|null=null):Promise<RotationOperationStateV2>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('Native v2 rotation requires an active v2 selection.')
    const active=await this.stateAndRoot(selection.epoch_id),ref=active.state.rotation_state_ref
    let operation:RotationOperationStateV2|null=null
    if(ref){
      try{const found=await this.store.loadRotationOperation(ref.operation_id);if(found.rotation_kind!=='profile_upgrade'&&!['stale','cutover_race','post_activation_superseded'].includes(found.stage))operation=found}catch{/* terminal historical ref or missing op is handled as a new rotation */}
    }
    if(operation){
      this.operationId=operation.operation_id
      if(operation.stage!=='switched'&&(operation.rotation_kind!==kind||operation.source_recovery_transition_id!==transitionId))throw new Error('A different native v2 Rotation operation is already resumable.')
    }else operation=await this.freezeSource(kind,transitionId)
    this.operationId=operation.operation_id
    const result=await runProfileUpgradeStateMachineV2(this)
    if(result.stage==='switched'&&result.rotation_kind==='recovery_rekey')await this.completeBoundRecoveryRekey(result)
    return result
  }

  async load():Promise<RotationOperationStateV2>{
    const operation=await this.store.loadRotationOperation(this.requireOperationId()),freeze=await this.artifact<NativeSourceFreezeArtifactV2>('source-freeze')
    if(!freeze||freeze.operation_id!==operation.operation_id)throw new Error('Native v2 rotation Source freeze binding is missing.')
    const sourceRoot=await this.rootForEpoch(operation.source_epoch_id),sourceSalt=await deriveEpochSaltV2(fixedBase64Url(freeze.diary_id,16),fixedBase64Url(operation.source_epoch_id,16))
    const sourceState=await this.store.loadState(sourceRoot,sourceSalt,operation.source_epoch_id),hash=await rotationOperationStateHashV2(operation)
    if(!sourceState.rotation_state_ref||sourceState.rotation_state_ref.operation_id!==operation.operation_id||sourceState.rotation_state_ref.state!==operation.stage||sourceState.rotation_state_ref.state_record_hash!==hash){
      await this.store.bindSourceRotationOperationToState(sourceRoot,sourceSalt,operation.source_epoch_id,operation,sourceState.operation_generation)
    }
    const plan=await this.artifact<NativeSuccessorPlanArtifactV2>('successor-plan')
    if(plan){
      const root=await this.successorRoot(),salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16)),state=await this.store.loadState(root,salt,plan.successor_epoch_id)
      if(!state.rotation_state_ref||state.rotation_state_ref.operation_id!==operation.operation_id||state.rotation_state_ref.state!==operation.stage||state.rotation_state_ref.state_record_hash!==hash){
        await this.store.bindRotationOperationToState(root,salt,plan.successor_epoch_id,operation,state.operation_generation)
      }
    }
    return operation
  }

  async persist(current:RotationOperationStateV2,next:RotationOperationStateV2):Promise<RotationOperationStateV2>{
    await this.store.advanceRotationOperation(current.stage,next)
    const freeze=await this.artifact<NativeSourceFreezeArtifactV2>('source-freeze')
    if(!freeze)throw new Error('Native v2 Source freeze artifact is missing during operation transition.')
    const sourceRoot=await this.rootForEpoch(current.source_epoch_id),sourceSalt=await deriveEpochSaltV2(fixedBase64Url(freeze.diary_id,16),fixedBase64Url(current.source_epoch_id,16)),sourceState=await this.store.loadState(sourceRoot,sourceSalt,current.source_epoch_id)
    await this.store.bindSourceRotationOperationToState(sourceRoot,sourceSalt,current.source_epoch_id,next,sourceState.operation_generation)
    const plan=await this.artifact<NativeSuccessorPlanArtifactV2>('successor-plan')
    if(plan){
      const root=await this.successorRoot(),salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16)),state=await this.store.loadState(root,salt,plan.successor_epoch_id)
      await this.store.bindRotationOperationToState(root,salt,plan.successor_epoch_id,next,state.operation_generation)
    }
    await this.hit(next.stage)
    return next
  }

  private async sourceSnapshot():Promise<{freeze:NativeSourceFreezeArtifactV2;context:Awaited<ReturnType<ProductiveNativeRotationV2Service['sourceContext']>>;result:CanonicalFullResultV2;snapshot:NativeV2SourceSnapshot}>{
    const frozen=await this.exactFrozenSource(false),snapshot=await nativeV2SourceSnapshot(frozen.result),freeze=frozen.context.freeze
    if(!same(frozen.result.remote_anchor,freeze.source_anchor)||snapshot.semantic_snapshot_hash!==freeze.source_semantic_snapshot_hash||snapshot.lineage_snapshot_hash!==freeze.source_lineage_snapshot_hash
      ||snapshot.active_head_count!==freeze.source_active_head_count||snapshot.tombstone_head_count!==freeze.source_tombstone_head_count
      ||snapshot.heads.map(head=>head.revision_id).join('\0')!==freeze.source_head_revision_ids.join('\0'))throw new NativeRotationPreCutoverStaleError('Native v2 Source semantic/lineage snapshot changed after freeze.')
    return{freeze,context:frozen.context,result:frozen.result,snapshot}
  }

  async planSuccessor():Promise<{creationLocator:string}>{
    const existing=await this.artifact<NativeSuccessorPlanArtifactV2>('successor-plan')
    if(existing)return{creationLocator:existing.creation_locator}
    const operation=await this.load()
    if(operation.stage!=='source_frozen_verified')throw new Error('Native v2 Successor may only be planned from source_frozen_verified.')
    const source=await this.sourceSnapshot(),sourceArtifact=await this.sourceArtifact(source.context),rootKey=randomBytes(32)
    if(base64Url(rootKey)===base64Url(source.context.rootKey)||sourceArtifact.payload.activation_lineage.some(entry=>entry.kind==='profile_upgrade'?entry.source_root_key===base64Url(rootKey):entry.source_root_key===base64Url(rootKey)))throw new Error('successor_root_key_reuse')
    const keyId=base64Url(randomBytes(16)),wrapId=randomBytes(16),creationLocator=base64Url(randomBytes(16))
    const writer=await this.store.loadWriterKey(source.result.current_writer.writer_key_id,source.freeze.diary_id,source.freeze.source_epoch_id)
    if(!writer||writer.writer_device_id!==source.result.current_writer.writer_device_id||writer.writer_public_key!==source.result.current_writer.writer_public_key)throw new Error('Native v2 carried WriterDeviceKeyV2 is missing.')
    const transport=await this.session.transportForEpoch(source.freeze.diary_id,operation.successor_epoch_id),account=await this.session.remoteIdentityBinding(transport)
    if(account!==source.freeze.source_account_binding)throw new Error('Native v2 Successor account binding differs from Source.')
    const salt=await deriveEpochSaltV2(fixedBase64Url(source.freeze.diary_id,16),fixedBase64Url(operation.successor_epoch_id,16)),createdAt=this.now()
    const recovery=source.result.current_recovery
    const manifestPayload:ProtectedManifestV6={
      diary_id:source.freeze.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,creation_locator:creationLocator,
      recovery_generation:recovery.recovery_generation,recovery_urs_commitment:recovery.recovery_urs_commitment,recovery_urs_id:recovery.recovery_urs_id,
      recovery_credential_history:source.result.recovery_credential_history.map(entry=>({...entry})),diary_marker:'epoch-manifest-v6',
      crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6',sync_profile:SINGLE_WRITER_V2_PROFILE,created_at:createdAt,google_account_binding:account,
      predecessor_epochs:[{epoch_id:source.freeze.source_epoch_id,manifest_fingerprint:source.freeze.source_manifest_fingerprint}],
      record_schema_allowlist:[...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST],record_schema_registry_hash:V2_SCHEMA_REGISTRY_HASH,protocol_limits:V6_PROTOCOL_LIMITS,
      epoch_start_authority_mode:'carried_from_predecessor',epoch_start_writer_generation:source.result.current_writer.writer_generation,
      epoch_start_writer_grant_id:source.result.current_writer.writer_grant_id,epoch_start_writer_device_id:source.result.current_writer.writer_device_id,
      epoch_start_writer_key_id:source.result.current_writer.writer_key_id,epoch_start_writer_public_key:source.result.current_writer.writer_public_key,
      recovery_takeover_key_id:recovery.recovery_takeover_key_id,recovery_takeover_public_key:recovery.recovery_takeover_public_key,
    }
    const manifest=await prepareManifestV6(rootKey,salt,{diaryId:source.freeze.diary_id,epochId:operation.successor_epoch_id},manifestPayload),fingerprint=await manifestFingerprintV6(manifest)
    const privatePkcs8=fromBase64Url(sourceArtifact.payload.recovery_takeover_private_key_pkcs8)
    const staging=await createRecoveryTakeoverStagingV2({
      diaryId:source.freeze.diary_id,epochId:operation.successor_epoch_id,recoveryGeneration:recovery.recovery_generation,
      recoveryTakeoverKeyId:recovery.recovery_takeover_key_id,recoveryTakeoverPublicKey:recovery.recovery_takeover_public_key,
      recoveryTakeoverPrivateKeyPkcs8:privatePkcs8,manifestFingerprint:fingerprint,urs:this.urs,
    })
    privatePkcs8.fill(0)
    const preparedWrap=await prepareSuccessorRootWrapV6ForActiveMode(rootKey,{diary_id:source.freeze.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,manifest_fingerprint:fingerprint},wrapId)
    const state:EpochLocalSecurityStateV6={
      local_state_version:6,diary_id:source.freeze.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,manifest_fingerprint:fingerprint,
      recovery_generation:recovery.recovery_generation,recovery_urs_commitment:recovery.recovery_urs_commitment,recovery_urs_id:recovery.recovery_urs_id,
      recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null,remote_binding:null,remote_anchor:null,epoch_status:'local_offline',
      operation_generation:0,rotation_state_ref:null,migration_state_ref:null,writer_operation_state_ref:null,recovery_operation_state_ref:null,activation_lineage_cache_ref:null,
      local_journal_count:0,local_journal_hash:await localJournalInitialV2(source.freeze.diary_id,operation.successor_epoch_id),
      writer_status:'read_only',writer_device_id:source.result.current_writer.writer_device_id,writer_signing_key_id:source.result.current_writer.writer_key_id,
      writer_generation:null,writer_grant_id:null,verified_writer_device_id:null,verified_writer_key_id:null,verified_writer_generation:null,verified_writer_grant_id:null,
      recovery_takeover_key_id:recovery.recovery_takeover_key_id,recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(source.result.recovery_credential_history),
      stale_writer_pending_count:0,
    }
    const plan:NativeSuccessorPlanArtifactV2={
      format:'native-v2-successor-plan-v2',operation_id:operation.operation_id,rotation_kind:operation.rotation_kind as 'normal'|'recovery_rekey',
      recovery_transition_id:operation.source_recovery_transition_id,diary_id:source.freeze.diary_id,source_epoch_id:source.freeze.source_epoch_id,
      successor_epoch_id:operation.successor_epoch_id,key_id:keyId,wrap_id:preparedWrap.wrap.wrap_id,creation_locator:creationLocator,
      manifest_cells:[...manifestCellsArrayV6(manifest)] as [string,string,string,string],manifest_fingerprint:fingerprint,
      writer_device_id:source.result.current_writer.writer_device_id,writer_key_id:source.result.current_writer.writer_key_id,writer_public_key:source.result.current_writer.writer_public_key,
      writer_generation:source.result.current_writer.writer_generation,writer_grant_id:source.result.current_writer.writer_grant_id,
      recovery_generation:recovery.recovery_generation,recovery_urs_commitment:recovery.recovery_urs_commitment,recovery_urs_id:recovery.recovery_urs_id,
      recovery_takeover_key_id:recovery.recovery_takeover_key_id,recovery_takeover_public_key:recovery.recovery_takeover_public_key,
      recovery_credential_history:source.result.recovery_credential_history.map(entry=>({...entry})),source_recovery_artifact_sha256:source.freeze.source_recovery_artifact_sha256,
      google_account_binding:account,created_at:createdAt,
    }
    await this.store.persistNativeRotationSuccessorPlanBundle({artifactId:this.artifactId('successor-plan'),artifactValue:plan,rootKey,epochSalt:salt,rootWrap:preparedWrap.wrap,bestEffortWrappingKey:preparedWrap.bestEffortWrappingKey,writerKey:writer,recoveryStaging:staging,urs:this.urs,state})
    rootKey.fill(0);await this.fault?.('after-successor-plan')
    return{creationLocator}
  }

  private async plan():Promise<NativeSuccessorPlanArtifactV2>{const plan=await this.artifact<NativeSuccessorPlanArtifactV2>('successor-plan');if(!plan)throw new Error('Native v2 Successor plan is missing.');return plan}
  private async successorRoot():Promise<Uint8Array>{const plan=await this.plan();return openSuccessorRootWrapV6WithActiveMode(await this.store.loadRootWrapV6(plan.successor_epoch_id))}
  private async successorContext():Promise<{plan:NativeSuccessorPlanArtifactV2;rootKey:Uint8Array;epochSalt:Uint8Array;transport:GoogleSheetsTransferableSingleWriterV2Transport;codec:GoogleSheetsTransferableSingleWriterV2ProfileCodec;remoteId:string}>{
    const plan=await this.plan(),rootKey=await this.successorRoot(),epochSalt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16))
    const transport=await this.session.transportForEpoch(plan.diary_id,plan.successor_epoch_id),codec=await this.session.codecForEpoch(plan.diary_id,plan.successor_epoch_id,rootKey,transport)
    const remote=await this.artifact<NativeSuccessorRemoteArtifactV2>('successor-remote');if(!remote?.remote_id)throw new Error('Native v2 Successor remote binding is missing.')
    return{plan,rootKey,epochSalt,transport,codec,remoteId:remote.remote_id}
  }
  private planWriter(plan:NativeSuccessorPlanArtifactV2):WriterAuthoritySnapshotV2{return{writer_generation:plan.writer_generation,writer_grant_id:plan.writer_grant_id,writer_device_id:plan.writer_device_id,writer_key_id:plan.writer_key_id,writer_public_key:plan.writer_public_key,source_epoch_sealed:false}}
  private async carriedWriter(plan:NativeSuccessorPlanArtifactV2):Promise<StoredWriterDeviceKeyV2>{
    const key=await this.store.loadWriterKey(plan.writer_key_id,plan.diary_id,plan.successor_epoch_id)
    if(!key||key.writer_device_id!==plan.writer_device_id||key.writer_public_key!==plan.writer_public_key)throw new Error('Native v2 carried WriterDeviceKeyV2 changed.')
    return key
  }

  async createOrReconcileSuccessor():Promise<{manifestFingerprint:string}>{
    const plan=await this.plan(),rootKey=await this.successorRoot(),transport=await this.session.transportForEpoch(plan.diary_id,plan.successor_epoch_id)
    const staging=await this.store.loadRecoveryTakeoverStagingMaterial({epochId:plan.successor_epoch_id,recoveryGeneration:plan.recovery_generation,recoveryTakeoverKeyId:plan.recovery_takeover_key_id,manifestFingerprint:plan.manifest_fingerprint,urs:this.urs})
    staging.privateKeyPkcs8.fill(0)
    const creation=await this.session.createOrReconcileEpoch({diaryId:plan.diary_id,epochId:plan.successor_epoch_id,rootKey,creationLocator:plan.creation_locator,manifest:{format:'sync-v6',version:'6',manifestIv:plan.manifest_cells[2],manifestCiphertext:plan.manifest_cells[3]},transport,persistence:this.store.creationPersistence(),recoveryStaging:staging.verified})
    if(creation.status!=='bound'||!creation.remoteId)throw new Error('Native v2 Successor creation did not bind uniquely.')
    await this.putArtifact('successor-remote',{remote_id:creation.remoteId} satisfies NativeSuccessorRemoteArtifactV2)
    const salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16)),state=await this.store.loadState(rootKey,salt,plan.successor_epoch_id)
    const binding={storage_provider_id:GOOGLE_DRIVE_SHEETS_PROVIDER,sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:creation.remoteId,remote_identity_binding:plan.google_account_binding} as const
    if(state.remote_binding===null)await this.store.replaceState(rootKey,salt,state.operation_generation,{...state,operation_generation:state.operation_generation+1,remote_binding:binding,epoch_status:'remote_bound'})
    else if(!same(state.remote_binding,binding))throw new Error('Native v2 Successor remote binding changed.')
    return{manifestFingerprint:plan.manifest_fingerprint}
  }

  private async prepareSuccessorEnvelope(role:string,revision:RevisionV2,remoteRows:ReadonlyArray<readonly string[]>):Promise<PreparedEnvelope>{
    const ctx=await this.successorContext(),key=`reservation:${role}`;let reservation=await this.artifact<EnvelopeReservationV6>(key)
    if(!reservation){reservation=await this.store.reserveEnvelope(ctx.plan.successor_epoch_id,remoteRows);await this.putArtifact(key,reservation)}
    const envelope=await sealRevisionEnvelopeV2(ctx.rootKey,ctx.epochSalt,{diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    const stored=(await this.store.envelopes(ctx.plan.successor_epoch_id)).find(item=>item.envelopeId===envelope.envelopeId)
    if(stored){if(!same(asRow(stored),asRow(envelope)))throw new Error('Native v2 Successor persisted envelope differs from one-shot bytes.');return stored}
    const state=await this.store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    await this.store.commitReservedEnvelope(ctx.rootKey,ctx.epochSalt,state.operation_generation,reservation,envelope,writerAuthority(this.planWriter(ctx.plan)),'rotation')
    await this.putArtifact(`envelope:${role}`,asRow(envelope));return envelope
  }

  private async prepareSourceEnvelope(role:string,revision:RevisionV2,remoteRows:ReadonlyArray<readonly string[]>):Promise<PreparedEnvelope>{
    const ctx=await this.sourceContext(),key=`source-reservation:${role}`;let reservation=await this.artifact<EnvelopeReservationV6>(key)
    if(!reservation){reservation=await this.store.reserveEnvelope(ctx.freeze.source_epoch_id,remoteRows);await this.putArtifact(key,reservation)}
    const envelope=await sealRevisionEnvelopeV2(ctx.rootKey,ctx.epochSalt,{diaryId:ctx.freeze.diary_id,epochId:ctx.freeze.source_epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    const stored=(await this.store.envelopes(ctx.freeze.source_epoch_id)).find(item=>item.envelopeId===envelope.envelopeId)
    if(stored){if(!same(asRow(stored),asRow(envelope)))throw new Error('Native v2 Source persisted envelope differs from one-shot bytes.');return stored}
    const state=await this.store.loadState(ctx.rootKey,ctx.epochSalt,ctx.freeze.source_epoch_id)
    await this.store.commitReservedEnvelope(ctx.rootKey,ctx.epochSalt,state.operation_generation,reservation,envelope,writerAuthority(ctx.freeze.source_writer),'rotation')
    await this.putArtifact(`source-envelope:${role}`,asRow(envelope));return envelope
  }

  private async commitSuccessorCanonical(verified:VerifiedRemoteState,result:CanonicalFullResultV2):Promise<void>{
    const ctx=await this.successorContext(),state=await this.store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id),key=await this.carriedWriter(ctx.plan)
    const next=await stateAfterCanonicalVerifyV6(state,result,verified.snapshot.rows,key.writer_device_id===ctx.plan.writer_device_id)
    await this.store.commitVerifiedDispositions(ctx.rootKey,ctx.epochSalt,state.operation_generation,next,verified.acceptedEnvelopeIds,verified.staleWriterEnvelopeIds,{
      remote_rows:verified.snapshot.rows,current_writer:{writer_generation:result.current_writer.writer_generation,writer_grant_id:result.current_writer.writer_grant_id,writer_device_id:result.current_writer.writer_device_id,writer_key_id:result.current_writer.writer_key_id},
      source_epoch_sealed:result.source_epoch_sealed,recovery_rekey_rotation_required:result.current_recovery.recovery_rekey_rotation_required,
    })
  }

  private async plannedStagingRows():Promise<{rows:Row[];canonical:CanonicalFullResultV2}>{
    const ctx=await this.successorContext(),source=await this.sourceSnapshot(),writer=await this.carriedWriter(ctx.plan),planned:Row[]=[]
    for(const head of source.snapshot.heads){
      const role=`copy:${head.revision_id}`;let row=await this.artifact<Row>(`envelope:${role}`)
      if(!row){
        const revision=await copyV2HeadForRotation({diaryId:ctx.plan.diary_id,successorEpochId:ctx.plan.successor_epoch_id,sourceEpochId:source.freeze.source_epoch_id,sourceHead:head,
          writerContext:writerContext(source.result.current_writer),writerPrivateKey:writer.private_key,protocolCreatedAt:ctx.plan.created_at,revisionId:await deterministicId(ctx.plan.operation_id,`copy-revision:${head.revision_id}`,32)})
        row=asRow(await this.prepareSuccessorEnvelope(role,revision,[]))
      }
      planned.push(row)
    }
    let migration=await this.artifact<Row>('envelope:migration')
    if(!migration){
      const created=await createNativeV2MigrationRevision({diaryId:ctx.plan.diary_id,successorEpochId:ctx.plan.successor_epoch_id,sourceEpochId:source.freeze.source_epoch_id,
        sourceManifestFingerprint:source.freeze.source_manifest_fingerprint,sourceAnchor:source.freeze.source_anchor,sourceSnapshot:source.snapshot,sourceWriter:source.result.current_writer,
        rotationKind:ctx.plan.rotation_kind,recoveryTransitionId:ctx.plan.recovery_transition_id,writerContext:writerContext(source.result.current_writer),writerPrivateKey:writer.private_key,
        protocolCreatedAt:ctx.plan.created_at,migrationId:ctx.plan.operation_id,recordId:await deterministicId(ctx.plan.operation_id,'migration-record',16),revisionId:await deterministicId(ctx.plan.operation_id,'migration-revision',32)})
      migration=asRow(await this.prepareSuccessorEnvelope('migration',created.revision,[]))
    }
    planned.push(migration);await this.putArtifact('staging-row-plan',planned)
    let retryBudget=1
    for(;;){
      let snapshot=await ctx.transport.read(ctx.remoteId);const present=requirePlannedPrefix(snapshot.rows,planned)
      if(present===planned.length){
        const verified=await ctx.codec.verifyRemote(snapshot),result=canonical(verified)
        await verifyNativeV2MigrationIntegrity({source:source.result,successor:result,rotationKind:ctx.plan.rotation_kind,recoveryTransitionId:ctx.plan.recovery_transition_id})
        await this.commitSuccessorCanonical(verified,result);return{rows:planned,canonical:result}
      }
      await ctx.codec.verifyRotationResume(snapshot,{successor_epoch_id:ctx.plan.successor_epoch_id,successor_manifest_fingerprint:ctx.plan.manifest_fingerprint,stage:'copying',mac_authenticated:true})
      const next=planned[present]!,row:[string,string,string]=[next[0],next[1],next[2]];let unknown=false
      try{await ctx.transport.append(ctx.remoteId,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      snapshot=await ctx.transport.read(ctx.remoteId);const after=requirePlannedPrefix(snapshot.rows,planned)
      if(after>present){retryBudget=1;continue}
      if(!unknown)throw new Error('Native v2 Successor append succeeded without verified prefix advancement.')
      if(retryBudget===0)throw new TransportError('unknown_outcome','Native v2 Successor append remains unresolved; no blind third append is allowed.')
      retryBudget=0
      await ctx.codec.verifyRotationResume(snapshot,{successor_epoch_id:ctx.plan.successor_epoch_id,successor_manifest_fingerprint:ctx.plan.manifest_fingerprint,stage:'copying',mac_authenticated:true})
    }
  }

  async copyAndVerifySuccessor():Promise<{stagingAnchor:CanonicalFullResultV2['remote_anchor']}>{return{stagingAnchor:(await this.plannedStagingRows()).canonical.remote_anchor}}

  async prepareActivation():Promise<{announcementEnvelope:{envelope_id:string;iv:string;ciphertext:string};confirmationEnvelope:{envelope_id:string;iv:string;ciphertext:string};activationEvidenceSha256:string;activationLineageSha256:string;recoveryArtifactId:string;recoveryArtifactLocator:string;recoveryArtifactSha256:string}>{
    const existing=await this.artifact<NativeActivationArtifactV2>('activation'),plan=await this.plan()
    if(existing)return{
      announcementEnvelope:{...existing.proof.announcement_envelope},confirmationEnvelope:{...existing.proof.successor_confirmation_envelope},
      activationEvidenceSha256:await recoveryActivationProofHashV2(existing.proof),activationLineageSha256:await activationLineageHashV2(existing.lineage),
      recoveryArtifactId:existing.recovery_artifact.recovery_artifact_id,recoveryArtifactLocator:await recoveryArtifactLocatorV6(this.urs,plan.diary_id,plan.successor_epoch_id),
      recoveryArtifactSha256:await recoveryArtifactHashV6(existing.recovery_artifact),
    }
    const operation=await this.load(),source=await this.sourceSnapshot(),ctx=await this.successorContext()
    if(!operation.successor_staging_anchor)throw new Error('Native v2 Successor staging anchor is missing.')
    const stagedSnapshot=await ctx.transport.read(ctx.remoteId),staged=canonical(await ctx.codec.verifyRemote(stagedSnapshot))
    if(!same(staged.remote_anchor,operation.successor_staging_anchor)||staged.accepted_activation_confirmation!==null)throw new NativeRotationPreCutoverStaleError('Native v2 Successor changed after staging freeze.')
    const sourceCurrent=await this.exactFrozenSource(false)
    if(!same(sourceCurrent.result.remote_anchor,source.freeze.source_anchor))throw new NativeRotationPreCutoverStaleError('Native v2 Source changed before activation preparation.')
    const writer=await this.carriedWriter(plan)
    const announcementCreated=await createRotationAnnouncementRevisionV2({diaryId:plan.diary_id,sourceEpochId:source.freeze.source_epoch_id,successorEpochId:plan.successor_epoch_id,
      successorCreationLocator:plan.creation_locator,successorManifestFingerprint:plan.manifest_fingerprint,rotationKind:plan.rotation_kind,sourceWriter:source.result.current_writer,
      successorRecoveryGeneration:plan.recovery_generation,sourceAnchor:source.freeze.source_anchor,successorStagingAnchor:operation.successor_staging_anchor,recoveryTransitionId:plan.recovery_transition_id,
      writerPrivateKey:writer.private_key,protocolCreatedAt:plan.created_at,rotationId:operation.operation_id,recordId:await deterministicId(operation.operation_id,'announcement-record',16),revisionId:await deterministicId(operation.operation_id,'announcement-revision',32)})
    const announcement=await this.prepareSourceEnvelope('announcement',announcementCreated.revision,sourceCurrent.snapshot.rows)
    const confirmationCreated=await createV2RotationConfirmationRevision({diaryId:plan.diary_id,successorEpochId:plan.successor_epoch_id,successorManifestFingerprint:plan.manifest_fingerprint,
      sourceEpochId:source.freeze.source_epoch_id,sourceManifestFingerprint:source.freeze.source_manifest_fingerprint,sourceAnchor:source.freeze.source_anchor,successorStagingAnchor:operation.successor_staging_anchor,
      announcementEnvelope:announcement,writerContext:writerContext(source.result.current_writer),writerPrivateKey:writer.private_key,protocolCreatedAt:plan.created_at,
      confirmationId:await deterministicId(operation.operation_id,'confirmation-id',32),recordId:await deterministicId(operation.operation_id,'confirmation-record',16),revisionId:await deterministicId(operation.operation_id,'confirmation-revision',32)})
    const confirmation=await this.prepareSuccessorEnvelope('confirmation',confirmationCreated.revision,stagedSnapshot.rows)
    const proof=await createRecoveryActivationProofV2({sourceEpochId:source.freeze.source_epoch_id,sourceManifestFingerprint:source.freeze.source_manifest_fingerprint,sourceAnchor:source.freeze.source_anchor,
      successorStagingAnchor:operation.successor_staging_anchor,sourceWriter:source.result.current_writer,successorEpochId:plan.successor_epoch_id,successorManifestFingerprint:plan.manifest_fingerprint,
      successorRecoveryGeneration:plan.recovery_generation,rotationKind:plan.rotation_kind,recoveryTransitionId:plan.recovery_transition_id,announcementEnvelope:announcement,confirmationEnvelope:confirmation,sourceWriterPrivateKey:writer.private_key})
    const lineage=extendActivationLineageV2(source.context.rootKey,source.freeze.source_activation_lineage,proof)
    const staging=await this.store.loadRecoveryTakeoverStagingMaterial({epochId:plan.successor_epoch_id,recoveryGeneration:plan.recovery_generation,recoveryTakeoverKeyId:plan.recovery_takeover_key_id,manifestFingerprint:plan.manifest_fingerprint,urs:this.urs})
    const artifact=await createRecoveryArtifactV6({diary_id:plan.diary_id,epoch_id:plan.successor_epoch_id,key_id:plan.key_id,RK_epoch:base64Url(ctx.rootKey),manifest_fingerprint:plan.manifest_fingerprint,
      remote_anchor:operation.successor_staging_anchor,google_account_binding:plan.google_account_binding,recovery_generation:plan.recovery_generation,recovery_urs_commitment:plan.recovery_urs_commitment,
      recovery_urs_id:plan.recovery_urs_id,recovery_credential_history:plan.recovery_credential_history.map(entry=>({...entry})),recovery_takeover_key_id:plan.recovery_takeover_key_id,
      recovery_takeover_public_key:plan.recovery_takeover_public_key,recovery_takeover_private_key_pkcs8:base64Url(staging.privateKeyPkcs8),activation_lineage:lineage,
      recovery_authority_transition_proof:null,created_at:plan.created_at},this.urs,await deterministicBytes(operation.operation_id,'recovery-artifact-id',16))
    staging.privateKeyPkcs8.fill(0)
    await this.putArtifact('activation',{lineage,proof,recovery_artifact:artifact} satisfies NativeActivationArtifactV2)
    const persisted=await this.store.persistRecoveryArtifactV6(this.urs,plan.diary_id,plan.successor_epoch_id,artifact)
    return{announcementEnvelope:{envelope_id:announcement.envelopeId,iv:announcement.iv,ciphertext:announcement.ciphertext},confirmationEnvelope:{envelope_id:confirmation.envelopeId,iv:confirmation.iv,ciphertext:confirmation.ciphertext},
      activationEvidenceSha256:await recoveryActivationProofHashV2(proof),activationLineageSha256:await activationLineageHashV2(lineage),
      recoveryArtifactId:artifact.recovery_artifact_id,recoveryArtifactLocator:persisted.artifactLocator,recoveryArtifactSha256:await recoveryArtifactHashV6(artifact)}
  }

  async publishAndVerifyRecoveryArtifact():Promise<void>{
    const plan=await this.plan(),activation=await this.artifact<NativeActivationArtifactV2>('activation')
    if(!activation)throw new Error('Native v2 activation artifact is missing.')
    const persisted=await this.store.persistRecoveryArtifactV6(this.urs,plan.diary_id,plan.successor_epoch_id,activation.recovery_artifact)
    await this.session.publishRecoveryArtifact(this.urs,persisted)
    const readback=await this.session.loadRecoveryArtifact(this.urs,plan.diary_id,plan.successor_epoch_id)
    if(!same(readback,activation.recovery_artifact))throw new Error('Native v2 RecoveryArtifactV6 remote readback differs from persisted one-shot bytes.')
    const recovered=await openRecoveryArtifactV6(readback,this.urs),ctx=await this.successorContext(),operation=await this.load(),source=await this.sourceSnapshot()
    if(base64Url(recovered.rootKey)!==base64Url(ctx.rootKey)||!operation.successor_staging_anchor||!same(recovered.payload.remote_anchor,operation.successor_staging_anchor)||!same(recovered.payload.activation_lineage,activation.lineage))throw new Error('Native v2 staged Recovery test recovered different identity/evidence.')
    const freshSource=await this.exactFrozenSource(false)
    await verifyRecoveryActivationProofV2({proof:activation.proof,source:freshSource.result,announcementEnvelope:preparedFromRow([activation.proof.announcement_envelope.envelope_id,activation.proof.announcement_envelope.iv,activation.proof.announcement_envelope.ciphertext]),confirmationEnvelope:preparedFromRow([activation.proof.successor_confirmation_envelope.envelope_id,activation.proof.successor_confirmation_envelope.iv,activation.proof.successor_confirmation_envelope.ciphertext])})
    const successorVerified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),successor=canonical(successorVerified)
    if(!same(successor.remote_anchor,operation.successor_staging_anchor)||successor.accepted_activation_confirmation!==null)throw new Error('Native v2 staged Recovery test does not bind frozen Successor staging prefix.')
    await verifyNativeV2MigrationIntegrity({source:source.result,successor,rotationKind:plan.rotation_kind,recoveryTransitionId:plan.recovery_transition_id})
  }

  private async backupRows():Promise<{pending:Row[];stale:Row[]}>{
    const ctx=await this.successorContext(),entries=await this.store.outbox(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id),envelopes=await this.store.envelopes(ctx.plan.successor_epoch_id),byId=new Map(envelopes.map(envelope=>[envelope.envelopeId,asRow(envelope)]))
    const pending:Row[]=[],stale:Row[]=[]
    for(const entry of entries){const row=byId.get(entry.envelope_id);if(!row)throw new Error('Native v2 backup outbox references a missing envelope.');if(entry.status==='stale_writer_pending')stale.push(row);else if(entry.status!=='durable')pending.push(row)}
    return{pending,stale}
  }
  private async createBackup(activationState:'staged'|'activated',verified:VerifiedRemoteState):Promise<{backup:SyncBackupV6;anchor:CanonicalFullResultV2['remote_anchor']}>{
    const ctx=await this.successorContext(),activation=await this.artifact<NativeActivationArtifactV2>('activation')
    if(!activation)throw new Error('Native v2 activation artifact is missing for BackupV6.')
    const result=canonical(verified),rows=verified.snapshot.rows.map(row=>[row[0]!,row[1]!,row[2]!] as Row),local=await this.backupRows()
    const backup=await createBackupV6({rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,urs:this.urs,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,keyId:ctx.plan.key_id,
      epochManifestPublic:ctx.plan.manifest_cells,canonical:result,recoveryArtifact:activation.recovery_artifact,recordRows:rows,pendingOutboxRows:local.pending,staleWriterPendingRows:local.stale,activationState,createdAt:ctx.plan.created_at})
    const restored=await testRestoreBackupV6({rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,urs:this.urs,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,keyId:ctx.plan.key_id},backup,new TransferableSingleWriterV2Verifier())
    if(restored.access!=='read_only'||restored.activation_state!==activationState||!same(restored.canonical.remote_anchor,result.remote_anchor))throw new Error('Native v2 BackupV6 test restore did not reproduce export anchor.')
    return{backup,anchor:result.remote_anchor}
  }

  async createAndVerifyStagedBackup():Promise<{backupId:string}>{
    const existing=await this.artifact<NativeBackupArtifactV2>('staged-backup');if(existing)return{backupId:existing.backup.backup_id}
    const operation=await this.load(),ctx=await this.successorContext(),verified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),result=canonical(verified)
    if(!operation.successor_staging_anchor||!same(result.remote_anchor,operation.successor_staging_anchor)||result.accepted_activation_confirmation!==null)throw new Error('Native v2 staged BackupV6 must end exactly at staging anchor.')
    const created=await this.createBackup('staged',verified);await this.putArtifact('staged-backup',{backup:created.backup,anchor:created.anchor} satisfies NativeBackupArtifactV2)
    try{await this.store.deleteRecoveryTakeoverStaging({epochId:ctx.plan.successor_epoch_id,recoveryGeneration:ctx.plan.recovery_generation,recoveryTakeoverKeyId:ctx.plan.recovery_takeover_key_id,manifestFingerprint:ctx.plan.manifest_fingerprint,urs:this.urs})}catch(error){if(!(error instanceof Error)||!error.message.includes('is missing'))throw error}
    return{backupId:created.backup.backup_id}
  }

  private async successorAtStagingOrConfirmation():Promise<{verified:VerifiedRemoteState;result:CanonicalFullResultV2;confirmationCount:number;activationAnchor:CanonicalFullResultV2['remote_anchor']|null}>{
    const operation=await this.load(),ctx=await this.successorContext()
    if(!operation.successor_staging_anchor||!operation.confirmation_envelope)throw new Error('Native v2 cutover evidence is incomplete.')
    const snapshot=await ctx.transport.read(ctx.remoteId),prefix=snapshot.rows.slice(0,operation.successor_staging_anchor.covered_row_count)
    if(!same(await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,prefix),operation.successor_staging_anchor))throw new Error('Native v2 Successor staging prefix changed.')
    const suffix=snapshot.rows.slice(operation.successor_staging_anchor.covered_row_count),expected:Row=[operation.confirmation_envelope.envelope_id,operation.confirmation_envelope.iv,operation.confirmation_envelope.ciphertext]
    if(!suffix.length){const verified=await ctx.codec.verifyRemote(snapshot);return{verified,result:canonical(verified),confirmationCount:0,activationAnchor:null}}
    if(!same(suffix[0],expected))throw new NativeRotationCutoverRaceError('successor_cutover_race')
    let count=0;while(count<suffix.length&&same(suffix[count],expected))count+=1
    const verified=await ctx.codec.verifyRemote(snapshot)
    return{verified,result:canonical(verified),confirmationCount:count,activationAnchor:await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,snapshot.rows.slice(0,operation.successor_staging_anchor.covered_row_count+count))}
  }

  async publishOrReconcileAnnouncement(state:RotationOperationStateV2):Promise<{kind:'durable'}|{kind:'unknown'}|{kind:'stale'}|{kind:'source_race'}>{
    const operation=await this.load()
    if(!operation.announcement_envelope||!operation.successor_staging_anchor)throw new Error('Native v2 Announcement is not prepared.')
    const inspect=async():Promise<
      |{kind:'durable'}
      |{kind:'stale'}
      |{kind:'ready';source:Awaited<ReturnType<ProductiveNativeRotationV2Service['exactFrozenSource']>>}
    >=>{
      try{
        const source=await this.exactFrozenSource(true),successor=await this.successorAtStagingOrConfirmation()
        if(source.announcementCount>0){await this.reconcileSource(source);return{kind:'durable'}}
        if(successor.confirmationCount!==0||!same(successor.result.remote_anchor,operation.successor_staging_anchor))return{kind:'stale'}
        return{kind:'ready',source}
      }catch(error){
        if(error instanceof NativeRotationPreCutoverStaleError||error instanceof NativeRotationCutoverRaceError)return{kind:'stale'}
        throw error
      }
    }
    const row:[string,string,string]=[operation.announcement_envelope.envelope_id,operation.announcement_envelope.iv,operation.announcement_envelope.ciphertext]
    const maxAttempts=state.stage==='announcement_unknown'?1:2
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      const before=await inspect()
      if(before.kind!=='ready')return before
      let unknown=false
      try{await before.source.context.transport.append(before.source.context.freeze.source_remote_id,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      await this.fault?.('after-source-append')
      const after=await inspect()
      if(after.kind!=='ready')return after
      if(!unknown)return{kind:'unknown'}
    }
    return{kind:'unknown'}
  }

  private async verifyActivatedCandidate(value:Awaited<ReturnType<ProductiveNativeRotationV2Service['successorAtStagingOrConfirmation']>>):Promise<ActiveCandidateV2>{
    const ctx=await this.successorContext(),activation=await this.artifact<NativeActivationArtifactV2>('activation')
    if(!activation)throw new Error('Native v2 activation artifact is missing.')
    const manifest=await openManifestV6(ctx.rootKey,ctx.epochSalt,{diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id},parseManifestCellsV6(value.verified.snapshot.manifest))
    const candidate:ActiveCandidateV2={artifact:activation.recovery_artifact,artifactSha256:await recoveryArtifactHashV6(activation.recovery_artifact),rootKey:ctx.rootKey,
      payload:(await openRecoveryArtifactV6(activation.recovery_artifact,this.urs)).payload,manifest,snapshot:value.verified.snapshot,verified:value.verified,result:value.result,remoteId:ctx.remoteId,accountBinding:ctx.plan.google_account_binding}
    await verifyCurrentRecoveryTransitionForJoin(candidate);await verifyActivationForJoin(this.session,candidate)
    return candidate
  }

  async publishOrReconcileConfirmation(state:RotationOperationStateV2):Promise<{kind:'durable';activationAnchor:CanonicalFullResultV2['remote_anchor']}|{kind:'unknown'}|{kind:'cutover_race'}>{
    const operation=await this.load()
    if(!operation.confirmation_envelope||!operation.successor_staging_anchor)throw new Error('Native v2 Confirmation is not prepared.')
    const inspect=async():Promise<
      |{kind:'durable';activationAnchor:CanonicalFullResultV2['remote_anchor']}
      |{kind:'ready';transport:GoogleSheetsTransferableSingleWriterV2Transport;remoteId:string}
      |{kind:'cutover_race'}
    >=>{
      const source=await this.exactFrozenSource(true)
      if(source.announcementCount===0)throw new Error('Native v2 Confirmation is forbidden before durable Source Announcement.')
      try{
        const successor=await this.successorAtStagingOrConfirmation()
        if(successor.confirmationCount>0){
          await this.verifyActivatedCandidate(successor);await this.commitSuccessorCanonical(successor.verified,successor.result)
          return{kind:'durable',activationAnchor:successor.activationAnchor!}
        }
        if(!same(successor.result.remote_anchor,operation.successor_staging_anchor))return{kind:'cutover_race'}
        const ctx=await this.successorContext()
        return{kind:'ready',transport:ctx.transport,remoteId:ctx.remoteId}
      }catch(error){
        if(error instanceof NativeRotationCutoverRaceError)return{kind:'cutover_race'}
        throw error
      }
    }
    const row:[string,string,string]=[operation.confirmation_envelope.envelope_id,operation.confirmation_envelope.iv,operation.confirmation_envelope.ciphertext]
    const maxAttempts=state.stage==='confirmation_unknown'?1:2
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      const before=await inspect()
      if(before.kind!=='ready')return before
      let unknown=false
      try{await before.transport.append(before.remoteId,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      await this.fault?.('after-confirmation-append')
      const after=await inspect()
      if(after.kind!=='ready')return after
      if(!unknown)return{kind:'unknown'}
    }
    return{kind:'unknown'}
  }

  private async recoveryAdvanced(result:CanonicalFullResultV2):Promise<boolean>{
    const activation=await this.artifact<NativeActivationArtifactV2>('activation');if(!activation)throw new Error('Native v2 RecoveryArtifactV6 is missing.')
    const payload=(await openRecoveryArtifactV6(activation.recovery_artifact,this.urs)).payload
    return result.source_epoch_sealed||result.current_recovery.recovery_generation!==payload.recovery_generation||result.current_recovery.recovery_urs_id!==payload.recovery_urs_id
      ||result.current_recovery.recovery_takeover_key_id!==payload.recovery_takeover_key_id||result.current_recovery.recovery_rekey_rotation_required
  }

  async createAndVerifyActivatedBackup():Promise<{kind:'ready';activatedBackupId:string}|{kind:'superseded'}>{
    const existing=await this.artifact<NativeBackupArtifactV2>('activated-backup');if(existing)return{kind:'ready',activatedBackupId:existing.backup.backup_id}
    const successor=await this.successorAtStagingOrConfirmation()
    if(successor.confirmationCount===0)throw new Error('Native v2 activated BackupV6 requires durable Confirmation.')
    if(await this.recoveryAdvanced(successor.result))return{kind:'superseded'}
    await this.verifyActivatedCandidate(successor);await this.commitSuccessorCanonical(successor.verified,successor.result)
    const created=await this.createBackup('activated',successor.verified);await this.putArtifact('activated-backup',{backup:created.backup,anchor:created.anchor} satisfies NativeBackupArtifactV2)
    return{kind:'ready',activatedBackupId:created.backup.backup_id}
  }

  async persistLineageAndReverifyBeforeSwitch():Promise<'ready'|'superseded'>{
    const ctx=await this.successorContext(),activation=await this.artifact<NativeActivationArtifactV2>('activation'),backup=await this.artifact<NativeBackupArtifactV2>('activated-backup')
    if(!activation||!backup)throw new Error('Native v2 final activation artifacts are incomplete.')
    const state=await this.store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    if(state.activation_lineage_cache_ref===null){
      const cache=await createActivationLineageCacheV2({rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,manifestFingerprint:ctx.plan.manifest_fingerprint,activationLineage:activation.lineage})
      await this.store.persistActivationLineageCache(ctx.rootKey,ctx.epochSalt,cache,state.operation_generation)
    }else await this.store.loadActivationLineageCache(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    const successor=await this.successorAtStagingOrConfirmation()
    if(successor.confirmationCount===0||await this.recoveryAdvanced(successor.result))return'superseded'
    await this.verifyActivatedCandidate(successor)
    if(successor.result.remote_anchor.covered_row_count<backup.anchor.covered_row_count||!same(await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,successor.verified.snapshot.rows.slice(0,backup.anchor.covered_row_count)),backup.anchor))throw new Error('Native v2 remote prefix no longer extends activated BackupV6 anchor.')
    await this.commitSuccessorCanonical(successor.verified,successor.result);return'ready'
  }

  async switchLocally(state:RotationOperationStateV2):Promise<void>{
    const source=await this.sourceContext(),ctx=await this.successorContext()
    await this.store.switchNativeRotationEpochStates({operation:state,sourceRootKey:source.rootKey,sourceEpochSalt:source.epochSalt,successorRootKey:ctx.rootKey,successorEpochSalt:ctx.epochSalt})
    await this.fault?.('after-local-state-switch')
    await atomicSelectRotatedV2({operation:state,diaryId:ctx.plan.diary_id,sourceManifestFingerprint:source.freeze.source_manifest_fingerprint,successorManifestFingerprint:ctx.plan.manifest_fingerprint})
    await this.fault?.('after-active-selection-switch')
  }

  async orphanPreAnnouncementSuccessor():Promise<void>{
    const ctx=await this.successorContext(),state=await this.store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    if(state.epoch_status==='orphaned')return
    await this.store.replaceState(ctx.rootKey,ctx.epochSalt,state.operation_generation,{...state,epoch_status:'orphaned',writer_status:'read_only',writer_generation:null,writer_grant_id:null,operation_generation:state.operation_generation+1})
  }
  async markSourceRace():Promise<void>{throw new Error('Native v2 rotation reports pre-announcement Source races as stale, not profile-upgrade source_race.')}

  private async completeBoundRecoveryRekey(rotation:RotationOperationStateV2):Promise<void>{
    const source=await this.sourceContext(),state=await this.store.loadState(source.rootKey,source.epochSalt,rotation.source_epoch_id),ref=state.recovery_operation_state_ref
    if(!ref)return
    const operation=await this.store.loadRecoveryRekeyOperation(ref.operation_id)
    if(operation.stage==='completed')return
    if(operation.stage!=='successor_rotation_required'||operation.transition_id!==rotation.source_recovery_transition_id)throw new Error('Switched recovery_rekey rotation does not bind successor_rotation_required RecoveryRekeyOperationStateV2.')
    const next:RecoveryRekeyOperationStateV2={...operation,stage:'completed',completed_successor_epoch_id:rotation.successor_epoch_id,completed_successor_manifest_fingerprint:rotation.successor_manifest_fingerprint}
    await this.store.advanceRecoveryRekeyOperationBinding(source.rootKey,source.epochSalt,rotation.source_epoch_id,state.operation_generation,'successor_rotation_required',next)
  }
}
