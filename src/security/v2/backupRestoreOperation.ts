import { base64Url, fixedBase64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import type { SyncBackupV6 } from './backup'

export const BACKUP_RESTORE_STAGES_V2=[
  'verified',
  'local_bundle_persisted',
  'local_data_applied',
  'selected',
] as const
export type BackupRestoreStageV2=typeof BACKUP_RESTORE_STAGES_V2[number]

export interface BackupRestorePlanV2 {
  format:'backup-restore-plan-v2'
  version:2
  operation_id:string
  backup_id:string
  backup_sha256:string
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
  activation_state:'staged'|'activated'
}

export interface BackupRestoreCheckpointV2 {
  format:'backup-restore-checkpoint-v2'
  version:2
  operation_id:string
  plan_sha256:string
  stage:BackupRestoreStageV2
  prior_checkpoint_sha256:string|null
}

const PLAN_KEYS=[
  'format','version','operation_id','backup_id','backup_sha256',
  'diary_id','epoch_id','key_id','manifest_fingerprint','activation_state',
] as const
const CHECKPOINT_KEYS=[
  'format','version','operation_id','plan_sha256','stage','prior_checkpoint_sha256',
] as const

function exact(value:unknown,keys:readonly string[],label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`)
  const record=value as Record<string,unknown>
  if(Object.keys(record).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} has unknown or missing properties.`)
  return record
}

export function validateBackupRestorePlanV2(value:unknown):BackupRestorePlanV2{
  const plan=exact(value,PLAN_KEYS,'BackupRestorePlanV2')
  if(plan.format!=='backup-restore-plan-v2'||plan.version!==2)throw new Error('BackupRestorePlanV2 version mismatch.')
  for(const [key,bytes] of [
    ['operation_id',32],['backup_id',32],['backup_sha256',32],
    ['diary_id',16],['epoch_id',16],['key_id',16],['manifest_fingerprint',32],
  ] as const){
    if(typeof plan[key]!=='string')throw new Error(`BackupRestorePlanV2 ${key} is invalid.`)
    fixedBase64Url(plan[key] as string,bytes,key)
  }
  if(plan.activation_state!=='staged'&&plan.activation_state!=='activated')throw new Error('BackupRestorePlanV2 activation state is invalid.')
  return value as BackupRestorePlanV2
}

export function validateBackupRestoreCheckpointV2(value:unknown):BackupRestoreCheckpointV2{
  const checkpoint=exact(value,CHECKPOINT_KEYS,'BackupRestoreCheckpointV2')
  if(checkpoint.format!=='backup-restore-checkpoint-v2'||checkpoint.version!==2)throw new Error('BackupRestoreCheckpointV2 version mismatch.')
  if(typeof checkpoint.operation_id!=='string'||typeof checkpoint.plan_sha256!=='string')throw new Error('BackupRestoreCheckpointV2 identity is invalid.')
  fixedBase64Url(checkpoint.operation_id as string,32,'operation_id')
  fixedBase64Url(checkpoint.plan_sha256 as string,32,'plan_sha256')
  if(!BACKUP_RESTORE_STAGES_V2.includes(checkpoint.stage as BackupRestoreStageV2))throw new Error('BackupRestoreCheckpointV2 stage is invalid.')
  if(checkpoint.prior_checkpoint_sha256!==null){
    if(typeof checkpoint.prior_checkpoint_sha256!=='string')throw new Error('BackupRestoreCheckpointV2 prior hash is invalid.')
    fixedBase64Url(checkpoint.prior_checkpoint_sha256,32,'prior_checkpoint_sha256')
  }
  return value as BackupRestoreCheckpointV2
}

export async function backupRestorePlanHashV2(plan:BackupRestorePlanV2):Promise<string>{
  validateBackupRestorePlanV2(plan)
  return base64Url(await sha256(canonicalBytes(plan as never)))
}

export async function backupRestoreCheckpointHashV2(checkpoint:BackupRestoreCheckpointV2):Promise<string>{
  validateBackupRestoreCheckpointV2(checkpoint)
  return base64Url(await sha256(canonicalBytes(checkpoint as never)))
}

export async function backupDocumentHashV6(backup:SyncBackupV6):Promise<string>{
  return base64Url(await sha256(canonicalBytes(backup as never)))
}

export async function backupRestoreOperationIdV2(backup:SyncBackupV6):Promise<string>{
  const backupHash=await backupDocumentHashV6(backup)
  return base64Url(await sha256(canonicalBytes([
    'eds-diary/backup-restore/v2',backup.backup_id,backupHash,
  ] as never)))
}
