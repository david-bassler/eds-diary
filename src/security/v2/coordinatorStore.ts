import type { CoordinatorStore } from '../../sync/core/coordinator'
import { SINGLE_WRITER_V2_PROFILE, type RemoteAnchorState, type VerifiedRemoteState } from '../../sync/core/contracts'
import type { PreparedEnvelope } from '../envelopes'
import { IndexedDbV2LocalSecurityStore } from './localPersistence'
import { stateAfterCanonicalVerifyV6 } from './stateReconciliation'
import type { CanonicalFullResultV2 } from './verifier'

function canonical(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 coordinator store profile mismatch.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 coordinator store requires canonical_full verifier state.')
  return result
}

export class IndexedDbV2CoordinatorStore implements CoordinatorStore {
  constructor(
    private readonly epochId:string,
    private readonly rootKey:Uint8Array,
    private readonly epochSalt:Uint8Array,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
  ){}

  async readAnchor():Promise<RemoteAnchorState|null>{
    return (await this.store.loadState(this.rootKey,this.epochSalt,this.epochId)).remote_anchor
  }

  async generation():Promise<number>{
    return (await this.store.loadState(this.rootKey,this.epochSalt,this.epochId)).operation_generation
  }

  async pending(verified:VerifiedRemoteState):Promise<readonly PreparedEnvelope[]>{
    canonical(verified)
    await this.store.verifyLocalJournal(this.rootKey,this.epochSalt,this.epochId)
    const [outbox,envelopes]=await Promise.all([this.store.outbox(this.rootKey,this.epochSalt,this.epochId),this.store.envelopes(this.epochId)])
    const byId=new Map(envelopes.map(envelope=>[envelope.envelopeId,envelope]))
    const pending:PreparedEnvelope[]=[]
    for(const entry of outbox){
      // WriterGrant controls are ceremony-owned and deliberately persist with
      // authority=null. The generic domain coordinator must never push or
      // quarantine them; WriterHandoff/ForcedTakeover reconcile those exact
      // one-shot bytes under WriterGrantOperationStateV2.
      if(entry.authority===null||entry.ceremony_owner!==undefined)continue
      if(entry.status==='stale_writer_pending'||verified.staleWriterEnvelopeIds.has(entry.envelope_id))continue
      if(entry.status==='durable'&&verified.acceptedEnvelopeIds.has(entry.envelope_id))continue
      if(verified.acceptedEnvelopeIds.has(entry.envelope_id))continue
      const envelope=byId.get(entry.envelope_id)
      if(!envelope)throw new Error('V2 outbox references a missing immutable envelope.')
      pending.push(envelope)
    }
    return pending
  }

  async markPending(envelopeId:string,expectedGeneration:number):Promise<number>{
    return (await this.store.updateOutboxStatus(this.rootKey,this.epochSalt,this.epochId,envelopeId,expectedGeneration,'pending')).operation_generation
  }

  async quarantineStaleWriter(envelopeId:string,expectedGeneration:number):Promise<number>{
    return (await this.store.updateOutboxStatus(this.rootKey,this.epochSalt,this.epochId,envelopeId,expectedGeneration,'stale_writer_pending')).operation_generation
  }

  async commitVerifiedPull(verified:VerifiedRemoteState,anchor:RemoteAnchorState,expectedGeneration:number):Promise<number>{
    const remote=canonical(verified)
    if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE
      ||anchor.covered_row_count!==remote.remote_anchor.covered_row_count
      ||anchor.prefix_hash!==remote.remote_anchor.prefix_hash)throw new Error('V2 verified pull anchor mismatch.')
    const current=await this.store.loadState(this.rootKey,this.epochSalt,this.epochId)
    if(current.operation_generation!==expectedGeneration)throw new Error('Stale StateV6 generation before verified pull commit.')
    const keyUsable=await (async()=>{
      try{
        const key=await this.store.loadWriterKey(current.writer_signing_key_id,current.diary_id,current.epoch_id)
        return key!==null&&key.writer_device_id===current.writer_device_id
      }catch{return false}
    })()
    const next=await stateAfterCanonicalVerifyV6(current,remote,verified.snapshot.rows,keyUsable)
    const persisted=await this.store.commitVerifiedDispositions(
      this.rootKey,
      this.epochSalt,
      expectedGeneration,
      next,
      verified.acceptedEnvelopeIds,
      verified.staleWriterEnvelopeIds,
      {
        remote_rows:verified.snapshot.rows,
        current_writer:{
          writer_generation:remote.current_writer.writer_generation,
          writer_grant_id:remote.current_writer.writer_grant_id,
          writer_device_id:remote.current_writer.writer_device_id,
          writer_key_id:remote.current_writer.writer_key_id,
        },
        source_epoch_sealed:remote.source_epoch_sealed,
        recovery_rekey_rotation_required:remote.current_recovery.recovery_rekey_rotation_required,
      },
    )
    return persisted.operation_generation
  }
}
