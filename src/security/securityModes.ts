import { hkdfSha256, randomBytes, validatePassphrase, derivePassphraseMaterial } from './crypto/core'
import { utf8 } from './crypto/bytes'

export const ARGON2ID_PARAMETERS = { version: 0x13, memoryKiB: 65536, iterations: 3, parallelism: 1, outputBytes: 32 } as const
export async function passphraseKek(passphrase: string, salt: Uint8Array, context: string): Promise<Uint8Array> {
  validatePassphrase(passphrase); return hkdfSha256(derivePassphraseMaterial(passphrase, salt), salt, utf8(`eds-diary/local-passphrase-kek/v5\0${context}`))
}
export interface WebAuthnPrfEnrollment { credentialId: Uint8Array; prfEvalInput: Uint8Array; verified: boolean }
export function newPrfEnrollment(credentialId: Uint8Array): WebAuthnPrfEnrollment { if (!credentialId.byteLength) throw new Error('Credential ID is required.'); return { credentialId: new Uint8Array(credentialId), prfEvalInput: randomBytes(32), verified: false } }
export function verifyPrfEnrollment(enrollment: WebAuthnPrfEnrollment, assertedCredentialId: Uint8Array, prfOutput: Uint8Array): WebAuthnPrfEnrollment {
  if (assertedCredentialId.toString() !== enrollment.credentialId.toString() || prfOutput.byteLength !== 32) throw new Error('WebAuthn PRF verification failed.')
  return { ...enrollment, verified: true }
}
