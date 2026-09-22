import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE, type RemoteAnchorState } from '../../sync/core/contracts'
import { fixedBase64Url } from '../crypto/bytes'
import { recoveryTakeoverKeyIdV2, transferDescriptorPopBytesV2, verifyEd25519V2, writerKeyIdV2 } from './crypto'
import {
  V2_RECORD_SCHEMA_BY_TYPE,
  type EpochMigrationV2,
  type RecoveryAuthorityTransitionV2,
  type RemoteAnchorV2,
  type RevisionV2,
  type RotationAnnouncementV2,
  type SourceWriterAuthorityV2,
  type SuccessorActivationConfirmationV2,
  type TransferDescriptorV2,
  type WriterContextV2,
  type WriterGrantV2,
  type V2RecordType,
} from './types'

const MAX_SAFE = Number.MAX_SAFE_INTEGER
const MAX_PARENTS = 8
const MAX_PER_RECORD = 4096
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function canonicalTimestampV2(value:unknown,label:string):string{
  if(typeof value!=='string'||!CREATED_AT.test(value))throw new Error(`Invalid ${label}.`)
  const parsed=new Date(value)
  if(Number.isNaN(parsed.valueOf())||parsed.toISOString()!==value)throw new Error(`Invalid ${label}.`)
  return value
}

function object(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`)
  return value as Record<string,unknown>
}
function exact(value:Record<string,unknown>,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} has unknown or missing properties.`)
}
function safeInteger(value:unknown,min:number,label:string):number{
  if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>MAX_SAFE)throw new Error(`${label} is outside the safe-integer protocol range.`)
  return Number(value)
}
function id(value:unknown,bytes:number,label:string):string{
  if(typeof value!=='string')throw new Error(`${label} must be a string.`)
  fixedBase64Url(value,bytes,label)
  return value
}
function nullableId(value:unknown,bytes:number,label:string):string|null{
  if(value===null)return null
  return id(value,bytes,label)
}
function oneOf<T extends string>(value:unknown,allowed:readonly T[],label:string):T{
  if(typeof value!=='string'||!allowed.includes(value as T))throw new Error(`${label} is invalid.`)
  return value as T
}
function validateAnchorShape(value:unknown,profiles:readonly string[],label:string):RemoteAnchorState{
  const anchor=object(value,label);exact(anchor,['anchor_profile','covered_row_count','prefix_hash'],label)
  if(typeof anchor.anchor_profile!=='string'||!profiles.includes(anchor.anchor_profile))throw new Error(`${label}.anchor_profile is invalid.`)
  safeInteger(anchor.covered_row_count,0,`${label}.covered_row_count`);id(anchor.prefix_hash,32,`${label}.prefix_hash`)
  return value as RemoteAnchorState
}
export function validateRemoteAnchorV2(value:unknown,label='authority_anchor'):RemoteAnchorV2{
  return validateAnchorShape(value,[SINGLE_WRITER_V2_PROFILE],label) as RemoteAnchorV2
}
export function validateWriterContextV2(value:unknown):WriterContextV2{
  const context=object(value,'writer_context');exact(context,['writer_generation','writer_grant_id','writer_device_id','writer_key_id'],'writer_context')
  safeInteger(context.writer_generation,1,'writer_context.writer_generation');id(context.writer_grant_id,32,'writer_context.writer_grant_id');id(context.writer_device_id,16,'writer_context.writer_device_id');id(context.writer_key_id,32,'writer_context.writer_key_id')
  return value as WriterContextV2
}
function compareBytes(left:Uint8Array,right:Uint8Array):number{
  const length=Math.min(left.byteLength,right.byteLength)
  for(let index=0;index<length;index+=1)if(left[index]!==right[index])return left[index]!-right[index]!
  return left.byteLength-right.byteLength
}
function validateMigrationOrigin(value:unknown):void{
  if(value===null)return
  const origin=object(value,'migration_origin');exact(origin,['sources'],'migration_origin')
  if(!Array.isArray(origin.sources)||origin.sources.length<1||origin.sources.length>8)throw new Error('migration_origin.sources is invalid.')
  let previousSourceKey:Uint8Array|null=null
  const seenSources=new Set<string>()
  for(const [index,entry] of origin.sources.entries()){
    const source=object(entry,`migration_origin.sources[${index}]`);exact(source,['source_epoch_id','source_record_id','source_revision_ids'],`migration_origin.sources[${index}]`)
    const epochBytes=fixedBase64Url(id(source.source_epoch_id,16,'source_epoch_id'),16,'source_epoch_id')
    const recordBytes=fixedBase64Url(id(source.source_record_id,16,'source_record_id'),16,'source_record_id')
    const sourceKey=new Uint8Array(epochBytes.byteLength+recordBytes.byteLength);sourceKey.set(epochBytes);sourceKey.set(recordBytes,epochBytes.byteLength)
    const sourceIdentity=`${source.source_epoch_id}\0${source.source_record_id}`
    if(seenSources.has(sourceIdentity))throw new Error('migration_origin sources must be unique.')
    if(previousSourceKey!==null&&compareBytes(previousSourceKey,sourceKey)>=0)throw new Error('migration_origin sources must be byte-sorted.')
    seenSources.add(sourceIdentity);previousSourceKey=sourceKey
    if(!Array.isArray(source.source_revision_ids)||source.source_revision_ids.length<1||source.source_revision_ids.length>8||new Set(source.source_revision_ids).size!==source.source_revision_ids.length)throw new Error('migration_origin source_revision_ids are invalid.')
    let previousRevision:Uint8Array|null=null
    for(const revisionId of source.source_revision_ids){
      const revisionBytes=fixedBase64Url(id(revisionId,32,'source_revision_id'),32,'source_revision_id')
      if(previousRevision!==null&&compareBytes(previousRevision,revisionBytes)>=0)throw new Error('migration_origin source_revision_ids must be byte-sorted.')
      previousRevision=revisionBytes
    }
  }
}

export function validateTransferDescriptorV2(value:unknown):TransferDescriptorV2{
  const descriptor=object(value,'TransferDescriptorV2');exact(descriptor,['format','version','sync_profile','diary_id','epoch_id','writer_device_id','writer_key_id','writer_public_key','nonce','possession_signature'],'TransferDescriptorV2')
  if(descriptor.format!=='eds-writer-transfer-v2'||descriptor.version!==2||descriptor.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('TransferDescriptorV2 profile mismatch.')
  id(descriptor.diary_id,16,'diary_id');id(descriptor.epoch_id,16,'epoch_id');id(descriptor.writer_device_id,16,'writer_device_id');id(descriptor.writer_key_id,32,'writer_key_id');id(descriptor.writer_public_key,32,'writer_public_key');id(descriptor.nonce,32,'nonce');id(descriptor.possession_signature,64,'possession_signature')
  return value as unknown as TransferDescriptorV2
}
export async function verifyTransferDescriptorV2(value:unknown):Promise<TransferDescriptorV2>{
  const descriptor=validateTransferDescriptorV2(value),publicKey=fixedBase64Url(descriptor.writer_public_key,32,'writer_public_key')
  if(await writerKeyIdV2(publicKey)!==descriptor.writer_key_id)throw new Error('TransferDescriptorV2 writer_key_id does not match writer_public_key.')
  const core:Omit<TransferDescriptorV2,'possession_signature'>={format:descriptor.format,version:descriptor.version,sync_profile:descriptor.sync_profile,diary_id:descriptor.diary_id,epoch_id:descriptor.epoch_id,writer_device_id:descriptor.writer_device_id,writer_key_id:descriptor.writer_key_id,writer_public_key:descriptor.writer_public_key,nonce:descriptor.nonce}
  if(!await verifyEd25519V2(publicKey,descriptor.possession_signature,transferDescriptorPopBytesV2(core)))throw new Error('TransferDescriptorV2 possession signature failed.')
  return descriptor
}

export async function validateWriterGrantV2(value:unknown):Promise<WriterGrantV2>{
  const grant=object(value,'WriterGrantV2');exact(grant,['grant_id','writer_generation','writer_device_id','writer_key_id','writer_public_key','previous_grant_id','previous_writer_generation','recovery_generation','reason','authority_anchor','authorization'],'WriterGrantV2')
  id(grant.grant_id,32,'grant_id');const generation=safeInteger(grant.writer_generation,1,'writer_generation');id(grant.writer_device_id,16,'writer_device_id');const keyId=id(grant.writer_key_id,32,'writer_key_id'),publicKey=id(grant.writer_public_key,32,'writer_public_key');nullableId(grant.previous_grant_id,32,'previous_grant_id');const previous=safeInteger(grant.previous_writer_generation,0,'previous_writer_generation');safeInteger(grant.recovery_generation,0,'recovery_generation');const reason=oneOf(grant.reason,['initial','handoff','forced_takeover'] as const,'reason'),authorityAnchor=validateRemoteAnchorV2(grant.authority_anchor)
  if(await writerKeyIdV2(fixedBase64Url(publicKey,32,'writer_public_key'))!==keyId)throw new Error('writer_key_id does not match writer_public_key.')
  const authorization=object(grant.authorization,'authorization');exact(authorization,['kind','signer_key_id','signature'],'authorization');const kind=oneOf(authorization.kind,['manifest_genesis','writer_handoff','recovery_takeover'] as const,'authorization.kind');const signer=nullableId(authorization.signer_key_id,32,'authorization.signer_key_id'),signature=nullableId(authorization.signature,64,'authorization.signature')
  if(reason==='initial'){
    if(generation!==1||grant.previous_grant_id!==null||previous!==0||kind!=='manifest_genesis'||signer!==null||signature!==null||authorityAnchor.covered_row_count!==0)throw new Error('Initial WriterGrantV2 invariants failed.')
  }else{
    if(generation<2||grant.previous_grant_id===null||previous!==generation-1||signer===null||signature===null)throw new Error('Non-genesis WriterGrantV2 predecessor invariants failed.')
    if(reason==='handoff'&&kind!=='writer_handoff')throw new Error('Handoff grant authorization kind mismatch.')
    if(reason==='forced_takeover'&&kind!=='recovery_takeover')throw new Error('Forced-takeover authorization kind mismatch.')
  }
  return value as unknown as WriterGrantV2
}

export async function validateRecoveryAuthorityTransitionV2(value:unknown):Promise<RecoveryAuthorityTransitionV2>{
  const transition=object(value,'RecoveryAuthorityTransitionV2');exact(transition,['transition_id','transition_kind','from_recovery_generation','from_recovery_urs_id','from_recovery_takeover_key_id','to_recovery_generation','to_recovery_urs_commitment','to_recovery_urs_id','to_recovery_takeover_key_id','to_recovery_takeover_public_key','authority_anchor'],'RecoveryAuthorityTransitionV2')
  id(transition.transition_id,32,'transition_id');if(transition.transition_kind!=='recovery_rekey')throw new Error('transition_kind must be recovery_rekey.')
  const from=safeInteger(transition.from_recovery_generation,0,'from_recovery_generation'),to=safeInteger(transition.to_recovery_generation,1,'to_recovery_generation');if(to!==from+1)throw new Error('Recovery transition generation must increase exactly by one.')
  const fromUrs=id(transition.from_recovery_urs_id,32,'from_recovery_urs_id'),fromTakeover=id(transition.from_recovery_takeover_key_id,32,'from_recovery_takeover_key_id');id(transition.to_recovery_urs_commitment,32,'to_recovery_urs_commitment');const toUrs=id(transition.to_recovery_urs_id,32,'to_recovery_urs_id'),keyId=id(transition.to_recovery_takeover_key_id,32,'to_recovery_takeover_key_id'),publicKey=id(transition.to_recovery_takeover_public_key,32,'to_recovery_takeover_public_key');validateRemoteAnchorV2(transition.authority_anchor)
  if(toUrs===fromUrs||keyId===fromTakeover)throw new Error('Recovery transition must introduce fresh URS and takeover-key identifiers.')
  if(await recoveryTakeoverKeyIdV2(fixedBase64Url(publicKey,32,'to_recovery_takeover_public_key'))!==keyId)throw new Error('to_recovery_takeover_key_id does not match its public key.')
  return value as unknown as RecoveryAuthorityTransitionV2
}

export function validateRotationAnnouncementV2(value:unknown):RotationAnnouncementV2{
  const rotation=object(value,'RotationAnnouncementV2');exact(rotation,['rotation_id','from_epoch_id','successor_epoch_id','successor_creation_locator','successor_manifest_fingerprint','rotation_kind','source_writer_generation','source_writer_grant_id','successor_recovery_generation','source_anchor_before_announcement','successor_staging_anchor','recovery_transition_id'],'RotationAnnouncementV2')
  id(rotation.rotation_id,32,'rotation_id');const fromEpoch=id(rotation.from_epoch_id,16,'from_epoch_id'),successorEpoch=id(rotation.successor_epoch_id,16,'successor_epoch_id');if(fromEpoch===successorEpoch)throw new Error('Rotation successor epoch must differ from source epoch.');id(rotation.successor_creation_locator,16,'successor_creation_locator');id(rotation.successor_manifest_fingerprint,32,'successor_manifest_fingerprint');const kind=oneOf(rotation.rotation_kind,['normal','recovery_rekey'] as const,'rotation_kind');safeInteger(rotation.source_writer_generation,1,'source_writer_generation');id(rotation.source_writer_grant_id,32,'source_writer_grant_id');safeInteger(rotation.successor_recovery_generation,0,'successor_recovery_generation');validateRemoteAnchorV2(rotation.source_anchor_before_announcement,'source_anchor_before_announcement');validateRemoteAnchorV2(rotation.successor_staging_anchor,'successor_staging_anchor');const transition=nullableId(rotation.recovery_transition_id,32,'recovery_transition_id')
  if((kind==='normal')!==(transition===null))throw new Error('rotation_kind/recovery_transition_id mismatch.')
  return value as unknown as RotationAnnouncementV2
}

export function validateSuccessorActivationConfirmationV2(value:unknown):SuccessorActivationConfirmationV2{
  const confirmation=object(value,'SuccessorActivationConfirmationV2');exact(confirmation,['confirmation_id','activation_kind','source_profile','source_epoch_id','source_manifest_fingerprint','source_anchor_before_announcement','successor_epoch_id','successor_manifest_fingerprint','successor_staging_anchor','source_announcement_envelope_sha256'],'SuccessorActivationConfirmationV2')
  id(confirmation.confirmation_id,32,'confirmation_id');const kind=oneOf(confirmation.activation_kind,['profile_upgrade','v2_rotation'] as const,'activation_kind'),profile=oneOf(confirmation.source_profile,[SINGLE_WRITER_V1_PROFILE,SINGLE_WRITER_V2_PROFILE] as const,'source_profile');id(confirmation.source_epoch_id,16,'source_epoch_id');id(confirmation.source_manifest_fingerprint,32,'source_manifest_fingerprint');id(confirmation.successor_epoch_id,16,'successor_epoch_id');id(confirmation.successor_manifest_fingerprint,32,'successor_manifest_fingerprint');id(confirmation.source_announcement_envelope_sha256,32,'source_announcement_envelope_sha256');validateRemoteAnchorV2(confirmation.successor_staging_anchor,'successor_staging_anchor')
  const expectedProfile=kind==='profile_upgrade'?SINGLE_WRITER_V1_PROFILE:SINGLE_WRITER_V2_PROFILE;if(profile!==expectedProfile)throw new Error('Activation kind/source profile mismatch.')
  validateAnchorShape(confirmation.source_anchor_before_announcement,[expectedProfile],'source_anchor_before_announcement')
  return value as unknown as SuccessorActivationConfirmationV2
}

function validateSourceWriterAuthority(value:unknown):SourceWriterAuthorityV2{
  const authority=object(value,'source_writer_authority');exact(authority,['writer_generation','writer_grant_id','writer_device_id','writer_key_id'],'source_writer_authority');safeInteger(authority.writer_generation,1,'source_writer_authority.writer_generation');id(authority.writer_grant_id,32,'source_writer_authority.writer_grant_id');id(authority.writer_device_id,16,'source_writer_authority.writer_device_id');id(authority.writer_key_id,32,'source_writer_authority.writer_key_id');return value as SourceWriterAuthorityV2
}
export function validateEpochMigrationV2(value:unknown):EpochMigrationV2{
  const migration=object(value,'EpochMigrationV2');exact(migration,['migration_id','migration_kind','source','result_semantic_snapshot_hash','active_head_count','tombstone_head_count','source_writer_authority','source_recovery_transition_id'],'EpochMigrationV2')
  id(migration.migration_id,32,'migration_id');const kind=oneOf(migration.migration_kind,['profile_upgrade','normal','recovery_rekey'] as const,'migration_kind');id(migration.result_semantic_snapshot_hash,32,'result_semantic_snapshot_hash');safeInteger(migration.active_head_count,0,'active_head_count');safeInteger(migration.tombstone_head_count,0,'tombstone_head_count')
  const source=object(migration.source,'source');exact(source,['source_epoch_id','source_manifest_fingerprint','source_anchor','source_lineage_snapshot_hash','source_semantic_snapshot_hash'],'source');id(source.source_epoch_id,16,'source.source_epoch_id');id(source.source_manifest_fingerprint,32,'source.source_manifest_fingerprint');id(source.source_lineage_snapshot_hash,32,'source.source_lineage_snapshot_hash');id(source.source_semantic_snapshot_hash,32,'source.source_semantic_snapshot_hash')
  if(source.source_anchor===null)throw new Error('EpochMigrationV2 source_anchor must be non-null.')
  validateAnchorShape(source.source_anchor,[kind==='profile_upgrade'?SINGLE_WRITER_V1_PROFILE:SINGLE_WRITER_V2_PROFILE],'source.source_anchor')
  const transition=nullableId(migration.source_recovery_transition_id,32,'source_recovery_transition_id')
  if(migration.result_semantic_snapshot_hash!==source.source_semantic_snapshot_hash)throw new Error('Unchanged one-source migration changed the semantic snapshot.')
  if(kind==='profile_upgrade'){
    if(migration.source_writer_authority!==null||transition!==null)throw new Error('Profile-upgrade migration authority fields must be null.')
  }else{
    if(migration.source_writer_authority===null)throw new Error('v2 source migration requires source_writer_authority.')
    validateSourceWriterAuthority(migration.source_writer_authority)
    if(kind==='normal'&&transition!==null)throw new Error('Normal migration must not bind a recovery transition.')
    if(kind==='recovery_rekey'&&transition===null)throw new Error('Recovery-rekey migration must bind a recovery transition.')
  }
  return value as unknown as EpochMigrationV2
}

async function validateControlData(revision:RevisionV2):Promise<void>{
  if(revision.record_status!=='control')return
  if(revision.record_data===null)throw new Error('Control revision record_data must be non-null.')
  switch(revision.record_schema){
    case 'writer-grant-sw-v2':await validateWriterGrantV2(revision.record_data);break
    case 'rotation-announcement-sw-v2':validateRotationAnnouncementV2(revision.record_data);break
    case 'epoch-migration-sw-v2':validateEpochMigrationV2(revision.record_data);break
    case 'recovery-authority-transition-sw-v2':await validateRecoveryAuthorityTransitionV2(revision.record_data);break
    case 'successor-activation-confirmation-sw-v2':validateSuccessorActivationConfirmationV2(revision.record_data);break
    default:throw new Error('Unknown v2 control schema.')
  }
}

export async function validateRevisionV2<T>(revision:RevisionV2<T>):Promise<void>{
  const wrapper=object(revision,'RevisionV2');exact(wrapper,['record_type','record_schema','record_id','revision_id','parent_revision_ids','record_status','record_data','migration_origin','protocol_created_at','writer_context','writer_signature'],'RevisionV2')
  id(revision.record_id,16,'record_id');id(revision.revision_id,32,'revision_id')
  canonicalTimestampV2(revision.protocol_created_at,'protocol_created_at')
  if(!Object.prototype.hasOwnProperty.call(V2_RECORD_SCHEMA_BY_TYPE,revision.record_type))throw new Error('Invalid v2 record_type.')
  if(V2_RECORD_SCHEMA_BY_TYPE[revision.record_type as V2RecordType]!==revision.record_schema)throw new Error('Record type/schema binding mismatch.')
  if(!['active','deleted','control'].includes(revision.record_status))throw new Error('Invalid record_status.')
  const isControl=revision.record_schema.endsWith('-sw-v2')
  if(isControl!== (revision.record_status==='control'))throw new Error('v2 control/status binding mismatch.')
  if(revision.record_status==='deleted'&&revision.record_data!==null)throw new Error('Tombstone data must be null.')
  if(!Array.isArray(revision.parent_revision_ids)||revision.parent_revision_ids.length>MAX_PARENTS||new Set(revision.parent_revision_ids).size!==revision.parent_revision_ids.length)throw new Error('Invalid revision parents.')
  revision.parent_revision_ids.forEach((parent)=>id(parent,32,'parent_revision_id'))
  validateMigrationOrigin(revision.migration_origin)
  if(isControl&&(revision.parent_revision_ids.length||revision.migration_origin!==null))throw new Error('Control wrapper invariants failed.')
  if(revision.record_schema==='writer-grant-sw-v2'){
    if(revision.writer_context!==null||revision.writer_signature!==null)throw new Error('WriterGrantV2 wrapper must not carry writer signature fields.')
  }else{
    validateWriterContextV2(revision.writer_context)
    if(typeof revision.writer_signature!=='string')throw new Error('Writer-signed RevisionV2 requires writer_signature.')
    id(revision.writer_signature,64,'writer_signature')
  }
  await validateControlData(revision as RevisionV2)
  if(revision.record_schema==='rotation-announcement-sw-v2'){
    const rotation=revision.record_data as RotationAnnouncementV2
    if(!revision.writer_context||rotation.source_writer_generation!==revision.writer_context.writer_generation||rotation.source_writer_grant_id!==revision.writer_context.writer_grant_id)throw new Error('RotationAnnouncementV2 source writer fields must match writer_context.')
  }
}

export interface RevisionGraphV2<T=unknown>{revisions:Map<string,RevisionV2<T>>;headsByRecord:Map<string,Set<string>>}
export async function validateRevisionGraphV2<T>(input:readonly RevisionV2<T>[]):Promise<RevisionGraphV2<T>>{
  const revisions=new Map<string,RevisionV2<T>>(),children=new Set<string>(),counts=new Map<string,number>(),depths=new Map<string,number>()
  for(const revision of input){
    await validateRevisionV2(revision)
    if(revisions.has(revision.revision_id))throw new Error('Duplicate revision_id is an integrity failure.')
    const count=(counts.get(revision.record_id)??0)+1;if(count>MAX_PER_RECORD)throw new Error('Revision count bound exceeded.');counts.set(revision.record_id,count)
    for(const parentId of revision.parent_revision_ids){const parent=revisions.get(parentId);if(!parent)throw new Error('Parent must physically precede child.');if(parent.record_id!==revision.record_id||parent.record_type!==revision.record_type||parent.record_schema!==revision.record_schema)throw new Error('Cross-record, cross-type, or cross-schema parent.');children.add(parentId)}
    const depth=1+revision.parent_revision_ids.reduce((maximum,parentId)=>Math.max(maximum,depths.get(parentId)??0),0);if(depth>MAX_PER_RECORD)throw new Error('Revision graph depth bound exceeded.');depths.set(revision.revision_id,depth)
    revisions.set(revision.revision_id,revision)
  }
  const headsByRecord=new Map<string,Set<string>>()
  for(const revision of input){if(revision.record_status==='control'||children.has(revision.revision_id))continue;const heads=headsByRecord.get(revision.record_id)??new Set<string>();heads.add(revision.revision_id);headsByRecord.set(revision.record_id,heads)}
  return{revisions,headsByRecord}
}
