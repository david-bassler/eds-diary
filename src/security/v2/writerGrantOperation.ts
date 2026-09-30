import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { PreparedEnvelopeRowV2 } from './recovery'
import type { RemoteAnchorV2 } from './types'

export type WriterGrantOperationStageV2='prepared'|'append_unknown'|'durable'|'stale'

export interface WriterGrantOperationStateV2 {
  format:'writer-grant-operation-v2'
  version:2
  operation_id:string
  operation_kind:'handoff'|'forced_takeover'
  epoch_id:string
  stage:WriterGrantOperationStageV2
  authority_anchor:RemoteAnchorV2
  prepared_envelope:PreparedEnvelopeRowV2
  expected_writer_generation:number
  expected_writer_grant_id:string
}

const KEYS=[
  'format','version','operation_id','operation_kind','epoch_id','stage','authority_anchor',
  'prepared_envelope','expected_writer_generation','expected_writer_grant_id',
] as const

function exact(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('WriterGrantOperationStateV2 must be an object.')
  const record=value as Record<string,unknown>
  if(Object.keys(record).sort().join('\0')!==[...KEYS].sort().join('\0'))throw new Error('WriterGrantOperationStateV2 schema mismatch.')
  return record
}
function safe(value:unknown,min:number,label:string):number{
  if(!Number.isSafeInteger(value)||Number(value)<min)throw new Error(`${label} is invalid.`)
  return Number(value)
}
function row(value:unknown):PreparedEnvelopeRowV2{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('WriterGrantOperationStateV2 prepared_envelope is invalid.')
  const record=value as Record<string,unknown>
  if(Object.keys(record).sort().join('\0')!=='ciphertext\0envelope_id\0iv')throw new Error('WriterGrantOperationStateV2 prepared_envelope schema mismatch.')
  if(typeof record.envelope_id!=='string'||typeof record.iv!=='string'||typeof record.ciphertext!=='string')throw new Error('WriterGrantOperationStateV2 prepared_envelope values are invalid.')
  fixedBase64Url(record.envelope_id,32,'prepared_envelope.envelope_id')
  fixedBase64Url(record.iv,12,'prepared_envelope.iv')
  if(fromBase64Url(record.ciphertext).byteLength<16)throw new Error('WriterGrantOperationStateV2 prepared_envelope ciphertext is invalid.')
  return value as PreparedEnvelopeRowV2
}

export function validateWriterGrantOperationStateV2(value:unknown):WriterGrantOperationStateV2{
  const state=exact(value)
  if(state.format!=='writer-grant-operation-v2'||state.version!==2)throw new Error('WriterGrantOperationStateV2 profile mismatch.')
  fixedBase64Url(String(state.operation_id),32,'operation_id')
  if(state.operation_kind!=='handoff'&&state.operation_kind!=='forced_takeover')throw new Error('WriterGrantOperationStateV2 operation_kind is invalid.')
  fixedBase64Url(String(state.epoch_id),16,'epoch_id')
  if(!['prepared','append_unknown','durable','stale'].includes(String(state.stage)))throw new Error('WriterGrantOperationStateV2 stage is invalid.')
  const anchor=state.authority_anchor as Record<string,unknown>
  if(!anchor||typeof anchor!=='object'||Array.isArray(anchor)
    ||Object.keys(anchor).sort().join('\0')!=='anchor_profile\0covered_row_count\0prefix_hash'
    ||anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('WriterGrantOperationStateV2 authority_anchor is invalid.')
  safe(anchor.covered_row_count,0,'authority_anchor.covered_row_count')
  fixedBase64Url(String(anchor.prefix_hash),32,'authority_anchor.prefix_hash')
  row(state.prepared_envelope)
  safe(state.expected_writer_generation,2,'expected_writer_generation')
  fixedBase64Url(String(state.expected_writer_grant_id),32,'expected_writer_grant_id')
  return value as unknown as WriterGrantOperationStateV2
}

export function advanceWriterGrantOperationStateV2(current:WriterGrantOperationStateV2,next:WriterGrantOperationStateV2):WriterGrantOperationStateV2{
  validateWriterGrantOperationStateV2(current);validateWriterGrantOperationStateV2(next)
  const immutable=['operation_id','operation_kind','epoch_id','authority_anchor','prepared_envelope','expected_writer_generation','expected_writer_grant_id'] as const
  for(const field of immutable){
    if(new TextDecoder().decode(canonicalBytes(current[field] as never))!==new TextDecoder().decode(canonicalBytes(next[field] as never)))throw new Error(`WriterGrantOperationStateV2 immutable field changed: ${field}.`)
  }
  const edge=`${current.stage}->${next.stage}`
  if(!new Set(['prepared->append_unknown','prepared->durable','prepared->stale','append_unknown->durable','append_unknown->stale']).has(edge))throw new Error(`Illegal WriterGrantOperationStateV2 transition: ${edge}.`)
  return next
}

export async function writerGrantOperationStateHashV2(state:WriterGrantOperationStateV2):Promise<string>{
  validateWriterGrantOperationStateV2(state)
  return base64Url(await sha256(canonicalBytes(state as never)))
}
