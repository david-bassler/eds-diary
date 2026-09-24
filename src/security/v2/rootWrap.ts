import { arrayBuffer, base64Url, concatBytes, fixedBase64Url, fromBase64Url, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, derivePassphraseMaterial, hkdfSha256, randomBytes, sha256, validatePassphrase } from '../crypto/core'

interface RootWrapBaseV6 {
  local_wrap_version:6
  mode:'best-effort'|'prf'|'passphrase'
  diary_id:string
  epoch_id:string
  key_id:string
  manifest_fingerprint:string
  wrap_id:string
  wrap_iv:string
  wrapped_root_key:string
}
export interface BestEffortRootWrapV6 extends RootWrapBaseV6 {mode:'best-effort';mode_metadata:Record<string,never>}
export interface PassphraseRootWrapV6 extends RootWrapBaseV6 {mode:'passphrase';mode_metadata:{passphrase_profile:'argon2id-v6-1';passphrase_salt:string}}
export interface PrfRootWrapV6 extends RootWrapBaseV6 {mode:'prf';mode_metadata:{prf_profile:'webauthn-prf-v6-1';credential_id:string;prf_eval_input:string;prf_wrap_salt:string;rp_id:string}}
export type RootWrapV6=BestEffortRootWrapV6|PassphraseRootWrapV6|PrfRootWrapV6
export type RootWrapIdentityV6=Pick<RootWrapBaseV6,'diary_id'|'epoch_id'|'key_id'|'manifest_fingerprint'>

const ZERO=new Uint8Array([0])
const ROOT_KEYS=['local_wrap_version','mode','diary_id','epoch_id','key_id','manifest_fingerprint','wrap_id','wrap_iv','wrapped_root_key','mode_metadata'] as const
function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function assertIdentity(identity:RootWrapIdentityV6):void{
  fixedBase64Url(identity.diary_id,16,'diary_id');fixedBase64Url(identity.epoch_id,16,'epoch_id');fixedBase64Url(identity.key_id,16,'key_id');fixedBase64Url(identity.manifest_fingerprint,32,'manifest_fingerprint')
}
function assertRoot(rootKey:Uint8Array):void{if(rootKey.byteLength!==32)throw new Error('RootWrapV6 root key must contain 32 bytes.')}
function header(wrap:RootWrapV6):Omit<RootWrapV6,'wrap_iv'|'wrapped_root_key'>{
  return{local_wrap_version:wrap.local_wrap_version,mode:wrap.mode,diary_id:wrap.diary_id,epoch_id:wrap.epoch_id,key_id:wrap.key_id,manifest_fingerprint:wrap.manifest_fingerprint,wrap_id:wrap.wrap_id,mode_metadata:wrap.mode_metadata} as Omit<RootWrapV6,'wrap_iv'|'wrapped_root_key'>
}
function aad(value:Omit<RootWrapV6,'wrap_iv'|'wrapped_root_key'>):Uint8Array{return canonicalBytes(value as never)}
function assertAesWrappingKey(key:CryptoKey):void{
  const algorithm=key.algorithm as AesKeyAlgorithm
  if(key.type!=='secret'||key.extractable||key.algorithm.name!=='AES-GCM'||algorithm.length!==256||!key.usages.includes('encrypt')||!key.usages.includes('decrypt'))throw new Error('RootWrapV6 best-effort wrapping key is invalid.')
}
export async function generateBestEffortWrappingKeyV6():Promise<CryptoKey>{
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
  assertAesWrappingKey(key)
  return key
}
export function validateRootWrapV6(wrap:RootWrapV6):void{
  if(!wrap||typeof wrap!=='object')throw new Error('RootWrapV6 schema mismatch.')
  exact(wrap,ROOT_KEYS,'RootWrapV6')
  if(wrap.local_wrap_version!==6)throw new Error('RootWrapV6 version mismatch.')
  assertIdentity(wrap)
  fixedBase64Url(wrap.wrap_id,16,'wrap_id');fixedBase64Url(wrap.wrap_iv,12,'wrap_iv')
  if(fromBase64Url(wrap.wrapped_root_key).byteLength!==48)throw new Error('RootWrapV6 ciphertext length mismatch.')
  if(wrap.mode==='best-effort'){
    if(Object.keys(wrap.mode_metadata).length!==0)throw new Error('Best-effort RootWrapV6 mode_metadata must be empty.')
  }else if(wrap.mode==='passphrase'){
    exact(wrap.mode_metadata,['passphrase_profile','passphrase_salt'],'RootWrapV6 passphrase metadata')
    if(wrap.mode_metadata.passphrase_profile!=='argon2id-v6-1')throw new Error('RootWrapV6 passphrase profile mismatch.')
    fixedBase64Url(wrap.mode_metadata.passphrase_salt,16,'passphrase_salt')
  }else if(wrap.mode==='prf'){
    exact(wrap.mode_metadata,['prf_profile','credential_id','prf_eval_input','prf_wrap_salt','rp_id'],'RootWrapV6 PRF metadata')
    if(wrap.mode_metadata.prf_profile!=='webauthn-prf-v6-1'||!wrap.mode_metadata.rp_id)throw new Error('RootWrapV6 PRF profile mismatch.')
    if(fromBase64Url(wrap.mode_metadata.credential_id).byteLength<1)throw new Error('RootWrapV6 credential ID is empty.')
    fixedBase64Url(wrap.mode_metadata.prf_eval_input,32,'prf_eval_input');fixedBase64Url(wrap.mode_metadata.prf_wrap_salt,32,'prf_wrap_salt')
  }else throw new Error('RootWrapV6 mode mismatch.')
}
async function passphraseKekV6(passphrase:string,salt:Uint8Array,identity:RootWrapIdentityV6):Promise<Uint8Array>{
  validatePassphrase(passphrase)
  if(salt.byteLength!==16)throw new Error('RootWrapV6 passphrase salt must contain 16 bytes.')
  const diary=fixedBase64Url(identity.diary_id,16),epoch=fixedBase64Url(identity.epoch_id,16),key=fixedBase64Url(identity.key_id,16)
  const saltDomain=await sha256(concatBytes(utf8('eds-diary/local-passphrase-salt/v6'),ZERO,diary,epoch))
  const context=concatBytes(utf8('eds-diary/local-passphrase-wrap/v6'),ZERO,diary,epoch,key)
  return hkdfSha256(derivePassphraseMaterial(passphrase,salt),saltDomain,context)
}
async function prfKekV6(prfOutput:Uint8Array,wrapSalt:Uint8Array,identity:RootWrapIdentityV6,credentialId:Uint8Array):Promise<Uint8Array>{
  if(prfOutput.byteLength!==32||wrapSalt.byteLength!==32||credentialId.byteLength<1)throw new Error('RootWrapV6 PRF material is invalid.')
  const diary=fixedBase64Url(identity.diary_id,16),epoch=fixedBase64Url(identity.epoch_id,16),key=fixedBase64Url(identity.key_id,16),credentialHash=await sha256(credentialId)
  return hkdfSha256(prfOutput,wrapSalt,concatBytes(utf8('eds-diary/local-prf-wrap/v6'),ZERO,diary,epoch,key,credentialHash))
}
export async function createBestEffortRootWrapV6(rootKey:Uint8Array,wrappingKey:CryptoKey,identity:RootWrapIdentityV6,id=randomBytes(16),iv=randomBytes(12)):Promise<BestEffortRootWrapV6>{
  assertRoot(rootKey);assertIdentity(identity);assertAesWrappingKey(wrappingKey)
  if(id.byteLength!==16||iv.byteLength!==12)throw new Error('RootWrapV6 randomness mismatch.')
  const base={local_wrap_version:6 as const,mode:'best-effort' as const,...identity,wrap_id:base64Url(id),mode_metadata:{}}
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:arrayBuffer(iv),additionalData:arrayBuffer(aad(base)),tagLength:128},wrappingKey,arrayBuffer(rootKey))
  const wrap={...base,wrap_iv:base64Url(iv),wrapped_root_key:base64Url(new Uint8Array(encrypted))}
  validateRootWrapV6(wrap)
  return wrap
}
export async function openBestEffortRootWrapV6(wrap:RootWrapV6,wrappingKey:CryptoKey):Promise<Uint8Array>{
  validateRootWrapV6(wrap);assertAesWrappingKey(wrappingKey)
  if(wrap.mode!=='best-effort')throw new Error('RootWrapV6 is not best-effort mode.')
  const root=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:arrayBuffer(fixedBase64Url(wrap.wrap_iv,12)),additionalData:arrayBuffer(aad(header(wrap))),tagLength:128},wrappingKey,arrayBuffer(fromBase64Url(wrap.wrapped_root_key))))
  assertRoot(root);return root
}
export async function createPassphraseRootWrapV6(rootKey:Uint8Array,passphrase:string,identity:RootWrapIdentityV6,id=randomBytes(16),passphraseSalt=randomBytes(16),iv=randomBytes(12)):Promise<PassphraseRootWrapV6>{
  assertRoot(rootKey);assertIdentity(identity)
  if(id.byteLength!==16||passphraseSalt.byteLength!==16||iv.byteLength!==12)throw new Error('RootWrapV6 randomness mismatch.')
  const mode_metadata={passphrase_profile:'argon2id-v6-1' as const,passphrase_salt:base64Url(passphraseSalt)}
  const base={local_wrap_version:6 as const,mode:'passphrase' as const,...identity,wrap_id:base64Url(id),mode_metadata}
  const encrypted=await aesGcmEncrypt(await passphraseKekV6(passphrase,passphraseSalt,identity),rootKey,aad(base),iv)
  const wrap={...base,wrap_iv:base64Url(encrypted.iv),wrapped_root_key:base64Url(encrypted.ciphertext)}
  validateRootWrapV6(wrap);return wrap
}
export async function openPassphraseRootWrapV6(wrap:RootWrapV6,passphrase:string):Promise<Uint8Array>{
  validateRootWrapV6(wrap);if(wrap.mode!=='passphrase')throw new Error('RootWrapV6 is not passphrase mode.')
  const identity:RootWrapIdentityV6={diary_id:wrap.diary_id,epoch_id:wrap.epoch_id,key_id:wrap.key_id,manifest_fingerprint:wrap.manifest_fingerprint}
  const root=await aesGcmDecrypt(await passphraseKekV6(passphrase,fixedBase64Url(wrap.mode_metadata.passphrase_salt,16),identity),fromBase64Url(wrap.wrapped_root_key),aad(header(wrap)),fixedBase64Url(wrap.wrap_iv,12))
  assertRoot(root);return root
}
export interface PrfWrapEnrollmentMaterialV6 {credentialId:Uint8Array;prfEvalInput:Uint8Array;prfOutput:Uint8Array;rpId:string}
export async function createPrfRootWrapV6(rootKey:Uint8Array,material:PrfWrapEnrollmentMaterialV6,identity:RootWrapIdentityV6,id=randomBytes(16),wrapSalt=randomBytes(32),iv=randomBytes(12)):Promise<PrfRootWrapV6>{
  assertRoot(rootKey);assertIdentity(identity)
  if(id.byteLength!==16||material.prfEvalInput.byteLength!==32||material.prfOutput.byteLength!==32||wrapSalt.byteLength!==32||iv.byteLength!==12||material.credentialId.byteLength<1||!material.rpId)throw new Error('RootWrapV6 PRF enrollment material is invalid.')
  const mode_metadata={prf_profile:'webauthn-prf-v6-1' as const,credential_id:base64Url(material.credentialId),prf_eval_input:base64Url(material.prfEvalInput),prf_wrap_salt:base64Url(wrapSalt),rp_id:material.rpId}
  const base={local_wrap_version:6 as const,mode:'prf' as const,...identity,wrap_id:base64Url(id),mode_metadata}
  const encrypted=await aesGcmEncrypt(await prfKekV6(material.prfOutput,wrapSalt,identity,material.credentialId),rootKey,aad(base),iv)
  const wrap={...base,wrap_iv:base64Url(encrypted.iv),wrapped_root_key:base64Url(encrypted.ciphertext)}
  validateRootWrapV6(wrap);return wrap
}
export async function openPrfRootWrapV6(wrap:RootWrapV6,assertedCredentialId:Uint8Array,prfOutput:Uint8Array):Promise<Uint8Array>{
  validateRootWrapV6(wrap);if(wrap.mode!=='prf')throw new Error('RootWrapV6 is not PRF mode.')
  const expected=fromBase64Url(wrap.mode_metadata.credential_id)
  if(expected.byteLength!==assertedCredentialId.byteLength||expected.some((byte,index)=>byte!==assertedCredentialId[index]))throw new Error('WebAuthn credential does not match RootWrapV6.')
  const identity:RootWrapIdentityV6={diary_id:wrap.diary_id,epoch_id:wrap.epoch_id,key_id:wrap.key_id,manifest_fingerprint:wrap.manifest_fingerprint}
  const root=await aesGcmDecrypt(await prfKekV6(prfOutput,fixedBase64Url(wrap.mode_metadata.prf_wrap_salt,32),identity,expected),fromBase64Url(wrap.wrapped_root_key),aad(header(wrap)),fixedBase64Url(wrap.wrap_iv,12))
  assertRoot(root);return root
}
