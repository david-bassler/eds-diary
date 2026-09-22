import type { PreparedEnvelope } from '../envelopes'
import { base64Url, fixedBase64Url, fromBase64Url, uint32be } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, sha256 } from '../crypto/core'
import { deriveEnvelopeKeyV2, envelopeAadV2 } from './crypto'
import type { RevisionV2 } from './types'
import { validateRevisionV2 } from './validators'

export const V2_PADDING_BUCKETS = [1024, 2048, 4096, 8192, 16384] as const
export type V2PaddingBucket = (typeof V2_PADDING_BUCKETS)[number]

export interface EnvelopeContextV2 {
  diaryId: string
  epochId: string
}

/**
 * Pure EnvelopeV6 framing. Reservation/persistence is deliberately owned by the
 * later local-write layer; callers must supply an already-reserved envelope ID
 * and the one-shot IV chosen for that reservation.
 */
export function frameEnvelopePayloadV2(payload: Uint8Array): { bucket: V2PaddingBucket; frame: Uint8Array } {
  const bucket = V2_PADDING_BUCKETS.find((size) => size >= payload.byteLength + 4)
  if (!bucket) throw new Error('EnvelopeV6 payload exceeds 16380 bytes.')
  const frame = new Uint8Array(bucket)
  frame.set(uint32be(payload.byteLength))
  frame.set(payload, 4)
  return { bucket, frame }
}

export function unframeEnvelopePayloadV2(frame: Uint8Array): Uint8Array {
  if (!V2_PADDING_BUCKETS.includes(frame.byteLength as V2PaddingBucket)) throw new Error('Invalid EnvelopeV6 padding bucket.')
  const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0)
  if (length > frame.byteLength - 4 || frame.slice(4 + length).some((byte) => byte !== 0)) throw new Error('Invalid EnvelopeV6 padding frame.')
  return frame.slice(4, 4 + length)
}

export async function sealRevisionEnvelopeV2(
  rootKey: Uint8Array,
  epochSalt: Uint8Array,
  context: EnvelopeContextV2,
  revision: RevisionV2,
  envelopeIdBytes: Uint8Array,
  iv: Uint8Array,
): Promise<PreparedEnvelope> {
  fixedBase64Url(context.diaryId, 16, 'diary_id')
  fixedBase64Url(context.epochId, 16, 'epoch_id')
  if (envelopeIdBytes.byteLength !== 32) throw new Error('EnvelopeV6 envelope_id must contain exactly 32 bytes.')
  if (iv.byteLength !== 12) throw new Error('EnvelopeV6 IV must contain exactly 12 bytes.')
  await validateRevisionV2(revision)

  const envelopeId = base64Url(envelopeIdBytes)
  const { bucket, frame } = frameEnvelopePayloadV2(canonicalBytes(revision as never))
  const key = await deriveEnvelopeKeyV2(rootKey, epochSalt, envelopeIdBytes)
  const encrypted = await aesGcmEncrypt(key, frame, envelopeAadV2(context.diaryId, context.epochId, envelopeId, bucket), iv)
  const encodedIv = base64Url(encrypted.iv)
  const ciphertext = base64Url(encrypted.ciphertext)
  const bytesHash = base64Url(await sha256(canonicalBytes([envelopeId, encodedIv, ciphertext])))

  return { envelopeId, iv: encodedIv, ciphertext, bytesHash }
}

export async function openRevisionEnvelopeV2(
  rootKey: Uint8Array,
  epochSalt: Uint8Array,
  context: EnvelopeContextV2,
  envelope: Pick<PreparedEnvelope, 'envelopeId' | 'iv' | 'ciphertext'>,
): Promise<RevisionV2> {
  fixedBase64Url(context.diaryId, 16, 'diary_id')
  fixedBase64Url(context.epochId, 16, 'epoch_id')
  const envelopeIdBytes = fixedBase64Url(envelope.envelopeId, 32, 'envelope_id')
  const iv = fixedBase64Url(envelope.iv, 12, 'iv')
  const ciphertext = fromBase64Url(envelope.ciphertext)
  const bucket = ciphertext.byteLength - 16
  if (!V2_PADDING_BUCKETS.includes(bucket as V2PaddingBucket)) throw new Error('Invalid EnvelopeV6 ciphertext bucket.')

  const key = await deriveEnvelopeKeyV2(rootKey, epochSalt, envelopeIdBytes)
  const frame = await aesGcmDecrypt(
    key,
    ciphertext,
    envelopeAadV2(context.diaryId, context.epochId, envelope.envelopeId, bucket as V2PaddingBucket),
    iv,
  )
  const revision = parseCanonicalJson(unframeEnvelopePayloadV2(frame)) as unknown as RevisionV2
  await validateRevisionV2(revision)
  return revision
}

export function envelopeRowV2(envelope: Pick<PreparedEnvelope, 'envelopeId' | 'iv' | 'ciphertext'>): readonly [string, string, string] {
  return [envelope.envelopeId, envelope.iv, envelope.ciphertext]
}
