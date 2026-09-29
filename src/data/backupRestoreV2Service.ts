import { base64Url, fixedBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSaltV2, generateWriterDeviceKeyV2 } from '../security/v2/crypto'
import { testRestoreBackupV6, type SyncBackupV6 } from '../security/v2/backup'
import {
  BACKUP_RESTORE_STAGES_V2,
  backupDocumentHashV6,
  backupRestoreCheckpointHashV2,
  backupRestoreOperationIdV2,
  backupRestorePlanHashV2,
  validateBackupRestoreCheckpointV2,
  validateBackupRestorePlanV2,
  type BackupRestoreCheckpointV2,
  type BackupRestorePlanV2,
  type BackupRestoreStageV2,
} from '../security/v2/backupRestoreOperation'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import {
  localJournalInitialV2,
  recoveryCredentialHistoryHashV2,
  type EpochLocalSecurityStateV6,
  type StoredWriterDeviceKeyV2,
} from '../security/v2/localState'
import { openRecoveryArtifactV6, recoveryArtifactHashV6 } from '../security/v2/recovery'
import { TransferableSingleWriterV2Verifier } from '../security/v2/verifier'
import {
  activeProtocolSelectionV2,
  assertReadOnlyJoinLocalProfileIsFresh,
  atomicSelectOfflineRestoreV2,
  prepareReadOnlyJoinRootWrapV6ForActiveMode,
  retainVerifiedOfflineRestoreRootWrapV6Unlock,
} from './localDatabase'

export type BackupRestoreFaultPointV2=
  |'after-verified'
  |'after-local-bundle'
  |'after-local-data'
  |'after-selection'

export interface ProductiveBackupRestoreV2Result {
  operationId:string
  backupId:string
  diaryId:string
  epochId:string
  manifestFingerprint:string
  stage:'selected'
  access:'read_only'
  quarantinedRowCount:number
  resumed:boolean
}

function checkpointId(operationId:string,stage:BackupRestoreStageV2):string{
  return `backup-restore:${operationId}:checkpoint:${stage}`
}
function planId(operationId:string):string{return `backup-restore:${operationId}:plan`}
function ownerId(epochId:string):string{return `backup-restore-owner:${epochId}`}

export class ProductiveBackupRestoreV2Service {
  constructor(
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly fault?: (point:BackupRestoreFaultPointV2)=>Promise<void>|void,
  ){}

  private async checkpoint(
    plan:BackupRestorePlanV2,
    planHash:string,
    stage:BackupRestoreStageV2,
    priorHash:string|null,
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
  ):Promise<string>{
    const id=checkpointId(plan.operation_id,stage)
    const existing=await this.store.macBoundOperationArtifact<BackupRestoreCheckpointV2>(id,rootKey,epochSalt)
    if(existing){
      validateBackupRestoreCheckpointV2(existing)
      if(existing.operation_id!==plan.operation_id||existing.plan_sha256!==planHash
        ||existing.stage!==stage||existing.prior_checkpoint_sha256!==priorHash)throw new Error('Backup Restore checkpoint chain does not match the exact operation.')
      return backupRestoreCheckpointHashV2(existing)
    }
    const checkpoint:BackupRestoreCheckpointV2={
      format:'backup-restore-checkpoint-v2',version:2,
      operation_id:plan.operation_id,plan_sha256:planHash,stage,
      prior_checkpoint_sha256:priorHash,
    }
    await this.store.putMacBoundOperationArtifact(id,checkpoint,rootKey,epochSalt)
    return backupRestoreCheckpointHashV2(checkpoint)
  }

  private async verifyPlan(
    plan:BackupRestorePlanV2,
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    requireExisting:boolean,
  ):Promise<string>{
    validateBackupRestorePlanV2(plan)
    const encoded=new TextDecoder().decode(canonicalBytes(plan as never))
    // Epoch-scoped ownership closes the gap between a durable verified plan and
    // StateV6 persistence: no second valid backup may take over this local
    // restore after any crash point.
    const ownerKey=ownerId(plan.epoch_id)
    const owner=await this.store.macBoundOperationArtifact<BackupRestorePlanV2>(ownerKey,rootKey,epochSalt)
    if(owner){
      validateBackupRestorePlanV2(owner)
      if(new TextDecoder().decode(canonicalBytes(owner as never))!==encoded)throw new Error('A different BackupV6 already owns this local epoch restore.')
    }else{
      // Once a durable offline StateV6 exists, the owner is required evidence.
      // Recreating a deleted owner would permit another valid same-epoch backup
      // to take over the interrupted restore (IA-132).
      if(requireExisting)throw new Error('Persisted Backup Restore owner is missing; refusing rollback.')
      await this.store.putMacBoundOperationArtifact(ownerKey,plan,rootKey,epochSalt)
    }

    const id=planId(plan.operation_id)
    const existing=await this.store.macBoundOperationArtifact<BackupRestorePlanV2>(id,rootKey,epochSalt)
    if(existing){
      validateBackupRestorePlanV2(existing)
      if(new TextDecoder().decode(canonicalBytes(existing as never))!==encoded)throw new Error('A different Backup Restore plan already owns this operation ID.')
    }else{
      if(requireExisting)throw new Error('Persisted Backup Restore plan is missing; refusing rollback.')
      await this.store.putMacBoundOperationArtifact(id,plan,rootKey,epochSalt)
    }
    const planHash=await backupRestorePlanHashV2(plan)
    if(requireExisting){
      const verified=await this.store.macBoundOperationArtifact<BackupRestoreCheckpointV2>(
        checkpointId(plan.operation_id,'verified'),rootKey,epochSalt,
      )
      if(!verified)throw new Error('Persisted Backup Restore verified checkpoint is missing; refusing rollback.')
      validateBackupRestoreCheckpointV2(verified)
      if(verified.operation_id!==plan.operation_id||verified.plan_sha256!==planHash
        ||verified.stage!=='verified'||verified.prior_checkpoint_sha256!==null){
        throw new Error('Persisted Backup Restore verified checkpoint is not bound to the exact operation.')
      }
    }
    return planHash
  }

  async restore(backup:SyncBackupV6,urs:Uint8Array):Promise<ProductiveBackupRestoreV2Result>{
    if(urs.byteLength!==32)throw new Error('V2 Backup Restore requires a 32-byte Recovery Key.')
    const recovered=await openRecoveryArtifactV6(backup.recovery_artifact,urs)
    const payload=recovered.payload,rootKey=recovered.rootKey
    const epochSalt=await deriveEpochSaltV2(
      fixedBase64Url(payload.diary_id,16,'diary_id'),
      fixedBase64Url(payload.epoch_id,16,'epoch_id'),
    )
    const verified=await testRestoreBackupV6({
      rootKey,epochSalt,urs,
      diaryId:payload.diary_id,epochId:payload.epoch_id,keyId:payload.key_id,
    },backup,new TransferableSingleWriterV2Verifier())
    const backupHash=await backupDocumentHashV6(backup)
    const operationId=await backupRestoreOperationIdV2(backup)
    const plan:BackupRestorePlanV2={
      format:'backup-restore-plan-v2',version:2,operation_id:operationId,
      backup_id:backup.backup_id,backup_sha256:backupHash,
      diary_id:payload.diary_id,epoch_id:payload.epoch_id,key_id:payload.key_id,
      manifest_fingerprint:payload.manifest_fingerprint,
      activation_state:verified.activation_state,
    }
    // A rejected import into a different active diary must not leave behind
    // a MAC-bound restore owner or checkpoint. Perform the same fresh-profile
    // gate used by Join before any restore-operation persistence; an existing
    // exact offline-restored StateV6 is handled below for idempotent resume.
    const resumed=await this.store.stateRecordExists(payload.epoch_id)
    if(!resumed){
      if(await activeProtocolSelectionV2()){
        throw new Error('Backup Restore requires a fresh browser profile or the exact already-selected restore operation.')
      }
      await assertReadOnlyJoinLocalProfileIsFresh()
    }else{
      // The same epoch may already be in use by its original, remote-active
      // Writer. That is not a local restore to resume and must not acquire a
      // new restore owner before the StateV6 identity/role check.
      const state=await this.store.loadState(rootKey,epochSalt,payload.epoch_id)
      if(state.diary_id!==payload.diary_id||state.manifest_fingerprint!==payload.manifest_fingerprint
        ||state.epoch_status!=='offline_restored'||state.writer_status!=='read_only'
        ||state.remote_binding!==null)throw new Error('Persisted Backup Restore local bundle does not match the verified backup.')
    }
    const planHash=await this.verifyPlan(plan,rootKey,epochSalt,resumed)
    let checkpointHash=await this.checkpoint(plan,planHash,'verified',null,rootKey,epochSalt)
    await this.fault?.('after-verified')

    await this.store.persistRecoveryArtifactV6(
      urs,payload.diary_id,payload.epoch_id,backup.recovery_artifact,
    )
    const persistedRecovery=await this.store.loadPersistedRecoveryArtifactV6(
      urs,payload.diary_id,payload.epoch_id,backup.recovery_artifact.recovery_artifact_id,
    )
    if(persistedRecovery.artifactSha256!==await recoveryArtifactHashV6(backup.recovery_artifact)){
      throw new Error('Backup Restore persisted RecoveryArtifactV6 hash mismatch.')
    }

    if(!resumed){
      const writer=await generateWriterDeviceKeyV2(),writerDeviceId=base64Url(randomBytes(16))
      const storedWriter:StoredWriterDeviceKeyV2={
        writer_signing_key_id:writer.writerKeyId,
        writer_device_id:writerDeviceId,
        writer_public_key:base64Url(writer.publicKeyRaw),
        private_key:writer.privateKey,
      }
      const state:EpochLocalSecurityStateV6={
        local_state_version:6,
        diary_id:payload.diary_id,
        epoch_id:payload.epoch_id,
        key_id:payload.key_id,
        manifest_fingerprint:payload.manifest_fingerprint,
        recovery_generation:verified.canonical.current_recovery.recovery_generation,
        recovery_urs_commitment:verified.canonical.current_recovery.recovery_urs_commitment,
        recovery_urs_id:verified.canonical.current_recovery.recovery_urs_id,
        recovery_rekey_rotation_required:verified.canonical.current_recovery.recovery_rekey_rotation_required,
        recovery_rekey_transition_id:verified.canonical.current_recovery.recovery_rekey_transition_id,
        remote_binding:null,
        remote_anchor:{...verified.canonical.remote_anchor},
        epoch_status:'offline_restored',
        operation_generation:0,
        rotation_state_ref:null,
        migration_state_ref:null,
        writer_operation_state_ref:null,
        recovery_operation_state_ref:null,
        activation_lineage_cache_ref:null,
        local_journal_count:0,
        local_journal_hash:await localJournalInitialV2(payload.diary_id,payload.epoch_id),
        writer_status:'read_only',
        writer_device_id:writerDeviceId,
        writer_signing_key_id:writer.writerKeyId,
        writer_generation:null,
        writer_grant_id:null,
        verified_writer_device_id:verified.canonical.current_writer.writer_device_id,
        verified_writer_key_id:verified.canonical.current_writer.writer_key_id,
        verified_writer_generation:verified.canonical.current_writer.writer_generation,
        verified_writer_grant_id:verified.canonical.current_writer.writer_grant_id,
        recovery_takeover_key_id:verified.canonical.current_recovery.recovery_takeover_key_id,
        recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(verified.canonical.recovery_credential_history),
        stale_writer_pending_count:0,
      }
      const wrap=await prepareReadOnlyJoinRootWrapV6ForActiveMode(rootKey,{
        diary_id:state.diary_id,epoch_id:state.epoch_id,key_id:state.key_id,
        manifest_fingerprint:state.manifest_fingerprint,
      },randomBytes(16))
      await this.store.persistOfflineRestoreBundle({
        rootKey,epochSalt,rootWrap:wrap.wrap,bestEffortWrappingKey:wrap.bestEffortWrappingKey,
        writerKey:storedWriter,state,
      })
    }
    checkpointHash=await this.checkpoint(plan,planHash,'local_bundle_persisted',checkpointHash,rootKey,epochSalt)
    await this.fault?.('after-local-bundle')

    if(!await this.store.verifiedReadModelExists(payload.epoch_id)){
      const current=await this.store.loadState(rootKey,epochSalt,payload.epoch_id)
      const next:EpochLocalSecurityStateV6={...current,operation_generation:current.operation_generation+1}
      await this.store.commitVerifiedDispositions(
        rootKey,epochSalt,current.operation_generation,next,
        verified.canonical.accepted_envelope_ids,
        verified.canonical.stale_writer_envelope_ids,
        {
          remote_rows:backup.record_rows,
          current_writer:{
            writer_generation:verified.canonical.current_writer.writer_generation,
            writer_grant_id:verified.canonical.current_writer.writer_grant_id,
            writer_device_id:verified.canonical.current_writer.writer_device_id,
            writer_key_id:verified.canonical.current_writer.writer_key_id,
          },
          source_epoch_sealed:verified.canonical.source_epoch_sealed,
          recovery_rekey_rotation_required:verified.canonical.current_recovery.recovery_rekey_rotation_required,
        },
      )
    }else{
      const readModel=await this.store.loadVerifiedReadModel(rootKey,epochSalt,payload.epoch_id)
      if(readModel.model.remote_anchor.covered_row_count!==verified.canonical.remote_anchor.covered_row_count
        ||readModel.model.remote_anchor.prefix_hash!==verified.canonical.remote_anchor.prefix_hash)throw new Error('Persisted Backup Restore read model does not match the verified backup anchor.')
    }
    await this.store.persistRestoredQuarantineRows(
      rootKey,epochSalt,payload.epoch_id,
      [...verified.pending_outbox_rows,...verified.stale_writer_pending_rows],
    )
    checkpointHash=await this.checkpoint(plan,planHash,'local_data_applied',checkpointHash,rootKey,epochSalt)
    await this.fault?.('after-local-data')

    const priorSelection=await activeProtocolSelectionV2()
    if(priorSelection){
      // Post-selection crash resume is authenticated by BackupV6, StateV6,
      // exact owner/plan and checkpoint above. Do not demand a second unlock
      // of the retired, independently locked V1 placeholder (IA-134).
      if(priorSelection.sync_profile!=='google-sheets-transferable-single-writer-v2'
        ||priorSelection.operation_id!==operationId
        ||priorSelection.diary_id!==payload.diary_id
        ||priorSelection.epoch_id!==payload.epoch_id
        ||priorSelection.manifest_fingerprint!==payload.manifest_fingerprint){
        throw new Error('Backup Restore cannot replace a different selected V2 operation.')
      }
    }else{
      // Before the *first* selection, authenticate the persisted V2 wrap and
      // bridge the already-unlocked V1 factor to its exact restored diary ID.
      // This is not a Recovery-Key bypass: strong wraps must open with the
      // existing V1 factor, and a concurrent lock cancels adoption (IA-133).
      const prepared=await this.store.loadRootWrapV6(payload.epoch_id)
      if(prepared.wrap.diary_id!==payload.diary_id
        ||prepared.wrap.epoch_id!==payload.epoch_id
        ||prepared.wrap.key_id!==payload.key_id
        ||prepared.wrap.manifest_fingerprint!==payload.manifest_fingerprint){
        throw new Error('Backup Restore persisted RootWrapV6 identity mismatch.')
      }
      await retainVerifiedOfflineRestoreRootWrapV6Unlock(prepared,rootKey)
      await atomicSelectOfflineRestoreV2({
        operationId,diaryId:payload.diary_id,epochId:payload.epoch_id,
        manifestFingerprint:payload.manifest_fingerprint,
      })
    }
    checkpointHash=await this.checkpoint(plan,planHash,'selected',checkpointHash,rootKey,epochSalt)
    void checkpointHash
    await this.fault?.('after-selection')

    const selected=await activeProtocolSelectionV2()
    if(!selected||selected.operation_id!==operationId||selected.epoch_id!==payload.epoch_id)throw new Error('Backup Restore active selection readback failed.')
    const final=await this.store.loadState(rootKey,epochSalt,payload.epoch_id)
    if(final.epoch_status!=='offline_restored'||final.writer_status!=='read_only'||final.remote_binding!==null)throw new Error('Backup Restore did not remain fail-closed local read-only.')
    return{
      operationId,backupId:backup.backup_id,diaryId:payload.diary_id,epochId:payload.epoch_id,
      manifestFingerprint:payload.manifest_fingerprint,stage:'selected',access:'read_only',
      quarantinedRowCount:final.stale_writer_pending_count,resumed,
    }
  }
}

export async function restoreBackupV2Locally(backup:SyncBackupV6,urs:Uint8Array):Promise<ProductiveBackupRestoreV2Result>{
  return new ProductiveBackupRestoreV2Service().restore(backup,urs)
}

export async function verifyBackupRestoreCheckpointChainForTesting(
  backup:SyncBackupV6,
  urs:Uint8Array,
  store=new IndexedDbV2LocalSecurityStore(),
):Promise<{operationId:string;stages:BackupRestoreStageV2[]}>{
  const recovered=await openRecoveryArtifactV6(backup.recovery_artifact,urs)
  const epochSalt=await deriveEpochSaltV2(fixedBase64Url(recovered.payload.diary_id,16),fixedBase64Url(recovered.payload.epoch_id,16))
  const operationId=await backupRestoreOperationIdV2(backup)
  const plan=await store.macBoundOperationArtifact<BackupRestorePlanV2>(planId(operationId),recovered.rootKey,epochSalt)
  if(!plan)throw new Error('Backup Restore plan is missing.')
  const planHash=await backupRestorePlanHashV2(plan)
  let prior:string|null=null
  const stages:BackupRestoreStageV2[]=[]
  for(const stage of BACKUP_RESTORE_STAGES_V2){
    const checkpoint=await store.macBoundOperationArtifact<BackupRestoreCheckpointV2>(checkpointId(operationId,stage),recovered.rootKey,epochSalt)
    if(!checkpoint)break
    validateBackupRestoreCheckpointV2(checkpoint)
    if(checkpoint.plan_sha256!==planHash||checkpoint.prior_checkpoint_sha256!==prior)throw new Error('Backup Restore checkpoint hash chain is invalid.')
    prior=await backupRestoreCheckpointHashV2(checkpoint)
    stages.push(stage)
  }
  return{operationId,stages}
}
