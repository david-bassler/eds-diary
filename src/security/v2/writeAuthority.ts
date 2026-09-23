import { SINGLE_WRITER_V2_PROFILE, type VerifiedRemoteState, type WriteAccess, type WriteAuthority, type WritePushDecision, type WritePushPhase } from '../../sync/core/contracts'
import type { PreparedEnvelope } from '../envelopes'
import { fixedBase64Url } from '../crypto/bytes'
import { revisionSigningBytesV2, verifyEd25519V2 } from './crypto'
import {
  hasBlockingNormalWriteOperationV2,
  recoveryCredentialHistoryHashV2,
  validateEpochLocalSecurityStateV6,
  type EpochLocalSecurityStateV6,
} from './localState'
import type { RevisionV2 } from './types'
import type { CanonicalFullResultV2, WriterAuthoritySnapshotV2 } from './verifier'
import { assertExtendsAnchorV2, createAnchorV2 } from './prefix'

function canonicalFull(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Verified remote state is not the v2 profile.')
  const profile=verified.profileState as Partial<CanonicalFullResultV2>|null
  if(!profile||profile.kind!=='canonical_full'||profile.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('v2 WriteAuthority requires canonical_full verifier state.')
  const canonical=profile as CanonicalFullResultV2
  if(verified.manifestFingerprint!==canonical.manifest_fingerprint)throw new Error('Verified v2 manifest fingerprint mismatch.')
  const physicalIds=new Set(verified.snapshot.rows.map(row=>row[0]??''))
  if(physicalIds.size!==verified.verifiedEnvelopeIds.size||[...physicalIds].some(id=>!verified.verifiedEnvelopeIds.has(id)))throw new Error('Verified v2 physical envelope set mismatch.')
  if([...verified.acceptedEnvelopeIds].some(id=>!verified.verifiedEnvelopeIds.has(id))||[...verified.staleWriterEnvelopeIds].some(id=>!verified.verifiedEnvelopeIds.has(id)||verified.acceptedEnvelopeIds.has(id)))throw new Error('Verified v2 semantic envelope sets are inconsistent.')
  const sameSet=(left:ReadonlySet<string>,right:ReadonlySet<string>)=>left.size===right.size&&[...left].every(id=>right.has(id))
  if(!sameSet(verified.verifiedEnvelopeIds,canonical.verified_envelope_ids)
    ||!sameSet(verified.acceptedEnvelopeIds,canonical.accepted_envelope_ids)
    ||!sameSet(verified.staleWriterEnvelopeIds,canonical.stale_writer_envelope_ids))throw new Error('Generic and canonical v2 envelope dispositions diverge.')
  if(verified.retired!==canonical.source_epoch_sealed)throw new Error('Generic and canonical v2 seal/retirement state diverge.')
  return canonical
}

function sameWriter(authority:WriterAuthoritySnapshotV2,state:EpochLocalSecurityStateV6):boolean{
  return authority.writer_device_id===state.writer_device_id
    && authority.writer_key_id===state.writer_signing_key_id
    && authority.writer_generation===state.writer_generation
    && authority.writer_grant_id===state.writer_grant_id
}

function sameRevisionWriter(revision:RevisionV2,authority:WriterAuthoritySnapshotV2):boolean{
  const context=revision.writer_context
  return !!context
    && context.writer_device_id===authority.writer_device_id
    && context.writer_key_id===authority.writer_key_id
    && context.writer_generation===authority.writer_generation
    && context.writer_grant_id===authority.writer_grant_id
}

function assertBoundIdentity(state:EpochLocalSecurityStateV6,canonical:CanonicalFullResultV2):void{
  if(state.diary_id!==canonical.diary_id||state.epoch_id!==canonical.epoch_id||state.manifest_fingerprint!==canonical.manifest_fingerprint)throw new Error('Canonical v2 verifier state does not match local epoch identity.')
}

export async function reconcileLocalStateFromCanonicalV2(
  state:EpochLocalSecurityStateV6,
  verified:VerifiedRemoteState,
  writerKeyUsable:boolean,
):Promise<EpochLocalSecurityStateV6>{
  validateEpochLocalSecurityStateV6(state)
  const canonical=canonicalFull(verified)
  assertBoundIdentity(state,canonical)
  await assertExtendsAnchorV2(state.remote_anchor,state.diary_id,state.epoch_id,verified.snapshot.rows)
  const recomputedAnchor=await createAnchorV2(state.diary_id,state.epoch_id,verified.snapshot.rows)
  if(recomputedAnchor.covered_row_count!==canonical.remote_anchor.covered_row_count||recomputedAnchor.prefix_hash!==canonical.remote_anchor.prefix_hash)throw new Error('Canonical v2 anchor does not match the verified physical snapshot.')
  if(state.epoch_status==='active'&&canonical.activation_state==='staged_confirmation_missing')throw new Error('An active local epoch cannot reconcile to an unconfirmed staged successor.')
  if(state.epoch_status==='active'&&canonical.accepted_epoch_migration!==null&&state.activation_lineage_cache_ref===null)throw new Error('An active non-native v2 epoch requires its authenticated ActivationLineage cache.')
  const current=canonical.current_writer
  const localOwnsCurrent=writerKeyUsable
    && !canonical.source_epoch_sealed
    && canonical.activation_state!=='staged_confirmation_missing'
    && state.writer_device_id===current.writer_device_id
    && state.writer_signing_key_id===current.writer_key_id
    && state.epoch_status==='active'
  const writerStatus=localOwnsCurrent?'writer_active' as const:'read_only' as const
  const next:EpochLocalSecurityStateV6={
    ...state,
    remote_anchor:canonical.remote_anchor,
    recovery_generation:canonical.current_recovery.recovery_generation,
    recovery_urs_commitment:canonical.current_recovery.recovery_urs_commitment,
    recovery_urs_id:canonical.current_recovery.recovery_urs_id,
    recovery_rekey_rotation_required:canonical.current_recovery.recovery_rekey_rotation_required,
    recovery_rekey_transition_id:canonical.current_recovery.recovery_rekey_transition_id,
    recovery_takeover_key_id:canonical.current_recovery.recovery_takeover_key_id,
    recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(canonical.recovery_credential_history),
    writer_status:writerStatus,
    writer_generation:writerStatus==='writer_active'?current.writer_generation:null,
    writer_grant_id:writerStatus==='writer_active'?current.writer_grant_id:null,
    verified_writer_device_id:current.writer_device_id,
    verified_writer_key_id:current.writer_key_id,
    verified_writer_generation:current.writer_generation,
    verified_writer_grant_id:current.writer_grant_id,
    operation_generation:state.operation_generation+1,
  }
  return validateEpochLocalSecurityStateV6(next)
}

export interface TransferableWriterAuthorityV2Dependencies {
  readLocalState():Promise<EpochLocalSecurityStateV6>
  inspectPreparedRevision(envelope:PreparedEnvelope):Promise<RevisionV2>
}

export class TransferableWriterAuthorityV2 implements WriteAuthority {
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  constructor(private readonly dependencies:TransferableWriterAuthorityV2Dependencies){}

  private async localAccess(verified:VerifiedRemoteState,normalDomainWrite:boolean):Promise<WriteAccess>{
    const canonical=canonicalFull(verified),state=validateEpochLocalSecurityStateV6(await this.dependencies.readLocalState())
    assertBoundIdentity(state,canonical)
    if(state.epoch_status==='active'&&canonical.activation_state==='staged_confirmation_missing')throw new Error('Active StateV6 conflicts with an unconfirmed staged successor.')
    if(state.epoch_status==='active'&&canonical.accepted_epoch_migration!==null&&state.activation_lineage_cache_ref===null)throw new Error('Active non-native StateV6 lacks its ActivationLineage cache binding.')
    if(state.epoch_status!=='active'||state.writer_status!=='writer_active')return'read_only'
    if(canonical.source_epoch_sealed||state.verified_writer_device_id===null||state.verified_writer_key_id===null||state.verified_writer_generation===null||state.verified_writer_grant_id===null)return'read_only'
    if(!sameWriter(canonical.current_writer,state))return'read_only'
    if(normalDomainWrite&&(canonical.current_recovery.recovery_rekey_rotation_required||state.recovery_rekey_rotation_required||hasBlockingNormalWriteOperationV2(state)))return'read_only'
    if(canonical.current_recovery.recovery_generation!==state.recovery_generation
      ||canonical.current_recovery.recovery_urs_id!==state.recovery_urs_id
      ||canonical.current_recovery.recovery_takeover_key_id!==state.recovery_takeover_key_id
      ||canonical.current_recovery.recovery_rekey_rotation_required!==state.recovery_rekey_rotation_required
      ||canonical.current_recovery.recovery_rekey_transition_id!==state.recovery_rekey_transition_id)throw new Error('Local StateV6 recovery cache is not reconciled to the supplied canonical verification.')
    return'writer'
  }

  accessAfterPull(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.localAccess(verified,false)}
  canPrepareDomainWrite(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.localAccess(verified,true)}

  async verifyBeforePush(envelope:PreparedEnvelope,verified:VerifiedRemoteState,_phase:WritePushPhase):Promise<WritePushDecision>{
    const canonical=canonicalFull(verified),state=validateEpochLocalSecurityStateV6(await this.dependencies.readLocalState())
    assertBoundIdentity(state,canonical)
    const revision=await this.dependencies.inspectPreparedRevision(envelope)
    if(revision.record_status==='control')throw new Error('V2-03 WriteAuthority only authorizes normal domain envelopes; control services have separate gates.')
    if(!revision.writer_context||!revision.writer_signature)throw new Error('Prepared v2 domain envelope is missing Writer provenance.')
    const publicKey=fixedBase64Url(canonical.current_writer.writer_public_key,32,'writer_public_key')
    if(!await verifyEd25519V2(publicKey,revision.writer_signature,revisionSigningBytesV2(canonical.diary_id,canonical.epoch_id,revision)))return'quarantine_stale_writer'
    if(canonical.source_epoch_sealed||canonical.current_recovery.recovery_rekey_rotation_required||state.recovery_rekey_rotation_required||hasBlockingNormalWriteOperationV2(state))return'quarantine_stale_writer'
    if(state.epoch_status!=='active'||state.writer_status!=='writer_active'||!sameWriter(canonical.current_writer,state)||!sameRevisionWriter(revision,canonical.current_writer))return'quarantine_stale_writer'
    return'push'
  }

  accessAfterReadback(verified:VerifiedRemoteState):Promise<WriteAccess>{return this.localAccess(verified,false)}
}

export function canonicalV2ProfileState(verified:VerifiedRemoteState):CanonicalFullResultV2{return canonicalFull(verified)}
