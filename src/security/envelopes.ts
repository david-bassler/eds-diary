import { base64Url, fixedBase64Url, fromBase64Url, uint32be } from './crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from './crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, deriveEnvelopeKey, randomBytes, sha256 } from './crypto/core'
import { validateRevision, type Revision } from './revisions'

export const PADDING_BUCKETS = [1024,2048,4096,8192,16384] as const
export interface EnvelopeContext { diaryId: string; epochId: string }
export interface PreparedEnvelope { envelopeId: string; iv: string; ciphertext: string; bytesHash: string }
export interface EnvelopeReservation { reserve(envelopeId:string):Promise<void>; verifyReservation?(envelopeId:string):Promise<void>; persist(envelope:PreparedEnvelope):Promise<void> }
function recordAad(context:EnvelopeContext,envelopeId:string,bucket:number):Uint8Array{return canonicalBytes({protocol_version:5,crypto_suite:'A256GCM-HKDF-SHA256-v5',diary_id:context.diaryId,epoch_id:context.epochId,envelope_id:envelopeId,padding_bucket:bucket})}
export function framePayload(payload:Uint8Array):{bucket:number;frame:Uint8Array}{const bucket=PADDING_BUCKETS.find((size)=>size>=payload.byteLength+4);if(!bucket)throw new Error('Envelope payload exceeds 16380 bytes.');const frame=new Uint8Array(bucket);frame.set(uint32be(payload.byteLength));frame.set(payload,4);return{bucket,frame}}
function unframe(frame:Uint8Array):Uint8Array{if(!PADDING_BUCKETS.includes(frame.byteLength as typeof PADDING_BUCKETS[number]))throw new Error('Invalid padding bucket.');const length=new DataView(frame.buffer,frame.byteOffset,4).getUint32(0);if(length>frame.byteLength-4||frame.slice(4+length).some((byte)=>byte!==0))throw new Error('Invalid envelope padding frame.');return frame.slice(4,4+length)}
export async function prepareEnvelope(rootKey:Uint8Array,epochSalt:Uint8Array,context:EnvelopeContext,revision:Revision,journal:EnvelopeReservation,iv=randomBytes(12),idBytes=randomBytes(32)):Promise<PreparedEnvelope>{
  fixedBase64Url(context.diaryId,16,'diary_id');fixedBase64Url(context.epochId,16,'epoch_id');validateRevision(revision)
  const envelopeId=base64Url(idBytes);await journal.reserve(envelopeId);await journal.verifyReservation?.(envelopeId)
  const {bucket,frame}=framePayload(canonicalBytes(revision as never));const key=await deriveEnvelopeKey(rootKey,epochSalt,idBytes);const encrypted=await aesGcmEncrypt(key,frame,recordAad(context,envelopeId,bucket),iv)
  const encodedIv=base64Url(encrypted.iv),ciphertext=base64Url(encrypted.ciphertext);const envelope={envelopeId,iv:encodedIv,ciphertext,bytesHash:base64Url(await sha256(canonicalBytes([envelopeId,encodedIv,ciphertext])))};await journal.persist(envelope);return envelope
}
export async function openEnvelope(rootKey:Uint8Array,epochSalt:Uint8Array,context:EnvelopeContext,envelope:PreparedEnvelope):Promise<Revision>{
  const id=fixedBase64Url(envelope.envelopeId,32,'envelope_id'),iv=fixedBase64Url(envelope.iv,12,'iv'),ciphertext=fromBase64Url(envelope.ciphertext),bucket=ciphertext.byteLength-16
  if(!PADDING_BUCKETS.includes(bucket as typeof PADDING_BUCKETS[number]))throw new Error('Invalid ciphertext bucket.')
  const key=await deriveEnvelopeKey(rootKey,epochSalt,id),frame=await aesGcmDecrypt(key,ciphertext,recordAad(context,envelope.envelopeId,bucket),iv),revision=parseCanonicalJson(unframe(frame)) as unknown as Revision;validateRevision(revision);return revision
}
export function envelopeRow(envelope:PreparedEnvelope):readonly[string,string,string]{return[envelope.envelopeId,envelope.iv,envelope.ciphertext]}
