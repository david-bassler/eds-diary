import { aesGcmDecrypt,aesGcmEncrypt,deriveRecoveryKey,randomBytes,recoveryCommitment } from './crypto/core'
import { base64Url,fixedBase64Url,fromBase64Url } from './crypto/bytes'
import { canonicalBytes,parseCanonicalJson } from './crypto/canonical'

export interface RecoveryArtifact {format:'sync-recovery-v5';version:5;recovery_artifact_id:string;kdf_profile_id:'recovery-hkdf-v5-1';salt:string;wrap_iv:string;wrapped_payload:string}
export interface RecoveryPayload {recovery_artifact_id:string;diary_id:string;epoch_id:string;key_id:string;RK_epoch:string;manifest_fingerprint:string;remote_anchor:unknown;google_account_binding:string;recovery_generation:number;created_at:string}
function aad(a:Omit<RecoveryArtifact,'wrapped_payload'>):Uint8Array{return canonicalBytes(a)}
export async function createRecovery(payload:Omit<RecoveryPayload,'recovery_artifact_id'>,urs:Uint8Array,id=randomBytes(16),salt=randomBytes(32),iv=randomBytes(12)):Promise<RecoveryArtifact>{
  const recovery_artifact_id=base64Url(id),header={format:'sync-recovery-v5' as const,version:5 as const,recovery_artifact_id,kdf_profile_id:'recovery-hkdf-v5-1' as const,salt:base64Url(salt),wrap_iv:base64Url(iv)}
  const encrypted=await aesGcmEncrypt(await deriveRecoveryKey(urs,salt),canonicalBytes({...payload,recovery_artifact_id} as never),aad(header),iv)
  return {...header,wrapped_payload:base64Url(encrypted.ciphertext)}
}
export async function recoverRootKeyCandidate(artifact:RecoveryArtifact,urs:Uint8Array,manifestCommitment:string):Promise<{rootKey:Uint8Array;payload:RecoveryPayload}>{
  fixedBase64Url(artifact.recovery_artifact_id,16);const header={format:artifact.format,version:artifact.version,recovery_artifact_id:artifact.recovery_artifact_id,kdf_profile_id:artifact.kdf_profile_id,salt:artifact.salt,wrap_iv:artifact.wrap_iv}
  const plaintext=await aesGcmDecrypt(await deriveRecoveryKey(urs,fixedBase64Url(artifact.salt,32)),fromBase64Url(artifact.wrapped_payload),aad(header),fixedBase64Url(artifact.wrap_iv,12)),payload=parseCanonicalJson(plaintext) as unknown as RecoveryPayload
  if(payload.recovery_artifact_id!==artifact.recovery_artifact_id)throw new Error('Recovery artifact binding mismatch.');const diary=fixedBase64Url(payload.diary_id,16),rootKey=fixedBase64Url(payload.RK_epoch,32)
  if(await recoveryCommitment(urs,diary,payload.recovery_generation)!==manifestCommitment)throw new Error('Recovery secret continuity check failed.')
  return {rootKey,payload}
}
export interface RecoveryBootstrapProof {manifestFingerprint:string;diaryId:string;epochId:string;keyId:string;recoveryGeneration:number;accountBinding:string;anchorVerified:boolean;allRowsVerified:boolean;graphVerified:boolean}
/** Activation consumes an explicit proof from the full remote/backup verifier;
 * AEAD unwrap or a generic callback can never be the activation boundary. */
export async function activateRecoveredRoot(candidate:{rootKey:Uint8Array;payload:RecoveryPayload},proof:RecoveryBootstrapProof,persistWrap:(rootKey:Uint8Array,payload:RecoveryPayload)=>Promise<void>):Promise<void>{const p=candidate.payload;if(!proof.anchorVerified||!proof.allRowsVerified||!proof.graphVerified||proof.manifestFingerprint!==p.manifest_fingerprint||proof.diaryId!==p.diary_id||proof.epochId!==p.epoch_id||proof.keyId!==p.key_id||proof.recoveryGeneration!==p.recovery_generation||proof.accountBinding!==p.google_account_binding)throw new Error('Recovery bootstrap proof does not bind the candidate.');await persistWrap(candidate.rootKey,p)}
