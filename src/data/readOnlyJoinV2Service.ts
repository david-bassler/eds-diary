import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE, type RemoteSnapshot, type VerifiedRemoteState } from '../sync/core/contracts'
import { SingleWriterV1RemoteVerifier } from '../sync/core/remoteVerifier'
import { createAnchorV1 } from '../sync/core/prefix'
import { epochLocator } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { epochLocatorV2 } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { base64Url, fixedBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSalt, sha256 } from '../security/crypto/core'
import { openEnvelope, type PreparedEnvelope } from '../security/envelopes'
import { openRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { manifestFingerprint, openManifest, parseManifestCells } from '../security/manifest'
import { validateRevisionGraphV1, type RevisionV1 } from '../security/revisions'
import { deriveEpochSaltV2, generateWriterDeviceKeyV2 } from '../security/v2/crypto'
import { createActivationLineageCacheV2, activationLineageCacheHashV2, type ActivationLineageCacheV2 } from '../security/v2/activationLineageCache'
import { openManifestV6, parseManifestCellsV6, type ProtectedManifestV6 } from '../security/v2/manifest'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import { localJournalInitialV2, recoveryCredentialHistoryHashV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from '../security/v2/localState'
import { assertExtendsAnchorV2, createAnchorV2 } from '../security/v2/prefix'
import {
  openRecoveryArtifactV6,
  recoveryArtifactHashV6,
  recoveryFamilyLocatorV6,
  type PreparedEnvelopeRowV2,
  type ProfileUpgradeActivationEntryV2,
  type RecoveryArtifactV6,
  type RecoveryPayloadV6,
} from '../security/v2/recovery'
import { sourceAnnouncementEnvelopeHashV2 as profileUpgradeSourceAnnouncementEnvelopeHashV2, verifyProfileUpgradeMigrationIntegrityV2 } from '../security/v2/profileUpgrade'
import { sourceAnnouncementEnvelopeHashV2 as v2SourceAnnouncementEnvelopeHashV2, verifyNativeV2MigrationIntegrity, verifyRecoveryActivationProofV2 } from '../security/v2/nativeRotation'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import type { RecoveryAuthorityTransitionV2, RotationAnnouncementV2 } from '../security/v2/types'
import {
  DOMAIN_SCHEMA_REGISTRY,
  activeProtocolSelectionV2,
  assertReadOnlyJoinLocalProfileIsFresh,
  atomicSelectReadOnlyJoinV2,
  openReadOnlyJoinRootWrapV6WithActiveMode,
  prepareReadOnlyJoinRootWrapV6ForActiveMode,
} from './localDatabase'

export interface ReadOnlyJoinPlanV2 {
  format:'read-only-join-v2'
  version:2
  join_id:string
  recovery_family_locator:string
  recovery_artifact_sha256:string
  diary_id:string
  epoch_id:string
  manifest_fingerprint:string
  remote_resource_id:string
  remote_anchor:CanonicalFullResultV2['remote_anchor']
  local_writer_device_id:string
  local_writer_key_id:string
}

export interface ReadOnlyJoinResultV2 {
  joinId:string
  diaryId:string
  epochId:string
  manifestFingerprint:string
  remoteResourceId:string
  writerDeviceId:string
  writerKeyId:string
  resumed:boolean
}

export interface ActiveCandidateV2 {
  artifact:RecoveryArtifactV6
  artifactSha256:string
  rootKey:Uint8Array
  payload:RecoveryPayloadV6
  manifest:ProtectedManifestV6
  snapshot:RemoteSnapshot
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
  remoteId:string
  accountBinding:string
}

function same(left:unknown,right:unknown):boolean{
  return new TextDecoder().decode(canonicalBytes(left as never))===new TextDecoder().decode(canonicalBytes(right as never))
}
function prepared(row:PreparedEnvelopeRowV2):PreparedEnvelope{
  return{envelopeId:row.envelope_id,iv:row.iv,ciphertext:row.ciphertext,bytesHash:''}
}
function canonicalResult(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Read-only Join requires a v2 canonical verifier result.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Read-only Join requires canonical_full.')
  return result
}
function exactRecoveryBinding(payload:RecoveryPayloadV6,result:CanonicalFullResultV2):void{
  const recovery=result.current_recovery
  if(payload.recovery_generation!==recovery.recovery_generation
    ||payload.recovery_urs_commitment!==recovery.recovery_urs_commitment
    ||payload.recovery_urs_id!==recovery.recovery_urs_id
    ||payload.recovery_takeover_key_id!==recovery.recovery_takeover_key_id
    ||payload.recovery_takeover_public_key!==recovery.recovery_takeover_public_key
    ||!same(payload.recovery_credential_history,result.recovery_credential_history))throw new Error('RecoveryArtifactV6 is not current for the canonical v2 Recovery authority.')
}

export async function verifyCurrentRecoveryTransitionForJoin(candidate:ActiveCandidateV2):Promise<void>{
  const recovery=candidate.result.current_recovery,proof=candidate.payload.recovery_authority_transition_proof
  if(!recovery.recovery_rekey_rotation_required){
    if(recovery.recovery_rekey_transition_id!==null)throw new Error('Canonical Recovery state has an inconsistent Pending-Rekey transition reference.')
    if(proof!==null)throw new Error('RecoveryArtifactV6 carries a same-epoch transition proof although canonical Recovery-Rekey is not pending.')
    return
  }
  if(recovery.recovery_rekey_transition_id===null||proof===null)throw new Error('Pending Recovery-Rekey Join requires the current RecoveryAuthorityTransitionProofV2.')
  if(proof.source_epoch_id!==candidate.payload.epoch_id||proof.source_manifest_fingerprint!==candidate.payload.manifest_fingerprint)throw new Error('RecoveryAuthorityTransitionProofV2 source binding mismatch during Join.')
  const row=candidate.snapshot.rows.find(item=>item[0]===proof.transition_envelope.envelope_id)
  if(!row||row[1]!==proof.transition_envelope.iv||row[2]!==proof.transition_envelope.ciphertext
    ||!candidate.verified.acceptedEnvelopeIds.has(proof.transition_envelope.envelope_id))throw new Error('RecoveryAuthorityTransitionProofV2 transition is not canonically durable during Join.')
  const epochSalt=await deriveEpochSaltV2(fixedBase64Url(candidate.payload.diary_id,16),fixedBase64Url(candidate.payload.epoch_id,16))
  const revision=await openRevisionEnvelopeV2(
    candidate.rootKey,epochSalt,{diaryId:candidate.payload.diary_id,epochId:candidate.payload.epoch_id},
    {envelopeId:row[0]!,iv:row[1]!,ciphertext:row[2]!},
  )
  if(revision.record_schema!=='recovery-authority-transition-sw-v2'||revision.record_type!=='recovery_authority_transition'||revision.record_status!=='control')throw new Error('RecoveryAuthorityTransitionProofV2 envelope type mismatch during Join.')
  const transition=revision.record_data as RecoveryAuthorityTransitionV2
  if(!transition
    ||transition.transition_id!==recovery.recovery_rekey_transition_id
    ||transition.from_recovery_generation!==proof.from_recovery_generation
    ||transition.from_recovery_urs_id!==proof.from_recovery_urs_id
    ||transition.from_recovery_takeover_key_id!==proof.from_recovery_takeover_key_id
    ||transition.to_recovery_generation!==proof.to_recovery_generation
    ||transition.to_recovery_urs_commitment!==proof.to_recovery_urs_commitment
    ||transition.to_recovery_urs_id!==proof.to_recovery_urs_id
    ||transition.to_recovery_takeover_key_id!==proof.to_recovery_takeover_key_id
    ||transition.to_recovery_takeover_public_key!==proof.to_recovery_takeover_public_key
    ||!same(transition.authority_anchor,proof.authority_anchor_before_transition))throw new Error('RecoveryAuthorityTransitionProofV2 semantic binding mismatch during Join.')
}

async function sourceRevisionsAtAnchor(args:{
  rootKey:Uint8Array
  diaryId:string
  epochId:string
  snapshot:RemoteSnapshot
  coveredRows:number
}):Promise<RevisionV1[]>{
  const salt=await deriveEpochSalt(fixedBase64Url(args.diaryId,16),fixedBase64Url(args.epochId,16))
  const revisions:RevisionV1[]=[],seen=new Set<string>()
  for(const row of args.snapshot.rows.slice(0,args.coveredRows)){
    if(row.length!==3)throw new Error('Profile-upgrade Source contains an invalid physical row.')
    if(seen.has(row[0]!))continue
    seen.add(row[0]!)
    revisions.push(await openEnvelope(args.rootKey,salt,{diaryId:args.diaryId,epochId:args.epochId},{envelopeId:row[0]!,iv:row[1]!,ciphertext:row[2]!,bytesHash:''}))
  }
  validateRevisionGraphV1(revisions)
  return revisions
}

interface VerifiedLineageEpochV2 {
  rootKey:Uint8Array
  manifest:ProtectedManifestV6
  snapshot:RemoteSnapshot
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
  remoteId:string
  accountBinding:string
}
async function loadLineageEpochV2(args:{
  session:TransferableSingleWriterV2ProviderSession
  diaryId:string
  epochId:string
  manifestFingerprint:string
  rootKey:Uint8Array
}):Promise<VerifiedLineageEpochV2>{
  const transport=await args.session.transportForEpoch(args.diaryId,args.epochId)
  const candidates=await transport.discover(await epochLocatorV2(args.diaryId,args.epochId))
  if(candidates.length!==1)throw new Error('ActivationLineageV2 requires exactly one authenticated v2 epoch candidate.')
  const remoteId=candidates[0]!.remoteId,snapshot=await transport.read(remoteId),accountBinding=await transport.authenticatedAccountBinding()
  const salt=await deriveEpochSaltV2(fixedBase64Url(args.diaryId,16),fixedBase64Url(args.epochId,16))
  const manifest=await openManifestV6(args.rootKey,salt,{diaryId:args.diaryId,epochId:args.epochId},parseManifestCellsV6(snapshot.manifest))
  if(manifest.google_account_binding!==accountBinding)throw new Error('ActivationLineageV2 v2 Source account binding mismatch.')
  const codec=await args.session.codecForEpoch(args.diaryId,args.epochId,args.rootKey,transport)
  const verified=await codec.verifyRemote(snapshot),result=canonicalResult(verified)
  if(result.diary_id!==args.diaryId||result.epoch_id!==args.epochId||result.manifest_fingerprint!==args.manifestFingerprint)throw new Error('ActivationLineageV2 v2 epoch identity mismatch.')
  return{rootKey:args.rootKey,manifest,snapshot,verified,result,remoteId,accountBinding}
}

async function verifyProfileUpgradeLineageStep(args:{
  session:TransferableSingleWriterV2ProviderSession
  diaryId:string
  entry:ProfileUpgradeActivationEntryV2
  successor:VerifiedLineageEpochV2
}):Promise<void>{
  const {entry,successor}=args
  if(successor.manifest.predecessor_epochs.length!==1
    ||successor.manifest.predecessor_epochs[0]!.epoch_id!==entry.source_epoch_id
    ||successor.manifest.predecessor_epochs[0]!.manifest_fingerprint!==entry.source_manifest_fingerprint)throw new Error('Profile-upgrade activation predecessor binding mismatch.')
  if(entry.successor_epoch_id!==successor.result.epoch_id||entry.successor_manifest_fingerprint!==successor.result.manifest_fingerprint)throw new Error('Profile-upgrade activation lineage leaf mismatch.')

  const sourceRoot=fixedBase64Url(entry.source_root_key,32,'profile_upgrade.source_root_key')
  if(!args.session.v1TransportForEpoch)throw new Error('Authenticated v1 lineage transport is unavailable.')
  const sourceTransport=await args.session.v1TransportForEpoch(args.diaryId,entry.source_epoch_id)
  const candidates=await sourceTransport.discover(await epochLocator(args.diaryId,entry.source_epoch_id))
  if(candidates.length!==1)throw new Error('Profile-upgrade activation requires exactly one authenticated v1 Source.')
  const sourceSnapshot=await sourceTransport.read(candidates[0]!.remoteId),sourceCells=parseManifestCells(sourceSnapshot.manifest)
  if(await manifestFingerprint(sourceCells)!==entry.source_manifest_fingerprint)throw new Error('Profile-upgrade activation Source manifest fingerprint mismatch.')
  const sourceSalt=await deriveEpochSalt(fixedBase64Url(args.diaryId,16),fixedBase64Url(entry.source_epoch_id,16))
  const sourceManifest=await openManifest(sourceRoot,sourceSalt,{diaryId:args.diaryId,epochId:entry.source_epoch_id},sourceCells)
  const account=await sourceTransport.authenticatedAccountBinding()
  if(sourceManifest.google_account_binding!==account)throw new Error('Profile-upgrade activation Source account binding mismatch.')
  const verifier=new SingleWriterV1RemoteVerifier({
    rootKey:sourceRoot,diaryId:args.diaryId,epochId:entry.source_epoch_id,expectedManifestFingerprint:entry.source_manifest_fingerprint,
    expectedKeyId:sourceManifest.key_id,expectedRecoveryGeneration:sourceManifest.recovery_generation,
    expectedRecoveryCommitment:sourceManifest.recovery_urs_commitment,expectedGoogleAccountBinding:account,schemas:DOMAIN_SCHEMA_REGISTRY,
    oldAnchor:entry.source_anchor_before_announcement,localEnvelopes:[],localHeadRevisionIds:new Set(),
  })
  if(!(await verifier.verify(sourceSnapshot)).retired)throw new Error('Profile-upgrade activation Source is not durably retired.')
  const sourcePrefix=sourceSnapshot.rows.slice(0,entry.source_anchor_before_announcement.covered_row_count)
  if(!same(await createAnchorV1(args.diaryId,entry.source_epoch_id,sourcePrefix),entry.source_anchor_before_announcement))throw new Error('Profile-upgrade activation Source frozen prefix mismatch.')
  const suffix=sourceSnapshot.rows.slice(entry.source_anchor_before_announcement.covered_row_count),announcementRow=[entry.announcement_envelope.envelope_id,entry.announcement_envelope.iv,entry.announcement_envelope.ciphertext]
  if(!suffix.length||!same(suffix[0],announcementRow))throw new Error('Profile-upgrade activation Announcement is not the immediate first post-freeze row.')
  const announcement=await openEnvelope(sourceRoot,sourceSalt,{diaryId:args.diaryId,epochId:entry.source_epoch_id},prepared(entry.announcement_envelope)),data=announcement.record_data as Record<string,unknown>
  if(announcement.record_schema!=='rotation-announcement-sw-v1'||data.from_epoch_id!==entry.source_epoch_id||data.successor_epoch_id!==successor.result.epoch_id
    ||data.successor_manifest_fingerprint!==successor.result.manifest_fingerprint||data.successor_creation_locator!==successor.manifest.creation_locator||data.rotation_kind!=='profile_upgrade')throw new Error('Profile-upgrade activation Announcement binding mismatch.')

  const stagingRows=successor.snapshot.rows.slice(0,entry.successor_staging_anchor.covered_row_count)
  if(!same(await createAnchorV2(args.diaryId,successor.result.epoch_id,stagingRows),entry.successor_staging_anchor))throw new Error('Profile-upgrade activation Successor staging anchor mismatch.')
  const firstAfter=successor.snapshot.rows[entry.successor_staging_anchor.covered_row_count],confirmationRow=[entry.successor_confirmation_envelope.envelope_id,entry.successor_confirmation_envelope.iv,entry.successor_confirmation_envelope.ciphertext]
  if(!firstAfter||!same(firstAfter,confirmationRow))throw new Error('Profile-upgrade activation Confirmation is not the first Successor row after staging.')
  const confirmation=successor.result.accepted_activation_confirmation
  if(!confirmation||confirmation.activation_kind!=='profile_upgrade'||confirmation.source_profile!==SINGLE_WRITER_V1_PROFILE
    ||confirmation.source_epoch_id!==entry.source_epoch_id||confirmation.source_manifest_fingerprint!==entry.source_manifest_fingerprint
    ||!same(confirmation.source_anchor_before_announcement,entry.source_anchor_before_announcement)
    ||confirmation.successor_epoch_id!==successor.result.epoch_id||confirmation.successor_manifest_fingerprint!==successor.result.manifest_fingerprint
    ||!same(confirmation.successor_staging_anchor,entry.successor_staging_anchor)
    ||confirmation.source_announcement_envelope_sha256!==await profileUpgradeSourceAnnouncementEnvelopeHashV2(prepared(entry.announcement_envelope)))throw new Error('Profile-upgrade activation Confirmation evidence mismatch.')
  await verifyProfileUpgradeMigrationIntegrityV2({
    sourceEpochId:entry.source_epoch_id,sourceManifestFingerprint:entry.source_manifest_fingerprint,sourceAnchor:entry.source_anchor_before_announcement,
    sourceRevisions:await sourceRevisionsAtAnchor({rootKey:sourceRoot,diaryId:args.diaryId,epochId:entry.source_epoch_id,snapshot:sourceSnapshot,coveredRows:entry.source_anchor_before_announcement.covered_row_count}),
    successor:successor.result,
  })
}

async function verifyV2RotationLineageStep(args:{
  session:TransferableSingleWriterV2ProviderSession
  diaryId:string
  sourceRoot:Uint8Array
  successor:VerifiedLineageEpochV2
  entry:Extract<RecoveryPayloadV6['activation_lineage'][number],{kind:'v2_rotation'}>
}):Promise<void>{
  const proof=args.entry.proof
  if(proof.successor_epoch_id!==args.successor.result.epoch_id||proof.successor_manifest_fingerprint!==args.successor.result.manifest_fingerprint)throw new Error('v2 rotation ActivationLineageV2 successor binding mismatch.')
  if(args.successor.manifest.predecessor_epochs.length!==1||args.successor.manifest.predecessor_epochs[0]!.epoch_id!==proof.source_epoch_id
    ||args.successor.manifest.predecessor_epochs[0]!.manifest_fingerprint!==proof.source_manifest_fingerprint)throw new Error('v2 rotation ActivationLineageV2 predecessor binding mismatch.')
  if(args.successor.manifest.recovery_generation!==proof.successor_recovery_generation)throw new Error('v2 rotation ActivationLineageV2 successor Recovery generation mismatch.')
  const source=await loadLineageEpochV2({session:args.session,diaryId:args.diaryId,epochId:proof.source_epoch_id,manifestFingerprint:proof.source_manifest_fingerprint,rootKey:args.sourceRoot})
  const prefixRows=source.snapshot.rows.slice(0,proof.source_anchor_before_announcement.covered_row_count)
  if(!same(await createAnchorV2(args.diaryId,proof.source_epoch_id,prefixRows),proof.source_anchor_before_announcement))throw new Error('v2 rotation activation Source prefix mismatch.')
  const sourceTransport=await args.session.transportForEpoch(args.diaryId,proof.source_epoch_id),sourceCodec=await args.session.codecForEpoch(args.diaryId,proof.source_epoch_id,args.sourceRoot,sourceTransport)
  const prefixVerified=await sourceCodec.verifyRemote({...source.snapshot,rows:prefixRows}),prefix=canonicalResult(prefixVerified)
  if(prefix.source_epoch_sealed||!same(prefix.remote_anchor,proof.source_anchor_before_announcement))throw new Error('v2 rotation activation Source decision prefix is not active.')
  if(proof.rotation_kind==='normal'){
    if(prefix.current_recovery.recovery_rekey_rotation_required||proof.recovery_transition_id!==null)throw new Error('Normal v2 rotation activation binds a Pending-Rekey Source.')
  }else if(!prefix.current_recovery.recovery_rekey_rotation_required||prefix.current_recovery.recovery_rekey_transition_id!==proof.recovery_transition_id)throw new Error('Recovery-rekey activation transition binding mismatch.')
  await verifyRecoveryActivationProofV2({proof,source:prefix,announcementEnvelope:prepared(proof.announcement_envelope),confirmationEnvelope:prepared(proof.successor_confirmation_envelope)})
  if(!source.result.source_epoch_sealed||!source.verified.acceptedEnvelopeIds.has(proof.announcement_envelope.envelope_id))throw new Error('v2 rotation activation Source Announcement is not canonically durable.')
  const suffix=source.snapshot.rows.slice(proof.source_anchor_before_announcement.covered_row_count),announcementRow=[proof.announcement_envelope.envelope_id,proof.announcement_envelope.iv,proof.announcement_envelope.ciphertext]
  if(!suffix.length||!same(suffix[0],announcementRow))throw new Error('v2 rotation activation Announcement is not the immediate first post-freeze row.')
  const sourceSalt=await deriveEpochSaltV2(fixedBase64Url(args.diaryId,16),fixedBase64Url(proof.source_epoch_id,16))
  const revision=await openRevisionEnvelopeV2(args.sourceRoot,sourceSalt,{diaryId:args.diaryId,epochId:proof.source_epoch_id},prepared(proof.announcement_envelope))
  const announcement=revision.record_data as RotationAnnouncementV2
  if(revision.record_schema!=='rotation-announcement-sw-v2'||revision.record_type!=='rotation_announcement'||revision.record_status!=='control'||!announcement
    ||announcement.from_epoch_id!==proof.source_epoch_id||announcement.successor_epoch_id!==proof.successor_epoch_id
    ||announcement.successor_manifest_fingerprint!==proof.successor_manifest_fingerprint||announcement.successor_creation_locator!==args.successor.manifest.creation_locator
    ||announcement.rotation_kind!==proof.rotation_kind||announcement.source_writer_generation!==proof.source_writer_generation
    ||announcement.source_writer_grant_id!==proof.source_writer_grant_id||announcement.successor_recovery_generation!==proof.successor_recovery_generation
    ||!same(announcement.source_anchor_before_announcement,proof.source_anchor_before_announcement)||!same(announcement.successor_staging_anchor,proof.successor_staging_anchor)
    ||announcement.recovery_transition_id!==proof.recovery_transition_id)throw new Error('v2 rotation activation Announcement semantic binding mismatch.')
  const stagingRows=args.successor.snapshot.rows.slice(0,proof.successor_staging_anchor.covered_row_count)
  if(!same(await createAnchorV2(args.diaryId,proof.successor_epoch_id,stagingRows),proof.successor_staging_anchor))throw new Error('v2 rotation activation Successor staging anchor mismatch.')
  const firstAfter=args.successor.snapshot.rows[proof.successor_staging_anchor.covered_row_count],confirmationRow=[proof.successor_confirmation_envelope.envelope_id,proof.successor_confirmation_envelope.iv,proof.successor_confirmation_envelope.ciphertext]
  if(!firstAfter||!same(firstAfter,confirmationRow)||!args.successor.verified.acceptedEnvelopeIds.has(proof.successor_confirmation_envelope.envelope_id))throw new Error('v2 rotation activation Confirmation is not canonically first after staging.')
  const confirmation=args.successor.result.accepted_activation_confirmation
  if(!confirmation||confirmation.activation_kind!=='v2_rotation'||confirmation.source_profile!==SINGLE_WRITER_V2_PROFILE
    ||confirmation.source_epoch_id!==proof.source_epoch_id||confirmation.source_manifest_fingerprint!==proof.source_manifest_fingerprint
    ||!same(confirmation.source_anchor_before_announcement,proof.source_anchor_before_announcement)
    ||confirmation.successor_epoch_id!==proof.successor_epoch_id||confirmation.successor_manifest_fingerprint!==proof.successor_manifest_fingerprint
    ||!same(confirmation.successor_staging_anchor,proof.successor_staging_anchor)
    ||confirmation.source_announcement_envelope_sha256!==await v2SourceAnnouncementEnvelopeHashV2(prepared(proof.announcement_envelope)))throw new Error('v2 rotation activation Confirmation evidence mismatch.')
  await verifyNativeV2MigrationIntegrity({source:prefix,successor:args.successor.result,rotationKind:proof.rotation_kind,recoveryTransitionId:proof.recovery_transition_id})
}

export interface CanonicalActivationLineageContextV2 {
  diaryId:string
  epochId:string
  rootKey:Uint8Array
  manifest:ProtectedManifestV6
  snapshot:RemoteSnapshot
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
  remoteId:string
  accountBinding:string
  activationLineage:RecoveryPayloadV6['activation_lineage']
}
export async function verifyActivationLineageForCanonicalEpoch(
  session:TransferableSingleWriterV2ProviderSession,
  context:CanonicalActivationLineageContextV2,
):Promise<void>{
  const lineage=context.activationLineage
  if(context.result.activation_state==='native_active'){
    if(context.manifest.predecessor_epochs.length!==0||lineage.length!==0)throw new Error('Native-v2 activation evidence mismatch.')
    return
  }
  if(context.result.activation_state!=='cross_epoch_evidence_present'||lineage.length===0)throw new Error('Staged or evidence-free v2 Successor is not activatable.')
  const leafCandidate:ActiveCandidateV2={
    artifact:{} as RecoveryArtifactV6,artifactSha256:'',rootKey:context.rootKey,payload:{diary_id:context.diaryId,epoch_id:context.epochId,activation_lineage:lineage} as RecoveryPayloadV6,
    manifest:context.manifest,snapshot:context.snapshot,verified:context.verified,result:context.result,remoteId:context.remoteId,accountBinding:context.accountBinding,
  }
  for(let index=0;index<lineage.length;index+=1){
    const entry=lineage[index]!,successorEpoch=entry.kind==='profile_upgrade'?entry.successor_epoch_id:entry.proof.successor_epoch_id
    let successorRoot:Uint8Array
    if(successorEpoch===context.epochId)successorRoot=context.rootKey
    else{
      const next=lineage[index+1]
      if(!next||next.kind!=='v2_rotation'||next.proof.source_epoch_id!==successorEpoch)throw new Error('ActivationLineageV2 cannot resolve an intermediate Successor root.')
      successorRoot=fixedBase64Url(next.source_root_key,32,'v2_rotation.source_root_key')
    }
    const successor=successorEpoch===context.epochId
      ?{rootKey:context.rootKey,manifest:context.manifest,snapshot:context.snapshot,verified:context.verified,result:context.result,remoteId:context.remoteId,accountBinding:context.accountBinding}
      :await loadLineageEpochV2({session,diaryId:context.diaryId,epochId:successorEpoch,manifestFingerprint:entry.kind==='profile_upgrade'?entry.successor_manifest_fingerprint:entry.proof.successor_manifest_fingerprint,rootKey:successorRoot})
    if(entry.kind==='profile_upgrade'){
      if(index!==0)throw new Error('Profile-upgrade ActivationLineageV2 entry must be first.')
      await verifyProfileUpgradeLineageStep({session,diaryId:context.diaryId,entry,successor})
    }else{
      const sourceRoot=fixedBase64Url(entry.source_root_key,32,'v2_rotation.source_root_key')
      await verifyV2RotationLineageStep({session,diaryId:context.diaryId,sourceRoot,successor,entry})
    }
  }
  void leafCandidate
}
export async function verifyActivationForJoin(session:TransferableSingleWriterV2ProviderSession,candidate:ActiveCandidateV2):Promise<void>{
  return verifyActivationLineageForCanonicalEpoch(session,{
    diaryId:candidate.payload.diary_id,epochId:candidate.payload.epoch_id,rootKey:candidate.rootKey,manifest:candidate.manifest,
    snapshot:candidate.snapshot,verified:candidate.verified,result:candidate.result,remoteId:candidate.remoteId,accountBinding:candidate.accountBinding,
    activationLineage:candidate.payload.activation_lineage,
  })
}
async function discoverActiveCandidate(session:TransferableSingleWriterV2ProviderSession,urs:Uint8Array):Promise<{familyLocator:string;candidate:ActiveCandidateV2}>{
  const familyLocator=await recoveryFamilyLocatorV6(urs)
  if(!session.discoverRecoveryFamilyArtifacts)throw new Error('Recovery-family discovery is unavailable for read-only Join.')
  const artifacts=await session.discoverRecoveryFamilyArtifacts(urs)
  if(!artifacts.length)throw new Error('No RecoveryArtifactV6 family matches this Recovery Key.')
  const active:ActiveCandidateV2[]=[]
  for(const discovered of artifacts){
    const opened=await openRecoveryArtifactV6(discovered.artifact,urs),payload=opened.payload
    const transport=await session.transportForEpoch(payload.diary_id,payload.epoch_id)
    const locator=await epochLocatorV2(payload.diary_id,payload.epoch_id)
    const candidates=await transport.discover(locator)
    if(candidates.length!==1)throw new Error('RecoveryArtifactV6 does not resolve to exactly one authenticated v2 epoch.')
    const remoteId=candidates[0]!.remoteId,snapshot=await transport.read(remoteId)
    const accountBinding=await transport.authenticatedAccountBinding()
    if(accountBinding!==payload.google_account_binding)throw new Error('RecoveryArtifactV6 account binding does not match the authenticated v2 epoch.')
    const manifest=await openManifestV6(opened.rootKey,await deriveEpochSaltV2(fixedBase64Url(payload.diary_id,16),fixedBase64Url(payload.epoch_id,16)),{diaryId:payload.diary_id,epochId:payload.epoch_id},parseManifestCellsV6(snapshot.manifest))
    if(manifest.key_id!==payload.key_id||manifest.google_account_binding!==payload.google_account_binding)throw new Error('RecoveryArtifactV6 does not bind the discovered ManifestV6.')
    const codec=await session.codecForEpoch(payload.diary_id,payload.epoch_id,opened.rootKey,transport)
    const verified=await codec.verifyRemote(snapshot),result=canonicalResult(verified)
    if(result.diary_id!==payload.diary_id||result.epoch_id!==payload.epoch_id||result.manifest_fingerprint!==payload.manifest_fingerprint)throw new Error('RecoveryArtifactV6 identity does not match canonical_full.')
    await assertExtendsAnchorV2(payload.remote_anchor,payload.diary_id,payload.epoch_id,snapshot.rows)
    exactRecoveryBinding(payload,result)

    const candidate:ActiveCandidateV2={
      artifact:discovered.artifact,
      artifactSha256:await recoveryArtifactHashV6(discovered.artifact),
      rootKey:opened.rootKey,
      payload,manifest,snapshot,verified,result,remoteId,accountBinding,
    }
    if(result.source_epoch_sealed||result.activation_state==='staged_confirmation_missing')continue
    await verifyCurrentRecoveryTransitionForJoin(candidate)
    await verifyActivationForJoin(session,candidate)
    active.push(candidate)
  }
  if(active.length!==1)throw new Error(active.length?'Recovery family has multiple unretired canonical v2 leaves.':'Recovery family has no fully activated unretired canonical v2 leaf.')
  return{familyLocator,candidate:active[0]!}
}

async function validateResumePlan(args:{
  plan:ReadOnlyJoinPlanV2
  joinId:string
  familyLocator:string
  candidate:ActiveCandidateV2
  state:EpochLocalSecurityStateV6
}):Promise<void>{
  const {plan,joinId,familyLocator,candidate,state}=args
  if(plan.format!=='read-only-join-v2'||plan.version!==2
    ||plan.join_id!==joinId||plan.recovery_family_locator!==familyLocator
    ||plan.recovery_artifact_sha256!==candidate.artifactSha256
    ||plan.diary_id!==candidate.payload.diary_id||plan.epoch_id!==candidate.payload.epoch_id
    ||plan.manifest_fingerprint!==candidate.payload.manifest_fingerprint||plan.remote_resource_id!==candidate.remoteId)throw new Error('Persisted read-only Join plan does not match the freshly verified remote leaf.')
  fixedBase64Url(plan.join_id,32,'join_id');fixedBase64Url(plan.recovery_artifact_sha256,32,'recovery_artifact_sha256')
  fixedBase64Url(plan.local_writer_device_id,16,'local_writer_device_id');fixedBase64Url(plan.local_writer_key_id,32,'local_writer_key_id')
  await assertExtendsAnchorV2(plan.remote_anchor,plan.diary_id,plan.epoch_id,candidate.snapshot.rows)
  const binding=state.remote_binding
  if(state.diary_id!==plan.diary_id||state.epoch_id!==plan.epoch_id||state.key_id!==candidate.payload.key_id||state.manifest_fingerprint!==plan.manifest_fingerprint
    ||state.writer_device_id!==plan.local_writer_device_id||state.writer_signing_key_id!==plan.local_writer_key_id
    ||binding?.storage_provider_id!==GOOGLE_DRIVE_SHEETS_PROVIDER||binding.sync_profile!==SINGLE_WRITER_V2_PROFILE
    ||binding.remote_resource_id!==plan.remote_resource_id||binding.remote_identity_binding!==candidate.accountBinding)throw new Error('Persisted read-only Join plan is not bound to the authenticated local StateV6.')
}

export class ProductiveReadOnlyJoinV2Service {
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
    private readonly fault?: (point:'after-join-bundle')=>Promise<void>,
  ){}

  private async reconcileForLocalSwitch(args:{
    plan:ReadOnlyJoinPlanV2
    joinId:string
    familyLocator:string
    candidate:ActiveCandidateV2
  }):Promise<EpochLocalSecurityStateV6>{
    const {plan,joinId,familyLocator,candidate}=args
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(candidate.payload.diary_id,16),fixedBase64Url(candidate.payload.epoch_id,16))
    let state=await this.store.loadState(candidate.rootKey,epochSalt,candidate.payload.epoch_id)
    await validateResumePlan({plan,joinId,familyLocator,candidate,state})
    const key=await this.store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
    if(!key||key.writer_device_id!==state.writer_device_id)throw new Error('Persisted read-only Join WriterDeviceKeyV2 is missing or does not match authenticated StateV6.')
    const persistedWrap=await this.store.loadRootWrapV6(state.epoch_id)
    if(persistedWrap.wrap.diary_id!==state.diary_id||persistedWrap.wrap.epoch_id!==state.epoch_id
      ||persistedWrap.wrap.key_id!==state.key_id||persistedWrap.wrap.manifest_fingerprint!==state.manifest_fingerprint)throw new Error('Persisted read-only Join RootWrapV6 is not bound to authenticated StateV6.')
    const openedRoot=await openReadOnlyJoinRootWrapV6WithActiveMode(persistedWrap)
    if(base64Url(openedRoot)!==base64Url(candidate.rootKey))throw new Error('Persisted read-only Join RootWrapV6 does not recover the verified remote root key.')
    if(state.activation_lineage_cache_ref!==null)await this.store.loadActivationLineageCache(candidate.rootKey,epochSalt,state.epoch_id)
    else if(candidate.payload.activation_lineage.length!==0)throw new Error('Persisted read-only Join is missing ActivationLineageCacheV2.')
    const next=await stateAfterCanonicalVerifyV6(state,candidate.result,candidate.snapshot.rows,false)
    state=await this.store.commitVerifiedDispositions(
      candidate.rootKey,
      epochSalt,
      state.operation_generation,
      next,
      candidate.verified.acceptedEnvelopeIds,
      candidate.verified.staleWriterEnvelopeIds,
      {
        remote_manifest:candidate.snapshot.manifest,
        remote_rows:candidate.snapshot.rows,
        current_writer:{
          writer_generation:candidate.result.current_writer.writer_generation,
          writer_grant_id:candidate.result.current_writer.writer_grant_id,
          writer_device_id:candidate.result.current_writer.writer_device_id,
          writer_key_id:candidate.result.current_writer.writer_key_id,
        },
        source_epoch_sealed:candidate.result.source_epoch_sealed,
        recovery_rekey_rotation_required:candidate.result.current_recovery.recovery_rekey_rotation_required,
      },
    )
    if(state.writer_status!=='read_only'||state.writer_generation!==null||state.writer_grant_id!==null||state.epoch_status!=='active')throw new Error('Persisted read-only Join state lost its fail-closed status.')
    return state
  }

  async join(urs:Uint8Array):Promise<ReadOnlyJoinResultV2>{
    if(urs.byteLength!==32)throw new Error('V2 read-only Join requires a 32-byte Recovery Key.')
    const already=await activeProtocolSelectionV2()
    if(already)throw new Error('A v2 epoch is already selected locally; read-only Join is only for a fresh device profile.')
    await assertReadOnlyJoinLocalProfileIsFresh()

    const {familyLocator,candidate}=await discoverActiveCandidate(this.session,urs)
    const joinId=base64Url(await sha256(canonicalBytes(['eds-diary/read-only-join/v2',familyLocator,candidate.payload.diary_id,candidate.payload.epoch_id] as never)))
    const artifactId=`read-only-join:${joinId}`
    const existing=await this.store.operationArtifact<ReadOnlyJoinPlanV2>(artifactId)
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(candidate.payload.diary_id,16),fixedBase64Url(candidate.payload.epoch_id,16))

    if(existing){
      const final=await discoverActiveCandidate(this.session,urs)
      if(final.familyLocator!==familyLocator)throw new Error('Recovery family changed during read-only Join resume.')
      const state=await this.reconcileForLocalSwitch({plan:existing,joinId,familyLocator,candidate:final.candidate})
      await atomicSelectReadOnlyJoinV2({joinId,diaryId:state.diary_id,epochId:state.epoch_id,manifestFingerprint:state.manifest_fingerprint})
      return{joinId,diaryId:state.diary_id,epochId:state.epoch_id,manifestFingerprint:state.manifest_fingerprint,remoteResourceId:final.candidate.remoteId,writerDeviceId:state.writer_device_id,writerKeyId:state.writer_signing_key_id,resumed:true}
    }

    const writer=await generateWriterDeviceKeyV2(),writerDeviceId=base64Url(randomBytes(16))
    const storedWriter:StoredWriterDeviceKeyV2={writer_signing_key_id:writer.writerKeyId,writer_device_id:writerDeviceId,writer_public_key:base64Url(writer.publicKeyRaw),private_key:writer.privateKey}
    let lineageCache:ActivationLineageCacheV2|null=null,cacheRef:EpochLocalSecurityStateV6['activation_lineage_cache_ref']=null
    if(candidate.payload.activation_lineage.length){
      lineageCache=await createActivationLineageCacheV2({rootKey:candidate.rootKey,epochSalt,diaryId:candidate.payload.diary_id,epochId:candidate.payload.epoch_id,manifestFingerprint:candidate.payload.manifest_fingerprint,activationLineage:candidate.payload.activation_lineage})
      cacheRef={cache_id:lineageCache.cache_id,cache_record_hash:await activationLineageCacheHashV2(lineageCache)}
    }
    const state:EpochLocalSecurityStateV6={
      local_state_version:6,
      diary_id:candidate.payload.diary_id,
      epoch_id:candidate.payload.epoch_id,
      key_id:candidate.payload.key_id,
      manifest_fingerprint:candidate.payload.manifest_fingerprint,
      recovery_generation:candidate.result.current_recovery.recovery_generation,
      recovery_urs_commitment:candidate.result.current_recovery.recovery_urs_commitment,
      recovery_urs_id:candidate.result.current_recovery.recovery_urs_id,
      recovery_rekey_rotation_required:candidate.result.current_recovery.recovery_rekey_rotation_required,
      recovery_rekey_transition_id:candidate.result.current_recovery.recovery_rekey_transition_id,
      remote_binding:{storage_provider_id:GOOGLE_DRIVE_SHEETS_PROVIDER,sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:candidate.remoteId,remote_identity_binding:candidate.accountBinding},
      remote_anchor:{...candidate.result.remote_anchor},
      epoch_status:'active',
      operation_generation:0,
      rotation_state_ref:null,
      migration_state_ref:null,
      writer_operation_state_ref:null,
      recovery_operation_state_ref:null,
      activation_lineage_cache_ref:cacheRef,
      local_journal_count:0,
      local_journal_hash:await localJournalInitialV2(candidate.payload.diary_id,candidate.payload.epoch_id),
      writer_status:'read_only',
      writer_device_id:writerDeviceId,
      writer_signing_key_id:writer.writerKeyId,
      writer_generation:null,
      writer_grant_id:null,
      verified_writer_device_id:candidate.result.current_writer.writer_device_id,
      verified_writer_key_id:candidate.result.current_writer.writer_key_id,
      verified_writer_generation:candidate.result.current_writer.writer_generation,
      verified_writer_grant_id:candidate.result.current_writer.writer_grant_id,
      recovery_takeover_key_id:candidate.result.current_recovery.recovery_takeover_key_id,
      recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(candidate.result.recovery_credential_history),
      stale_writer_pending_count:0,
    }
    const wrap=await prepareReadOnlyJoinRootWrapV6ForActiveMode(candidate.rootKey,{diary_id:state.diary_id,epoch_id:state.epoch_id,key_id:state.key_id,manifest_fingerprint:state.manifest_fingerprint},randomBytes(16))
    const plan:ReadOnlyJoinPlanV2={
      format:'read-only-join-v2',version:2,join_id:joinId,recovery_family_locator:familyLocator,
      recovery_artifact_sha256:candidate.artifactSha256,diary_id:state.diary_id,epoch_id:state.epoch_id,
      manifest_fingerprint:state.manifest_fingerprint,remote_resource_id:candidate.remoteId,remote_anchor:{...candidate.result.remote_anchor},
      local_writer_device_id:writerDeviceId,local_writer_key_id:writer.writerKeyId,
    }
    await this.store.persistReadOnlyJoinBundle({artifactId,artifactValue:plan,rootKey:candidate.rootKey,epochSalt,rootWrap:wrap.wrap,bestEffortWrappingKey:wrap.bestEffortWrappingKey,writerKey:storedWriter,state,lineageCache})
    await this.fault?.('after-join-bundle')
    const final=await discoverActiveCandidate(this.session,urs)
    if(final.familyLocator!==familyLocator)throw new Error('Recovery family changed before read-only Join local switch.')
    const finalState=await this.reconcileForLocalSwitch({plan,joinId,familyLocator,candidate:final.candidate})
    await atomicSelectReadOnlyJoinV2({joinId,diaryId:finalState.diary_id,epochId:finalState.epoch_id,manifestFingerprint:finalState.manifest_fingerprint})
    return{joinId,diaryId:finalState.diary_id,epochId:finalState.epoch_id,manifestFingerprint:finalState.manifest_fingerprint,remoteResourceId:final.candidate.remoteId,writerDeviceId:finalState.writer_device_id,writerKeyId:finalState.writer_signing_key_id,resumed:false}
  }
}
