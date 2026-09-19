import { aesGcmDecrypt, aesGcmEncrypt, deriveStateMacKey, hmacSha256, randomBytes, sha256 } from './crypto/core'
import { arrayBuffer, base64Url, concatBytes, equalBytes, fixedBase64Url, fromBase64Url, uint64be, utf8 } from './crypto/bytes'
import { canonicalBytes } from './crypto/canonical'
import { passphraseKek, prfKek } from './securityModes'
import type { PreparedEnvelope } from './envelopes'
import type { RemoteAnchorV1 } from '../sync/core/prefix'
import { SINGLE_WRITER_V1_PROFILE } from '../sync/core/contracts'

export type EpochStatus='local_offline'|'remote_bound'|'active'|'offline_restored'|'retired'|'orphaned'
export interface SecurityStateRef {operation_id:string;state:string;state_record_hash:string}
export interface RemoteBindingV1 {provider_id:typeof SINGLE_WRITER_V1_PROFILE;remote_resource_id:string;remote_identity_binding:string}
export interface EpochLocalSecurityStateV5 {local_state_version:5;diary_id:string;epoch_id:string;key_id:string;manifest_fingerprint:string;recovery_generation:number;recovery_urs_commitment:string;remote_binding:null|RemoteBindingV1;remote_anchor:RemoteAnchorV1|null;epoch_status:EpochStatus;operation_generation:number;rotation_state_ref:SecurityStateRef|null;migration_state_ref:SecurityStateRef|null;local_journal_count:number;local_journal_hash:string}
/** Backwards-compatible alias for the only currently persisted state version. */
export type EpochLocalSecurityState = EpochLocalSecurityStateV5

interface RootWrapBase {local_wrap_version:5;diary_id:string;epoch_id:string;key_id:string;manifest_fingerprint:string;wrap_id:string;wrap_iv:string;wrapped_root_key:string}
export interface BestEffortRootWrap extends RootWrapBase {mode:'best-effort';mode_metadata:Record<string,never>}
export interface PassphraseRootWrap extends RootWrapBase {mode:'passphrase';mode_metadata:{passphrase_profile:'argon2id-v5-1';passphrase_salt:string}}
export interface PrfRootWrap extends RootWrapBase {mode:'prf';mode_metadata:{prf_profile:'webauthn-prf-v5-1';credential_id:string;prf_eval_input:string;prf_wrap_salt:string;rp_id:string}}
export type RootWrap=BestEffortRootWrap|PassphraseRootWrap|PrfRootWrap
export type RootWrapIdentity=Pick<RootWrapBase,'diary_id'|'epoch_id'|'key_id'|'manifest_fingerprint'>

const zero=new Uint8Array([0])
export async function journalInitial(diaryId:string,epochId:string):Promise<string>{return base64Url(await sha256(concatBytes(utf8('eds-diary/local-journal/v5'),zero,fixedBase64Url(diaryId,16),fixedBase64Url(epochId,16))))}
export async function journalNext(previous:string,sequence:number,envelope:Pick<PreparedEnvelope,'envelopeId'|'iv'|'ciphertext'>):Promise<string>{const entry=await sha256(canonicalBytes([envelope.envelopeId,envelope.iv,envelope.ciphertext]));return base64Url(await sha256(concatBytes(fixedBase64Url(previous,32),uint64be(sequence),entry)))}
export async function stateTag(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV5):Promise<string>{return base64Url(await hmacSha256(await deriveStateMacKey(rootKey,epochSalt),canonicalBytes(state as never)))}
export async function verifyStateTag(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV5,tag:string):Promise<void>{if(!equalBytes(fixedBase64Url(tag,32),fromBase64Url(await stateTag(rootKey,epochSalt,state))))throw new Error('Local security state MAC failed.')}

function rootWrapHeader(wrap:RootWrap):Omit<RootWrap,'wrapped_root_key'|'wrap_iv'>{return{local_wrap_version:wrap.local_wrap_version,mode:wrap.mode,diary_id:wrap.diary_id,epoch_id:wrap.epoch_id,key_id:wrap.key_id,manifest_fingerprint:wrap.manifest_fingerprint,wrap_id:wrap.wrap_id,mode_metadata:wrap.mode_metadata} as Omit<RootWrap,'wrapped_root_key'|'wrap_iv'>}
const wrapAad=(wrap:Omit<RootWrap,'wrapped_root_key'|'wrap_iv'>)=>canonicalBytes(wrap as never)
function assertRootKey(rootKey:Uint8Array):void{if(rootKey.byteLength!==32)throw new Error('Root key must contain 32 bytes.')}

export async function createBestEffortRootWrap(rootKey:Uint8Array,wrappingKey:CryptoKey,identity:RootWrapIdentity,id=randomBytes(16),iv=randomBytes(12)):Promise<BestEffortRootWrap>{
  assertRootKey(rootKey);if(wrappingKey.extractable)throw new Error('Invalid best-effort wrapping boundary.')
  const header={local_wrap_version:5 as const,mode:'best-effort'as const,...identity,wrap_id:base64Url(id),mode_metadata:{}}
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:arrayBuffer(iv),additionalData:arrayBuffer(wrapAad(header)),tagLength:128},wrappingKey,arrayBuffer(rootKey))
  return{...header,wrap_iv:base64Url(iv),wrapped_root_key:base64Url(new Uint8Array(ciphertext))}
}
export async function openBestEffortRootWrap(wrap:RootWrap,wrappingKey:CryptoKey):Promise<Uint8Array>{
  if(wrap.mode!=='best-effort'||Object.keys(wrap.mode_metadata).length!==0)throw new Error('Root wrap is not best-effort mode.')
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:arrayBuffer(fixedBase64Url(wrap.wrap_iv,12)),additionalData:arrayBuffer(wrapAad(rootWrapHeader(wrap))),tagLength:128},wrappingKey,arrayBuffer(fromBase64Url(wrap.wrapped_root_key))))
}

export async function createPassphraseRootWrap(rootKey:Uint8Array,passphrase:string,identity:RootWrapIdentity,id=randomBytes(16),passphraseSalt=randomBytes(16),iv=randomBytes(12)):Promise<PassphraseRootWrap>{
  assertRootKey(rootKey);if(id.byteLength!==16||passphraseSalt.byteLength!==16||iv.byteLength!==12)throw new Error('Invalid passphrase wrap randomness.')
  const mode_metadata={passphrase_profile:'argon2id-v5-1' as const,passphrase_salt:base64Url(passphraseSalt)},header={local_wrap_version:5 as const,mode:'passphrase'as const,...identity,wrap_id:base64Url(id),mode_metadata}
  const kek=await passphraseKek(passphrase,passphraseSalt,identity.diary_id,identity.epoch_id,identity.key_id),encrypted=await aesGcmEncrypt(kek,rootKey,wrapAad(header),iv)
  return{...header,wrap_iv:base64Url(encrypted.iv),wrapped_root_key:base64Url(encrypted.ciphertext)}
}
export async function openPassphraseRootWrap(wrap:RootWrap,passphrase:string):Promise<Uint8Array>{
  if(wrap.mode!=='passphrase'||wrap.mode_metadata.passphrase_profile!=='argon2id-v5-1')throw new Error('Root wrap is not passphrase mode.')
  const salt=fixedBase64Url(wrap.mode_metadata.passphrase_salt,16,'passphrase_salt'),kek=await passphraseKek(passphrase,salt,wrap.diary_id,wrap.epoch_id,wrap.key_id)
  return aesGcmDecrypt(kek,fromBase64Url(wrap.wrapped_root_key),wrapAad(rootWrapHeader(wrap)),fixedBase64Url(wrap.wrap_iv,12,'wrap_iv'))
}

export interface PrfWrapEnrollmentMaterial {credentialId:Uint8Array;prfEvalInput:Uint8Array;prfOutput:Uint8Array;rpId:string}
export async function createPrfRootWrap(rootKey:Uint8Array,material:PrfWrapEnrollmentMaterial,identity:RootWrapIdentity,id=randomBytes(16),wrapSalt=randomBytes(32),iv=randomBytes(12)):Promise<PrfRootWrap>{
  assertRootKey(rootKey);if(id.byteLength!==16||material.prfEvalInput.byteLength!==32||material.prfOutput.byteLength!==32||wrapSalt.byteLength!==32||iv.byteLength!==12||!material.credentialId.byteLength||!material.rpId)throw new Error('Invalid WebAuthn PRF wrap enrollment material.')
  const mode_metadata={prf_profile:'webauthn-prf-v5-1' as const,credential_id:base64Url(material.credentialId),prf_eval_input:base64Url(material.prfEvalInput),prf_wrap_salt:base64Url(wrapSalt),rp_id:material.rpId},header={local_wrap_version:5 as const,mode:'prf'as const,...identity,wrap_id:base64Url(id),mode_metadata}
  const kek=await prfKek(material.prfOutput,wrapSalt,identity.diary_id,identity.epoch_id,identity.key_id,material.credentialId),encrypted=await aesGcmEncrypt(kek,rootKey,wrapAad(header),iv)
  return{...header,wrap_iv:base64Url(encrypted.iv),wrapped_root_key:base64Url(encrypted.ciphertext)}
}
export async function openPrfRootWrap(wrap:RootWrap,assertedCredentialId:Uint8Array,prfOutput:Uint8Array):Promise<Uint8Array>{
  if(wrap.mode!=='prf'||wrap.mode_metadata.prf_profile!=='webauthn-prf-v5-1')throw new Error('Root wrap is not WebAuthn PRF mode.')
  const expected=fromBase64Url(wrap.mode_metadata.credential_id);if(expected.byteLength!==assertedCredentialId.byteLength||expected.some((byte,index)=>byte!==assertedCredentialId[index]))throw new Error('WebAuthn credential does not match the root wrap.')
  const salt=fixedBase64Url(wrap.mode_metadata.prf_wrap_salt,32,'prf_wrap_salt')
  return aesGcmDecrypt(await prfKek(prfOutput,salt,wrap.diary_id,wrap.epoch_id,wrap.key_id,expected),fromBase64Url(wrap.wrapped_root_key),wrapAad(rootWrapHeader(wrap)),fixedBase64Url(wrap.wrap_iv,12,'wrap_iv'))
}

export async function withDiaryLock<T>(diaryId:string,operation:()=>Promise<T>):Promise<T>{const manager=globalThis.navigator?.locks;if(!manager){if(typeof window!=='undefined')throw new Error('Web Locks are required for secure mutations.');return operation()}return manager.request(`eds-diary/security/${diaryId}`,{mode:'exclusive'},operation)}
