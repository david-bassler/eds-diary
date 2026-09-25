import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { PreparedEnvelopeRowV2 } from './recovery'
import type { RemoteAnchorV2 } from './types'

export const RECOVERY_REKEY_STAGES_V2=[
  'new_material_staged','recovery_artifact_published','transition_pending','transition_unknown',
  'transition_durable','source_backup_verified','successor_rotation_required','completed','stale','superseded',
] as const
export type RecoveryRekeyStageV2=typeof RECOVERY_REKEY_STAGES_V2[number]
export type RecoveryRekeyOperationOriginV2='local_rekey'|'remote_pending_rekey_adoption'

export interface RecoveryRekeyOperationStateV2 {
  format:'recovery-rekey-operation-v2'
  version:2
  operation_id:string
  operation_origin:RecoveryRekeyOperationOriginV2
  supersedes_transition_id:string|null
  superseded_by_transition_id:string|null
  epoch_id:string
  stage:RecoveryRekeyStageV2
  authority_anchor_before_transition:RemoteAnchorV2
  transition_id:string
  transition_envelope:PreparedEnvelopeRowV2
  recovery_artifact_id:string
  recovery_artifact_locator:string
  recovery_artifact_sha256:string
  artifact_publish_attempted:boolean
  transition_proof_sha256:string
  to_recovery_generation:number
  to_recovery_urs_commitment:string
  to_recovery_urs_id:string
  to_recovery_takeover_key_id:string
  completed_successor_epoch_id:string|null
  completed_successor_manifest_fingerprint:string|null
}

const KEYS=[
  'format','version','operation_id','operation_origin','supersedes_transition_id','superseded_by_transition_id',
  'epoch_id','stage','authority_anchor_before_transition','transition_id','transition_envelope',
  'recovery_artifact_id','recovery_artifact_locator','recovery_artifact_sha256','artifact_publish_attempted',
  'transition_proof_sha256','to_recovery_generation','to_recovery_urs_commitment','to_recovery_urs_id',
  'to_recovery_takeover_key_id','completed_successor_epoch_id','completed_successor_manifest_fingerprint',
] as const

function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function validateAnchor(anchor:RemoteAnchorV2):void{
  if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE||!Number.isSafeInteger(anchor.covered_row_count)||anchor.covered_row_count<0)throw new Error('RecoveryRekeyOperationStateV2 anchor mismatch.')
  fixedBase64Url(anchor.prefix_hash,32,'authority_anchor_before_transition.prefix_hash')
}
function validateRow(row:PreparedEnvelopeRowV2):void{
  if(!row||typeof row!=='object')throw new Error('RecoveryRekeyOperationStateV2 transition row mismatch.')
  exact(row,['envelope_id','iv','ciphertext'],'RecoveryRekeyOperationStateV2 transition row')
  fixedBase64Url(row.envelope_id,32,'transition_envelope.envelope_id')
  fixedBase64Url(row.iv,12,'transition_envelope.iv')
  if(fromBase64Url(row.ciphertext).byteLength<16)throw new Error('RecoveryRekeyOperationStateV2 transition ciphertext mismatch.')
}
function canonicalEqual(left:unknown,right:unknown):boolean{
  return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))
}

export function validateRecoveryRekeyOperationStateV2(value:RecoveryRekeyOperationStateV2):RecoveryRekeyOperationStateV2{
  if(!value||typeof value!=='object')throw new Error('RecoveryRekeyOperationStateV2 schema mismatch.')
  exact(value,KEYS,'RecoveryRekeyOperationStateV2')
  if(value.format!=='recovery-rekey-operation-v2'||value.version!==2||!['local_rekey','remote_pending_rekey_adoption'].includes(value.operation_origin)||!RECOVERY_REKEY_STAGES_V2.includes(value.stage))throw new Error('RecoveryRekeyOperationStateV2 profile mismatch.')
  fixedBase64Url(value.operation_id,32,'operation_id');fixedBase64Url(value.epoch_id,16,'epoch_id');fixedBase64Url(value.transition_id,32,'transition_id')
  if(value.supersedes_transition_id!==null)fixedBase64Url(value.supersedes_transition_id,32,'supersedes_transition_id')
  if(value.superseded_by_transition_id!==null)fixedBase64Url(value.superseded_by_transition_id,32,'superseded_by_transition_id')
  if(value.supersedes_transition_id===value.transition_id||value.superseded_by_transition_id===value.transition_id)throw new Error('RecoveryRekeyOperationStateV2 self-supersession is forbidden.')
  validateAnchor(value.authority_anchor_before_transition);validateRow(value.transition_envelope)
  fixedBase64Url(value.recovery_artifact_id,16,'recovery_artifact_id')
  fixedBase64Url(value.recovery_artifact_locator,16,'recovery_artifact_locator')
  fixedBase64Url(value.recovery_artifact_sha256,32,'recovery_artifact_sha256')
  fixedBase64Url(value.transition_proof_sha256,32,'transition_proof_sha256')
  if(typeof value.artifact_publish_attempted!=='boolean')throw new Error('RecoveryRekeyOperationStateV2 artifact_publish_attempted mismatch.')
  if(!Number.isSafeInteger(value.to_recovery_generation)||value.to_recovery_generation<1)throw new Error('RecoveryRekeyOperationStateV2 recovery generation mismatch.')
  fixedBase64Url(value.to_recovery_urs_commitment,32,'to_recovery_urs_commitment');fixedBase64Url(value.to_recovery_urs_id,32,'to_recovery_urs_id');fixedBase64Url(value.to_recovery_takeover_key_id,32,'to_recovery_takeover_key_id')
  if(value.completed_successor_epoch_id!==null)fixedBase64Url(value.completed_successor_epoch_id,16,'completed_successor_epoch_id')
  if(value.completed_successor_manifest_fingerprint!==null)fixedBase64Url(value.completed_successor_manifest_fingerprint,32,'completed_successor_manifest_fingerprint')
  if((value.completed_successor_epoch_id===null)!==(value.completed_successor_manifest_fingerprint===null))throw new Error('RecoveryRekeyOperationStateV2 completed successor binding mismatch.')
  if(value.stage==='completed'){
    if(value.completed_successor_epoch_id===null)throw new Error('RecoveryRekeyOperationStateV2 completed successor is missing.')
  }else if(value.completed_successor_epoch_id!==null)throw new Error('RecoveryRekeyOperationStateV2 successor fields are only valid at completed.')
  if(value.stage==='superseded'){
    if(value.superseded_by_transition_id===null)throw new Error('Superseded RecoveryRekeyOperationStateV2 requires superseded_by_transition_id.')
  }else if(value.superseded_by_transition_id!==null)throw new Error('Only a superseded RecoveryRekeyOperationStateV2 may bind superseded_by_transition_id.')
  if(value.operation_origin==='remote_pending_rekey_adoption'){
    if(value.supersedes_transition_id!==null||!value.artifact_publish_attempted)throw new Error('Remote pending-Rekey adoption invariants failed.')
    if(['new_material_staged','recovery_artifact_published','transition_pending','transition_unknown','stale'].includes(value.stage))throw new Error('Remote pending-Rekey adoption must start from durable transition evidence.')
  }
  if(value.stage!=='new_material_staged'&&!value.artifact_publish_attempted)throw new Error('RecoveryRekeyOperationStateV2 publish-attempt fence is missing.')
  return value
}

const ALLOWED=new Set([
  'new_material_staged->recovery_artifact_published','new_material_staged->stale',
  'recovery_artifact_published->transition_pending','recovery_artifact_published->stale',
  'transition_pending->transition_unknown','transition_pending->transition_durable','transition_pending->stale',
  'transition_unknown->transition_durable','transition_unknown->stale',
  'transition_durable->source_backup_verified','source_backup_verified->successor_rotation_required',
  'successor_rotation_required->completed',
  'transition_durable->superseded','source_backup_verified->superseded','successor_rotation_required->superseded',
])
const IMMUTABLE=[
  'operation_id','operation_origin','supersedes_transition_id','epoch_id','authority_anchor_before_transition',
  'transition_id','transition_envelope','recovery_artifact_id','recovery_artifact_locator','recovery_artifact_sha256',
  'transition_proof_sha256','to_recovery_generation','to_recovery_urs_commitment','to_recovery_urs_id','to_recovery_takeover_key_id',
] as const
export function advanceRecoveryRekeyOperationStateV2(current:RecoveryRekeyOperationStateV2,next:RecoveryRekeyOperationStateV2):RecoveryRekeyOperationStateV2{
  validateRecoveryRekeyOperationStateV2(current);validateRecoveryRekeyOperationStateV2(next)
  const edge=`${current.stage}->${next.stage}`
  if(!ALLOWED.has(edge))throw new Error(`Illegal RecoveryRekeyOperationStateV2 transition: ${edge}.`)
  for(const field of IMMUTABLE)if(!canonicalEqual(current[field],next[field]))throw new Error(`RecoveryRekeyOperationStateV2 immutable field changed: ${field}.`)
  if(current.artifact_publish_attempted&&!next.artifact_publish_attempted)throw new Error('RecoveryRekeyOperationStateV2 publish-attempt fence cannot be cleared.')
  if(current.stage!=='superseded'&&next.stage!=='superseded'&&next.superseded_by_transition_id!==null)throw new Error('RecoveryRekeyOperationStateV2 supersession binding is premature.')
  return next
}
export async function recoveryRekeyOperationStateHashV2(state:RecoveryRekeyOperationStateV2):Promise<string>{
  validateRecoveryRekeyOperationStateV2(state)
  return base64Url(await sha256(canonicalBytes(state as never)))
}
