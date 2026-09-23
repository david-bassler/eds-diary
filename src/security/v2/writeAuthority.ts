import type { PreparedEnvelope } from '../envelopes'
import type { EpochLocalSecurityStateV6 } from './localState'
import type { PreparedEnvelopeAuthorityV2 } from './localPersistence'
import type { CanonicalFullResultV2 } from './verifier'
import { SINGLE_WRITER_V2_PROFILE, type VerifiedRemoteState, type WriteAccess, type WriteAuthority, type WritePushDecision, type WritePushPhase } from '../../sync/core/contracts'

function canonicalState(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 WriteAuthority profile mismatch.')
  const state=verified.profileState as CanonicalFullResultV2
  if(!state||state.kind!=='canonical_full'||state.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 WriteAuthority requires canonical_full verifier state.')
  return state
}

function sameAnchor(local:EpochLocalSecurityStateV6,remote:CanonicalFullResultV2):boolean{
  return !!local.remote_anchor
    && local.remote_anchor.anchor_profile===remote.remote_anchor.anchor_profile
    && local.remote_anchor.covered_row_count===remote.remote_anchor.covered_row_count
    && local.remote_anchor.prefix_hash===remote.remote_anchor.prefix_hash
}

function localWriterMatches(local:EpochLocalSecurityStateV6,remote:CanonicalFullResultV2):boolean{
  const writer=remote.current_writer
  return local.writer_status==='writer_active'
    && local.writer_device_id===writer.writer_device_id
    && local.writer_signing_key_id===writer.writer_key_id
    && local.writer_generation===writer.writer_generation
    && local.writer_grant_id===writer.writer_grant_id
    && local.verified_writer_device_id===writer.writer_device_id
    && local.verified_writer_key_id===writer.writer_key_id
    && local.verified_writer_generation===writer.writer_generation
    && local.verified_writer_grant_id===writer.writer_grant_id
}

function mutationBlocked(local:EpochLocalSecurityStateV6,remote:CanonicalFullResultV2):boolean{
  return local.diary_id!==remote.diary_id
    || local.epoch_id!==remote.epoch_id
    || local.manifest_fingerprint!==remote.manifest_fingerprint
    || local.epoch_status!=='active'
    || remote.activation_state==='staged_confirmation_missing'
    || remote.source_epoch_sealed
    || remote.current_recovery.recovery_rekey_rotation_required
    || local.recovery_rekey_rotation_required
    || local.rotation_state_ref!==null
    || local.migration_state_ref!==null
    || local.writer_operation_state_ref!==null
    || local.recovery_operation_state_ref!==null
    || !sameAnchor(local,remote)
    || !localWriterMatches(local,remote)
}

export class TransferableSingleWriterV2WriteAuthority implements WriteAuthority {
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  constructor(
    private readonly loadLocalState:()=>Promise<EpochLocalSecurityStateV6>|EpochLocalSecurityStateV6,
    private readonly loadEnvelopeAuthority:(envelope:PreparedEnvelope)=>Promise<PreparedEnvelopeAuthorityV2|null>|PreparedEnvelopeAuthorityV2|null,
  ){}

  private async access(verified:VerifiedRemoteState):Promise<WriteAccess>{
    const remote=canonicalState(verified),local=await this.loadLocalState()
    return mutationBlocked(local,remote)?'read_only':'writer'
  }

  async accessAfterPull(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.access(verified)}
  async canPrepareDomainWrite(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.access(verified)}

  async verifyBeforePush(envelope:PreparedEnvelope,verified:VerifiedRemoteState,_phase:WritePushPhase):Promise<WritePushDecision>{
    if(!envelope.envelopeId||!envelope.iv||!envelope.ciphertext)throw new Error('Prepared envelope is incomplete.')
    const remote=canonicalState(verified),local=await this.loadLocalState(),prepared=await this.loadEnvelopeAuthority(envelope)
    if(!prepared)return 'quarantine_stale_writer'
    if(mutationBlocked(local,remote))return 'quarantine_stale_writer'
    const current=remote.current_writer
    if(prepared.writer_generation!==current.writer_generation
      ||prepared.writer_grant_id!==current.writer_grant_id
      ||prepared.writer_device_id!==current.writer_device_id
      ||prepared.writer_key_id!==current.writer_key_id)return 'quarantine_stale_writer'
    return 'push'
  }

  async accessAfterReadback(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.access(verified)}
}

export function v2VerifiedRemoteState(result:CanonicalFullResultV2,snapshot:VerifiedRemoteState['snapshot']):VerifiedRemoteState{
  return {
    profileId:SINGLE_WRITER_V2_PROFILE,
    profileState:result,
    snapshot,
    manifestFingerprint:result.manifest_fingerprint,
    retired:result.source_epoch_sealed,
    verifiedEnvelopeIds:result.verified_envelope_ids,
    acceptedEnvelopeIds:result.accepted_envelope_ids,
    staleWriterEnvelopeIds:result.stale_writer_envelope_ids,
  }
}
