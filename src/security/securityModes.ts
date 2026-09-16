import { hkdfSha256, randomBytes, validatePassphrase, derivePassphraseMaterial, sha256 } from './crypto/core'
import { concatBytes, fixedBase64Url, utf8 } from './crypto/bytes'

export const ARGON2ID_PARAMETERS = { version: 0x13, memoryKiB: 65536, iterations: 3, parallelism: 1, outputBytes: 32 } as const
export async function passphraseKek(passphrase: string, salt: Uint8Array, diaryId: string, epochId: string, keyId: string): Promise<Uint8Array> {
  validatePassphrase(passphrase); if(salt.byteLength!==16)throw new Error('Passphrase salt must contain 16 bytes.')
  const zero=new Uint8Array([0]),diary=fixedBase64Url(diaryId,16),epoch=fixedBase64Url(epochId,16),key=fixedBase64Url(keyId,16)
  return hkdfSha256(derivePassphraseMaterial(passphrase,salt),await sha256(concatBytes(utf8('eds-diary/local-passphrase-salt/v5'),zero,diary,epoch)),concatBytes(utf8('eds-diary/local-passphrase-wrap/v5'),zero,diary,epoch,key))
}

export async function prfKek(prfOutput:Uint8Array,wrapSalt:Uint8Array,diaryId:string,epochId:string,keyId:string,credentialId:Uint8Array):Promise<Uint8Array>{
  if(prfOutput.byteLength!==32)throw new Error('WebAuthn PRF output must contain 32 bytes.')
  if(wrapSalt.byteLength!==32)throw new Error('PRF wrap salt must contain 32 bytes.')
  if(!credentialId.byteLength)throw new Error('Credential ID is required.')
  const zero=new Uint8Array([0]),diary=fixedBase64Url(diaryId,16),epoch=fixedBase64Url(epochId,16),key=fixedBase64Url(keyId,16),credentialHash=await sha256(credentialId)
  const context=concatBytes(utf8('eds-diary/local-prf-wrap/v5'),zero,diary,epoch,key,credentialHash)
  return hkdfSha256(prfOutput,wrapSalt,context)
}

export interface WebAuthnPrfEnrollment { credentialId: Uint8Array; prfEvalInput: Uint8Array; verified: boolean }
export function newPrfEnrollment(credentialId: Uint8Array): WebAuthnPrfEnrollment { if (!credentialId.byteLength) throw new Error('Credential ID is required.'); return { credentialId: new Uint8Array(credentialId), prfEvalInput: randomBytes(32), verified: false } }
export function verifyPrfEnrollment(enrollment: WebAuthnPrfEnrollment, assertedCredentialId: Uint8Array, prfOutput: Uint8Array): WebAuthnPrfEnrollment {
  if (assertedCredentialId.byteLength!==enrollment.credentialId.byteLength || assertedCredentialId.some((byte,index)=>byte!==enrollment.credentialId[index]) || prfOutput.byteLength !== 32) throw new Error('WebAuthn PRF verification failed.')
  return { ...enrollment, verified: true }
}
