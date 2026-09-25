import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE, TransportError, type VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import type { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { base64Url, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import type { PreparedEnvelope } from '../security/envelopes'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  recoveryCommitmentV2,
  recoveryUrsIdV2,
} from '../security/v2/crypto'
import { sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { openManifestV6, parseManifestCellsV6 } from '../security/v2/manifest'
import {
  IndexedDbV2LocalSecurityStore,
} from '../security/v2/localPersistence'
import {
  type EpochLocalSecurityStateV6,
  type StoredWriterDeviceKeyV2,
} from '../security/v2/localState'
import { openActivationLineageCacheV2 } from '../security/v2/activationLineageCache'
import {
  createRecoveryArtifactV6,
  openRecoveryArtifactV6,
  recoveryArtifactHashV6,
  recoveryArtifactLocatorV6,
  type ActivationLineageV2,
  type RecoveryArtifactV6,
  type RecoveryAuthorityTransitionProofV2,
} from '../security/v2/recovery'
import {
  createRecoveryAuthorityTransitionProofV2,
  createRecoveryAuthorityTransitionRevisionV2,
  recoveryAuthorityTransitionProofHashV2,
} from '../security/v2/recoveryRekey'
import {
  type RecoveryRekeyOperationStateV2,
  type RecoveryRekeyStageV2,
} from '../security/v2/recoveryRekeyOperation'
import { createAnchorV2 } from '../security/v2/prefix'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import { TransferableSingleWriterV2Verifier } from '../security/v2/verifier'
import { createBackupV6, testRestoreBackupV6, type SyncBackupV6 } from '../security/v2/backup'
import { activeProtocolSelectionV2, openReadOnlyJoinRootWrapV6WithActiveMode } from './localDatabase'
import { verifyActivationLineageForCanonicalEpoch } from './readOnlyJoinV2Service'
import { ProductiveNativeRotationV2Service } from './nativeRotationV2Service'

type Row=readonly[string,string,string]

export type RecoveryRekeyV2FaultPoint=
  | 'after-prepared-bundle'
  | 'after-publish-attempt-fence'
  | 'after-artifact-publish'
  | 'after-transition-append'
  | 'after-transition-durable'
  | 'after-source-backup'
  | 'before-phase-b'

export interface RecoveryRekeyV2Result {
  operationId:string
  transitionId:string
  stage:RecoveryRekeyStageV2
  toRecoveryGeneration:number
  toRecoveryUrsId:string
  successorEpochId:string|null
}

interface SourceContextV2 {
  rootKey:Uint8Array
  epochSalt:Uint8Array
  state:EpochLocalSecurityStateV6
  transport:GoogleSheetsTransferableSingleWriterV2Transport
  codec:GoogleSheetsTransferableSingleWriterV2ProfileCodec
  remoteId:string
}
interface SourceBackupArtifactV2 {backup:SyncBackupV6;anchor:CanonicalFullResultV2['remote_anchor']}

function same(left:unknown,right:unknown):boolean{return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))}
function canonical(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Recovery-Rekey requires v2 canonical verification.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Recovery-Rekey requires canonical_full.')
  return result
}
function asRow(envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Row{return[envelope.envelopeId,envelope.iv,envelope.ciphertext]}
function writerContext(result:CanonicalFullResultV2){return{writer_generation:result.current_writer.writer_generation,writer_grant_id:result.current_writer.writer_grant_id,writer_device_id:result.current_writer.writer_device_id,writer_key_id:result.current_writer.writer_key_id}}
async function deterministicBytes(operationId:string,label:string,length:number):Promise<Uint8Array>{
  const {sha256}=await import('../security/crypto/core')
  return(await sha256(canonicalBytes(['recovery-rekey-v2',operationId,label] as never))).slice(0,length)
}
async function deterministicId(operationId:string,label:string,length:number):Promise<string>{return base64Url(await deterministicBytes(operationId,label,length))}

export class ProductiveRecoveryRekeyV2Service {
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly now:()=>string=()=>new Date().toISOString(),
    private readonly fault?:(point:RecoveryRekeyV2FaultPoint)=>void|Promise<void>,
  ){
    if(session.profileId!==SINGLE_WRITER_V2_PROFILE||session.providerId!==GOOGLE_DRIVE_SHEETS_PROVIDER)throw new Error('Recovery-Rekey requires the authenticated v2 provider session.')
  }

  private async activeContext():Promise<SourceContextV2>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('Recovery-Rekey requires an active v2 protocol selection.')
    const rootKey=await openReadOnlyJoinRootWrapV6WithActiveMode(await this.store.loadRootWrapV6(selection.epoch_id))
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,selection.epoch_id),binding=state.remote_binding
    if(state.diary_id!==selection.diary_id||state.manifest_fingerprint!==selection.manifest_fingerprint||!binding||binding.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('Recovery-Rekey active selection/StateV6 binding mismatch.')
    const transport=await this.session.transportForEpoch(state.diary_id,state.epoch_id)
    if(await this.session.remoteIdentityBinding(transport)!==binding.remote_identity_binding)throw new Error('Recovery-Rekey authenticated remote identity changed.')
    const codec=await this.session.codecForEpoch(state.diary_id,state.epoch_id,rootKey,transport)
    return{rootKey,epochSalt,state,transport,codec,remoteId:binding.remote_resource_id}
  }

  private async reconcile(context:SourceContextV2,verified:VerifiedRemoteState,result:CanonicalFullResultV2):Promise<EpochLocalSecurityStateV6>{
    const current=await this.store.loadState(context.rootKey,context.epochSalt,context.state.epoch_id)
    const key=await this.store.loadWriterKey(current.writer_signing_key_id,current.diary_id,current.epoch_id)
    const next=await stateAfterCanonicalVerifyV6(current,result,verified.snapshot.rows,key!==null&&key.writer_device_id===current.writer_device_id)
    return this.store.commitVerifiedDispositions(context.rootKey,context.epochSalt,current.operation_generation,next,verified.acceptedEnvelopeIds,verified.staleWriterEnvelopeIds,{
      remote_rows:verified.snapshot.rows,current_writer:{writer_generation:result.current_writer.writer_generation,writer_grant_id:result.current_writer.writer_grant_id,writer_device_id:result.current_writer.writer_device_id,writer_key_id:result.current_writer.writer_key_id},
      source_epoch_sealed:result.source_epoch_sealed,recovery_rekey_rotation_required:result.current_recovery.recovery_rekey_rotation_required,
    })
  }

  private async fresh():Promise<{context:SourceContextV2;verified:VerifiedRemoteState;result:CanonicalFullResultV2;state:EpochLocalSecurityStateV6;writer:StoredWriterDeviceKeyV2;lineage:ActivationLineageV2}>{
    let context=await this.activeContext();const verified=await context.codec.verifyRemote(await context.transport.read(context.remoteId)),result=canonical(verified)
    if(result.diary_id!==context.state.diary_id||result.epoch_id!==context.state.epoch_id||result.manifest_fingerprint!==context.state.manifest_fingerprint||result.source_epoch_sealed||result.activation_state==='staged_confirmation_missing')throw new Error('Recovery-Rekey Source is not the active fully activated canonical epoch.')
    const state=await this.reconcile(context,verified,result)
    context={...context,state}
    const writer=await this.store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
    if(!writer||state.writer_status!=='writer_active'||state.writer_generation!==result.current_writer.writer_generation||state.writer_grant_id!==result.current_writer.writer_grant_id
      ||state.writer_device_id!==result.current_writer.writer_device_id||state.writer_signing_key_id!==result.current_writer.writer_key_id||writer.writer_device_id!==state.writer_device_id
      ||writer.writer_public_key!==result.current_writer.writer_public_key)throw new Error('Recovery-Rekey requires the current local canonical WriterDeviceKeyV2.')
    const unresolved=(await this.store.outbox(context.rootKey,context.epochSalt,state.epoch_id)).filter(entry=>entry.ceremony_owner===undefined&&entry.authority!==null&&(entry.status==='prepared'||entry.status==='pending'))
    if(unresolved.length)throw new Error('Recovery-Rekey requires all normal Writer outbox rows to be resolved before freeze.')
    let lineage:ActivationLineageV2=[]
    if(state.activation_lineage_cache_ref){
      const cache=await this.store.loadActivationLineageCache(context.rootKey,context.epochSalt,state.epoch_id)
      lineage=await openActivationLineageCacheV2({cache,rootKey:context.rootKey,epochSalt:context.epochSalt,diaryId:state.diary_id,epochId:state.epoch_id,manifestFingerprint:state.manifest_fingerprint})
    }else if(result.activation_state!=='native_active')throw new Error('Recovery-Rekey active non-native Source is missing ActivationLineageCacheV2.')
    const manifest=await openManifestV6(context.rootKey,context.epochSalt,{diaryId:state.diary_id,epochId:state.epoch_id},parseManifestCellsV6(verified.snapshot.manifest))
    await verifyActivationLineageForCanonicalEpoch(this.session,{diaryId:state.diary_id,epochId:state.epoch_id,rootKey:context.rootKey,manifest,snapshot:verified.snapshot,verified,result,remoteId:context.remoteId,accountBinding:state.remote_binding!.remote_identity_binding,activationLineage:lineage})
    return{context,verified,result,state,writer,lineage}
  }

  private async prepareLocal(newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    if(newUrs.byteLength!==32)throw new Error('Recovery-Rekey new URS must contain 32 bytes.')
    const fresh=await this.fresh(),currentRef=fresh.state.recovery_operation_state_ref
    let supersedes:string|null=null
    if(currentRef){
      const currentOperation=await this.store.loadBoundRecoveryRekeyOperation(fresh.context.rootKey,fresh.context.epochSalt,fresh.state.epoch_id)
      if(currentOperation&&!['completed','stale','superseded'].includes(currentOperation.stage)){
        if(await recoveryUrsIdV2(newUrs)===currentOperation.to_recovery_urs_id)return currentOperation
        if(!fresh.result.current_recovery.recovery_rekey_rotation_required||fresh.result.current_recovery.recovery_rekey_transition_id!==currentOperation.transition_id
          ||!['transition_durable','source_backup_verified','successor_rotation_required'].includes(currentOperation.stage))throw new Error('A different non-terminal Recovery-Rekey must be reconciled before supersession.')
        supersedes=currentOperation.transition_id
      }
    }
    const newUrsId=await recoveryUrsIdV2(newUrs)
    if(fresh.result.recovery_credential_history.some(entry=>entry.recovery_urs_id===newUrsId))throw new Error('recovery_credential_reuse')
    const pair=await generateRecoveryTakeoverKeyMaterialV2()
    if(fresh.result.recovery_credential_history.some(entry=>entry.recovery_takeover_key_id===pair.recoveryTakeoverKeyId)){pair.privateKeyPkcs8.fill(0);throw new Error('recovery_credential_reuse')}
    const generation=fresh.result.current_recovery.recovery_generation+1,commitment=await recoveryCommitmentV2(newUrs,fixedBase64Url(fresh.state.diary_id,16),generation)
    const operationId=base64Url(randomBytes(32)),transitionId=base64Url(randomBytes(32)),reservation=await this.store.reserveEnvelope(fresh.state.epoch_id,fresh.verified.snapshot.rows)
    const transitionCreated=await createRecoveryAuthorityTransitionRevisionV2({
      diaryId:fresh.state.diary_id,epochId:fresh.state.epoch_id,transitionId,fromRecoveryGeneration:fresh.result.current_recovery.recovery_generation,
      fromRecoveryUrsId:fresh.result.current_recovery.recovery_urs_id,fromRecoveryTakeoverKeyId:fresh.result.current_recovery.recovery_takeover_key_id,
      toRecoveryGeneration:generation,toRecoveryUrsCommitment:commitment,toRecoveryUrsId:newUrsId,toRecoveryTakeoverKeyId:pair.recoveryTakeoverKeyId,
      toRecoveryTakeoverPublicKey:base64Url(pair.publicKeyRaw),authorityAnchor:fresh.result.remote_anchor,writerContext:writerContext(fresh.result),
      writerPrivateKey:fresh.writer.private_key,protocolCreatedAt:this.now(),recordId:await deterministicId(operationId,'transition-record',16),revisionId:await deterministicId(operationId,'transition-revision',32),
    })
    const envelope=await sealRevisionEnvelopeV2(fresh.context.rootKey,fresh.context.epochSalt,{diaryId:fresh.state.diary_id,epochId:fresh.state.epoch_id},transitionCreated.revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    const proof=createRecoveryAuthorityTransitionProofV2({sourceEpochId:fresh.state.epoch_id,sourceManifestFingerprint:fresh.state.manifest_fingerprint,transition:transitionCreated.transition,transitionEnvelope:envelope})
    const history=[...fresh.result.recovery_credential_history.map(entry=>({...entry})),{recovery_generation:generation,recovery_urs_id:newUrsId,recovery_takeover_key_id:pair.recoveryTakeoverKeyId}]
    const artifact=await createRecoveryArtifactV6({
      diary_id:fresh.state.diary_id,epoch_id:fresh.state.epoch_id,key_id:fresh.state.key_id,RK_epoch:base64Url(fresh.context.rootKey),manifest_fingerprint:fresh.state.manifest_fingerprint,
      remote_anchor:{...fresh.result.remote_anchor},google_account_binding:fresh.state.remote_binding!.remote_identity_binding,recovery_generation:generation,recovery_urs_commitment:commitment,recovery_urs_id:newUrsId,
      recovery_credential_history:history,recovery_takeover_key_id:pair.recoveryTakeoverKeyId,recovery_takeover_public_key:base64Url(pair.publicKeyRaw),recovery_takeover_private_key_pkcs8:base64Url(pair.privateKeyPkcs8),
      activation_lineage:structuredClone(fresh.lineage),recovery_authority_transition_proof:proof,created_at:this.now(),
    },newUrs,await deterministicBytes(operationId,'recovery-artifact-id',16),await deterministicBytes(operationId,'recovery-artifact-salt',32),await deterministicBytes(operationId,'recovery-artifact-iv',12))
    pair.privateKeyPkcs8.fill(0)
    const operation:RecoveryRekeyOperationStateV2={
      format:'recovery-rekey-operation-v2',version:2,operation_id:operationId,operation_origin:'local_rekey',supersedes_transition_id:supersedes,superseded_by_transition_id:null,
      epoch_id:fresh.state.epoch_id,stage:'new_material_staged',authority_anchor_before_transition:{...fresh.result.remote_anchor},transition_id:transitionId,
      transition_envelope:{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext},recovery_artifact_id:artifact.recovery_artifact_id,
      recovery_artifact_locator:await recoveryArtifactLocatorV6(newUrs,fresh.state.diary_id,fresh.state.epoch_id),recovery_artifact_sha256:await recoveryArtifactHashV6(artifact),
      artifact_publish_attempted:false,transition_proof_sha256:await recoveryAuthorityTransitionProofHashV2(proof),to_recovery_generation:generation,to_recovery_urs_commitment:commitment,
      to_recovery_urs_id:newUrsId,to_recovery_takeover_key_id:transitionCreated.transition.to_recovery_takeover_key_id,completed_successor_epoch_id:null,completed_successor_manifest_fingerprint:null,
    }
    await this.store.persistPreparedRecoveryRekeyBundle({rootKey:fresh.context.rootKey,epochSalt:fresh.context.epochSalt,newUrs,expectedOperationGeneration:fresh.state.operation_generation,reservation,envelope,operation,artifact})
    await this.fault?.('after-prepared-bundle')
    return operation
  }

  private async operationContext(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<{context:SourceContextV2;state:EpochLocalSecurityStateV6;artifact:RecoveryArtifactV6;proof:RecoveryAuthorityTransitionProofV2}>{
    const selection=await activeProtocolSelectionV2()
    if(!selection||selection.diary_id.length===0)throw new Error('Recovery-Rekey active selection is missing.')
    const rootKey=await openReadOnlyJoinRootWrapV6WithActiveMode(await this.store.loadRootWrapV6(operation.epoch_id)),epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(operation.epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,operation.epoch_id),binding=state.remote_binding
    if(!binding)throw new Error('Recovery-Rekey Source remote binding is missing.')
    const transport=await this.session.transportForEpoch(state.diary_id,state.epoch_id),codec=await this.session.codecForEpoch(state.diary_id,state.epoch_id,rootKey,transport)
    const persisted=await this.store.loadPersistedRecoveryArtifactV6(newUrs,state.diary_id,state.epoch_id,operation.recovery_artifact_id),opened=await openRecoveryArtifactV6(persisted.artifact,newUrs)
    const proof=opened.payload.recovery_authority_transition_proof
    if(!proof||await recoveryAuthorityTransitionProofHashV2(proof)!==operation.transition_proof_sha256||opened.payload.recovery_urs_id!==operation.to_recovery_urs_id)throw new Error('Recovery-Rekey persisted artifact/proof no longer binds operation.')
    return{context:{rootKey,epochSalt,state,transport,codec,remoteId:binding.remote_resource_id},state,artifact:persisted.artifact,proof}
  }

  private async transitionOperation(operation:RecoveryRekeyOperationStateV2,next:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    const ctx=await this.operationContext(operation,newUrs),state=await this.store.loadState(ctx.context.rootKey,ctx.context.epochSalt,operation.epoch_id)
    await this.store.advanceRecoveryRekeyOperationBinding(ctx.context.rootKey,ctx.context.epochSalt,operation.epoch_id,state.operation_generation,operation.stage,next)
    return this.store.loadRecoveryRekeyOperation(operation.operation_id)
  }

  private async ensureArtifactPublished(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    let current=operation
    if(current.stage!=='new_material_staged')return current
    if(!current.artifact_publish_attempted){
      current=await this.transitionOperation(current,{...current,artifact_publish_attempted:true},newUrs)
      await this.fault?.('after-publish-attempt-fence')
    }
    const ctx=await this.operationContext(current,newUrs),persisted=await this.store.loadPersistedRecoveryArtifactV6(newUrs,ctx.state.diary_id,ctx.state.epoch_id,current.recovery_artifact_id)
    await this.session.publishRecoveryArtifact(newUrs,persisted)
    const readback=await this.session.loadRecoveryArtifact(newUrs,ctx.state.diary_id,ctx.state.epoch_id)
    if(!same(readback,persisted.artifact))throw new Error('Recovery-Rekey RecoveryArtifactV6 remote readback differs from persisted exact bytes.')
    await this.fault?.('after-artifact-publish')
    return this.transitionOperation(current,{...current,stage:'recovery_artifact_published'},newUrs)
  }

  private async ensureTransitionPending(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    if(operation.stage!=='recovery_artifact_published')return operation
    const ctx=await this.operationContext(operation,newUrs),opened=await openRecoveryArtifactV6(ctx.artifact,newUrs)
    if(base64Url(opened.rootKey)!==base64Url(ctx.context.rootKey)||opened.payload.remote_anchor.covered_row_count!==operation.authority_anchor_before_transition.covered_row_count
      ||opened.payload.remote_anchor.prefix_hash!==operation.authority_anchor_before_transition.prefix_hash||opened.payload.recovery_generation!==operation.to_recovery_generation)throw new Error('Recovery-Rekey staged Recovery test failed.')
    const remote=await this.session.loadRecoveryArtifact(newUrs,ctx.state.diary_id,ctx.state.epoch_id)
    if(!same(remote,ctx.artifact))throw new Error('Recovery-Rekey staged RecoveryArtifact remote bytes changed.')
    return this.transitionOperation(operation,{...operation,stage:'transition_pending'},newUrs)
  }

  private async inspectTransition(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<{context:SourceContextV2;verified:VerifiedRemoteState;result:CanonicalFullResultV2;present:boolean;stale:boolean}>{
    const ctx=await this.operationContext(operation,newUrs),snapshot=await ctx.context.transport.read(ctx.context.remoteId)
    const prefix=snapshot.rows.slice(0,operation.authority_anchor_before_transition.covered_row_count)
    if(!same(await createAnchorV2(ctx.state.diary_id,ctx.state.epoch_id,prefix),operation.authority_anchor_before_transition))throw new Error('Recovery-Rekey authority anchor is no longer a prefix of remote.')
    const suffix=snapshot.rows.slice(operation.authority_anchor_before_transition.covered_row_count),expected:Row=[operation.transition_envelope.envelope_id,operation.transition_envelope.iv,operation.transition_envelope.ciphertext]
    const present=suffix.length>0&&same(suffix[0],expected)
    if(suffix.length>0&&!present){
      const verified=await ctx.context.codec.verifyRemote(snapshot),result=canonical(verified),state=await this.reconcile(ctx.context,verified,result)
      void state
      return{context:ctx.context,verified,result,present:false,stale:true}
    }
    const verified=await ctx.context.codec.verifyRemote(snapshot),result=canonical(verified)
    return{context:ctx.context,verified,result,present,stale:false}
  }

  private async markTransitionDurable(operation:RecoveryRekeyOperationStateV2,inspection:Awaited<ReturnType<ProductiveRecoveryRekeyV2Service['inspectTransition']>>):Promise<RecoveryRekeyOperationStateV2>{
    if(!inspection.present||!inspection.verified.acceptedEnvelopeIds.has(operation.transition_envelope.envelope_id)
      ||inspection.result.current_recovery.recovery_generation!==operation.to_recovery_generation||inspection.result.current_recovery.recovery_urs_id!==operation.to_recovery_urs_id
      ||inspection.result.current_recovery.recovery_takeover_key_id!==operation.to_recovery_takeover_key_id||!inspection.result.current_recovery.recovery_rekey_rotation_required
      ||inspection.result.current_recovery.recovery_rekey_transition_id!==operation.transition_id)throw new Error('Recovery-Rekey transition is present but not canonical current Recovery authority.')
    const reconciled=await this.reconcile(inspection.context,inspection.verified,inspection.result)
    const current=await this.store.loadRecoveryRekeyOperation(operation.operation_id)
    const next={...current,stage:'transition_durable'} as RecoveryRekeyOperationStateV2
    await this.store.advanceRecoveryRekeyOperationBinding(inspection.context.rootKey,inspection.context.epochSalt,current.epoch_id,reconciled.operation_generation,current.stage,next)
    await this.fault?.('after-transition-durable')
    return this.store.loadRecoveryRekeyOperation(operation.operation_id)
  }

  private async appendOrReconcileTransition(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    if(operation.stage!=='transition_pending'&&operation.stage!=='transition_unknown')return operation
    const stale=async(current:RecoveryRekeyOperationStateV2,inspection:Awaited<ReturnType<ProductiveRecoveryRekeyV2Service['inspectTransition']>>):Promise<RecoveryRekeyOperationStateV2>=>{
      const state=await this.store.loadState(inspection.context.rootKey,inspection.context.epochSalt,current.epoch_id),next={...current,stage:'stale'} as RecoveryRekeyOperationStateV2
      await this.store.advanceRecoveryRekeyOperationBinding(inspection.context.rootKey,inspection.context.epochSalt,current.epoch_id,state.operation_generation,current.stage,next)
      return this.store.loadRecoveryRekeyOperation(current.operation_id)
    }
    let current=operation,inspection=await this.inspectTransition(current,newUrs)
    if(inspection.stale)return stale(current,inspection)
    if(inspection.present)return this.markTransitionDurable(current,inspection)

    const row:[string,string,string]=[current.transition_envelope.envelope_id,current.transition_envelope.iv,current.transition_envelope.ciphertext]
    const maxAttempts=current.stage==='transition_unknown'?1:2
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      if(attempt>0){
        inspection=await this.inspectTransition(current,newUrs)
        if(inspection.stale)return stale(current,inspection)
        if(inspection.present)return this.markTransitionDurable(current,inspection)
      }
      let unknown=false
      try{await inspection.context.transport.append(inspection.context.remoteId,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error;unknown=true}
      await this.fault?.('after-transition-append')
      inspection=await this.inspectTransition(current,newUrs)
      if(inspection.present)return this.markTransitionDurable(current,inspection)
      if(inspection.stale)return stale(current,inspection)

      if(current.stage==='transition_pending'){
        current=await this.transitionOperation(current,{...current,stage:'transition_unknown'} as RecoveryRekeyOperationStateV2,newUrs)
      }
      if(!unknown)return current
    }
    return current
  }

  private async sourceBackup(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    if(operation.stage!=='transition_durable')return operation
    const key=`recovery-rekey:${operation.operation_id}:source-backup`,existing=await this.store.operationArtifact<SourceBackupArtifactV2>(key)
    const ctx=await this.operationContext(operation,newUrs),snapshot=await ctx.context.transport.read(ctx.context.remoteId),verified=await ctx.context.codec.verifyRemote(snapshot),result=canonical(verified)
    if(result.source_epoch_sealed||!result.current_recovery.recovery_rekey_rotation_required||result.current_recovery.recovery_rekey_transition_id!==operation.transition_id
      ||result.current_recovery.recovery_generation!==operation.to_recovery_generation||result.current_recovery.recovery_urs_id!==operation.to_recovery_urs_id)throw new Error('Recovery-Rekey Source Backup requires the durable current transition.')
    const remoteArtifact=await this.session.loadRecoveryArtifact(newUrs,ctx.state.diary_id,ctx.state.epoch_id)
    if(!same(remoteArtifact,ctx.artifact))throw new Error('Recovery-Rekey current RecoveryArtifactV6 changed before Source Backup.')
    await openRecoveryArtifactV6(remoteArtifact,newUrs)
    if(!existing){
      const entries=await this.store.outbox(ctx.context.rootKey,ctx.context.epochSalt,ctx.state.epoch_id),envelopes=await this.store.envelopes(ctx.state.epoch_id),byId=new Map(envelopes.map(envelope=>[envelope.envelopeId,asRow(envelope)]))
      const pending:Row[]=[],stale:Row[]=[]
      for(const entry of entries){const row=byId.get(entry.envelope_id);if(!row)throw new Error('Recovery-Rekey Source Backup outbox references missing envelope.');if(entry.status==='stale_writer_pending')stale.push(row);else if(entry.status!=='durable')pending.push(row)}
      if(snapshot.manifest.length!==4)throw new Error('Recovery-Rekey Source manifest shape mismatch.')
      const epochManifestPublic=snapshot.manifest as readonly [string,string,string,string]
      const backup=await createBackupV6({rootKey:ctx.context.rootKey,epochSalt:ctx.context.epochSalt,urs:newUrs,diaryId:ctx.state.diary_id,epochId:ctx.state.epoch_id,keyId:ctx.state.key_id,
        epochManifestPublic,canonical:result,recoveryArtifact:ctx.artifact,recordRows:snapshot.rows.map(row=>[row[0]!,row[1]!,row[2]!] as Row),pendingOutboxRows:pending,staleWriterPendingRows:stale,activationState:'activated',createdAt:this.now()})
      const restored=await testRestoreBackupV6({rootKey:ctx.context.rootKey,epochSalt:ctx.context.epochSalt,urs:newUrs,diaryId:ctx.state.diary_id,epochId:ctx.state.epoch_id,keyId:ctx.state.key_id},backup,new TransferableSingleWriterV2Verifier())
      if(restored.access!=='read_only'||!same(restored.canonical.remote_anchor,result.remote_anchor))throw new Error('Recovery-Rekey Source Backup test restore failed.')
      await this.store.putImmutableOperationArtifact(key,{backup,anchor:result.remote_anchor} satisfies SourceBackupArtifactV2)
    }
    const next=await this.transitionOperation(operation,{...operation,stage:'source_backup_verified'},newUrs);await this.fault?.('after-source-backup');return next
  }

  private async requirePhaseB(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    let current=operation
    if(current.stage==='source_backup_verified')current=await this.transitionOperation(current,{...current,stage:'successor_rotation_required'},newUrs)
    if(current.stage!=='successor_rotation_required')return current
    await this.fault?.('before-phase-b')
    await new ProductiveNativeRotationV2Service(this.session,newUrs,this.store,this.now).rotate('recovery_rekey',current.transition_id)
    return this.store.loadRecoveryRekeyOperation(current.operation_id)
  }

  private async resume(operation:RecoveryRekeyOperationStateV2,newUrs:Uint8Array):Promise<RecoveryRekeyOperationStateV2>{
    if(await recoveryUrsIdV2(newUrs)!==operation.to_recovery_urs_id)throw new Error('Recovery-Rekey resume requires the operation current/new URS.')
    let current=operation
    current=await this.ensureArtifactPublished(current,newUrs)
    current=await this.ensureTransitionPending(current,newUrs)
    current=await this.appendOrReconcileTransition(current,newUrs)
    if(current.stage==='transition_unknown'||current.stage==='stale'||current.stage==='superseded'||current.stage==='completed')return current
    current=await this.sourceBackup(current,newUrs)
    current=await this.requirePhaseB(current,newUrs)
    return current
  }

  async rekey(newUrs:Uint8Array):Promise<RecoveryRekeyV2Result>{
    if(newUrs.byteLength!==32)throw new Error('Recovery-Rekey requires a 32-byte new URS.')
    const fresh=await this.fresh(),bound=await this.store.loadBoundRecoveryRekeyOperation(fresh.context.rootKey,fresh.context.epochSalt,fresh.state.epoch_id),newId=await recoveryUrsIdV2(newUrs)
    let operation:RecoveryRekeyOperationStateV2
    if(bound&&!['completed','stale','superseded'].includes(bound.stage)&&bound.to_recovery_urs_id===newId)operation=bound
    else if(fresh.result.current_recovery.recovery_rekey_rotation_required&&fresh.result.current_recovery.recovery_urs_id===newId){
      operation=await this.adoptPendingInternal(newUrs,fresh)
    }else operation=await this.prepareLocal(newUrs)
    operation=await this.resume(operation,newUrs)
    return{operationId:operation.operation_id,transitionId:operation.transition_id,stage:operation.stage,toRecoveryGeneration:operation.to_recovery_generation,toRecoveryUrsId:operation.to_recovery_urs_id,successorEpochId:operation.completed_successor_epoch_id}
  }

  private async adoptPendingInternal(newUrs:Uint8Array,fresh?:Awaited<ReturnType<ProductiveRecoveryRekeyV2Service['fresh']>>):Promise<RecoveryRekeyOperationStateV2>{
    fresh=fresh??await this.fresh()
    if(!fresh.result.current_recovery.recovery_rekey_rotation_required||!fresh.result.current_recovery.recovery_rekey_transition_id)throw new Error('Remote Pending-Rekey adoption requires current pending Recovery state.')
    const artifact=await this.session.loadRecoveryArtifact(newUrs,fresh.state.diary_id,fresh.state.epoch_id),opened=await openRecoveryArtifactV6(artifact,newUrs),proof=opened.payload.recovery_authority_transition_proof
    if(base64Url(opened.rootKey)!==base64Url(fresh.context.rootKey)||!proof||proof.source_epoch_id!==fresh.state.epoch_id||proof.source_manifest_fingerprint!==fresh.state.manifest_fingerprint
      ||opened.payload.recovery_generation!==fresh.result.current_recovery.recovery_generation||opened.payload.recovery_urs_id!==fresh.result.current_recovery.recovery_urs_id
      ||opened.payload.recovery_takeover_key_id!==fresh.result.current_recovery.recovery_takeover_key_id||proof.to_recovery_generation!==opened.payload.recovery_generation
      ||proof.to_recovery_urs_id!==opened.payload.recovery_urs_id||proof.to_recovery_takeover_key_id!==opened.payload.recovery_takeover_key_id)throw new Error('Remote Pending-Rekey RecoveryArtifactV6 does not bind canonical current Recovery state.')
    const row=fresh.verified.snapshot.rows.find(candidate=>candidate[0]===proof.transition_envelope.envelope_id)
    if(!row||row[1]!==proof.transition_envelope.iv||row[2]!==proof.transition_envelope.ciphertext||!fresh.verified.acceptedEnvelopeIds.has(proof.transition_envelope.envelope_id))throw new Error('Remote Pending-Rekey transition proof is not canonically durable.')
    const persisted=await this.store.persistRecoveryArtifactV6(newUrs,fresh.state.diary_id,fresh.state.epoch_id,artifact),operation:RecoveryRekeyOperationStateV2={
      format:'recovery-rekey-operation-v2',version:2,operation_id:base64Url(randomBytes(32)),operation_origin:'remote_pending_rekey_adoption',supersedes_transition_id:null,superseded_by_transition_id:null,
      epoch_id:fresh.state.epoch_id,stage:'transition_durable',authority_anchor_before_transition:{...proof.authority_anchor_before_transition},transition_id:fresh.result.current_recovery.recovery_rekey_transition_id,
      transition_envelope:{...proof.transition_envelope},recovery_artifact_id:artifact.recovery_artifact_id,recovery_artifact_locator:persisted.artifactLocator,recovery_artifact_sha256:persisted.artifactSha256,
      artifact_publish_attempted:true,transition_proof_sha256:await recoveryAuthorityTransitionProofHashV2(proof),to_recovery_generation:opened.payload.recovery_generation,
      to_recovery_urs_commitment:opened.payload.recovery_urs_commitment,to_recovery_urs_id:opened.payload.recovery_urs_id,to_recovery_takeover_key_id:opened.payload.recovery_takeover_key_id,
      completed_successor_epoch_id:null,completed_successor_manifest_fingerprint:null,
    }
    await this.store.initializeRecoveryRekeyOperationBinding(fresh.context.rootKey,fresh.context.epochSalt,fresh.state.operation_generation,operation)
    return operation
  }

  async adoptPending(currentUrs:Uint8Array):Promise<RecoveryRekeyV2Result>{
    const operation=await this.adoptPendingInternal(currentUrs)
    const resumed=await this.resume(operation,currentUrs)
    return{operationId:resumed.operation_id,transitionId:resumed.transition_id,stage:resumed.stage,toRecoveryGeneration:resumed.to_recovery_generation,toRecoveryUrsId:resumed.to_recovery_urs_id,successorEpochId:resumed.completed_successor_epoch_id}
  }
}
