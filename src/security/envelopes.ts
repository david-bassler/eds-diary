import { base64Url, fromBase64Url } from './crypto/bytes'
import { canonicalBytes } from './crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, deriveEnvelopeKey, randomBytes, sha256 } from './crypto/core'
import type { Revision } from './revisions'

export interface EnvelopeContext { diaryId: string; epochId: string }
export interface PreparedEnvelope { envelopeId: string; iv: string; ciphertext: string; bytesHash: string }
export interface EnvelopeReservation { reserve(envelopeId: string): Promise<void>; persist(envelope: PreparedEnvelope): Promise<void> }

function aad(context: EnvelopeContext, envelopeId: string): Uint8Array {
  return canonicalBytes({ envelope_id: envelopeId, epoch_id: context.epochId, diary_id: context.diaryId, profile: 'eds-diary-envelope-v5' })
}

export async function prepareEnvelope(rootKey: Uint8Array, epochSalt: Uint8Array, context: EnvelopeContext, revision: Revision, journal: EnvelopeReservation): Promise<PreparedEnvelope> {
  const idBytes = randomBytes(32)
  const envelopeId = base64Url(idBytes)
  await journal.reserve(envelopeId)
  const key = await deriveEnvelopeKey(rootKey, epochSalt, idBytes)
  const encrypted = await aesGcmEncrypt(key, canonicalBytes(revision as never), aad(context, envelopeId))
  const iv = base64Url(encrypted.iv)
  const ciphertext = base64Url(encrypted.ciphertext)
  const envelope = { envelopeId, iv, ciphertext, bytesHash: base64Url(await sha256(canonicalBytes([envelopeId, iv, ciphertext]))) }
  await journal.persist(envelope)
  return envelope
}

export async function openEnvelope(rootKey: Uint8Array, epochSalt: Uint8Array, context: EnvelopeContext, envelope: PreparedEnvelope): Promise<Revision> {
  const key = await deriveEnvelopeKey(rootKey, epochSalt, fromBase64Url(envelope.envelopeId))
  const plaintext = await aesGcmDecrypt(key, fromBase64Url(envelope.ciphertext), aad(context, envelope.envelopeId), fromBase64Url(envelope.iv))
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as Revision
}

export function envelopeRow(envelope: PreparedEnvelope): readonly [string, string, string] {
  return [envelope.envelopeId, envelope.iv, envelope.ciphertext]
}
