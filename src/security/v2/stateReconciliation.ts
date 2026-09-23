import { recoveryCredentialHistoryHashV2, type EpochLocalSecurityStateV6 } from './localState'
import type { CanonicalFullResultV2 } from './verifier'
import { assertExtendsAnchorV2, createAnchorV2 } from './prefix'

function sameLocalWriter(state:EpochLocalSecurityStateV6,result:CanonicalFullResultV2,writerKeyUsable:boolean):boolean{
  return writerKeyUsable
    && result.activation_state!=='staged_confirmation_missing'
    && state.epoch_status==='active'
    && state.writer_device_id===result.current_writer.writer_device_id
    && state.writer_signing_key_id===result.current_writer.writer_key_id
}

export async function stateAfterCanonicalVerifyV6(
  current:EpochLocalSecurityStateV6,
  result:CanonicalFullResultV2,
  rows:ReadonlyArray<readonly string[]>,
  writerKeyUsable:boolean,
):Promise<EpochLocalSecurityStateV6>{
  if(current.diary_id!==result.diary_id||current.epoch_id!==result.epoch_id||current.manifest_fingerprint!==result.manifest_fingerprint)throw new Error('Canonical verify does not match local epoch identity.')
  if(current.epoch_status==='orphaned'&&sameLocalWriter(current,result,writerKeyUsable))throw new Error('Orphaned epoch must never regain writer authority.')
  await assertExtendsAnchorV2(current.remote_anchor,current.diary_id,current.epoch_id,rows)
  const reproduced=await createAnchorV2(current.diary_id,current.epoch_id,rows)
  if(reproduced.covered_row_count!==result.remote_anchor.covered_row_count||reproduced.prefix_hash!==result.remote_anchor.prefix_hash)throw new Error('Canonical verify anchor does not match its remote snapshot.')

  const writerActive=sameLocalWriter(current,result,writerKeyUsable)
  return {
    ...current,
    operation_generation:current.operation_generation+1,
    remote_anchor:{...result.remote_anchor},
    recovery_generation:result.current_recovery.recovery_generation,
    recovery_urs_commitment:result.current_recovery.recovery_urs_commitment,
    recovery_urs_id:result.current_recovery.recovery_urs_id,
    recovery_rekey_rotation_required:result.current_recovery.recovery_rekey_rotation_required,
    recovery_rekey_transition_id:result.current_recovery.recovery_rekey_transition_id,
    recovery_takeover_key_id:result.current_recovery.recovery_takeover_key_id,
    recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(result.recovery_credential_history),
    verified_writer_device_id:result.current_writer.writer_device_id,
    verified_writer_key_id:result.current_writer.writer_key_id,
    verified_writer_generation:result.current_writer.writer_generation,
    verified_writer_grant_id:result.current_writer.writer_grant_id,
    writer_status:writerActive?'writer_active':'read_only',
    writer_generation:writerActive?result.current_writer.writer_generation:null,
    writer_grant_id:writerActive?result.current_writer.writer_grant_id:null,
  }
}
