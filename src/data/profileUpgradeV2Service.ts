import { base64Url, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSalt, recoveryCommitment, sha256 } from '../security/crypto/core'
import { openEnvelope, type PreparedEnvelope } from '../security/envelopes'
import { validateRevisionGraphV1, validateRevisionV1, type RevisionV1 } from '../security/revisions'
import {
  DOMAIN_SCHEMA_REGISTRY,
  IndexedDbCoordinatorStore,
  IndexedDbRotationRepository,
  activeProtocolSelectionV2,
  activeRemoteDurabilityStatus,
  atomicSelectV2AndRetireV1,
  loadProfileUpgradeSourceOperationV2,
  markV1ProfileUpgradeSourceRace,
  openSuccessorRootWrapV6WithActiveMode,
  persistProfileUpgradeSourceOperationV2,
  prepareSuccessorRootWrapV6ForActiveMode,
  type VerifiedEpochMaterial,
} from './localDatabase'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import {
  GOOGLE_DRIVE_SHEETS_PROVIDER,
  SINGLE_WRITER_V1_PROFILE,
  SINGLE_WRITER_V2_PROFILE,
  TransportError,
  type RemoteSnapshot,
  type RemoteTransport,
  type VerifiedRemoteState,
} from '../sync/core/contracts'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import { SingleWriterV1RemoteVerifier } from '../sync/core/remoteVerifier'
import { singleWriterV1WriteAuthority } from '../sync/core/writeAuthority'
import { createAnchorV1, type RemoteAnchorV1 } from '../sync/core/prefix'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import type { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import {
  activationLineageHashV2,
  createProfileUpgradeActivationEntryV2,
  createProfileUpgradeConfirmationRevisionV2,
  createProfileUpgradeGenesisGrantRevisionV2,
  createProfileUpgradeMigrationRevisionV2,
  copyV1HeadForProfileUpgradeV2,
  profileUpgradeActivationEvidenceHashV2,
  profileUpgradeSourceSnapshotV2,
  rotationOperationStateHashV2,
  runProfileUpgradeStateMachineV2,
  verifyProfileUpgradeMigrationIntegrityV2,
  type ProfileUpgradeOrchestratorV2Dependencies,
  type ProfileUpgradeSourceSnapshotV2,
  type RotationOperationStageV2,
  type RotationOperationStateV2,
} from '../security/v2/profileUpgrade'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  recoveryCommitmentV2,
  recoveryUrsIdV2,
  revisionSigningBytesV2,
  verifyEd25519V2,
} from '../security/v2/crypto'
import {
  manifestCellsArrayV6,
  manifestFingerprintV6,
  prepareManifestV6,
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
import { createRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'
import { openRevisionEnvelopeV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { SINGLE_WRITER_V2_SCHEMA_ALLOWLIST, type RevisionV2, type WriterContextV2 } from '../security/v2/types'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import {
  createRecoveryArtifactV6,
  openRecoveryArtifactV6,
  recoveryArtifactHashV6,
  recoveryArtifactLocatorV6,
  type ProfileUpgradeActivationEntryV2,
  type RecoveryArtifactV6,
} from '../security/v2/recovery'
import { createBackupV6, testRestoreBackupV6, type SyncBackupV6 } from '../security/v2/backup'
import { TransferableSingleWriterV2Verifier } from '../security/v2/verifier'
import { createActivationLineageCacheV2 } from '../security/v2/activationLineageCache'
import { createAnchorV2 } from '../security/v2/prefix'
import { V2_SCHEMA_REGISTRY_HASH } from '../security/v2/schemaRegistry'
import { V6_PROTOCOL_LIMITS } from '../security/v2/manifest'

type Row=readonly[string,string,string]
class ProfileUpgradePreCutoverStaleError extends Error {}
class ProfileUpgradeSourceRaceError extends Error {}
class ProfileUpgradeSuccessorCutoverRaceError extends Error {}
export type ProfileUpgradeV2FaultPoint=
  | `after-${RotationOperationStageV2}`
  | 'before-source-freeze-persist'
  | 'after-genesis-append'
  | 'after-source-append'
  | 'after-confirmation-append'
  | 'after-activation-artifact'
  | 'after-local-selection'

interface FrozenSourceArtifactV2 {
  format:'profile-upgrade-source-freeze-v2'
  operation_id:string
  diary_id:string
  source_epoch_id:string
  source_manifest_fingerprint:string
  source_remote_id:string
  source_account_binding:string
  source_anchor:RemoteAnchorV1
  source_semantic_snapshot_hash:string
  source_lineage_snapshot_hash:string
  source_active_head_count:number
  source_tombstone_head_count:number
  source_head_revision_ids:string[]
  created_at:string
}
interface SuccessorPlanArtifactV2 {
  format:'profile-upgrade-successor-plan-v2'
  operation_id:string
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
  writer_grant_id:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
  google_account_binding:string
  created_at:string
}
interface SuccessorRemoteArtifactV2 {remote_id:string}
interface ActivationArtifactV2 {
  entry:ProfileUpgradeActivationEntryV2
  lineage:[ProfileUpgradeActivationEntryV2]
  recovery_artifact:RecoveryArtifactV6
}
interface BackupArtifactV2 {backup:SyncBackupV6;anchor:{anchor_profile:string;covered_row_count:number;prefix_hash:string}}

function sameJson(a:unknown,b:unknown):boolean{return new TextDecoder().decode(canonicalBytes(a as never))===new TextDecoder().decode(canonicalBytes(b as never))}
function canonical(result:VerifiedRemoteState):CanonicalFullResultV2{
  if(result.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Profile upgrade expected a v2 canonical verifier result.')
  const value=result.profileState as CanonicalFullResultV2
  if(!value||value.kind!=='canonical_full')throw new Error('Profile upgrade requires canonical_full.')
  return value
}
async function deterministicBytes(operationId:string,label:string,length:number):Promise<Uint8Array>{
  return (await sha256(canonicalBytes(['profile-upgrade-v2',operationId,label]))).slice(0,length)
}
async function deterministicId(operationId:string,label:string,length:number):Promise<string>{
  return base64Url(await deterministicBytes(operationId,label,length))
}
function asRow(envelope:PreparedEnvelope):Row{return[envelope.envelopeId,envelope.iv,envelope.ciphertext]}
function preparedFromRow(row:Row):PreparedEnvelope{return{envelopeId:row[0],iv:row[1],ciphertext:row[2],bytesHash:''}}
function uniquePhysicalRows(rows:ReadonlyArray<readonly string[]>):Row[]{
  const byId=new Map<string,Row>(),ordered:Row[]=[]
  for(const row of rows){
    if(row.length!==3)throw new Error('Profile-upgrade remote row shape mismatch.')
    const candidate=[row[0]!,row[1]!,row[2]!] as Row,prior=byId.get(candidate[0])
    if(prior){
      if(!sameJson(prior,candidate))throw new Error('Profile-upgrade remote envelope ID has different bytes.')
      continue
    }
    byId.set(candidate[0],candidate);ordered.push(candidate)
  }
  return ordered
}
function requirePrefix(actual:ReadonlyArray<readonly string[]>,planned:readonly Row[]):number{
  const semantic=uniquePhysicalRows(actual)
  if(semantic.length>planned.length)throw new Error('Profile-upgrade successor contains an unplanned semantic row.')
  for(let i=0;i<semantic.length;i++)if(!sameJson(semantic[i],planned[i]))throw new Error('Profile-upgrade successor prefix differs from the persisted one-shot plan.')
  return semantic.length
}

export class ProductiveProfileUpgradeV2Service implements ProfileUpgradeOrchestratorV2Dependencies {
  private readonly v1Repository=new IndexedDbRotationRepository()
  private readonly v2Store=new IndexedDbV2LocalSecurityStore()
  private operationId:string|null=null
  constructor(
    private readonly sourceSession:SingleWriterProviderSession,
    private readonly sourceTransport:RemoteTransport,
    private readonly successorSession:TransferableSingleWriterV2ProviderSession,
    private readonly urs:Uint8Array,
    private readonly now:()=>string=()=>new Date().toISOString(),
    private readonly fault?:(point:ProfileUpgradeV2FaultPoint)=>void|Promise<void>,
  ){
    if(sourceSession.profileId!==SINGLE_WRITER_V1_PROFILE||sourceTransport.profileId!==SINGLE_WRITER_V1_PROFILE)throw new Error('Profile upgrade requires a v1 Source provider session.')
    if(successorSession.profileId!==SINGLE_WRITER_V2_PROFILE||successorSession.providerId!==GOOGLE_DRIVE_SHEETS_PROVIDER)throw new Error('Profile upgrade requires the authenticated v2 provider session.')
    if(urs.byteLength!==32)throw new Error('Profile upgrade requires the current 32-byte v1 URS.')
  }

  async upgrade():Promise<RotationOperationStateV2>{
    let operation=await loadProfileUpgradeSourceOperationV2()
    if(!operation){
      const selected=await activeProtocolSelectionV2()
      if(selected)throw new Error('A v2 protocol selection already exists without a resumable profile-upgrade operation.')
      operation=await this.freezeSource()
    }
    this.operationId=operation.operation_id
    return runProfileUpgradeStateMachineV2(this)
  }

  private async hit(stage:RotationOperationStageV2|ProfileUpgradeV2FaultPoint):Promise<void>{
    const point=String(stage).startsWith('after-')?stage as ProfileUpgradeV2FaultPoint:`after-${stage}` as ProfileUpgradeV2FaultPoint
    await this.fault?.(point)
  }
  private requireOperationId():string{if(!this.operationId)throw new Error('Profile-upgrade operation is not initialized.');return this.operationId}
  private artifactId(suffix:string):string{return`${this.requireOperationId()}:${suffix}`}
  private artifact<T>(suffix:string):Promise<T|null>{return this.v2Store.operationArtifact<T>(this.artifactId(suffix))}
  private async putArtifact(suffix:string,value:unknown):Promise<void>{await this.v2Store.putImmutableOperationArtifact(this.artifactId(suffix),value)}

  private async sourceVerifier(material:VerifiedEpochMaterial,anchor:RemoteAnchorV1|null):Promise<SingleWriterV1RemoteVerifier>{
    const binding=material.state.remote_binding
    if(!binding||binding.provider_id!==SINGLE_WRITER_V1_PROFILE)throw new Error('Profile-upgrade Source must be a remotely bound v1 epoch.')
    const account=await this.sourceSession.remoteIdentityBinding(this.sourceTransport)
    if(account!==binding.remote_identity_binding)throw new Error('Profile-upgrade Source provider identity changed.')
    const graph=validateRevisionGraphV1(material.revisions)
    return new SingleWriterV1RemoteVerifier({
      rootKey:material.rootKey,
      diaryId:material.context.diaryId,
      epochId:material.context.epochId,
      expectedManifestFingerprint:material.context.manifestFingerprint,
      expectedKeyId:material.context.keyId,
      expectedRecoveryGeneration:material.state.recovery_generation,
      expectedRecoveryCommitment:material.state.recovery_urs_commitment,
      expectedGoogleAccountBinding:binding.remote_identity_binding,
      schemas:DOMAIN_SCHEMA_REGISTRY,
      oldAnchor:anchor,
      localEnvelopes:material.envelopes,
      localHeadRevisionIds:new Set([...graph.headsByRecord.values()].flatMap(ids=>[...ids])),
    })
  }

  private async freezeSource():Promise<RotationOperationStateV2>{
    let material=await this.v1Repository.verifiedActiveEpoch()
    if(material.state.epoch_status!=='active'||!material.state.remote_binding||!material.state.remote_anchor)throw new Error('Profile upgrade requires an active remotely bound v1 Source.')
    const expected=await recoveryCommitment(this.urs,fromBase64Url(material.context.diaryId),material.state.recovery_generation)
    if(expected!==material.state.recovery_urs_commitment)throw new Error('Current URS does not match the authenticated v1 recovery commitment.')

    const verifier=await this.sourceVerifier(material,material.state.remote_anchor)
    const coordinator=new SingleWriterCoordinator(
      material.context.diaryId,material.context.epochId,material.state.remote_binding.remote_resource_id,
      this.sourceTransport,this.sourceSession.codec(verifier),new IndexedDbCoordinatorStore(material.context.epochId),false,singleWriterV1WriteAuthority(),
    )
    coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
    if((await activeRemoteDurabilityStatus()).pendingEnvelopeCount!==0)throw new Error('Profile upgrade requires all v1 pending/unknown-outcome writes to be durable before freeze.')

    material=await this.v1Repository.verifiedActiveEpoch()
    const freshVerifier=await this.sourceVerifier(material,material.state.remote_anchor)
    const snapshot=await this.sourceTransport.read(material.state.remote_binding!.remote_resource_id)
    const verified=await freshVerifier.verify(snapshot)
    if(verified.retired)throw new Error('The v1 Source is already retired.')
    const anchor=await createAnchorV1(material.context.diaryId,material.context.epochId,snapshot.rows)
    const store=new IndexedDbCoordinatorStore(material.context.epochId)
    await store.commitVerifiedPull(verified,anchor,await store.generation())
    material=await this.v1Repository.verifiedActiveEpoch()
    const source=await profileUpgradeSourceSnapshotV2(material.revisions)
    const operationId=base64Url(randomBytes(32)),successorEpochId=base64Url(randomBytes(16)),createdAt=this.now()
    const frozen:FrozenSourceArtifactV2={
      format:'profile-upgrade-source-freeze-v2',operation_id:operationId,diary_id:material.context.diaryId,
      source_epoch_id:material.context.epochId,source_manifest_fingerprint:material.context.manifestFingerprint,
      source_remote_id:material.state.remote_binding!.remote_resource_id,source_account_binding:material.state.remote_binding!.remote_identity_binding,
      source_anchor:anchor,source_semantic_snapshot_hash:source.semantic_snapshot_hash,source_lineage_snapshot_hash:source.lineage_snapshot_hash,
      source_active_head_count:source.active_head_count,source_tombstone_head_count:source.tombstone_head_count,
      source_head_revision_ids:source.heads.map(head=>head.revision_id),created_at:createdAt,
    }
    this.operationId=operationId
    await this.putArtifact('source-freeze',frozen)
    await this.fault?.('before-source-freeze-persist')
    const operation:RotationOperationStateV2={
      format:'rotation-operation-v2',version:2,operation_id:operationId,rotation_kind:'profile_upgrade',
      source_epoch_id:material.context.epochId,successor_epoch_id:successorEpochId,stage:'source_frozen_verified',
      source_anchor_before_announcement:anchor,successor_staging_anchor:null,successor_activation_anchor:null,
      successor_creation_locator:null,successor_manifest_fingerprint:null,source_recovery_transition_id:null,
      activation_lineage_sha256:null,announcement_envelope:null,confirmation_envelope:null,activation_evidence_sha256:null,
      recovery_artifact_id:null,recovery_artifact_locator:null,recovery_artifact_sha256:null,staged_backup_id:null,activated_backup_id:null,
    }
    await persistProfileUpgradeSourceOperationV2(operation,material.state.operation_generation)
    await this.v2Store.initializeRotationOperation(operation)
    await this.hit('source_frozen_verified')
    return operation
  }

  async load():Promise<RotationOperationStateV2>{
    const source=await loadProfileUpgradeSourceOperationV2()
    if(!source)throw new Error('Profile-upgrade Source operation is missing.')
    this.operationId=source.operation_id
    let mirror:RotationOperationStateV2
    try{mirror=await this.v2Store.loadRotationOperation(source.operation_id)}
    catch{mirror=await this.v2Store.initializeRotationOperation(source)}
    if(await rotationOperationStateHashV2(mirror)!==await rotationOperationStateHashV2(source)){
      try{mirror=await this.v2Store.advanceRotationOperation(mirror.stage,source)}
      catch{throw new Error('v1/v2 profile-upgrade operation mirrors diverged.')}
    }
    const plan=await this.artifact<SuccessorPlanArtifactV2>('successor-plan')
    if(plan){
      const root=await this.successorRoot()
      const salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16))
      const local=await this.v2Store.loadState(root,salt,plan.successor_epoch_id)
      if(!local.rotation_state_ref
        ||local.rotation_state_ref.operation_id!==source.operation_id
        ||local.rotation_state_ref.state!==source.stage
        ||local.rotation_state_ref.state_record_hash!==await rotationOperationStateHashV2(source)){
        await this.v2Store.bindRotationOperationToState(root,salt,plan.successor_epoch_id,source,local.operation_generation)
      }
    }
    return source
  }

  async persist(current:RotationOperationStateV2,next:RotationOperationStateV2):Promise<RotationOperationStateV2>{
    await persistProfileUpgradeSourceOperationV2(next)
    let mirror:RotationOperationStateV2
    try{mirror=await this.v2Store.loadRotationOperation(current.operation_id)}
    catch{mirror=await this.v2Store.initializeRotationOperation(current)}
    if(await rotationOperationStateHashV2(mirror)!==await rotationOperationStateHashV2(current))throw new Error('Profile-upgrade operation mirror changed before transition.')
    await this.v2Store.advanceRotationOperation(current.stage,next)
    const plan=await this.artifact<SuccessorPlanArtifactV2>('successor-plan')
    if(plan){
      const root=await this.successorRoot(),salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16))
      const state=await this.v2Store.loadState(root,salt,plan.successor_epoch_id)
      await this.v2Store.bindRotationOperationToState(root,salt,plan.successor_epoch_id,next,state.operation_generation)
    }
    await this.hit(next.stage)
    return next
  }

  private async frozenSource():Promise<{artifact:FrozenSourceArtifactV2;material:VerifiedEpochMaterial;snapshot:ProfileUpgradeSourceSnapshotV2}>{
    const artifact=await this.artifact<FrozenSourceArtifactV2>('source-freeze')
    if(!artifact)throw new Error('Frozen v1 Source artifact is missing.')
    const material=await this.v1Repository.verifiedActiveEpoch()
    if(material.context.epochId!==artifact.source_epoch_id||material.context.manifestFingerprint!==artifact.source_manifest_fingerprint)throw new Error('Frozen v1 Source identity changed.')
    const snapshot=await profileUpgradeSourceSnapshotV2(material.revisions)
    if(snapshot.semantic_snapshot_hash!==artifact.source_semantic_snapshot_hash
      ||snapshot.lineage_snapshot_hash!==artifact.source_lineage_snapshot_hash
      ||snapshot.active_head_count!==artifact.source_active_head_count
      ||snapshot.tombstone_head_count!==artifact.source_tombstone_head_count
      ||snapshot.heads.map(head=>head.revision_id).join('\0')!==artifact.source_head_revision_ids.join('\0'))throw new Error('Frozen v1 Source snapshots changed.')
    return{artifact,material,snapshot}
  }

  async planSuccessor():Promise<{creationLocator:string}>{
    const existing=await this.artifact<SuccessorPlanArtifactV2>('successor-plan')
    if(existing)return{creationLocator:existing.creation_locator}
    const operation=await loadProfileUpgradeSourceOperationV2()
    if(!operation||operation.stage!=='source_frozen_verified')throw new Error('Profile-upgrade successor may only be planned from source_frozen_verified.')
    const {artifact:source,material}=await this.frozenSource()
    const rootKey=randomBytes(32)
    if(base64Url(rootKey)===base64Url(material.rootKey))throw new Error('Profile-upgrade successor RK must be independent from the v1 Source RK.')
    const keyId=base64Url(randomBytes(16)),wrapId=randomBytes(16),creationLocator=base64Url(randomBytes(16))
    const writerDeviceId=base64Url(randomBytes(16)),writer=await generateWriterDeviceKeyV2(),grantId=base64Url(randomBytes(32))
    const recovery=await generateRecoveryTakeoverKeyMaterialV2(),generation=material.state.recovery_generation
    const recoveryUrsId=await recoveryUrsIdV2(this.urs)
    const recoveryCommitmentV6=await recoveryCommitmentV2(this.urs,fromBase64Url(source.diary_id),generation)
    const transport=await this.successorSession.transportForEpoch(source.diary_id,operation.successor_epoch_id)
    const accountBinding=await this.successorSession.remoteIdentityBinding(transport)
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(source.diary_id,16),fixedBase64Url(operation.successor_epoch_id,16))
    const manifestPayload:ProtectedManifestV6={
      diary_id:source.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,creation_locator:creationLocator,
      recovery_generation:generation,recovery_urs_commitment:recoveryCommitmentV6,recovery_urs_id:recoveryUrsId,
      recovery_credential_history:[{recovery_generation:generation,recovery_urs_id:recoveryUrsId,recovery_takeover_key_id:recovery.recoveryTakeoverKeyId}],
      diary_marker:'epoch-manifest-v6',crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6',sync_profile:SINGLE_WRITER_V2_PROFILE,
      created_at:source.created_at,google_account_binding:accountBinding,
      predecessor_epochs:[{epoch_id:source.source_epoch_id,manifest_fingerprint:source.source_manifest_fingerprint}],
      record_schema_allowlist:[...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST],
      record_schema_registry_hash:V2_SCHEMA_REGISTRY_HASH,
      protocol_limits:V6_PROTOCOL_LIMITS,
      epoch_start_authority_mode:'genesis_grant_required',epoch_start_writer_generation:1,epoch_start_writer_grant_id:grantId,
      epoch_start_writer_device_id:writerDeviceId,epoch_start_writer_key_id:writer.writerKeyId,epoch_start_writer_public_key:base64Url(writer.publicKeyRaw),
      recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
    }
    const manifest=await prepareManifestV6(rootKey,epochSalt,{diaryId:source.diary_id,epochId:operation.successor_epoch_id},manifestPayload)
    const fingerprint=await manifestFingerprintV6(manifest)
    const staging=await createRecoveryTakeoverStagingV2({
      diaryId:source.diary_id,epochId:operation.successor_epoch_id,recoveryGeneration:generation,
      recoveryTakeoverKeyId:recovery.recoveryTakeoverKeyId,recoveryTakeoverPublicKey:base64Url(recovery.publicKeyRaw),
      recoveryTakeoverPrivateKeyPkcs8:recovery.privateKeyPkcs8,manifestFingerprint:fingerprint,urs:this.urs,
    })
    const preparedWrap=await prepareSuccessorRootWrapV6ForActiveMode(rootKey,{diary_id:source.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,manifest_fingerprint:fingerprint},wrapId)
    const history=[{recovery_generation:generation,recovery_urs_id:recoveryUrsId,recovery_takeover_key_id:recovery.recoveryTakeoverKeyId}]
    const state:EpochLocalSecurityStateV6={
      local_state_version:6,diary_id:source.diary_id,epoch_id:operation.successor_epoch_id,key_id:keyId,manifest_fingerprint:fingerprint,
      recovery_generation:generation,recovery_urs_commitment:recoveryCommitmentV6,recovery_urs_id:recoveryUrsId,
      recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null,remote_binding:null,remote_anchor:null,epoch_status:'local_offline',
      operation_generation:0,rotation_state_ref:null,migration_state_ref:null,writer_operation_state_ref:null,recovery_operation_state_ref:null,
      activation_lineage_cache_ref:null,local_journal_count:0,local_journal_hash:await localJournalInitialV2(source.diary_id,operation.successor_epoch_id),
      writer_status:'read_only',writer_device_id:writerDeviceId,writer_signing_key_id:writer.writerKeyId,writer_generation:null,writer_grant_id:null,
      verified_writer_device_id:null,verified_writer_key_id:null,verified_writer_generation:null,verified_writer_grant_id:null,
      recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(history),
      stale_writer_pending_count:0,
    }
    const plan:SuccessorPlanArtifactV2={
      format:'profile-upgrade-successor-plan-v2',operation_id:operation.operation_id,diary_id:source.diary_id,source_epoch_id:source.source_epoch_id,
      successor_epoch_id:operation.successor_epoch_id,key_id:keyId,wrap_id:preparedWrap.wrap.wrap_id,creation_locator:creationLocator,
      manifest_cells:[...manifestCellsArrayV6(manifest)] as [string,string,string,string],manifest_fingerprint:fingerprint,
      writer_device_id:writerDeviceId,writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),writer_grant_id:grantId,
      recovery_generation:generation,recovery_urs_commitment:recoveryCommitmentV6,recovery_urs_id:recoveryUrsId,
      recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
      google_account_binding:accountBinding,created_at:source.created_at,
    }
    const writerEntry:StoredWriterDeviceKeyV2={writer_signing_key_id:writer.writerKeyId,writer_device_id:writerDeviceId,writer_public_key:base64Url(writer.publicKeyRaw),private_key:writer.privateKey}
    await this.v2Store.persistProfileUpgradeSuccessorPlanBundle({
      artifactId:this.artifactId('successor-plan'),artifactValue:plan,rootKey,epochSalt,rootWrap:preparedWrap.wrap,
      bestEffortWrappingKey:preparedWrap.bestEffortWrappingKey,writerKey:writerEntry,recoveryStaging:staging,urs:this.urs,state,
    })
    recovery.privateKeyPkcs8.fill(0);rootKey.fill(0)
    return{creationLocator}
  }

  private async plan():Promise<SuccessorPlanArtifactV2>{
    const plan=await this.artifact<SuccessorPlanArtifactV2>('successor-plan')
    if(!plan)throw new Error('Profile-upgrade successor plan is missing.')
    return plan
  }
  private async successorRoot():Promise<Uint8Array>{
    const plan=await this.plan(),prepared=await this.v2Store.loadRootWrapV6(plan.successor_epoch_id)
    return openSuccessorRootWrapV6WithActiveMode(prepared)
  }
  private async successorContext():Promise<{plan:SuccessorPlanArtifactV2;rootKey:Uint8Array;epochSalt:Uint8Array;transport:GoogleSheetsTransferableSingleWriterV2Transport;codec:GoogleSheetsTransferableSingleWriterV2ProfileCodec;remoteId:string}>{
    const plan=await this.plan(),rootKey=await this.successorRoot(),epochSalt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16))
    const transport=await this.successorSession.transportForEpoch(plan.diary_id,plan.successor_epoch_id)
    const codec=await this.successorSession.codecForEpoch(plan.diary_id,plan.successor_epoch_id,rootKey,transport)
    const remote=await this.artifact<SuccessorRemoteArtifactV2>('successor-remote')
    if(!remote?.remote_id)throw new Error('Profile-upgrade successor remote binding is missing.')
    return{plan,rootKey,epochSalt,transport,codec,remoteId:remote.remote_id}
  }

  private async writer(plan:SuccessorPlanArtifactV2):Promise<StoredWriterDeviceKeyV2>{
    const key=await this.v2Store.loadWriterKey(plan.writer_key_id,plan.diary_id,plan.successor_epoch_id)
    if(!key||key.writer_device_id!==plan.writer_device_id||key.writer_public_key!==plan.writer_public_key)throw new Error('Profile-upgrade WriterDeviceKeyV2 is missing or changed.')
    return key
  }
  private writerContext(plan:SuccessorPlanArtifactV2):WriterContextV2{return{writer_generation:1,writer_grant_id:plan.writer_grant_id,writer_device_id:plan.writer_device_id,writer_key_id:plan.writer_key_id}}
  private writerAuthority(plan:SuccessorPlanArtifactV2):PreparedEnvelopeAuthorityV2{return{writer_generation:1,writer_grant_id:plan.writer_grant_id,writer_device_id:plan.writer_device_id,writer_key_id:plan.writer_key_id}}

  private async prepareV2Envelope(role:string,revision:RevisionV2,authority:PreparedEnvelopeAuthorityV2|null,remoteRows:ReadonlyArray<readonly string[]>):Promise<PreparedEnvelope>{
    const ctx=await this.successorContext(),reservationKey=`reservation:${role}`
    let reservation=await this.artifact<EnvelopeReservationV6>(reservationKey)
    if(!reservation){
      reservation=await this.v2Store.reserveEnvelope(ctx.plan.successor_epoch_id,remoteRows)
      await this.putArtifact(reservationKey,reservation)
    }
    const envelope=await sealRevisionEnvelopeV2(ctx.rootKey,ctx.epochSalt,{diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    const stored=(await this.v2Store.envelopes(ctx.plan.successor_epoch_id)).find(value=>value.envelopeId===envelope.envelopeId)
    if(stored){
      if(!sameJson(asRow(stored),asRow(envelope)))throw new Error('Persisted V2 envelope differs from its one-shot plan.')
      return stored
    }
    const state=await this.v2Store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    await this.v2Store.commitReservedEnvelope(ctx.rootKey,ctx.epochSalt,state.operation_generation,reservation,envelope,authority)
    await this.putArtifact(`envelope:${role}`,asRow(envelope))
    return envelope
  }

  private async ensureGenesisRemote(ctx:Awaited<ReturnType<ProductiveProfileUpgradeV2Service['successorContext']>>,genesis:PreparedEnvelope):Promise<void>{
    const expected=asRow(genesis)
    const inspect=async():Promise<RemoteSnapshot>=>{
      const snapshot=await ctx.transport.read(ctx.remoteId)
      if(snapshot.rows.length===0){
        const candidate=await ctx.codec.verifyCreationCandidate!(snapshot)
        if(candidate.manifestFingerprint!==ctx.plan.manifest_fingerprint)throw new Error('Profile-upgrade creation candidate ManifestV6 changed.')
        return snapshot
      }
      const unique=uniquePhysicalRows(snapshot.rows)
      if(unique.length!==1||!sameJson(unique[0],expected))throw new Error('Profile-upgrade Gen-1 Grant is not the sole first semantic Successor row.')
      return snapshot
    }
    let snapshot=await inspect()
    if(snapshot.rows.length!==0)return
    let uncertain=false
    try{await ctx.transport.append(ctx.remoteId,expected)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;uncertain=true}
    await this.fault?.('after-genesis-append')
    snapshot=await inspect()
    if(snapshot.rows.length!==0)return
    if(!uncertain)throw new Error('Profile-upgrade Gen-1 append succeeded without durable readback.')
    try{await ctx.transport.append(ctx.remoteId,expected)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error}
    snapshot=await inspect()
    if(snapshot.rows.length===0)throw new TransportError('unknown_outcome','Profile-upgrade Gen-1 Grant outcome remains unresolved; no blind third append is allowed.')
  }

  async createOrReconcileSuccessor():Promise<{manifestFingerprint:string}>{
    const plan=await this.plan(),rootKey=await this.successorRoot(),transport=await this.successorSession.transportForEpoch(plan.diary_id,plan.successor_epoch_id)
    const staging=await this.v2Store.loadRecoveryTakeoverStagingMaterial({
      epochId:plan.successor_epoch_id,recoveryGeneration:plan.recovery_generation,recoveryTakeoverKeyId:plan.recovery_takeover_key_id,
      manifestFingerprint:plan.manifest_fingerprint,urs:this.urs,
    })
    staging.privateKeyPkcs8.fill(0)
    const creation=await this.successorSession.createOrReconcileEpoch({
      diaryId:plan.diary_id,epochId:plan.successor_epoch_id,rootKey,creationLocator:plan.creation_locator,
      manifest:{format:'sync-v6',version:'6',manifestIv:plan.manifest_cells[2],manifestCiphertext:plan.manifest_cells[3]},
      transport,persistence:this.v2Store.creationPersistence(),recoveryStaging:staging.verified,
    })
    if(creation.status!=='bound'||!creation.remoteId)throw new Error('Profile-upgrade Successor creation did not reach a unique bound resource.')
    await this.putArtifact('successor-remote',{remote_id:creation.remoteId} satisfies SuccessorRemoteArtifactV2)
    const salt=await deriveEpochSaltV2(fixedBase64Url(plan.diary_id,16),fixedBase64Url(plan.successor_epoch_id,16))
    const state=await this.v2Store.loadState(rootKey,salt,plan.successor_epoch_id)
    const binding={storage_provider_id:GOOGLE_DRIVE_SHEETS_PROVIDER,sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:creation.remoteId,remote_identity_binding:plan.google_account_binding} as const
    if(state.remote_binding===null){
      await this.v2Store.replaceState(rootKey,salt,state.operation_generation,{...state,operation_generation:state.operation_generation+1,remote_binding:binding,epoch_status:'remote_bound'})
    }else if(!sameJson(state.remote_binding,binding))throw new Error('Profile-upgrade Successor remote binding changed.')

    const ctx=await this.successorContext()
    const genesisRevision=(await createProfileUpgradeGenesisGrantRevisionV2({
      diaryId:plan.diary_id,epochId:plan.successor_epoch_id,grantId:plan.writer_grant_id,writerDeviceId:plan.writer_device_id,
      writerKeyId:plan.writer_key_id,writerPublicKey:plan.writer_public_key,recoveryGeneration:plan.recovery_generation,protocolCreatedAt:plan.created_at,
      recordId:await deterministicId(plan.operation_id,'genesis-grant-record',16),revisionId:await deterministicId(plan.operation_id,'genesis-grant-revision',32),
    })).revision
    const genesis=await this.prepareV2Envelope('genesis-grant',genesisRevision,null,[])
    await this.ensureGenesisRemote(ctx,genesis)
    return{manifestFingerprint:plan.manifest_fingerprint}
  }

  private async plannedStagingRows():Promise<{rows:Row[];canonical:CanonicalFullResultV2}>{
    const ctx=await this.successorContext(),plan=ctx.plan,writer=await this.writer(plan),source=await this.frozenSource()
    const genesisRow=await this.artifact<Row>('envelope:genesis-grant')
    if(!genesisRow)throw new Error('Profile-upgrade Gen-1 envelope artifact is missing.')
    const planned:Row[]=[genesisRow]
    for(const head of source.snapshot.heads){
      const role=`copy:${head.revision_id}`
      let row=await this.artifact<Row>(`envelope:${role}`)
      if(!row){
        const revision=await copyV1HeadForProfileUpgradeV2({
          diaryId:plan.diary_id,successorEpochId:plan.successor_epoch_id,sourceEpochId:source.artifact.source_epoch_id,sourceHead:head,
          revisionId:await deterministicId(plan.operation_id,`copy-revision:${head.revision_id}`,32),writerContext:this.writerContext(plan),
          writerPrivateKey:writer.private_key,protocolCreatedAt:plan.created_at,
        })
        row=asRow(await this.prepareV2Envelope(role,revision,this.writerAuthority(plan),[]))
      }
      planned.push(row)
    }
    let migrationRow=await this.artifact<Row>('envelope:migration')
    if(!migrationRow){
      const revision=(await createProfileUpgradeMigrationRevisionV2({
        diaryId:plan.diary_id,successorEpochId:plan.successor_epoch_id,sourceEpochId:source.artifact.source_epoch_id,
        sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,sourceAnchor:source.artifact.source_anchor,
        sourceSnapshot:source.snapshot,writerContext:this.writerContext(plan),writerPrivateKey:writer.private_key,protocolCreatedAt:plan.created_at,
        migrationId:plan.operation_id,recordId:await deterministicId(plan.operation_id,'migration-record',16),revisionId:await deterministicId(plan.operation_id,'migration-revision',32),
      })).revision
      migrationRow=asRow(await this.prepareV2Envelope('migration',revision,this.writerAuthority(plan),[]))
    }
    planned.push(migrationRow)
    await this.putArtifact('staging-row-plan',planned)

    let retryBudget=1
    for(;;){
      let snapshot=await ctx.transport.read(ctx.remoteId)
      const present=requirePrefix(snapshot.rows,planned)
      if(present===planned.length){
        const verified=await ctx.codec.verifyRemote(snapshot),result=canonical(verified)
        await verifyProfileUpgradeMigrationIntegrityV2({
          sourceEpochId:source.artifact.source_epoch_id,sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,
          sourceAnchor:source.artifact.source_anchor,sourceRevisions:source.material.revisions,successor:result,
        })
        await this.commitSuccessorCanonical(verified,result)
        return{rows:planned,canonical:result}
      }
      if(present===0)throw new Error('Profile-upgrade Successor lost its manifest-bound Gen-1 Grant.')
      await ctx.codec.verifyRotationResume(snapshot,{successor_epoch_id:plan.successor_epoch_id,successor_manifest_fingerprint:plan.manifest_fingerprint,stage:'copying',mac_authenticated:true})
      const next=planned[present]!
      let unknown=false
      try{await ctx.transport.append(ctx.remoteId,next)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      snapshot=await ctx.transport.read(ctx.remoteId)
      const after=requirePrefix(snapshot.rows,planned)
      if(after>present){retryBudget=1;continue}
      if(!unknown)throw new Error('Profile-upgrade Successor append succeeded without advancing the verified prefix.')
      if(retryBudget===0)throw new TransportError('unknown_outcome','Profile-upgrade Successor append remains unresolved; no blind third append is allowed.')
      retryBudget=0
      await ctx.codec.verifyRotationResume(snapshot,{successor_epoch_id:plan.successor_epoch_id,successor_manifest_fingerprint:plan.manifest_fingerprint,stage:'copying',mac_authenticated:true})
    }
  }

  async copyAndVerifySuccessor():Promise<{stagingAnchor:{anchor_profile:typeof SINGLE_WRITER_V2_PROFILE;covered_row_count:number;prefix_hash:string}}>{
    const result=await this.plannedStagingRows()
    return{stagingAnchor:result.canonical.remote_anchor}
  }

  private async commitSuccessorCanonical(verified:VerifiedRemoteState,result:CanonicalFullResultV2):Promise<void>{
    const ctx=await this.successorContext(),state=await this.v2Store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id),key=await this.writer(ctx.plan)
    const reconciled=await stateAfterCanonicalVerifyV6(state,result,verified.snapshot.rows,key.writer_device_id===ctx.plan.writer_device_id)
    await this.v2Store.commitVerifiedDispositions(ctx.rootKey,ctx.epochSalt,state.operation_generation,reconciled,verified.acceptedEnvelopeIds,verified.staleWriterEnvelopeIds,{
      remote_rows:verified.snapshot.rows,current_writer:{
        writer_generation:result.current_writer.writer_generation,writer_grant_id:result.current_writer.writer_grant_id,
        writer_device_id:result.current_writer.writer_device_id,writer_key_id:result.current_writer.writer_key_id,
      },source_epoch_sealed:result.source_epoch_sealed,recovery_rekey_rotation_required:result.current_recovery.recovery_rekey_rotation_required,
    })
  }

  private async sourceAnnouncement():Promise<PreparedEnvelope>{
    const existing=await this.artifact<Row>('source-announcement-row')
    if(existing)return preparedFromRow(existing)
    const operation=await this.load(),plan=await this.plan(),source=await this.frozenSource()
    const revision:RevisionV1={
      record_type:'rotation_announcement',record_schema:'rotation-announcement-sw-v1',
      record_id:await deterministicId(operation.operation_id,'source-announcement-record',16),
      revision_id:await deterministicId(operation.operation_id,'source-announcement-revision',32),
      parent_revision_ids:[],record_status:'control',
      record_data:{rotation_id:operation.operation_id,from_epoch_id:source.artifact.source_epoch_id,successor_epoch_id:plan.successor_epoch_id,
        successor_creation_locator:plan.creation_locator,successor_manifest_fingerprint:plan.manifest_fingerprint,rotation_kind:'profile_upgrade'},
      migration_origin:null,protocol_created_at:plan.created_at,
    }
    validateRevisionV1(revision)
    const envelope=await this.v1Repository.prepareRotationEnvelope(`${operation.operation_id}:profile-upgrade-announcement`,source.material.context,revision)
    await this.putArtifact('source-announcement-row',asRow(envelope))
    return envelope
  }

  async prepareActivation():Promise<{
    announcementEnvelope:{envelope_id:string;iv:string;ciphertext:string}
    confirmationEnvelope:{envelope_id:string;iv:string;ciphertext:string}
    activationEvidenceSha256:string;activationLineageSha256:string
    recoveryArtifactId:string;recoveryArtifactLocator:string;recoveryArtifactSha256:string
  }>{
    const existing=await this.artifact<ActivationArtifactV2>('activation')
    if(existing){
      const plan=await this.plan()
      return{
        announcementEnvelope:structuredClone(existing.entry.announcement_envelope),
        confirmationEnvelope:structuredClone(existing.entry.successor_confirmation_envelope),
        activationEvidenceSha256:await profileUpgradeActivationEvidenceHashV2(existing.entry),
        activationLineageSha256:await activationLineageHashV2(existing.lineage),
        recoveryArtifactId:existing.recovery_artifact.recovery_artifact_id,
        recoveryArtifactLocator:await recoveryArtifactLocatorV6(this.urs,plan.diary_id,plan.successor_epoch_id),
        recoveryArtifactSha256:await recoveryArtifactHashV6(existing.recovery_artifact),
      }
    }
    const operation=await this.load(),plan=await this.plan(),ctx=await this.successorContext(),source=await this.frozenSource()
    if(!operation.successor_staging_anchor)throw new Error('Profile-upgrade staging anchor is missing.')
    const writer=await this.writer(plan),announcement=await this.sourceAnnouncement()
    const confirmation=await createProfileUpgradeConfirmationRevisionV2({
      diaryId:plan.diary_id,successorEpochId:plan.successor_epoch_id,successorManifestFingerprint:plan.manifest_fingerprint,
      sourceEpochId:source.artifact.source_epoch_id,sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,
      sourceAnchor:source.artifact.source_anchor,successorStagingAnchor:operation.successor_staging_anchor,announcementEnvelope:announcement,
      writerContext:this.writerContext(plan),writerPrivateKey:writer.private_key,protocolCreatedAt:plan.created_at,
      confirmationId:await deterministicId(plan.operation_id,'confirmation-id',32),recordId:await deterministicId(plan.operation_id,'confirmation-record',16),
      revisionId:await deterministicId(plan.operation_id,'confirmation-revision',32),
    })
    const stagingSnapshot=await ctx.transport.read(ctx.remoteId)
    const staged=canonical(await ctx.codec.verifyRemote(stagingSnapshot))
    if(!sameJson(staged.remote_anchor,operation.successor_staging_anchor)||staged.accepted_activation_confirmation!==null)throw new Error('Profile-upgrade Successor changed after staging anchor freeze.')
    const confirmationEnvelope=await this.prepareV2Envelope('confirmation',confirmation.revision,this.writerAuthority(plan),stagingSnapshot.rows)
    const entry=createProfileUpgradeActivationEntryV2({
      sourceEpochId:source.artifact.source_epoch_id,sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,sourceRootKey:source.material.rootKey,
      sourceAnchor:source.artifact.source_anchor,successorEpochId:plan.successor_epoch_id,successorManifestFingerprint:plan.manifest_fingerprint,
      successorStagingAnchor:operation.successor_staging_anchor,announcementEnvelope:announcement,confirmationEnvelope,
    })
    const lineage:[ProfileUpgradeActivationEntryV2]=[entry]
    const stagingMaterial=await this.v2Store.loadRecoveryTakeoverStagingMaterial({
      epochId:plan.successor_epoch_id,recoveryGeneration:plan.recovery_generation,recoveryTakeoverKeyId:plan.recovery_takeover_key_id,
      manifestFingerprint:plan.manifest_fingerprint,urs:this.urs,
    })
    const artifactId=await deterministicId(plan.operation_id,'recovery-artifact-id',16)
    const artifact=await createRecoveryArtifactV6({
      diary_id:plan.diary_id,epoch_id:plan.successor_epoch_id,key_id:plan.key_id,RK_epoch:base64Url(ctx.rootKey),manifest_fingerprint:plan.manifest_fingerprint,
      remote_anchor:operation.successor_staging_anchor,google_account_binding:plan.google_account_binding,recovery_generation:plan.recovery_generation,
      recovery_urs_commitment:plan.recovery_urs_commitment,recovery_urs_id:plan.recovery_urs_id,
      recovery_credential_history:[{recovery_generation:plan.recovery_generation,recovery_urs_id:plan.recovery_urs_id,recovery_takeover_key_id:plan.recovery_takeover_key_id}],
      recovery_takeover_key_id:plan.recovery_takeover_key_id,recovery_takeover_public_key:plan.recovery_takeover_public_key,
      recovery_takeover_private_key_pkcs8:base64Url(stagingMaterial.privateKeyPkcs8),activation_lineage:lineage,recovery_authority_transition_proof:null,
      created_at:plan.created_at,
    },this.urs,fromBase64Url(artifactId))
    stagingMaterial.privateKeyPkcs8.fill(0)
    await this.putArtifact('activation',{entry,lineage,recovery_artifact:artifact} satisfies ActivationArtifactV2)
    await this.fault?.('after-activation-artifact')
    const persisted=await this.v2Store.persistRecoveryArtifactV6(this.urs,plan.diary_id,plan.successor_epoch_id,artifact)
    return{
      announcementEnvelope:{envelope_id:announcement.envelopeId,iv:announcement.iv,ciphertext:announcement.ciphertext},
      confirmationEnvelope:{envelope_id:confirmationEnvelope.envelopeId,iv:confirmationEnvelope.iv,ciphertext:confirmationEnvelope.ciphertext},
      activationEvidenceSha256:await profileUpgradeActivationEvidenceHashV2(entry),activationLineageSha256:await activationLineageHashV2(lineage),
      recoveryArtifactId:artifact.recovery_artifact_id,recoveryArtifactLocator:persisted.artifactLocator,recoveryArtifactSha256:await recoveryArtifactHashV6(artifact),
    }
  }

  async publishAndVerifyRecoveryArtifact():Promise<void>{
    const plan=await this.plan(),activation=await this.artifact<ActivationArtifactV2>('activation')
    if(!activation)throw new Error('Profile-upgrade activation artifact is missing.')
    const persisted=await this.v2Store.persistRecoveryArtifactV6(this.urs,plan.diary_id,plan.successor_epoch_id,activation.recovery_artifact)
    await this.successorSession.publishRecoveryArtifact(this.urs,persisted)
    const readback=await this.successorSession.loadRecoveryArtifact(this.urs,plan.diary_id,plan.successor_epoch_id)
    if(!sameJson(readback,activation.recovery_artifact))throw new Error('Profile-upgrade RecoveryArtifactV6 remote readback differs from persisted one-shot bytes.')

    // §18 step 6 requires an actual staged Recovery test here; remote readback
    // alone is insufficient. Re-derive RK/takeover authority from the published
    // artifact, re-verify the frozen v1 source prefix and the exact staged v2
    // migration prefix, and bind the recovered lineage to the one-shot evidence.
    const recovered=await openRecoveryArtifactV6(readback,this.urs)
    const ctx=await this.successorContext(),operation=await this.load(),source=await this.frozenSource()
    if(base64Url(recovered.rootKey)!==base64Url(ctx.rootKey)
      ||recovered.payload.diary_id!==plan.diary_id
      ||recovered.payload.epoch_id!==plan.successor_epoch_id
      ||recovered.payload.manifest_fingerprint!==plan.manifest_fingerprint
      ||!operation.successor_staging_anchor
      ||!sameJson(recovered.payload.remote_anchor,operation.successor_staging_anchor)
      ||!sameJson(recovered.payload.activation_lineage,activation.lineage))throw new Error('Profile-upgrade staged RecoveryArtifactV6 recovered a different successor identity/evidence.')

    const sourceRemote=await this.verifySourceAtFrozenPrefix(false)
    const sourceVerifier=await this.sourceVerifier(source.material,source.artifact.source_anchor)
    const sourceVerified=await sourceVerifier.verify(sourceRemote.snapshot)
    if(sourceVerified.retired||sourceRemote.snapshot.rows.length!==source.artifact.source_anchor.covered_row_count)throw new Error('Profile-upgrade staged Recovery test does not bind the frozen active v1 Source prefix.')

    const sourceSalt=await deriveEpochSalt(fromBase64Url(plan.diary_id),fromBase64Url(source.artifact.source_epoch_id))
    const openedAnnouncement=await openEnvelope(
      source.material.rootKey,
      sourceSalt,
      {diaryId:plan.diary_id,epochId:source.artifact.source_epoch_id},
      preparedFromRow([
        activation.entry.announcement_envelope.envelope_id,
        activation.entry.announcement_envelope.iv,
        activation.entry.announcement_envelope.ciphertext,
      ]),
    )
    if(openedAnnouncement.record_schema!=='rotation-announcement-sw-v1'
      ||!sameJson(openedAnnouncement.record_data,{
        rotation_id:operation.operation_id,
        from_epoch_id:source.artifact.source_epoch_id,
        successor_epoch_id:plan.successor_epoch_id,
        successor_creation_locator:plan.creation_locator,
        successor_manifest_fingerprint:plan.manifest_fingerprint,
        rotation_kind:'profile_upgrade',
      }))throw new Error('Profile-upgrade staged Recovery test rejected its one-shot v1 Announcement evidence.')

    const openedConfirmation=await openRevisionEnvelopeV2(
      recovered.rootKey,
      ctx.epochSalt,
      {diaryId:plan.diary_id,epochId:plan.successor_epoch_id},
      preparedFromRow([
        activation.entry.successor_confirmation_envelope.envelope_id,
        activation.entry.successor_confirmation_envelope.iv,
        activation.entry.successor_confirmation_envelope.ciphertext,
      ]),
    )
    if(openedConfirmation.record_schema!=='successor-activation-confirmation-sw-v2'
      ||openedConfirmation.writer_signature===null
      ||!await verifyEd25519V2(
        fixedBase64Url(plan.writer_public_key,32),
        openedConfirmation.writer_signature,
        revisionSigningBytesV2(plan.diary_id,plan.successor_epoch_id,openedConfirmation),
      )
      ||!sameJson(openedConfirmation.record_data,{
        confirmation_id:await deterministicId(plan.operation_id,'confirmation-id',32),
        activation_kind:'profile_upgrade',
        source_profile:SINGLE_WRITER_V1_PROFILE,
        source_epoch_id:source.artifact.source_epoch_id,
        source_manifest_fingerprint:source.artifact.source_manifest_fingerprint,
        source_anchor_before_announcement:source.artifact.source_anchor,
        successor_epoch_id:plan.successor_epoch_id,
        successor_manifest_fingerprint:plan.manifest_fingerprint,
        successor_staging_anchor:operation.successor_staging_anchor,
        source_announcement_envelope_sha256:await (await import('../security/v2/profileUpgrade')).sourceAnnouncementEnvelopeHashV2(preparedFromRow([
          activation.entry.announcement_envelope.envelope_id,
          activation.entry.announcement_envelope.iv,
          activation.entry.announcement_envelope.ciphertext,
        ])),
      }))throw new Error('Profile-upgrade staged Recovery test rejected its one-shot v2 Confirmation evidence.')

    const successorVerified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),result=canonical(successorVerified)
    if(!sameJson(result.remote_anchor,operation.successor_staging_anchor)||result.accepted_activation_confirmation!==null)throw new Error('Profile-upgrade staged Recovery test does not bind the frozen Successor prefix.')
    await verifyProfileUpgradeMigrationIntegrityV2({
      sourceEpochId:source.artifact.source_epoch_id,
      sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,
      sourceAnchor:source.artifact.source_anchor,
      sourceRevisions:source.material.revisions,
      successor:result,
    })
  }

  private async backupRows():Promise<{pending:Row[];stale:Row[]}>{
    const ctx=await this.successorContext(),entries=await this.v2Store.outbox(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id),envelopes=await this.v2Store.envelopes(ctx.plan.successor_epoch_id),byId=new Map(envelopes.map(envelope=>[envelope.envelopeId,asRow(envelope)]))
    const pending:Row[]=[],stale:Row[]=[]
    for(const entry of entries){
      const row=byId.get(entry.envelope_id)
      if(!row)throw new Error('Profile-upgrade backup outbox references a missing immutable envelope.')
      if(entry.status==='stale_writer_pending')stale.push(row)
      else if(entry.status!=='durable')pending.push(row)
    }
    return{pending,stale}
  }
  private async createBackup(activationState:'staged'|'activated',verified:VerifiedRemoteState):Promise<{backup:SyncBackupV6;anchor:CanonicalFullResultV2['remote_anchor']}>{
    const ctx=await this.successorContext(),activation=await this.artifact<ActivationArtifactV2>('activation')
    if(!activation)throw new Error('Profile-upgrade activation artifact is missing.')
    const rows=verified.snapshot.rows.map(row=>[row[0]!,row[1]!,row[2]!] as Row),local=await this.backupRows(),result=canonical(verified)
    const backup=await createBackupV6({
      rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,urs:this.urs,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,keyId:ctx.plan.key_id,
      epochManifestPublic:ctx.plan.manifest_cells,canonical:result,recoveryArtifact:activation.recovery_artifact,recordRows:rows,
      pendingOutboxRows:local.pending,staleWriterPendingRows:local.stale,activationState,createdAt:ctx.plan.created_at,
    })
    const restored=await testRestoreBackupV6({rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,urs:this.urs,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,keyId:ctx.plan.key_id},backup,new TransferableSingleWriterV2Verifier())
    if(restored.access!=='read_only'||restored.activation_state!==activationState||!sameJson(restored.canonical.remote_anchor,result.remote_anchor))throw new Error('Profile-upgrade BackupV6 test restore did not reproduce its export anchor.')
    return{backup,anchor:result.remote_anchor}
  }

  async createAndVerifyStagedBackup():Promise<{backupId:string}>{
    const existing=await this.artifact<BackupArtifactV2>('staged-backup')
    if(existing)return{backupId:existing.backup.backup_id}
    const operation=await this.load(),ctx=await this.successorContext(),verified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),result=canonical(verified)
    if(!operation.successor_staging_anchor||!sameJson(result.remote_anchor,operation.successor_staging_anchor)||result.accepted_activation_confirmation!==null)throw new Error('Staged BackupV6 must end exactly at the frozen Successor staging anchor.')
    const created=await this.createBackup('staged',verified)
    await this.putArtifact('staged-backup',{backup:created.backup,anchor:created.anchor} satisfies BackupArtifactV2)
    try{await this.v2Store.deleteRecoveryTakeoverStaging({epochId:ctx.plan.successor_epoch_id,recoveryGeneration:ctx.plan.recovery_generation,recoveryTakeoverKeyId:ctx.plan.recovery_takeover_key_id,manifestFingerprint:ctx.plan.manifest_fingerprint,urs:this.urs})}
    catch(error){if(!(error instanceof Error)||!error.message.includes('is missing'))throw error}
    return{backupId:created.backup.backup_id}
  }

  private async verifySourceAtFrozenPrefix(allowAnnouncement:boolean):Promise<{snapshot:RemoteSnapshot;announcementCount:number}>{
    const operation=await this.load(),source=await this.frozenSource(),announcement=operation.announcement_envelope
    const snapshot=await this.sourceTransport.read(source.artifact.source_remote_id)
    const prefix=snapshot.rows.slice(0,source.artifact.source_anchor.covered_row_count)
    if(!sameJson(await createAnchorV1(source.artifact.diary_id,source.artifact.source_epoch_id,prefix),source.artifact.source_anchor))throw new Error('Frozen v1 Source prefix changed.')
    if(snapshot.rows.length===source.artifact.source_anchor.covered_row_count)return{snapshot,announcementCount:0}
    if(!allowAnnouncement||!announcement)throw new ProfileUpgradePreCutoverStaleError('v1 Source advanced before its one-shot profile-upgrade Announcement.')
    const expected:[string,string,string]=[announcement.envelope_id,announcement.iv,announcement.ciphertext]
    let count=0
    for(const row of snapshot.rows.slice(source.artifact.source_anchor.covered_row_count)){
      if(!sameJson(row,expected))throw new ProfileUpgradeSourceRaceError('profile_upgrade_source_race')
      count+=1
    }
    return{snapshot,announcementCount:count}
  }
  private async verifySuccessorAtStagingOrConfirmation():Promise<{verified:VerifiedRemoteState;confirmationCount:number;activationAnchor:CanonicalFullResultV2['remote_anchor']|null}>{
    const operation=await this.load(),ctx=await this.successorContext()
    if(!operation.successor_staging_anchor||!operation.confirmation_envelope)throw new Error('Profile-upgrade cutover evidence is incomplete.')
    const snapshot=await ctx.transport.read(ctx.remoteId)
    const stagingRows=snapshot.rows.slice(0,operation.successor_staging_anchor.covered_row_count)
    if(!sameJson(await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,stagingRows),operation.successor_staging_anchor))throw new Error('Profile-upgrade Successor staging prefix changed.')
    const suffix=snapshot.rows.slice(operation.successor_staging_anchor.covered_row_count),expected:[string,string,string]=[operation.confirmation_envelope.envelope_id,operation.confirmation_envelope.iv,operation.confirmation_envelope.ciphertext]
    if(!suffix.length){
      const verified=await ctx.codec.verifyRemote(snapshot)
      return{verified,confirmationCount:0,activationAnchor:null}
    }
    let duplicates=0
    for(const row of suffix){
      if(duplicates===suffix.length)break
      if(sameJson(row,expected)){duplicates++;continue}
      break
    }
    if(duplicates===0)throw new ProfileUpgradeSuccessorCutoverRaceError('profile_upgrade_successor_cutover_race')
    const verified=await ctx.codec.verifyRemote(snapshot)
    const activationAnchor=await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,snapshot.rows.slice(0,operation.successor_staging_anchor.covered_row_count+duplicates))
    return{verified,confirmationCount:duplicates,activationAnchor}
  }

  async publishOrReconcileAnnouncement(state:RotationOperationStateV2):Promise<{kind:'durable'}|{kind:'unknown'}|{kind:'stale'}|{kind:'source_race'}>{
    const operation=await this.load()
    if(!operation.announcement_envelope||!operation.successor_staging_anchor)throw new Error('Profile-upgrade Announcement is not prepared.')
    let sourceBefore:Awaited<ReturnType<ProductiveProfileUpgradeV2Service['verifySourceAtFrozenPrefix']>>
    let successorBefore:Awaited<ReturnType<ProductiveProfileUpgradeV2Service['verifySuccessorAtStagingOrConfirmation']>>
    try{
      sourceBefore=await this.verifySourceAtFrozenPrefix(true)
      successorBefore=await this.verifySuccessorAtStagingOrConfirmation()
    }catch(error){
      if(error instanceof ProfileUpgradePreCutoverStaleError
        ||error instanceof ProfileUpgradeSourceRaceError
        ||error instanceof ProfileUpgradeSuccessorCutoverRaceError)return{kind:'stale'}
      throw error
    }
    if(sourceBefore.announcementCount===0&&successorBefore.confirmationCount!==0)return{kind:'stale'}
    if(sourceBefore.announcementCount===0&&!sameJson(canonical(successorBefore.verified).remote_anchor,operation.successor_staging_anchor))return{kind:'stale'}
    if(sourceBefore.announcementCount>0){
      const source=await this.frozenSource(),verifier=await this.sourceVerifier(source.material,source.artifact.source_anchor),verified=await verifier.verify(sourceBefore.snapshot)
      if(!verified.retired)throw new Error('Profile-upgrade v1 Announcement did not retire the Source.')
      const anchor=await createAnchorV1(source.artifact.diary_id,source.artifact.source_epoch_id,sourceBefore.snapshot.rows),store=new IndexedDbCoordinatorStore(source.artifact.source_epoch_id)
      await store.commitVerifiedPull(verified,anchor,await store.generation())
      return{kind:'durable'}
    }
    if(state.stage==='announcement_unknown')return{kind:'unknown'}

    const row:[string,string,string]=[operation.announcement_envelope.envelope_id,operation.announcement_envelope.iv,operation.announcement_envelope.ciphertext]
    let unknown=false
    try{await this.sourceTransport.append((await this.frozenSource()).artifact.source_remote_id,row)}
    catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
    await this.fault?.('after-source-append')
    let readback
    try{readback=await this.verifySourceAtFrozenPrefix(true)}
    catch(error){if(error instanceof ProfileUpgradeSourceRaceError)return{kind:'source_race'};throw error}
    if(readback.announcementCount===0&&unknown){
      const source=await this.frozenSource(),verifier=await this.sourceVerifier(source.material,source.artifact.source_anchor)
      await verifier.verify(readback.snapshot)
      try{await this.sourceTransport.append(source.artifact.source_remote_id,row)}
      catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error}
      try{readback=await this.verifySourceAtFrozenPrefix(true)}
      catch(error){if(error instanceof ProfileUpgradeSourceRaceError)return{kind:'source_race'};throw error}
    }
    if(readback.announcementCount===0)return{kind:'unknown'}
    const source=await this.frozenSource(),verifier=await this.sourceVerifier(source.material,source.artifact.source_anchor),verified=await verifier.verify(readback.snapshot)
    if(!verified.retired)throw new Error('Profile-upgrade v1 Announcement did not retire the Source.')
    const anchor=await createAnchorV1(source.artifact.diary_id,source.artifact.source_epoch_id,readback.snapshot.rows),store=new IndexedDbCoordinatorStore(source.artifact.source_epoch_id)
    await store.commitVerifiedPull(verified,anchor,await store.generation())
    return{kind:'durable'}
  }

  async publishOrReconcileConfirmation(state:RotationOperationStateV2):Promise<{kind:'durable';activationAnchor:CanonicalFullResultV2['remote_anchor']}|{kind:'unknown'}|{kind:'cutover_race'}>{
    const operation=await this.load(),ctx=await this.successorContext()
    if(!operation.confirmation_envelope)throw new Error('Profile-upgrade Confirmation is not prepared.')
    const source=await this.verifySourceAtFrozenPrefix(true)
    if(source.announcementCount===0)throw new Error('Successor Confirmation is forbidden before durable v1 Announcement.')
    try{
      let successor=await this.verifySuccessorAtStagingOrConfirmation()
      if(successor.confirmationCount>0){
        const result=canonical(successor.verified)
        await this.verifyActivationBoundary(successor.verified,result)
        await this.commitSuccessorCanonical(successor.verified,result)
        return{kind:'durable',activationAnchor:successor.activationAnchor!}
      }
      if(state.stage==='confirmation_unknown')return{kind:'unknown'}
      const row:[string,string,string]=[operation.confirmation_envelope.envelope_id,operation.confirmation_envelope.iv,operation.confirmation_envelope.ciphertext]
      let unknown=false
      try{await ctx.transport.append(ctx.remoteId,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      await this.fault?.('after-confirmation-append')
      successor=await this.verifySuccessorAtStagingOrConfirmation()
      if(successor.confirmationCount===0&&unknown){
        const staged=canonical(successor.verified)
        if(!sameJson(staged.remote_anchor,operation.successor_staging_anchor))return{kind:'cutover_race'}
        try{await ctx.transport.append(ctx.remoteId,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error}
        successor=await this.verifySuccessorAtStagingOrConfirmation()
      }
      if(successor.confirmationCount===0)return{kind:'unknown'}
      const result=canonical(successor.verified)
      await this.verifyActivationBoundary(successor.verified,result)
      await this.commitSuccessorCanonical(successor.verified,result)
      return{kind:'durable',activationAnchor:successor.activationAnchor!}
    }catch(error){
      if(error instanceof ProfileUpgradeSuccessorCutoverRaceError)return{kind:'cutover_race'}
      throw error
    }
  }

  private async verifyActivationBoundary(verified:VerifiedRemoteState,result:CanonicalFullResultV2):Promise<void>{
    const operation=await this.load(),source=await this.frozenSource(),activation=await this.artifact<ActivationArtifactV2>('activation')
    if(!activation||!operation.successor_staging_anchor)throw new Error('Profile-upgrade activation evidence is missing.')
    await verifyProfileUpgradeMigrationIntegrityV2({
      sourceEpochId:source.artifact.source_epoch_id,sourceManifestFingerprint:source.artifact.source_manifest_fingerprint,
      sourceAnchor:source.artifact.source_anchor,sourceRevisions:source.material.revisions,successor:result,
    })
    const sourceRemote=await this.verifySourceAtFrozenPrefix(true)
    if(sourceRemote.announcementCount<1)throw new Error('Profile-upgrade activation lacks durable Source Announcement.')
    const announcement=operation.announcement_envelope!,confirmation=operation.confirmation_envelope!
    if(!sameJson(activation.entry.source_anchor_before_announcement,source.artifact.source_anchor)
      ||activation.entry.source_epoch_id!==source.artifact.source_epoch_id
      ||activation.entry.source_manifest_fingerprint!==source.artifact.source_manifest_fingerprint
      ||activation.entry.source_root_key!==base64Url(source.material.rootKey)
      ||activation.entry.successor_epoch_id!==result.epoch_id
      ||activation.entry.successor_manifest_fingerprint!==result.manifest_fingerprint
      ||!sameJson(activation.entry.successor_staging_anchor,operation.successor_staging_anchor)
      ||!sameJson(activation.entry.announcement_envelope,announcement)
      ||!sameJson(activation.entry.successor_confirmation_envelope,confirmation))throw new Error('Profile-upgrade ActivationLineageV2 binding mismatch.')
    if(result.accepted_activation_confirmation===null||result.activation_state!=='cross_epoch_evidence_present')throw new Error('Profile-upgrade canonical successor lacks accepted Confirmation evidence.')
    void verified
  }

  private async recoveryAdvancedBeyondArtifact(result:CanonicalFullResultV2):Promise<boolean>{
    const activation=await this.artifact<ActivationArtifactV2>('activation')
    if(!activation)throw new Error('Profile-upgrade recovery artifact is missing.')
    const payload=(await import('../security/v2/recovery')).openRecoveryArtifactV6
    const opened=(await payload(activation.recovery_artifact,this.urs)).payload
    return result.source_epoch_sealed
      ||result.current_recovery.recovery_generation!==opened.recovery_generation
      ||result.current_recovery.recovery_urs_id!==opened.recovery_urs_id
      ||result.current_recovery.recovery_takeover_key_id!==opened.recovery_takeover_key_id
      ||result.current_recovery.recovery_rekey_rotation_required
  }

  async createAndVerifyActivatedBackup():Promise<{kind:'ready';activatedBackupId:string}|{kind:'superseded'}>{
    const existing=await this.artifact<BackupArtifactV2>('activated-backup')
    if(existing)return{kind:'ready',activatedBackupId:existing.backup.backup_id}
    const ctx=await this.successorContext(),verified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),result=canonical(verified)
    await this.verifyActivationBoundary(verified,result)
    if(await this.recoveryAdvancedBeyondArtifact(result))return{kind:'superseded'}
    await this.commitSuccessorCanonical(verified,result)
    const created=await this.createBackup('activated',verified)
    await this.putArtifact('activated-backup',{backup:created.backup,anchor:created.anchor} satisfies BackupArtifactV2)
    return{kind:'ready',activatedBackupId:created.backup.backup_id}
  }

  async persistLineageAndReverifyBeforeSwitch():Promise<'ready'|'superseded'>{
    const ctx=await this.successorContext(),activation=await this.artifact<ActivationArtifactV2>('activation'),backup=await this.artifact<BackupArtifactV2>('activated-backup')
    if(!activation||!backup)throw new Error('Profile-upgrade final activation artifacts are incomplete.')
    const state=await this.v2Store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    if(state.activation_lineage_cache_ref===null){
      const cache=await createActivationLineageCacheV2({
        rootKey:ctx.rootKey,epochSalt:ctx.epochSalt,diaryId:ctx.plan.diary_id,epochId:ctx.plan.successor_epoch_id,
        manifestFingerprint:ctx.plan.manifest_fingerprint,activationLineage:activation.lineage,
      })
      await this.v2Store.persistActivationLineageCache(ctx.rootKey,ctx.epochSalt,cache,state.operation_generation)
    }else await this.v2Store.loadActivationLineageCache(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)

    const verified=await ctx.codec.verifyRemote(await ctx.transport.read(ctx.remoteId)),result=canonical(verified)
    await this.verifyActivationBoundary(verified,result)
    if(await this.recoveryAdvancedBeyondArtifact(result))return'superseded'
    const exported=backup.anchor
    if(result.remote_anchor.covered_row_count<exported.covered_row_count
      ||!sameJson(await createAnchorV2(ctx.plan.diary_id,ctx.plan.successor_epoch_id,verified.snapshot.rows.slice(0,exported.covered_row_count)),exported))throw new Error('Profile-upgrade remote prefix no longer extends the activated BackupV6 anchor.')
    await this.commitSuccessorCanonical(verified,result)
    return'ready'
  }

  async switchLocally(state:RotationOperationStateV2):Promise<void>{
    const ctx=await this.successorContext(),selected=await activeProtocolSelectionV2()
    if(!selected){
      await atomicSelectV2AndRetireV1({operation:state,diaryId:ctx.plan.diary_id,successorEpochId:ctx.plan.successor_epoch_id,successorManifestFingerprint:ctx.plan.manifest_fingerprint})
      await this.fault?.('after-local-selection')
    }else if(selected.operation_id!==state.operation_id||selected.epoch_id!==ctx.plan.successor_epoch_id)throw new Error('A different v2 profile selection already won locally.')

    const local=await this.v2Store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    if(local.epoch_status!=='active'){
      if(local.epoch_status!=='remote_bound'||local.remote_anchor===null||local.verified_writer_generation===null||local.verified_writer_grant_id===null)throw new Error('Profile-upgrade Successor is not safely promotable to active.')
      const localWriter=local.verified_writer_device_id===ctx.plan.writer_device_id&&local.verified_writer_key_id===ctx.plan.writer_key_id
      const next:EpochLocalSecurityStateV6={...local,epoch_status:'active',operation_generation:local.operation_generation+1,
        writer_status:localWriter?'writer_active':'read_only',
        writer_generation:localWriter?local.verified_writer_generation:null,writer_grant_id:localWriter?local.verified_writer_grant_id:null}
      await this.v2Store.replaceState(ctx.rootKey,ctx.epochSalt,local.operation_generation,next)
    }
  }

  async orphanPreAnnouncementSuccessor():Promise<void>{
    const ctx=await this.successorContext(),state=await this.v2Store.loadState(ctx.rootKey,ctx.epochSalt,ctx.plan.successor_epoch_id)
    if(state.epoch_status==='orphaned')return
    await this.v2Store.replaceState(ctx.rootKey,ctx.epochSalt,state.operation_generation,{...state,epoch_status:'orphaned',writer_status:'read_only',writer_generation:null,writer_grant_id:null,operation_generation:state.operation_generation+1})
  }
  async markSourceRace(state:RotationOperationStateV2):Promise<void>{await markV1ProfileUpgradeSourceRace(state)}
}
