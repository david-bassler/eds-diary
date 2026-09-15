import { aesGcmDecrypt, aesGcmEncrypt, sha256 } from './crypto/core'
import { base64Url, fromBase64Url, utf8, decodeUtf8 } from './crypto/bytes'
import { canonicalBytes } from './crypto/canonical'
import type { PreparedEnvelope } from './envelopes'

export const MAX_BACKUP_BYTES = 16 * 1024 * 1024
export interface EncryptedBackup { version: 1; iv: string; ciphertext: string; digest: string }
export async function createBackup(key: Uint8Array, envelopes: readonly PreparedEnvelope[]): Promise<EncryptedBackup> {
  const plaintext = canonicalBytes({ profile: 'eds-diary-backup-v1', envelopes: envelopes.map((value) => ({ envelopeId: value.envelopeId, iv: value.iv, ciphertext: value.ciphertext, bytesHash: value.bytesHash })) })
  if (plaintext.byteLength > MAX_BACKUP_BYTES) throw new Error('Backup size bound exceeded.')
  const encrypted = await aesGcmEncrypt(key, plaintext, utf8('eds-diary/backup/v1'))
  return { version: 1, iv: base64Url(encrypted.iv), ciphertext: base64Url(encrypted.ciphertext), digest: base64Url(await sha256(plaintext)) }
}
export async function testRestoreBackup(key: Uint8Array, backup: EncryptedBackup): Promise<PreparedEnvelope[]> {
  if (backup.ciphertext.length > Math.ceil(MAX_BACKUP_BYTES * 4 / 3) + 128) throw new Error('Backup input bound exceeded.')
  const plaintext = await aesGcmDecrypt(key, fromBase64Url(backup.ciphertext), utf8('eds-diary/backup/v1'), fromBase64Url(backup.iv))
  if (plaintext.byteLength > MAX_BACKUP_BYTES || base64Url(await sha256(plaintext)) !== backup.digest) throw new Error('Backup verification failed.')
  const parsed: unknown = JSON.parse(decodeUtf8(plaintext)); if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { envelopes?: unknown }).envelopes)) throw new Error('Invalid backup structure.')
  return (parsed as { envelopes: PreparedEnvelope[] }).envelopes
}
