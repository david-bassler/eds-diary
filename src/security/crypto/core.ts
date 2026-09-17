import { argon2id } from '@noble/hashes/argon2.js'
import { arrayBuffer, base64Url, concatBytes, equalBytes, randomBytes, uint64be, utf8 } from './bytes'

const ZERO = new Uint8Array([0])

export async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBuffer(value)))
}

export async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', arrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, arrayBuffer(value)))
}

export async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length = 32): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', arrayBuffer(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: arrayBuffer(salt), info: arrayBuffer(info) }, key, length * 8))
}

export async function deriveEpochSalt(diaryId: Uint8Array, epochId: Uint8Array): Promise<Uint8Array> {
  if (diaryId.byteLength !== 16 || epochId.byteLength !== 16) throw new Error('Diary and epoch IDs require 16 bytes.')
  return sha256(concatBytes(utf8('eds-diary/hkdf-salt/v5'), ZERO, diaryId, epochId))
}

export async function deriveManifestKey(rootKey: Uint8Array, epochSalt: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(rootKey, epochSalt, utf8('eds-diary/epoch-manifest/v5'))
}

export async function deriveEnvelopeKey(rootKey: Uint8Array, epochSalt: Uint8Array, envelopeId: Uint8Array): Promise<Uint8Array> {
  if (rootKey.byteLength !== 32 || envelopeId.byteLength !== 32) throw new Error('Root and envelope keys require 32 bytes.')
  return hkdfSha256(rootKey, epochSalt, concatBytes(utf8('eds-diary/envelope-key/v5'), ZERO, envelopeId))
}

export async function deriveStateMacKey(rootKey: Uint8Array, epochSalt: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(rootKey, epochSalt, utf8('eds-diary/local-state-mac/v5'))
}

export async function aesGcmEncrypt(keyBytes: Uint8Array, plaintext: Uint8Array, aad: Uint8Array, iv = randomBytes(12)): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  if (keyBytes.byteLength !== 32 || iv.byteLength !== 12) throw new Error('AES-256-GCM requires a 32-byte key and 12-byte IV.')
  const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(aad), tagLength: 128 }, key, arrayBuffer(plaintext))
  return { iv: new Uint8Array(iv), ciphertext: new Uint8Array(ciphertext) }
}

export async function aesGcmDecrypt(keyBytes: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(aad), tagLength: 128 }, key, arrayBuffer(ciphertext)))
}

export async function recoveryCommitment(urs: Uint8Array, diaryId: Uint8Array, generation: number | bigint): Promise<string> {
  if (urs.byteLength !== 32) throw new Error('URS must contain exactly 32 bytes.')
  return base64Url(await hmacSha256(urs, concatBytes(utf8('eds-diary/recovery-urs-commitment/v5'), ZERO, diaryId, uint64be(generation))))
}

export async function deriveRecoveryKey(urs: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (urs.byteLength !== 32 || salt.byteLength !== 32) throw new Error('Recovery inputs must contain exactly 32 bytes.')
  return hkdfSha256(urs, salt, utf8('eds-diary/recovery-wrap/v5'))
}

export function validatePassphrase(passphrase: string): void {
  if ([...passphrase].length < 15) throw new Error('Die Passphrase muss mindestens 15 Unicode-Zeichen enthalten.')
  if (utf8(passphrase).byteLength > 1024) throw new Error('Die Passphrase darf maximal 1024 UTF-8-Bytes enthalten.')
  const blocked = ['passwordpassword', 'passwortpasswort', '123456789012345']
  if (blocked.includes(passphrase.toLocaleLowerCase('de'))) throw new Error('Diese häufig verwendete Passphrase ist nicht erlaubt.')
}

export function derivePassphraseMaterial(passphrase: string, salt: Uint8Array): Uint8Array {
  validatePassphrase(passphrase)
  return argon2id(utf8(passphrase), salt, { m: 65536, t: 3, p: 1, dkLen: 32, version: 0x13 })
}

export { equalBytes, randomBytes }
