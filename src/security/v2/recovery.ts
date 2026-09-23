import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { RemoteAnchorV1 } from '../../sync/core/prefix'
import { base64Url, concatBytes, fixedBase64Url, fromBase64Url, utf8 } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes, sha256 } from '../crypto/core'
import {
  deriveRecoveryKeyV2,
  importRecoveryTakeoverSigningKeyV2,
  recoveryCommitmentV2,
  recoveryTakeoverKeyIdV2,
  recoveryUrsIdV2,
  verifyRecoveryTakeoverKeyPairV2,
} from './crypto'
import { V2_PADDING_BUCKETS } from './envelopes'
import type { RemoteAnchorV2 } from './types'
import type { RecoveryCredentialHistoryEntryV6 } from './manifest'

export interface PreparedEnvelopeRowV2 {envelope_id:string;iv:string;ciphertext:string}
export interface RecoveryActivationProofV2 {
  format:'recovery-activation-proof-v2'
  version:2
  source_profile:typeof SINGLE_WRITER_V2_PROFILE
  source_epoch_id:string
  source_manifest_fingerprint:string
  source_anchor_before_announcement:RemoteAnchorV2
  successor_staging_anchor:RemoteAnchorV2
  source_writer_generation:number
  source_writer_grant_id:string
  source_writer_device_id:string
  source_writer_key_id:string
  successor_epoch_id:string
  successor_manifest_fingerprint:string
  successor_recovery_generation:number
  rotation_kind:'normal'|'recovery_rekey'
  recovery_transition_id:string|null
  announcement_envelope:PreparedEnvelopeRowV2
  successor_confirmation_envelope:PreparedEnvelopeRowV2
  activation_signature:string
}
export interface ProfileUpgradeActivationEntryV2 {
  kind:'profile_upgrade'
  source_profile:typeof SINGLE_WRITER_V1_PROFILE
  source_epoch_id:string
  source_manifest_fingerprint:string
  source_root_key:string
  source_anchor_before_announcement:RemoteAnchorV1
  successor_epoch_id:string
  successor_manifest_fingerprint:string
  successor_staging_anchor:RemoteAnchorV2
  announcement_envelope:PreparedEnvelopeRowV2
  successor_confirmation_envelope:PreparedEnvelopeRowV2
}
export interface V2RotationActivationEntryV2 {
  kind:'v2_rotation'
  source_profile:typeof SINGLE_WRITER_V2_PROFILE
  source_root_key:string
  proof:RecoveryActivationProofV2
}
export type ActivationLineageEntryV2=ProfileUpgradeActivationEntryV2|V2RotationActivationEntryV2
export type ActivationLineageV2=ActivationLineageEntryV2[]

export interface RecoveryAuthorityTransitionProofV2 {
  format:'recovery-authority-transition-proof-v2'
  version:2
  source_epoch_id:string
  source_manifest_fingerprint:string
  authority_anchor_before_transition:RemoteAnchorV2
  from_recovery_generation:number
  from_recovery_urs_id:string
  from_recovery_takeover_key_id:string
  to_recovery_generation:number
  to_recovery_urs_commitment:string
  to_recovery_urs_id:string
  to_recovery_takeover_key_id:string
  to_recovery_takeover_public_key:string
  transition_envelope:PreparedEnvelopeRowV2
}

export interface RecoveryArtifactV6 {
  format:'sync-recovery-v6'
  version:6
  recovery_artifact_id:string
  kdf_profile_id:'recovery-hkdf-v6-1'
  salt:string
  wrap_iv:string
  wrapped_payload:string
}
export interface RecoveryPayloadV6 {
  recovery_artifact_id:string
  diary_id:string
  epoch_id:string
  key_id:string
  RK_epoch:string
  manifest_fingerprint:string
  remote_anchor:RemoteAnchorV2
  google_account_binding:string
  recovery_generation:number
  recovery_urs_commitment:string
  recovery_urs_id:string
  recovery_credential_history:RecoveryCredentialHistoryEntryV6[]
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
  recovery_takeover_private_key_pkcs8:string
  activation_lineage:ActivationLineageV2
  recovery_authority_transition_proof:RecoveryAuthorityTransitionProofV2|null
  created_at:string
}
export interface RecoveredRootCandidateV6 {
  rootKey:Uint8Array
  payload:RecoveryPayloadV6
  recoveryTakeoverPrivateKey:CryptoKey
}

const ARTIFACT_KEYS=['format','version','recovery_artifact_id','kdf_profile_id','salt','wrap_iv','wrapped_payload'] as const
const PAYLOAD_KEYS=[
  'recovery_artifact_id','diary_id','epoch_id','key_id','RK_epoch','manifest_fingerprint',
  'remote_anchor','google_account_binding','recovery_generation','recovery_urs_commitment',
  'recovery_urs_id','recovery_credential_history','recovery_takeover_key_id',
  'recovery_takeover_public_key','recovery_takeover_private_key_pkcs8',
  'activation_lineage','recovery_authority_transition_proof','created_at',
] as const
const PROOF_KEYS=[
  'format','version','source_profile','source_epoch_id','source_manifest_fingerprint',
  'source_anchor_before_announcement','successor_staging_anchor','source_writer_generation',
  'source_writer_grant_id','source_writer_device_id','source_writer_key_id','successor_epoch_id',
  'successor_manifest_fingerprint','successor_recovery_generation','rotation_kind',
  'recovery_transition_id','announcement_envelope','successor_confirmation_envelope','activation_signature',
] as const
const TRANSITION_KEYS=[
  'format','version','source_epoch_id','source_manifest_fingerprint','authority_anchor_before_transition',
  'from_recovery_generation','from_recovery_urs_id','from_recovery_takeover_key_id',
  'to_recovery_generation','to_recovery_urs_commitment','to_recovery_urs_id',
  'to_recovery_takeover_key_id','to_recovery_takeover_public_key','transition_envelope',
] as const
const PROFILE_ENTRY_KEYS=[
  'kind','source_profile','source_epoch_id','source_manifest_fingerprint','source_root_key',
  'source_anchor_before_announcement','successor_epoch_id','successor_manifest_fingerprint',
  'successor_staging_anchor','announcement_envelope','successor_confirmation_envelope',
] as const
const ROTATION_ENTRY_KEYS=['kind','source_profile','source_root_key','proof'] as const

function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function timestamp(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false
  try{return new Date(value).toISOString()===value}catch{return false}
}
function safe(value:number,min=0):void{if(!Number.isSafeInteger(value)||value<min)throw new Error('Recovery integer is invalid.')}
function validateRow(row:PreparedEnvelopeRowV2,label:string):void{
  if(!row||typeof row!=='object')throw new Error(`${label} schema mismatch.`)
  exact(row,['envelope_id','iv','ciphertext'],label)
  if(row.envelope_id.length+row.iv.length+row.ciphertext.length+10>21_936)throw new Error(`${label} canonical row bound exceeded.`)
  fixedBase64Url(row.envelope_id,32,`${label}.envelope_id`);fixedBase64Url(row.iv,12,`${label}.iv`)
  const bucket=fromBase64Url(row.ciphertext).byteLength-16
  if(!V2_PADDING_BUCKETS.includes(bucket as (typeof V2_PADDING_BUCKETS)[number]))throw new Error(`${label} ciphertext bucket mismatch.`)
}
function validateAnchorV2(anchor:RemoteAnchorV2,label:string):void{
  if(!anchor||typeof anchor!=='object')throw new Error(`${label} schema mismatch.`)
  exact(anchor,['anchor_profile','covered_row_count','prefix_hash'],label)
  if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error(`${label} profile mismatch.`)
  safe(anchor.covered_row_count);fixedBase64Url(anchor.prefix_hash,32,`${label}.prefix_hash`)
}
function validateAnchorV1(anchor:RemoteAnchorV1,label:string):void{
  if(!anchor||typeof anchor!=='object')throw new Error(`${label} schema mismatch.`)
  exact(anchor,['anchor_profile','covered_row_count','prefix_hash'],label)
  if(anchor.anchor_profile!==SINGLE_WRITER_V1_PROFILE)throw new Error(`${label} profile mismatch.`)
  safe(anchor.covered_row_count);fixedBase64Url(anchor.prefix_hash,32,`${label}.prefix_hash`)
}
function validateHistory(history:RecoveryCredentialHistoryEntryV6[],payload:RecoveryPayloadV6):void{
  if(!Array.isArray(history)||history.length<1||history.length>128)throw new Error('Recovery credential history bound mismatch.')
  let prior=-1
  const urs=new Set<string>(),keys=new Set<string>()
  for(const entry of history){
    if(!entry||typeof entry!=='object')throw new Error('Recovery credential history schema mismatch.')
    exact(entry,['recovery_generation','recovery_urs_id','recovery_takeover_key_id'],'Recovery credential history entry')
    safe(entry.recovery_generation)
    if(entry.recovery_generation<=prior)throw new Error('Recovery credential history ordering mismatch.')
    fixedBase64Url(entry.recovery_urs_id,32);fixedBase64Url(entry.recovery_takeover_key_id,32)
    if(urs.has(entry.recovery_urs_id)||keys.has(entry.recovery_takeover_key_id))throw new Error('Recovery credential history reuse.')
    urs.add(entry.recovery_urs_id);keys.add(entry.recovery_takeover_key_id);prior=entry.recovery_generation
  }
  const last=history.at(-1)!
  if(last.recovery_generation!==payload.recovery_generation||last.recovery_urs_id!==payload.recovery_urs_id||last.recovery_takeover_key_id!==payload.recovery_takeover_key_id)throw new Error('Recovery credential history tail mismatch.')
}
function validateActivationProof(proof:RecoveryActivationProofV2):void{
  if(!proof||typeof proof!=='object')throw new Error('Recovery activation proof schema mismatch.')
  exact(proof,PROOF_KEYS,'Recovery activation proof')
  if(proof.format!=='recovery-activation-proof-v2'||proof.version!==2||proof.source_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('Recovery activation proof profile mismatch.')
  fixedBase64Url(proof.source_epoch_id,16);fixedBase64Url(proof.source_manifest_fingerprint,32)
  validateAnchorV2(proof.source_anchor_before_announcement,'source_anchor_before_announcement')
  validateAnchorV2(proof.successor_staging_anchor,'successor_staging_anchor')
  safe(proof.source_writer_generation,1);fixedBase64Url(proof.source_writer_grant_id,32);fixedBase64Url(proof.source_writer_device_id,16);fixedBase64Url(proof.source_writer_key_id,32)
  fixedBase64Url(proof.successor_epoch_id,16);fixedBase64Url(proof.successor_manifest_fingerprint,32);safe(proof.successor_recovery_generation)
  if(proof.rotation_kind==='normal'){if(proof.recovery_transition_id!==null)throw new Error('Normal recovery activation proof must not bind a recovery transition.')}
  else if(proof.rotation_kind==='recovery_rekey'){if(proof.recovery_transition_id===null)throw new Error('Recovery-rekey activation proof requires a transition.');fixedBase64Url(proof.recovery_transition_id,32)}
  else throw new Error('Recovery activation proof rotation kind mismatch.')
  validateRow(proof.announcement_envelope,'announcement_envelope');validateRow(proof.successor_confirmation_envelope,'successor_confirmation_envelope')
  fixedBase64Url(proof.activation_signature,64,'activation_signature')
}
function validateLineage(lineage:ActivationLineageV2,payload:RecoveryPayloadV6):void{
  if(!Array.isArray(lineage)||lineage.length>128)throw new Error('ActivationLineageV2 bound exceeded.')
  let priorSuccessor:{epoch:string;fingerprint:string}|null=null
  const sourceRoots=new Set<string>(),seenEpochs=new Set<string>()
  for(const entry of lineage){
    if(!entry||typeof entry!=='object')throw new Error('ActivationLineageV2 entry schema mismatch.')
    if(entry.kind==='profile_upgrade'){
      exact(entry,PROFILE_ENTRY_KEYS,'ProfileUpgradeActivationEntryV2')
      if(entry.source_profile!==SINGLE_WRITER_V1_PROFILE)throw new Error('Profile upgrade source profile mismatch.')
      fixedBase64Url(entry.source_epoch_id,16);fixedBase64Url(entry.source_manifest_fingerprint,32);fixedBase64Url(entry.source_root_key,32)
      validateAnchorV1(entry.source_anchor_before_announcement,'profile_upgrade.source_anchor_before_announcement')
      fixedBase64Url(entry.successor_epoch_id,16);fixedBase64Url(entry.successor_manifest_fingerprint,32)
      validateAnchorV2(entry.successor_staging_anchor,'profile_upgrade.successor_staging_anchor')
      validateRow(entry.announcement_envelope,'profile_upgrade.announcement_envelope');validateRow(entry.successor_confirmation_envelope,'profile_upgrade.successor_confirmation_envelope')
      if(priorSuccessor)throw new Error('Profile upgrade may only be the first lineage entry.')
      if(entry.source_epoch_id===entry.successor_epoch_id||seenEpochs.has(entry.source_epoch_id)||seenEpochs.has(entry.successor_epoch_id))throw new Error('ActivationLineageV2 cycle/repetition detected.')
      if(sourceRoots.has(entry.source_root_key))throw new Error('ActivationLineageV2 source root reuse detected.')
      seenEpochs.add(entry.source_epoch_id);seenEpochs.add(entry.successor_epoch_id)
      priorSuccessor={epoch:entry.successor_epoch_id,fingerprint:entry.successor_manifest_fingerprint}
      sourceRoots.add(entry.source_root_key)
    }else if(entry.kind==='v2_rotation'){
      exact(entry,ROTATION_ENTRY_KEYS,'V2RotationActivationEntryV2')
      if(entry.source_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('v2 rotation source profile mismatch.')
      fixedBase64Url(entry.source_root_key,32);validateActivationProof(entry.proof)
      if(priorSuccessor&&(entry.proof.source_epoch_id!==priorSuccessor.epoch||entry.proof.source_manifest_fingerprint!==priorSuccessor.fingerprint))throw new Error('ActivationLineageV2 continuity mismatch.')
      if(entry.proof.source_epoch_id===entry.proof.successor_epoch_id)throw new Error('ActivationLineageV2 self-cycle detected.')
      if(priorSuccessor===null){
        if(seenEpochs.has(entry.proof.source_epoch_id))throw new Error('ActivationLineageV2 source repetition detected.')
        seenEpochs.add(entry.proof.source_epoch_id)
      }
      if(seenEpochs.has(entry.proof.successor_epoch_id))throw new Error('ActivationLineageV2 cycle/repetition detected.')
      if(sourceRoots.has(entry.source_root_key))throw new Error('ActivationLineageV2 source root reuse detected.')
      seenEpochs.add(entry.proof.successor_epoch_id)
      priorSuccessor={epoch:entry.proof.successor_epoch_id,fingerprint:entry.proof.successor_manifest_fingerprint}
      sourceRoots.add(entry.source_root_key)
    }else throw new Error('ActivationLineageV2 entry kind mismatch.')
  }
  if(lineage.length&&(!priorSuccessor||priorSuccessor.epoch!==payload.epoch_id||priorSuccessor.fingerprint!==payload.manifest_fingerprint))throw new Error('ActivationLineageV2 leaf mismatch.')
  if(sourceRoots.has(payload.RK_epoch))throw new Error('successor_root_key_reuse')
}
function validateTransitionProof(proof:RecoveryAuthorityTransitionProofV2,payload:RecoveryPayloadV6):void{
  exact(proof,TRANSITION_KEYS,'RecoveryAuthorityTransitionProofV2')
  if(proof.format!=='recovery-authority-transition-proof-v2'||proof.version!==2)throw new Error('Recovery transition proof profile mismatch.')
  fixedBase64Url(proof.source_epoch_id,16);fixedBase64Url(proof.source_manifest_fingerprint,32);validateAnchorV2(proof.authority_anchor_before_transition,'authority_anchor_before_transition')
  safe(proof.from_recovery_generation);safe(proof.to_recovery_generation)
  if(proof.to_recovery_generation!==proof.from_recovery_generation+1)throw new Error('Recovery transition proof generation mismatch.')
  fixedBase64Url(proof.from_recovery_urs_id,32);fixedBase64Url(proof.from_recovery_takeover_key_id,32)
  fixedBase64Url(proof.to_recovery_urs_commitment,32);fixedBase64Url(proof.to_recovery_urs_id,32);fixedBase64Url(proof.to_recovery_takeover_key_id,32);fixedBase64Url(proof.to_recovery_takeover_public_key,32)
  validateRow(proof.transition_envelope,'transition_envelope')
  if(proof.source_epoch_id!==payload.epoch_id||proof.source_manifest_fingerprint!==payload.manifest_fingerprint
    ||proof.to_recovery_generation!==payload.recovery_generation
    ||proof.to_recovery_urs_commitment!==payload.recovery_urs_commitment
    ||proof.to_recovery_urs_id!==payload.recovery_urs_id
    ||proof.to_recovery_takeover_key_id!==payload.recovery_takeover_key_id
    ||proof.to_recovery_takeover_public_key!==payload.recovery_takeover_public_key)throw new Error('Recovery transition proof to-state mismatch.')
}
function artifactAad(header:Omit<RecoveryArtifactV6,'wrapped_payload'>):Uint8Array{return canonicalBytes(header as never)}

export async function recoveryFamilyLocatorV6(urs:Uint8Array):Promise<string>{
  if(urs.byteLength!==32)throw new Error('URS must contain 32 bytes.')
  return base64Url((await sha256(concatBytes(utf8('eds-diary/recovery-family-locator/v6'),new Uint8Array([0]),urs))).slice(0,16))
}
export async function recoveryArtifactLocatorV6(urs:Uint8Array,diaryId:string,epochId:string):Promise<string>{
  if(urs.byteLength!==32)throw new Error('URS must contain 32 bytes.')
  return base64Url((await sha256(concatBytes(
    utf8('eds-diary/recovery-artifact-locator/v6'),new Uint8Array([0]),urs,new Uint8Array([0]),
    fixedBase64Url(diaryId,16),fixedBase64Url(epochId,16),
  ))).slice(0,16))
}

export function validateRecoveryArtifactV6(artifact:RecoveryArtifactV6):void{
  if(!artifact||typeof artifact!=='object')throw new Error('RecoveryArtifactV6 schema mismatch.')
  exact(artifact,ARTIFACT_KEYS,'RecoveryArtifactV6')
  if(artifact.format!=='sync-recovery-v6'||artifact.version!==6||artifact.kdf_profile_id!=='recovery-hkdf-v6-1')throw new Error('RecoveryArtifactV6 profile mismatch.')
  fixedBase64Url(artifact.recovery_artifact_id,16);fixedBase64Url(artifact.salt,32);fixedBase64Url(artifact.wrap_iv,12)
  const bytes=fromBase64Url(artifact.wrapped_payload)
  if(bytes.byteLength<16||bytes.byteLength>1_048_576)throw new Error('RecoveryArtifactV6 ciphertext bound exceeded.')
}
export async function validateRecoveryPayloadV6(payload:RecoveryPayloadV6,urs?:Uint8Array):Promise<void>{
  if(!payload||typeof payload!=='object')throw new Error('RecoveryPayloadV6 schema mismatch.')
  exact(payload,PAYLOAD_KEYS,'RecoveryPayloadV6')
  fixedBase64Url(payload.recovery_artifact_id,16);fixedBase64Url(payload.diary_id,16);fixedBase64Url(payload.epoch_id,16);fixedBase64Url(payload.key_id,16);fixedBase64Url(payload.RK_epoch,32)
  fixedBase64Url(payload.manifest_fingerprint,32);validateAnchorV2(payload.remote_anchor,'recovery.remote_anchor');fixedBase64Url(payload.google_account_binding,32)
  safe(payload.recovery_generation);fixedBase64Url(payload.recovery_urs_commitment,32);fixedBase64Url(payload.recovery_urs_id,32)
  fixedBase64Url(payload.recovery_takeover_key_id,32);const publicKey=fixedBase64Url(payload.recovery_takeover_public_key,32)
  if(await recoveryTakeoverKeyIdV2(publicKey)!==payload.recovery_takeover_key_id)throw new Error('Recovery takeover key ID mismatch.')
  const pkcs8=fromBase64Url(payload.recovery_takeover_private_key_pkcs8);if(pkcs8.byteLength===0)throw new Error('Recovery takeover PKCS#8 is empty.')
  if(!timestamp(payload.created_at))throw new Error('RecoveryPayloadV6 created_at is not canonical.')
  validateHistory(payload.recovery_credential_history,payload);validateLineage(payload.activation_lineage,payload)
  if(payload.recovery_authority_transition_proof!==null)validateTransitionProof(payload.recovery_authority_transition_proof,payload)
  if(urs){
    if(urs.byteLength!==32)throw new Error('URS must contain 32 bytes.')
    if(await recoveryUrsIdV2(urs)!==payload.recovery_urs_id)throw new Error('Recovery URS ID mismatch.')
    if(await recoveryCommitmentV2(urs,fixedBase64Url(payload.diary_id,16),payload.recovery_generation)!==payload.recovery_urs_commitment)throw new Error('Recovery URS commitment mismatch.')
  }
}
export async function createRecoveryArtifactV6(
  payload:Omit<RecoveryPayloadV6,'recovery_artifact_id'>,
  urs:Uint8Array,
  id=randomBytes(16),
  salt=randomBytes(32),
  iv=randomBytes(12),
):Promise<RecoveryArtifactV6>{
  const recovery_artifact_id=base64Url(id)
  const complete={...payload,recovery_artifact_id} as RecoveryPayloadV6
  await validateRecoveryPayloadV6(complete,urs)
  const header={format:'sync-recovery-v6' as const,version:6 as const,recovery_artifact_id,kdf_profile_id:'recovery-hkdf-v6-1' as const,salt:base64Url(salt),wrap_iv:base64Url(iv)}
  const encrypted=await aesGcmEncrypt(await deriveRecoveryKeyV2(urs,salt),canonicalBytes(complete as never),artifactAad(header),iv)
  const artifact={...header,wrapped_payload:base64Url(encrypted.ciphertext)}
  validateRecoveryArtifactV6(artifact)
  return artifact
}
export async function openRecoveryArtifactV6(artifact:RecoveryArtifactV6,urs:Uint8Array):Promise<RecoveredRootCandidateV6>{
  validateRecoveryArtifactV6(artifact)
  const header={format:artifact.format,version:artifact.version,recovery_artifact_id:artifact.recovery_artifact_id,kdf_profile_id:artifact.kdf_profile_id,salt:artifact.salt,wrap_iv:artifact.wrap_iv}
  const plain=await aesGcmDecrypt(
    await deriveRecoveryKeyV2(urs,fixedBase64Url(artifact.salt,32)),
    fromBase64Url(artifact.wrapped_payload),
    artifactAad(header),
    fixedBase64Url(artifact.wrap_iv,12),
  )
  const payload=parseCanonicalJson(plain) as unknown as RecoveryPayloadV6
  await validateRecoveryPayloadV6(payload,urs)
  if(payload.recovery_artifact_id!==artifact.recovery_artifact_id)throw new Error('RecoveryArtifactV6 payload/header binding mismatch.')
  const privateKey=await importRecoveryTakeoverSigningKeyV2(fromBase64Url(payload.recovery_takeover_private_key_pkcs8))
  if(!await verifyRecoveryTakeoverKeyPairV2(privateKey,fixedBase64Url(payload.recovery_takeover_public_key,32),payload.diary_id,payload.epoch_id,payload.recovery_generation))throw new Error('Recovery takeover keypair check failed.')
  return{rootKey:fixedBase64Url(payload.RK_epoch,32),payload,recoveryTakeoverPrivateKey:privateKey}
}
export async function recoveryArtifactHashV6(artifact:RecoveryArtifactV6):Promise<string>{
  validateRecoveryArtifactV6(artifact)
  return base64Url(await sha256(canonicalBytes(artifact as never)))
}
