import { aesGcmDecrypt, aesGcmEncrypt, deriveRecoveryKey, equalBytes, randomBytes, recoveryCommitment } from './crypto/core'
import { base64Url, fromBase64Url, utf8 } from './crypto/bytes'
import { canonicalBytes } from './crypto/canonical'

export interface RecoveryArtifact { version: 5; generation: number; salt: string; iv: string; wrappedRootKey: string; ursCommitment: string; remoteAnchor: string }
export async function createRecovery(rootKey: Uint8Array, urs: Uint8Array, diaryId: string, generation: number, remoteAnchor: string): Promise<RecoveryArtifact> {
  if (rootKey.byteLength !== 32) throw new Error('Root key must contain 32 bytes.')
  const salt = randomBytes(32); const key = await deriveRecoveryKey(urs, salt)
  const commitment = await recoveryCommitment(urs, utf8(diaryId), generation)
  const aad = canonicalBytes({ version: 5, diary_id: diaryId, generation, urs_commitment: commitment, remote_anchor: remoteAnchor })
  const encrypted = await aesGcmEncrypt(key, rootKey, aad)
  return { version: 5, generation, salt: base64Url(salt), iv: base64Url(encrypted.iv), wrappedRootKey: base64Url(encrypted.ciphertext), ursCommitment: commitment, remoteAnchor }
}
export async function recoverRootKey(artifact: RecoveryArtifact, urs: Uint8Array, diaryId: string, expectedCommitment: string, expectedAnchor: string): Promise<Uint8Array> {
  const commitment = await recoveryCommitment(urs, utf8(diaryId), artifact.generation)
  if (!equalBytes(utf8(commitment), utf8(expectedCommitment)) || commitment !== artifact.ursCommitment) throw new Error('Recovery secret continuity check failed.')
  if (!expectedAnchor || artifact.remoteAnchor !== expectedAnchor) throw new Error('Recovery anchor verification failed.')
  const aad = canonicalBytes({ version: 5, diary_id: diaryId, generation: artifact.generation, urs_commitment: artifact.ursCommitment, remote_anchor: artifact.remoteAnchor })
  const key = await deriveRecoveryKey(urs, fromBase64Url(artifact.salt))
  const rootKey = await aesGcmDecrypt(key, fromBase64Url(artifact.wrappedRootKey), aad, fromBase64Url(artifact.iv))
  if (rootKey.byteLength !== 32) throw new Error('Recovered root key has invalid length.')
  return rootKey
}
