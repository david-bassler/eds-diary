import { aesGcmDecrypt,aesGcmEncrypt,deriveRecoveryKey,randomBytes,recoveryCommitment } from './crypto/core'
import { base64Url,fixedBase64Url,fromBase64Url } from './crypto/bytes'
import { canonicalBytes,parseCanonicalJson } from './crypto/canonical'
import type { RemoteAnchor } from '../sync/core/prefix'

export interface RecoveryArtifact {format:'sync-recovery-v5';version:5;recovery_artifact_id:string;kdf_profile_id:'recovery-hkdf-v5-1';salt:string;wrap_iv:string;wrapped_payload:string}
export interface RecoveryPayload {recovery_artifact_id:string;diary_id:string;epoch_id:string;key_id:string;RK_epoch:string;manifest_fingerprint:string;remote_anchor:RemoteAnchor|null;google_account_binding:string;recovery_generation:number;created_at:string}
const RECOVERY_KEYS=['created_at','diary_id','epoch_id','google_account_binding','key_id','manifest_fingerprint','recovery_artifact_id','recovery_generation','remote_anchor','RK_epoch']
function validateArtifact(value:RecoveryArtifact):void{if(!value||typeof value!=='object'||Object.keys(value).sort().join('\0')!==['format','version','recovery_artifact_id','kdf_profile_id','salt','wrap_iv','wrapped_payload'].sort().join('\0')||value.format!=='sync-recovery-v5'||value.version!==5||value.kdf_profile_id!=='recovery-hkdf-v5-1')throw new Error('Recovery artifact schema mismatch.');fixedBase64Url(value.recovery_artifact_id,16);fixedBase64Url(value.salt,32);fixedBase64Url(value.wrap_iv,12);if(fromBase64Url(value.wrapped_payload).byteLength<16||fromBase64Url(value.wrapped_payload).byteLength>65_536)throw new Error('Recovery ciphertext bound exceeded.')}
function validateAnchor(anchor:RemoteAnchor|null):void{if(anchor===null)return;if(!anchor||typeof anchor!=='object'||Object.keys(anchor).sort().join('\0')!==['anchor_profile','covered_row_count','prefix_hash'].sort().join('\0')||anchor.anchor_profile!=='google-sheets-single-writer-v1'||!Number.isSafeInteger(anchor.covered_row_count)||anchor.covered_row_count<0)throw new Error('Recovery anchor schema mismatch.');fixedBase64Url(anchor.prefix_hash,32)}
function validatePayload(value:RecoveryPayload):void{if(!value||typeof value!=='object'||Object.keys(value).sort().join('\0')!==RECOVERY_KEYS.sort().join('\0'))throw new Error('Recovery payload schema mismatch.');fixedBase64Url(value.recovery_artifact_id,16);fixedBase64Url(value.diary_id,16);fixedBase64Url(value.epoch_id,16);fixedBase64Url(value.key_id,16);fixedBase64Url(value.RK_epoch,32);fixedBase64Url(value.manifest_fingerprint,32);fixedBase64Url(value.google_account_binding,32);if(!Number.isSafeInteger(value.recovery_generation)||value.recovery_generation<0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value.created_at))throw new Error('Recovery payload scalar mismatch.');validateAnchor(value.remote_anchor)}
function aad(a:Omit<RecoveryArtifact,'wrapped_payload'>):Uint8Array{return canonicalBytes(a)}
export async function createRecovery(payload:Omit<RecoveryPayload,'recovery_artifact_id'|'remote_anchor'>&{remote_anchor:unknown},urs:Uint8Array,id=randomBytes(16),salt=randomBytes(32),iv=randomBytes(12)):Promise<RecoveryArtifact>{
  const recovery_artifact_id=base64Url(id),header={format:'sync-recovery-v5' as const,version:5 as const,recovery_artifact_id,kdf_profile_id:'recovery-hkdf-v5-1' as const,salt:base64Url(salt),wrap_iv:base64Url(iv)}
  const complete={...payload,recovery_artifact_id} as RecoveryPayload;validatePayload(complete);const encrypted=await aesGcmEncrypt(await deriveRecoveryKey(urs,salt),canonicalBytes(complete as never),aad(header),iv)
  return {...header,wrapped_payload:base64Url(encrypted.ciphertext)}
}
export async function recoverRootKeyCandidate(artifact:RecoveryArtifact,urs:Uint8Array,manifestCommitment:string):Promise<{rootKey:Uint8Array;payload:RecoveryPayload}>{
  validateArtifact(artifact);const header={format:artifact.format,version:artifact.version,recovery_artifact_id:artifact.recovery_artifact_id,kdf_profile_id:artifact.kdf_profile_id,salt:artifact.salt,wrap_iv:artifact.wrap_iv}
  const plaintext=await aesGcmDecrypt(await deriveRecoveryKey(urs,fixedBase64Url(artifact.salt,32)),fromBase64Url(artifact.wrapped_payload),aad(header),fixedBase64Url(artifact.wrap_iv,12)),payload=parseCanonicalJson(plaintext) as unknown as RecoveryPayload
  validatePayload(payload);if(payload.recovery_artifact_id!==artifact.recovery_artifact_id)throw new Error('Recovery artifact binding mismatch.');const diary=fixedBase64Url(payload.diary_id,16),rootKey=fixedBase64Url(payload.RK_epoch,32)
  if(await recoveryCommitment(urs,diary,payload.recovery_generation)!==manifestCommitment)throw new Error('Recovery secret continuity check failed.')
  return {rootKey,payload}
}
export interface RecoveryBootstrapProof {readonly manifestFingerprint:string;readonly diaryId:string;readonly epochId:string;readonly keyId:string;readonly recoveryGeneration:number;readonly accountBinding:string;readonly anchor:RemoteAnchor|null}
const issuedProofs=new WeakSet<object>()
/** Called only after a production full remote/backup verification boundary. */
export function issueRecoveryBootstrapProof(binding:RecoveryBootstrapProof):RecoveryBootstrapProof{const proof=Object.freeze({...binding});issuedProofs.add(proof);return proof}
/** Activation consumes an explicit proof from the full remote/backup verifier;
 * AEAD unwrap or a generic callback can never be the activation boundary. */
export async function activateRecoveredRoot(candidate:{rootKey:Uint8Array;payload:RecoveryPayload},proof:RecoveryBootstrapProof,persistWrap:(rootKey:Uint8Array,payload:RecoveryPayload)=>Promise<void>):Promise<void>{const p=candidate.payload;validatePayload(p);if(!issuedProofs.has(proof as object)||proof.manifestFingerprint!==p.manifest_fingerprint||proof.diaryId!==p.diary_id||proof.epochId!==p.epoch_id||proof.keyId!==p.key_id||proof.recoveryGeneration!==p.recovery_generation||proof.accountBinding!==p.google_account_binding||JSON.stringify(proof.anchor)!==JSON.stringify(p.remote_anchor))throw new Error('Recovery bootstrap proof does not bind the candidate.');await persistWrap(candidate.rootKey,p)}
