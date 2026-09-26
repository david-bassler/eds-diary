import { activeProtocolSelectionV2, openSuccessorRootWrapV6WithActiveMode } from './localDatabase'
import { base64Url, fixedBase64Url, fromBase64Url, randomBytes } from '../security/crypto/bytes'
import { randomProtocolIdV2, signEd25519V2, transferDescriptorPopBytesV2, verifyEd25519V2, writerGrantSigningBytesV2 } from '../security/v2/crypto'
import { openRevisionEnvelopeV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { IndexedDbV2LocalSecurityStore, type V2OutboxEntry } from '../security/v2/localPersistence'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import { validateStoredWriterDeviceKeyV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from '../security/v2/localState'
import { verifyTransferDescriptorV2, validateRevisionV2 } from '../security/v2/validators'
import type { WriterGrantOperationStateV2 } from '../security/v2/writerGrantOperation'
import type { RevisionV2, TransferDescriptorV2, WriterGrantV2 } from '../security/v2/types'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import { SINGLE_WRITER_V2_PROFILE, TransportError, type VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { deriveEpochSaltV2 } from '../security/v2/crypto'

const TERMINAL_ROTATION=new Set(['switched','stale','cutover_race','post_activation_superseded'])
const TERMINAL_WRITER=new Set(['durable','stale'])
const TERMINAL_RECOVERY=new Set(['completed','stale','superseded'])

interface ActiveHandoffContextV2 {
  rootKey:Uint8Array
  epochSalt:Uint8Array
  state:EpochLocalSecurityStateV6
  remoteId:string
}

interface FreshHandoffVerifyV2 {
  transport:GoogleSheetsTransferableSingleWriterV2Transport
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
}

export interface WriterHandoffResultV2 {
  operationId:string
  stage:'prepared'|'append_unknown'|'durable'|'stale'
  expectedWriterGeneration:number
  expectedWriterGrantId:string
  targetWriterDeviceId:string
  targetWriterKeyId:string
}

function canonicalResult(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Writer handoff requires v2 canonical verification.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Writer handoff requires canonical_full.')
  return result
}
function sameAnchor(left:CanonicalFullResultV2['remote_anchor'],right:CanonicalFullResultV2['remote_anchor']):boolean{
  return left.anchor_profile===right.anchor_profile&&left.covered_row_count===right.covered_row_count&&left.prefix_hash===right.prefix_hash
}
function nonTerminalSecurityOperation(state:EpochLocalSecurityStateV6,allowWriterOperationId:string|null):boolean{
  if(state.rotation_state_ref&&!TERMINAL_ROTATION.has(state.rotation_state_ref.state))return true
  if(state.recovery_operation_state_ref&&!TERMINAL_RECOVERY.has(state.recovery_operation_state_ref.state))return true
  if(state.writer_operation_state_ref
    &&state.writer_operation_state_ref.operation_id!==allowWriterOperationId
    &&!TERMINAL_WRITER.has(state.writer_operation_state_ref.state))return true
  return state.migration_state_ref!==null
}
function grantTarget(grant:WriterGrantV2):Pick<WriterHandoffResultV2,'targetWriterDeviceId'|'targetWriterKeyId'>{
  return{targetWriterDeviceId:grant.writer_device_id,targetWriterKeyId:grant.writer_key_id}
}
function toResult(operation:WriterGrantOperationStateV2,grant:WriterGrantV2):WriterHandoffResultV2{
  return{operationId:operation.operation_id,stage:operation.stage,expectedWriterGeneration:operation.expected_writer_generation,expectedWriterGrantId:operation.expected_writer_grant_id,...grantTarget(grant)}
}

export async function createTransferDescriptorV2(
  state:EpochLocalSecurityStateV6,
  key:StoredWriterDeviceKeyV2,
  nonce=randomBytes(32),
):Promise<TransferDescriptorV2>{
  if(state.epoch_status!=='active'||state.writer_status!=='read_only')throw new Error('TransferDescriptorV2 requires an active read-only local device.')
  if(state.writer_device_id!==key.writer_device_id||state.writer_signing_key_id!==key.writer_signing_key_id)throw new Error('TransferDescriptorV2 local WriterDeviceKeyV2 binding mismatch.')
  await validateStoredWriterDeviceKeyV2(key,state.diary_id,state.epoch_id)
  if(nonce.byteLength!==32)throw new Error('TransferDescriptorV2 nonce must contain 32 bytes.')
  const core:Omit<TransferDescriptorV2,'possession_signature'>={
    format:'eds-writer-transfer-v2',version:2,sync_profile:SINGLE_WRITER_V2_PROFILE,
    diary_id:state.diary_id,epoch_id:state.epoch_id,writer_device_id:state.writer_device_id,
    writer_key_id:state.writer_signing_key_id,writer_public_key:key.writer_public_key,nonce:base64Url(nonce),
  }
  return verifyTransferDescriptorV2({...core,possession_signature:await signEd25519V2(key.private_key,transferDescriptorPopBytesV2(core))})
}

export class ProductiveWriterHandoffV2Service {
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly now:()=>string=()=>new Date().toISOString(),
    private readonly fault?: (point:'after-prepared'|'after-append-attempt')=>Promise<void>,
  ){}

  private async activeContext():Promise<ActiveHandoffContextV2>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('No active v2 protocol selection exists.')
    const persistedWrap=await this.store.loadRootWrapV6(selection.epoch_id)
    const rootKey=await openSuccessorRootWrapV6WithActiveMode(persistedWrap)
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,selection.epoch_id)
    if(state.diary_id!==selection.diary_id||state.epoch_id!==selection.epoch_id||state.manifest_fingerprint!==selection.manifest_fingerprint)throw new Error('Active v2 selection does not match authenticated StateV6.')
    if(!state.remote_binding)throw new Error('Active v2 StateV6 has no remote binding.')
    return{rootKey,epochSalt,state,remoteId:state.remote_binding.remote_resource_id}
  }

  private async freshVerify(context:ActiveHandoffContextV2):Promise<FreshHandoffVerifyV2>{
    const transport=await this.session.transportForEpoch(context.state.diary_id,context.state.epoch_id)
    const binding=await this.session.remoteIdentityBinding(transport)
    if(binding!==context.state.remote_binding?.remote_identity_binding)throw new Error('Writer handoff authenticated remote identity changed.')
    const codec=await this.session.codecForEpoch(context.state.diary_id,context.state.epoch_id,context.rootKey,transport)
    const verified=await codec.verifyRemote(await transport.read(context.remoteId)),result=canonicalResult(verified)
    if(result.diary_id!==context.state.diary_id||result.epoch_id!==context.state.epoch_id||result.manifest_fingerprint!==context.state.manifest_fingerprint)throw new Error('Writer handoff canonical identity mismatch.')
    return{transport,verified,result}
  }

  private async refreshLocal(context:ActiveHandoffContextV2,fresh:FreshHandoffVerifyV2,writerKeyUsable:boolean):Promise<EpochLocalSecurityStateV6>{
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
    return key
  }

  async createTransferDescriptor():Promise<TransferDescriptorV2>{
    const context=await this.activeContext()
    if(context.state.writer_status!=='read_only')throw new Error('TransferDescriptorV2 may only be created by a locally read-only device.')
    const key=await this.localKey(context.state),fresh=await this.freshVerify(context)
    const state=await this.refreshLocal(context,fresh,false)
    if(nonTerminalSecurityOperation(state,null))throw new Error('TransferDescriptorV2 creation is blocked by another security operation.')
    if(state.writer_status!=='read_only'||state.epoch_status!=='active')throw new Error('TransferDescriptorV2 requires active read-only state after fresh verification.')
    if(fresh.result.current_writer.writer_device_id===state.writer_device_id||fresh.result.current_writer.writer_key_id===state.writer_signing_key_id)throw new Error('This device is already the canonical Writer; no transfer descriptor is needed.')
    return createTransferDescriptorV2(state,key)
  }

  private async parseOperationEnvelope(context:ActiveHandoffContextV2,operation:WriterGrantOperationStateV2):Promise<{envelope:{envelopeId:string;iv:string;ciphertext:string;bytesHash:string};grant:WriterGrantV2}>{
    const envelope=(await this.store.envelopes(operation.epoch_id)).find(item=>item.envelopeId===operation.prepared_envelope.envelope_id)
    if(!envelope||envelope.iv!==operation.prepared_envelope.iv||envelope.ciphertext!==operation.prepared_envelope.ciphertext)throw new Error('WriterGrantOperationStateV2 prepared envelope is missing or changed.')
    const revision=await openRevisionEnvelopeV2(context.rootKey,context.epochSalt,{diaryId:context.state.diary_id,epochId:context.state.epoch_id},envelope)
    if(revision.record_schema!=='writer-grant-sw-v2'||revision.record_type!=='writer_grant'||revision.record_status!=='control'||revision.writer_context!==null||revision.writer_signature!==null)throw new Error('WriterGrantOperationStateV2 envelope is not a WriterGrantV2 control.')
    const grant=revision.record_data as WriterGrantV2
    if(!grant||grant.reason!=='handoff'||grant.authorization.kind!=='writer_handoff'
      ||grant.grant_id!==operation.expected_writer_grant_id||grant.writer_generation!==operation.expected_writer_generation
      ||!sameAnchor(grant.authority_anchor,operation.authority_anchor))throw new Error('WriterGrantOperationStateV2 grant binding mismatch.')
    return{envelope,grant}
  }

  private async markOperation(context:ActiveHandoffContextV2,operation:WriterGrantOperationStateV2,stage:'append_unknown'|'durable'|'stale'):Promise<WriterGrantOperationStateV2>{
    if(operation.stage===stage)return operation
    const state=await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id)
    const next={...operation,stage} as WriterGrantOperationStateV2
    await this.store.advanceWriterGrantOperationBinding(context.rootKey,context.epochSalt,operation.epoch_id,state.operation_generation,operation.stage,next)
    return this.store.loadWriterGrantOperation(operation.operation_id)
  }

  private async noPendingDomainEnvelopes(context:ActiveHandoffContextV2):Promise<void>{
    await this.store.verifyLocalJournal(context.rootKey,context.epochSalt,context.state.epoch_id)
    const entries=await this.store.outbox(context.rootKey,context.epochSalt,context.state.epoch_id)
    const pending=entries.filter((entry:V2OutboxEntry)=>entry.authority!==null&&(entry.status==='prepared'||entry.status==='pending'))
    if(pending.length)throw new Error('Cooperative handoff requires all local Writer envelopes to be durable or otherwise resolved.')
  }

  private sourceStillOwnsGrantAnchor(state:EpochLocalSecurityStateV6,result:CanonicalFullResultV2,grant:WriterGrantV2,operation:WriterGrantOperationStateV2):boolean{
    return state.epoch_status==='active'&&state.writer_status==='writer_active'
      &&!result.source_epoch_sealed&&!result.current_recovery.recovery_rekey_rotation_required
      &&sameAnchor(result.remote_anchor,operation.authority_anchor)
      &&result.current_writer.writer_generation===grant.previous_writer_generation
      &&result.current_writer.writer_grant_id===grant.previous_grant_id
      &&result.current_writer.writer_device_id===state.writer_device_id
      &&result.current_writer.writer_key_id===state.writer_signing_key_id
      &&result.current_recovery.recovery_generation===grant.recovery_generation
      &&!nonTerminalSecurityOperation(state,operation.operation_id)
  }

  private async finalizeFromFresh(context:ActiveHandoffContextV2,operation:WriterGrantOperationStateV2,fresh:FreshHandoffVerifyV2):Promise<WriterGrantOperationStateV2|'absent'>{
    const rowPresent=fresh.verified.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)
    if(fresh.verified.acceptedEnvelopeIds.has(operation.prepared_envelope.envelope_id)){
      // Durable means this exact one-shot Grant was canonically accepted at its
      // row. A later accepted g+2 Grant may already have advanced current_writer;
      // that does not undo the completed A->B handoff. The source still
      // reconciles to the freshest current authority and therefore remains
      // read-only.
      await this.refreshLocal(context,fresh,true)
      return this.markOperation(context,operation,'durable')
    }
    if(rowPresent){
      const disposition=fresh.result.dispositions.find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)?.disposition
      if(disposition==='stale_grant_rejected'||disposition==='stale_after_seal_rejected'||disposition==='rekey_rotation_required_rejected'){
        await this.refreshLocal(context,fresh,true)
        return this.markOperation(context,operation,'stale')
      }
      throw new Error('WriterGrant envelope is physically present but neither accepted nor classified stale.')
    }
    return'absent'
  }

  private async runOperation(context:ActiveHandoffContextV2,operation:WriterGrantOperationStateV2):Promise<WriterHandoffResultV2>{
    const {envelope,grant}=await this.parseOperationEnvelope(context,operation)
    if(operation.stage==='durable'||operation.stage==='stale')return toResult(operation,grant)
    const sourceKey=await this.localKey(await this.store.loadState(context.rootKey,context.epochSalt,operation.epoch_id))
    const signature=grant.authorization.signature
    if(!signature||grant.authorization.signer_key_id!==sourceKey.writer_signing_key_id
      ||!await verifyEd25519V2(fixedBase64Url(sourceKey.writer_public_key,32),signature,writerGrantSigningBytesV2(context.state.diary_id,context.state.epoch_id,grant)))throw new Error('Persisted cooperative Handoff Grant authorization failed local re-verification.')

    let current=operation,appends=0
    const maxAppends=operation.stage==='prepared'?2:1
    while(true){
      const fresh=await this.freshVerify(context)
      const classified=await this.finalizeFromFresh(context,current,fresh)
      if(classified!=='absent')return toResult(classified,grant)
      const state=await this.refreshLocal(context,fresh,true)
      if(!this.sourceStillOwnsGrantAnchor(state,fresh.result,grant,current)){
        current=await this.markOperation(context,current,'stale')
        return toResult(current,grant)
      }
      if(appends>=maxAppends)return toResult(current,grant)
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

  async handoff(descriptorInput?:unknown):Promise<WriterHandoffResultV2>{
    const context=await this.activeContext()
    let operation=await this.store.loadBoundWriterGrantOperation(context.rootKey,context.epochSalt,context.state.epoch_id)
    if(operation&&TERMINAL_WRITER.has(operation.stage)){
      if(descriptorInput===undefined){
        if(operation.operation_kind!=='handoff')throw new Error('The terminal WriterGrant operation is not a cooperative handoff.')
        const parsed=await this.parseOperationEnvelope(context,operation)
        return toResult(operation,parsed.grant)
      }
      operation=null
    }
    if(operation){
      if(operation.operation_kind!=='handoff')throw new Error('A different WriterGrant operation is already bound locally.')
      const parsed=await this.parseOperationEnvelope(context,operation)
      if(descriptorInput!==undefined){
        const descriptor=await verifyTransferDescriptorV2(descriptorInput)
        if(descriptor.diary_id!==context.state.diary_id||descriptor.epoch_id!==context.state.epoch_id
          ||descriptor.writer_device_id!==parsed.grant.writer_device_id||descriptor.writer_key_id!==parsed.grant.writer_key_id
          ||descriptor.writer_public_key!==parsed.grant.writer_public_key)throw new Error('TransferDescriptorV2 does not match the crash-resumed Handoff Grant.')
      }
      return this.runOperation(context,operation)
    }

    if(descriptorInput===undefined)throw new Error('A TransferDescriptorV2 is required to start cooperative handoff.')
    const descriptor=await verifyTransferDescriptorV2(descriptorInput)
    if(descriptor.diary_id!==context.state.diary_id||descriptor.epoch_id!==context.state.epoch_id)throw new Error('TransferDescriptorV2 targets a different diary or epoch.')

    const sourceKey=await this.localKey(context.state),fresh=await this.freshVerify(context)
    const reconciled=await this.refreshLocal(context,fresh,true)
    if(reconciled.operation_generation===Number.MAX_SAFE_INTEGER)throw new Error('StateV6 operation generation exhausted.')
    if(nonTerminalSecurityOperation(reconciled,null))throw new Error('Cooperative handoff is blocked by another security operation.')
    if(reconciled.epoch_status!=='active'||reconciled.writer_status!=='writer_active'||reconciled.writer_generation===null||reconciled.writer_grant_id===null
      ||fresh.result.source_epoch_sealed||fresh.result.current_recovery.recovery_rekey_rotation_required)throw new Error('Cooperative handoff requires a fresh active Writer authority.')
    if(descriptor.writer_device_id===reconciled.writer_device_id||descriptor.writer_key_id===reconciled.writer_signing_key_id)throw new Error('Cooperative handoff target must use a distinct device/key identity.')
    await this.noPendingDomainEnvelopes({...context,state:reconciled})
    if(fresh.result.current_writer.writer_device_id!==reconciled.writer_device_id||fresh.result.current_writer.writer_key_id!==reconciled.writer_signing_key_id
      ||fresh.result.current_writer.writer_generation!==reconciled.writer_generation||fresh.result.current_writer.writer_grant_id!==reconciled.writer_grant_id)throw new Error('Fresh canonical Writer authority does not match the local source Writer.')

    const reservation=await this.store.reserveEnvelope(reconciled.epoch_id,fresh.verified.snapshot.rows)
    const grant:WriterGrantV2={
      grant_id:randomProtocolIdV2(32),writer_generation:reconciled.writer_generation+1,
      writer_device_id:descriptor.writer_device_id,writer_key_id:descriptor.writer_key_id,writer_public_key:descriptor.writer_public_key,
      previous_grant_id:reconciled.writer_grant_id,previous_writer_generation:reconciled.writer_generation,
      recovery_generation:fresh.result.current_recovery.recovery_generation,reason:'handoff',authority_anchor:{...fresh.result.remote_anchor},
      authorization:{kind:'writer_handoff',signer_key_id:reconciled.writer_signing_key_id,signature:null},
    }
    grant.authorization.signature=await signEd25519V2(sourceKey.private_key,writerGrantSigningBytesV2(reconciled.diary_id,reconciled.epoch_id,grant))
    const revision:RevisionV2<WriterGrantV2>={
      record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
      parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:this.now(),writer_context:null,writer_signature:null,
    }
    await validateRevisionV2(revision)
    const envelope=await sealRevisionEnvelopeV2(context.rootKey,context.epochSalt,{diaryId:reconciled.diary_id,epochId:reconciled.epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    operation={
      format:'writer-grant-operation-v2',version:2,operation_id:randomProtocolIdV2(32),operation_kind:'handoff',
      epoch_id:reconciled.epoch_id,stage:'prepared',authority_anchor:{...fresh.result.remote_anchor},
      prepared_envelope:{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext},
      expected_writer_generation:grant.writer_generation,expected_writer_grant_id:grant.grant_id,
    }
    await this.store.persistPreparedWriterGrantOperationBundle({
      rootKey:context.rootKey,epochSalt:context.epochSalt,expectedOperationGeneration:reconciled.operation_generation,
      reservation,envelope,operation,
    })
    await this.fault?.('after-prepared')
    return this.runOperation({...context,state:await this.store.loadState(context.rootKey,context.epochSalt,reconciled.epoch_id)},operation)
  }

  async adoptGrantedWriter():Promise<EpochLocalSecurityStateV6>{
    const context=await this.activeContext(),key=await this.localKey(context.state),fresh=await this.freshVerify(context)
    const remote=fresh.result.current_writer
    if(remote.writer_device_id!==context.state.writer_device_id||remote.writer_key_id!==context.state.writer_signing_key_id||remote.writer_public_key!==key.writer_public_key)throw new Error('Fresh canonical Writer authority does not grant this local device/key.')
    if(fresh.result.source_epoch_sealed||fresh.result.activation_state==='staged_confirmation_missing')throw new Error('Canonical epoch is not active for Writer adoption.')
    if(nonTerminalSecurityOperation(context.state,null))throw new Error('Writer adoption is blocked by another local security operation.')
    const state=await this.refreshLocal(context,fresh,true)
    if(state.writer_status!=='writer_active'||state.writer_generation!==remote.writer_generation||state.writer_grant_id!==remote.writer_grant_id)throw new Error('Writer adoption did not persist the canonical local authority.')
    return state
  }
}
