import { base64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { randomBytes, sha256 } from '../crypto/core'
import { revisionSigningBytesV2, signEd25519V2 } from './crypto'
import type { PreparedEnvelope } from '../envelopes'
import type { RecoveryAuthorityTransitionProofV2 } from './recovery'
import type { RecoveryAuthorityTransitionV2, RevisionV2, WriterContextV2 } from './types'
import { validateRecoveryAuthorityTransitionV2, validateRevisionV2 } from './validators'

function randomId(length:16|32):string{return base64Url(randomBytes(length))}

export async function createRecoveryAuthorityTransitionRevisionV2(args:{
  diaryId:string
  epochId:string
  transitionId:string
  fromRecoveryGeneration:number
  fromRecoveryUrsId:string
  fromRecoveryTakeoverKeyId:string
  toRecoveryGeneration:number
  toRecoveryUrsCommitment:string
  toRecoveryUrsId:string
  toRecoveryTakeoverKeyId:string
  toRecoveryTakeoverPublicKey:string
  authorityAnchor:RecoveryAuthorityTransitionV2['authority_anchor']
  writerContext:WriterContextV2
  writerPrivateKey:CryptoKey
  protocolCreatedAt:string
  recordId?:string
  revisionId?:string
}):Promise<{transition:RecoveryAuthorityTransitionV2;revision:RevisionV2<RecoveryAuthorityTransitionV2>}>{
  const transition:RecoveryAuthorityTransitionV2={
    transition_id:args.transitionId,transition_kind:'recovery_rekey',
    from_recovery_generation:args.fromRecoveryGeneration,from_recovery_urs_id:args.fromRecoveryUrsId,from_recovery_takeover_key_id:args.fromRecoveryTakeoverKeyId,
    to_recovery_generation:args.toRecoveryGeneration,to_recovery_urs_commitment:args.toRecoveryUrsCommitment,to_recovery_urs_id:args.toRecoveryUrsId,
    to_recovery_takeover_key_id:args.toRecoveryTakeoverKeyId,to_recovery_takeover_public_key:args.toRecoveryTakeoverPublicKey,
    authority_anchor:{...args.authorityAnchor},
  }
  await validateRecoveryAuthorityTransitionV2(transition)
  const revision:RevisionV2<RecoveryAuthorityTransitionV2>={
    record_type:'recovery_authority_transition',record_schema:'recovery-authority-transition-sw-v2',
    record_id:args.recordId??randomId(16),revision_id:args.revisionId??randomId(32),parent_revision_ids:[],record_status:'control',
    record_data:transition,migration_origin:null,protocol_created_at:args.protocolCreatedAt,writer_context:{...args.writerContext},writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(args.writerPrivateKey,revisionSigningBytesV2(args.diaryId,args.epochId,revision))
  await validateRevisionV2(revision)
  return{transition,revision}
}

export function createRecoveryAuthorityTransitionProofV2(args:{
  sourceEpochId:string
  sourceManifestFingerprint:string
  transition:RecoveryAuthorityTransitionV2
  transitionEnvelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>
}):RecoveryAuthorityTransitionProofV2{
  return{
    format:'recovery-authority-transition-proof-v2',version:2,source_epoch_id:args.sourceEpochId,source_manifest_fingerprint:args.sourceManifestFingerprint,
    authority_anchor_before_transition:{...args.transition.authority_anchor},from_recovery_generation:args.transition.from_recovery_generation,
    from_recovery_urs_id:args.transition.from_recovery_urs_id,from_recovery_takeover_key_id:args.transition.from_recovery_takeover_key_id,
    to_recovery_generation:args.transition.to_recovery_generation,to_recovery_urs_commitment:args.transition.to_recovery_urs_commitment,
    to_recovery_urs_id:args.transition.to_recovery_urs_id,to_recovery_takeover_key_id:args.transition.to_recovery_takeover_key_id,
    to_recovery_takeover_public_key:args.transition.to_recovery_takeover_public_key,
    transition_envelope:{envelope_id:args.transitionEnvelope.envelopeId,iv:args.transitionEnvelope.iv,ciphertext:args.transitionEnvelope.ciphertext},
  }
}
export async function recoveryAuthorityTransitionProofHashV2(proof:RecoveryAuthorityTransitionProofV2):Promise<string>{
  return base64Url(await sha256(canonicalBytes(proof as never)))
}
