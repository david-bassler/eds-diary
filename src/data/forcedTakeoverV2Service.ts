import { activeProtocolSelectionV2, openReadOnlyJoinRootWrapV6WithActiveMode } from './localDatabase'
import { base64Url, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { randomProtocolIdV2, signEd25519V2, verifyEd25519V2, writerGrantSigningBytesV2 } from '../security/v2/crypto'
import { openRevisionEnvelopeV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { openActivationLineageCacheV2 } from '../security/v2/activationLineageCache'
import { IndexedDbV2LocalSecurityStore, type V2OutboxEntry } from '../security/v2/localPersistence'
import { recoveryCredentialHistoryHashV2, validateStoredWriterDeviceKeyV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from '../security/v2/localState'
import { assertExtendsAnchorV2, createAnchorV2 } from '../security/v2/prefix'
import { openRecoveryArtifactV6, type RecoveryPayloadV6 } from '../security/v2/recovery'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import { validateRevisionV2 } from '../security/v2/validators'
import type { WriterGrantOperationStateV2 } from '../security/v2/writerGrantOperation'
import type { RecoveryAuthorityTransitionV2, RevisionV2, WriterGrantV2 } from '../security/v2/types'
import type { CanonicalFullResultV2, RecoveryStateSnapshotV2 } from '../security/v2/verifier'
import { SINGLE_WRITER_V2_PROFILE, TransportError, type VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { deriveEpochSaltV2 } from '../security/v2/crypto'

const TERMINAL_ROTATION=new Set(['switched','stale','cutover_race','post_activation_superseded'])
const TERMINAL_WRITER=new Set(['durable','stale'])
const TERMINAL_RECOVERY=new Set(['completed','stale','superseded'])

interface ActiveTakeoverContextV2 {
  rootKey:Uint8Array
  epochSalt:Uint8Array
  state:EpochLocalSecurityStateV6
  remoteId:string
}

interface FreshTakeoverVerifyV2 {
  transport:GoogleSheetsTransferableSingleWriterV2Transport
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
}

export interface ForcedTakeoverResultV2 {
  operationId:string
  stage:'prepared'|'append_unknown'|'durable'|'stale'
  expectedWriterGeneration:number
  expectedWriterGrantId:string
  writerDeviceId:string
  writerKeyId:string
  maintenanceOnly:boolean
}

function canonicalResult(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Forced Takeover requires v2 canonical verification.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Forced Takeover requires canonical_full.')
  return result
}
function sameAnchor(left:CanonicalFullResultV2['remote_anchor'],right:CanonicalFullResultV2['remote_anchor']):boolean{
  return left.anchor_profile===right.anchor_profile&&left.covered_row_count===right.covered_row_count&&left.prefix_hash===right.prefix_hash
}
function sameCanonical(left:unknown,right:unknown):boolean{
  return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))
}
function nonTerminalSecurityOperation(state:EpochLocalSecurityStateV6,allowWriterOperationId:string|null):boolean{
  if(state.rotation_state_ref&&!TERMINAL_ROTATION.has(state.rotation_state_ref.state))return true
  if(state.writer_operation_state_ref
    &&state.writer_operation_state_ref.operation_id!==allowWriterOperationId
    &&!TERMINAL_WRITER.has(state.writer_operation_state_ref.state))return true
  if(state.recovery_operation_state_ref
    &&!TERMINAL_RECOVERY.has(state.recovery_operation_state_ref.state))return true
  return state.migration_state_ref!==null
}
function toResult(operation:WriterGrantOperationStateV2,grant:WriterGrantV2,maintenanceOnly:boolean):ForcedTakeoverResultV2{
  return{
    operationId:operation.operation_id,
    stage:operation.stage,
    expectedWriterGeneration:operation.expected_writer_generation,
    expectedWriterGrantId:operation.expected_writer_grant_id,
    writerDeviceId:grant.writer_device_id,
    writerKeyId:grant.writer_key_id,
    maintenanceOnly,
  }
}

export class ProductiveForcedTakeoverV2Service {
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly now:()=>string=()=>new Date().toISOString(),
    private readonly fault?: (point:'after-prepared'|'after-append-attempt')=>Promise<void>,
  ){}

  private async activeContext():Promise<ActiveTakeoverContextV2>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('No active v2 protocol selection exists.')
    const persistedWrap=await this.store.loadRootWrapV6(selection.epoch_id)
    const rootKey=await openReadOnlyJoinRootWrapV6WithActiveMode(persistedWrap)
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,selection.epoch_id)
    if(state.diary_id!==selection.diary_id||state.epoch_id!==selection.epoch_id||state.manifest_fingerprint!==selection.manifest_fingerprint)throw new Error('Active v2 selection does not match authenticated StateV6.')
    if(!state.remote_binding)throw new Error('Active v2 StateV6 has no remote binding.')
    return{rootKey,epochSalt,state,remoteId:state.remote_binding.remote_resource_id}
  }

  private async freshVerify(context:ActiveTakeoverContextV2):Promise<FreshTakeoverVerifyV2>{
    const transport=await this.session.transportForEpoch(context.state.diary_id,context.state.epoch_id)
    const binding=await this.session.remoteIdentityBinding(transport)
    if(binding!==context.state.remote_binding?.remote_identity_binding)throw new Error('Forced Takeover authenticated remote identity changed.')
    const codec=await this.session.codecForEpoch(context.state.diary_id,context.state.epoch_id,context.rootKey,transport)
    const verified=await codec.verifyRemote(await transport.read(context.remoteId)),result=canonicalResult(verified)
    if(result.diary_id!==context.state.diary_id||result.epoch_id!==context.state.epoch_id||result.manifest_fingerprint!==context.state.manifest_fingerprint)throw new Error('Forced Takeover canonical identity mismatch.')
    return{transport,verified,result}
  }

  private async refreshLocal(context:ActiveTakeoverContextV2,fresh:FreshTakeoverVerifyV2,writerKeyUsable:boolean):Promise<EpochLocalSecurityStateV6>{
    const before=await this.store.loadState(context.rootKey,context.epochSalt,context.state.epoch_id)
    const next=await stateAfterCanonicalVerifyV6(before,fresh.result,fresh.verified.snapshot.rows,writerKeyUsable)
    return this.store.commitVerifiedDispositions(
      context.rootKey,context.epochSalt,before.operation_generation,next,
      fresh.verified.acceptedEnvelopeIds,fresh.verified.staleWriterEnvelopeIds,
      {
        remote_rows:fresh.verified.snapshot.rows,
        current_writer:{
          writer_generation:fresh.result.current_writer.writer_generation,
          writer_grant_id:fresh.result.current_writer.writer_grant_id,
          writer_device_id:fresh.result.current_writer.writer_device_id,
          writer_key_id:fresh.result.current_writer.writer_key_id,
        },
        source_epoch_sealed:fresh.result.source_epoch_sealed,
        recovery_rekey_rotation_required:fresh.result.current_recovery.recovery_rekey_rotation_required,
      },
    )
  }

  private async localKey(state:EpochLocalSecurityStateV6):Promise<StoredWriterDeviceKeyV2>{
    const key=await this.store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
    if(!key||key.writer_device_id!==state.writer_device_id)throw new Error('Local WriterDeviceKeyV2 is missing or does not match StateV6.')
    await validateStoredWriterDeviceKeyV2(key,state.diary_id,state.epoch_id)
    return key
  }

  private async verifyActivationLineage(context:ActiveTakeoverContextV2,payload:RecoveryPayloadV6,result:CanonicalFullResultV2):Promise<void>{
    if(payload.activation_lineage.length===0){
      if(result.activation_state!=='native_active'||context.state.activation_lineage_cache_ref!==null)throw new Error('Native Forced Takeover activation lineage binding mismatch.')
      return
    }
    if(result.activation_state!=='cross_epoch_evidence_present'||context.state.activation_lineage_cache_ref===null)throw new Error('Forced Takeover requires authenticated cross-epoch activation lineage evidence.')
    const cache=await this.store.loadActivationLineageCache(context.rootKey,context.epochSalt,context.state.epoch_id)
    const lineage=await openActivationLineageCacheV2({
      cache,rootKey:context.rootKey,epochSalt:context.epochSalt,
      diaryId:context.state.diary_id,epochId:context.state.epoch_id,manifestFingerprint:context.state.manifest_fingerprint,
    })
    if(!sameCanonical(lineage,payload.activation_lineage))throw new Error('RecoveryArtifactV6 activation lineage differs from the authenticated local activation cache.')
  }

  private async verifyTransitionProof(context:ActiveTakeoverContextV2,payload:RecoveryPayloadV6,fresh:FreshTakeoverVerifyV2):Promise<void>{
    const proof=payload.recovery_authority_transition_proof
    if(fresh.result.current_recovery.recovery_rekey_rotation_required&&!proof)throw new Error('Pending Recovery-Rekey Forced Takeover requires the current RecoveryAuthorityTransitionProofV2.')
    if(!proof)return
    if(proof.source_epoch_id!==context.state.epoch_id||proof.source_manifest_fingerprint!==context.state.manifest_fingerprint)throw new Error('RecoveryAuthorityTransitionProofV2 source binding mismatch.')
    if(fresh.result.current_recovery.recovery_rekey_transition_id===null)throw new Error('RecoveryAuthorityTransitionProofV2 is not current for this epoch.')
    const row=fresh.verified.snapshot.rows.find(item=>item[0]===proof.transition_envelope.envelope_id)
    if(!row||row[1]!==proof.transition_envelope.iv||row[2]!==proof.transition_envelope.ciphertext
      ||!fresh.verified.acceptedEnvelopeIds.has(proof.transition_envelope.envelope_id))throw new Error('RecoveryAuthorityTransitionProofV2 transition is not canonically durable.')
    const revision=await openRevisionEnvelopeV2(
      context.rootKey,context.epochSalt,{diaryId:context.state.diary_id,epochId:context.state.epoch_id},
      {envelopeId:row[0]!,iv:row[1]!,ciphertext:row[2]!},
    )
    if(revision.record_schema!=='recovery-authority-transition-sw-v2'||revision.record_type!=='recovery_authority_transition'||revision.record_status!=='control')throw new Error('RecoveryAuthorityTransitionProofV2 envelope type mismatch.')
    const transition=revision.record_data as RecoveryAuthorityTransitionV2
    if(!transition
      ||transition.transition_id!==fresh.result.current_recovery.recovery_rekey_transition_id
      ||transition.from_recovery_generation!==proof.from_recovery_generation
      ||transition.from_recovery_urs_id!==proof.from_recovery_urs_id
      ||transition.from_recovery_takeover_key_id!==proof.from_recovery_takeover_key_id
      ||transition.to_recovery_generation!==proof.to_recovery_generation
      ||transition.to_recovery_urs_commitment!==proof.to_recovery_urs_commitment
      ||transition.to_recovery_urs_id!==proof.to_recovery_urs_id
      ||transition.to_recovery_takeover_key_id!==proof.to_recovery_takeover_key_id
      ||transition.to_recovery_takeover_public_key!==proof.to_recovery_takeover_public_key
      ||!sameAnchor(transition.authority_anchor,proof.authority_anchor_before_transition))throw new Error('RecoveryAuthorityTransitionProofV2 semantic binding mismatch.')
  }

  private async recoveryCapability(context:ActiveTakeoverContextV2,urs:Uint8Array,fresh:FreshTakeoverVerifyV2):Promise<Awaited<ReturnType<typeof openRecoveryArtifactV6>>>{
    if(urs.byteLength!==32)throw new Error('Forced Takeover requires a 32-byte Recovery Key secret.')
    const artifact=await this.session.loadRecoveryArtifact(urs,context.state.diary_id,context.state.epoch_id)
    const recovered=await openRecoveryArtifactV6(artifact,urs),payload=recovered.payload
    if(base64Url(recovered.rootKey)!==base64Url(context.rootKey)
      ||payload.diary_id!==context.state.diary_id||payload.epoch_id!==context.state.epoch_id
      ||payload.key_id!==context.state.key_id||payload.manifest_fingerprint!==context.state.manifest_fingerprint
      ||payload.google_account_binding!==context.state.remote_binding?.remote_identity_binding)throw new Error('RecoveryArtifactV6 does not bind the active local v2 epoch.')
    await assertExtendsAnchorV2(payload.remote_anchor,payload.diary_id,payload.epoch_id,fresh.verified.snapshot.rows)
    const recovery=fresh.result.current_recovery
    if(payload.recovery_generation!==recovery.recovery_generation
      ||payload.recovery_urs_commitment!==recovery.recovery_urs_commitment
      ||payload.recovery_urs_id!==recovery.recovery_urs_id
      ||payload.recovery_takeover_key_id!==recovery.recovery_takeover_key_id
      ||payload.recovery_takeover_public_key!==recovery.recovery_takeover_public_key
      ||await recoveryCredentialHistoryHashV2(payload.recovery_credential_history)!==await recoveryCredentialHistoryHashV2(fresh.result.recovery_credential_history))throw new Error('RecoveryArtifactV6 is not current for the freshly verified Recovery authority.')
    await this.verifyActivationLineage(context,payload,fresh.result)
    await this.verifyTransitionProof(context,payload,fresh)
    return recovered
  }

  private async parseOperationEnvelope(context:ActiveTakeoverContextV2,operation:WriterGrantOperationStateV2):Promise<{envelope:{envelopeId:string;iv:string;ciphertext:string;bytesHash:string};grant:WriterGrantV2}>{
    const envelope=(await this.store.envelopes(operation.epoch_id)).find(item=>item.envelopeId===operation.prepared_envelope.envelope_id)
    if(!envelope||envelope.iv!==operation.prepared_envelope.iv||envelope.ciphertext!==operation.prepared_envelope.ciphertext)throw new Error('WriterGrantOperationStateV2 prepared envelope is missing or changed.')
    const revision=await openRevisionEnvelopeV2(context.rootKey,context.epochSalt,{diaryId:context.state.diary_id,epochId:context.state.epoch_id},envelope)
    if(revision.record_schema!=='writer-grant-sw-v2'||revision.record_type!=='writer_grant'||revision.record_status!=='control'||revision.writer_context!==null||revision.writer_signature!==null)throw new Error('WriterGrantOperationStateV2 envelope is not a WriterGrantV2 control.')
    const grant=revision.record_data as WriterGrantV2
    if(!grant||grant.reason!=='forced_takeover'||grant.authorization.kind!=='recovery_takeover'
      ||grant.grant_id!==operation.expected_writer_grant_id||grant.writer_generation!==operation.expected_writer_generation
      ||!sameAnchor(grant.authority_anchor,operation.authority_anchor))throw new Error('WriterGrantOperationStateV2 forced-takeover binding mismatch.')
    return{envelope,grant}
  }

  private async verifyPersistedAuthorization(context:ActiveTakeoverContextV2,operation:WriterGrantOperationStateV2,grant:WriterGrantV2,fresh:FreshTakeoverVerifyV2):Promise<RecoveryStateSnapshotV2>{
    const count=operation.authority_anchor.covered_row_count
    const actual=await createAnchorV2(context.state.diary_id,context.state.epoch_id,fresh.verified.snapshot.rows.slice(0,count))
    if(!sameAnchor(actual,operation.authority_anchor))throw new Error('Persisted Forced Takeover authority anchor is not a prefix of the fresh canonical remote.')
    const recovery=fresh.result.recovery_history_by_prefix.get(count)
    if(!recovery
      ||grant.recovery_generation!==recovery.recovery_generation
      ||grant.authorization.signer_key_id!==recovery.recovery_takeover_key_id
      ||!grant.authorization.signature
      ||!await verifyEd25519V2(fixedBase64Url(recovery.recovery_takeover_public_key,32),grant.authorization.signature,writerGrantSigningBytesV2(context.state.diary_id,context.state.epoch_id,grant)))throw new Error('Persisted Forced Takeover Grant authorization failed historical Recovery verification.')
    return recovery
  }

  private async markOperation(context:ActiveTakeoverContextV2,operation:WriterGrantOperationStateV2,stage:'append_unknown'|'durable'|'stale'):Promise<WriterGrantOperationStateV2>{
    if(operation.stage===stage)return operation
    const state=await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id)
    const next={...operation,stage} as WriterGrantOperationStateV2
    await this.store.advanceWriterGrantOperationBinding(context.rootKey,context.epochSalt,operation.epoch_id,state.operation_generation,operation.stage,next)
    return this.store.loadWriterGrantOperation(operation.operation_id)
  }

  private async unresolvedDomainEnvelopes(context:ActiveTakeoverContextV2):Promise<void>{
    await this.store.verifyLocalJournal(context.rootKey,context.epochSalt,context.state.epoch_id)
    const entries=await this.store.outbox(context.rootKey,context.epochSalt,context.state.epoch_id)
    const unresolved=entries.filter((entry:V2OutboxEntry)=>entry.authority!==null&&(entry.status==='prepared'||entry.status==='pending'))
    if(unresolved.length)throw new Error('Forced Takeover requires unresolved local Writer envelopes to be quarantined first.')
  }

  private stillOwnsDecisionAnchor(state:EpochLocalSecurityStateV6,result:CanonicalFullResultV2,grant:WriterGrantV2,operation:WriterGrantOperationStateV2,recovery:RecoveryStateSnapshotV2):boolean{
    return state.epoch_status==='active'&&state.writer_status==='read_only'
      &&!result.source_epoch_sealed&&result.activation_state!=='staged_confirmation_missing'
      &&sameAnchor(result.remote_anchor,operation.authority_anchor)
      &&result.current_writer.writer_generation===grant.previous_writer_generation
      &&result.current_writer.writer_grant_id===grant.previous_grant_id
      &&result.current_recovery.recovery_generation===recovery.recovery_generation
      &&result.current_recovery.recovery_takeover_key_id===recovery.recovery_takeover_key_id
      &&grant.writer_device_id===state.writer_device_id
      &&grant.writer_key_id===state.writer_signing_key_id
      &&!nonTerminalSecurityOperation(state,operation.operation_id)
  }

  private async finalizeFromFresh(context:ActiveTakeoverContextV2,operation:WriterGrantOperationStateV2,grant:WriterGrantV2,fresh:FreshTakeoverVerifyV2):Promise<WriterGrantOperationStateV2|'absent'>{
    const rowPresent=fresh.verified.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)
    if(fresh.verified.acceptedEnvelopeIds.has(operation.prepared_envelope.envelope_id)){
      const state=await this.refreshLocal(context,fresh,true)
      if(state.writer_status!=='writer_active'||state.writer_device_id!==grant.writer_device_id||state.writer_signing_key_id!==grant.writer_key_id
        ||state.writer_generation!==grant.writer_generation||state.writer_grant_id!==grant.grant_id)throw new Error('Canonical Forced Takeover did not promote the authenticated local WriterDeviceKeyV2.')
      return this.markOperation(context,operation,'durable')
    }
    if(rowPresent){
      const disposition=fresh.result.dispositions.find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)?.disposition
      if(disposition==='stale_grant_rejected'||disposition==='stale_after_seal_rejected'){
        await this.refreshLocal(context,fresh,true)
        return this.markOperation(context,operation,'stale')
      }
      throw new Error('Forced Takeover Grant is physically present but neither accepted nor classified stale.')
    }
    return'absent'
  }

  private async runOperation(context:ActiveTakeoverContextV2,operation:WriterGrantOperationStateV2):Promise<ForcedTakeoverResultV2>{
    const {envelope,grant}=await this.parseOperationEnvelope(context,operation)
    if(operation.stage==='durable'||operation.stage==='stale'){
      const state=await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id)
      return toResult(operation,grant,state.recovery_rekey_rotation_required)
    }

    const key=await this.localKey(await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id))
    if(grant.writer_device_id!==key.writer_device_id||grant.writer_key_id!==key.writer_signing_key_id||grant.writer_public_key!==key.writer_public_key)throw new Error('Persisted Forced Takeover target no longer matches the local WriterDeviceKeyV2.')

    let current=operation,appends=0
    const maxAppends=operation.stage==='prepared'?2:1
    while(true){
      const fresh=await this.freshVerify(context)
      const recovery=await this.verifyPersistedAuthorization(context,current,grant,fresh)
      const classified=await this.finalizeFromFresh(context,current,grant,fresh)
      if(classified!=='absent'){
        const state=await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id)
        return toResult(classified,grant,state.recovery_rekey_rotation_required)
      }
      const state=await this.refreshLocal(context,fresh,true)
      if(!this.stillOwnsDecisionAnchor(state,fresh.result,grant,current,recovery)){
        current=await this.markOperation(context,current,'stale')
        return toResult(current,grant,state.recovery_rekey_rotation_required)
      }
      if(appends>=maxAppends)return toResult(current,grant,state.recovery_rekey_rotation_required)
      if(appends===1&&current.stage==='prepared')current=await this.markOperation(context,current,'append_unknown')
      try{
        await fresh.transport.append(context.remoteId,[envelope.envelopeId,envelope.iv,envelope.ciphertext])
      }catch(error){
        if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error
        if(current.stage==='prepared')current=await this.markOperation(context,current,'append_unknown')
      }
      appends+=1
      await this.fault?.('after-append-attempt')
    }
  }

  async takeover(urs?:Uint8Array):Promise<ForcedTakeoverResultV2>{
    const context=await this.activeContext()
    let operation=await this.store.loadBoundWriterGrantOperation(context.rootKey,context.epochSalt,context.state.epoch_id)
    if(operation&&TERMINAL_WRITER.has(operation.stage)){
      if(urs===undefined){
        if(operation.operation_kind!=='forced_takeover')throw new Error('The terminal WriterGrant operation is not a Forced Takeover.')
        const parsed=await this.parseOperationEnvelope(context,operation)
        return toResult(operation,parsed.grant,context.state.recovery_rekey_rotation_required)
      }
      operation=null
    }
    if(operation){
      if(operation.operation_kind!=='forced_takeover')throw new Error('A different WriterGrant operation is already bound locally.')
      return this.runOperation(context,operation)
    }
    if(!urs)throw new Error('A Recovery Key is required to start Forced Takeover.')

    const key=await this.localKey(context.state),fresh=await this.freshVerify(context)
    const reconciled=await this.refreshLocal(context,fresh,true)
    if(reconciled.operation_generation===Number.MAX_SAFE_INTEGER)throw new Error('StateV6 operation generation exhausted.')
    if(nonTerminalSecurityOperation(reconciled,null))throw new Error('Forced Takeover is blocked by another security operation.')
    if(reconciled.epoch_status!=='active'||reconciled.writer_status!=='read_only'||fresh.result.source_epoch_sealed
      ||fresh.result.activation_state==='staged_confirmation_missing')throw new Error('Forced Takeover requires a fresh active read-only epoch.')
    if(fresh.result.current_writer.writer_device_id===reconciled.writer_device_id||fresh.result.current_writer.writer_key_id===reconciled.writer_signing_key_id)throw new Error('This device already matches the canonical Writer authority.')
    await this.unresolvedDomainEnvelopes({...context,state:reconciled})
    const recovered=await this.recoveryCapability({...context,state:reconciled},urs,fresh)
    const payload=recovered.payload
    const reservation=await this.store.reserveEnvelope(reconciled.epoch_id,fresh.verified.snapshot.rows)
    const grant:WriterGrantV2={
      grant_id:randomProtocolIdV2(32),
      writer_generation:fresh.result.current_writer.writer_generation+1,
      writer_device_id:reconciled.writer_device_id,
      writer_key_id:reconciled.writer_signing_key_id,
      writer_public_key:key.writer_public_key,
      previous_grant_id:fresh.result.current_writer.writer_grant_id,
      previous_writer_generation:fresh.result.current_writer.writer_generation,
      recovery_generation:fresh.result.current_recovery.recovery_generation,
      reason:'forced_takeover',
      authority_anchor:{...fresh.result.remote_anchor},
      authorization:{kind:'recovery_takeover',signer_key_id:fresh.result.current_recovery.recovery_takeover_key_id,signature:null},
    }
    grant.authorization.signature=await signEd25519V2(recovered.recoveryTakeoverPrivateKey,writerGrantSigningBytesV2(reconciled.diary_id,reconciled.epoch_id,grant))
    const revision:RevisionV2<WriterGrantV2>={
      record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
      parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:this.now(),writer_context:null,writer_signature:null,
    }
    await validateRevisionV2(revision)
    const envelope=await sealRevisionEnvelopeV2(context.rootKey,context.epochSalt,{diaryId:reconciled.diary_id,epochId:reconciled.epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    operation={
      format:'writer-grant-operation-v2',version:2,operation_id:randomProtocolIdV2(32),operation_kind:'forced_takeover',
      epoch_id:reconciled.epoch_id,stage:'prepared',authority_anchor:{...fresh.result.remote_anchor},
      prepared_envelope:{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext},
      expected_writer_generation:grant.writer_generation,expected_writer_grant_id:grant.grant_id,
    }
    await this.store.persistPreparedWriterGrantOperationBundle({
      rootKey:context.rootKey,epochSalt:context.epochSalt,expectedOperationGeneration:reconciled.operation_generation,
      reservation,envelope,operation,recoveryTakeoverPublicKey:payload.recovery_takeover_public_key,
    })
    await this.fault?.('after-prepared')
    return this.runOperation({...context,state:await this.store.loadState(context.rootKey,context.epochSalt,reconciled.epoch_id)},operation)
  }
}
