import { base64Url, fixedBase64Url, randomBytes } from '../crypto/bytes'
import { validateDomainData } from '../domainSchemaValidator'
import { revisionSigningBytesV2, signEd25519V2 } from './crypto'
import { V2_SCHEMA_REGISTRY } from './schemaRegistry'
import type { RevisionV2, WriterContextV2 } from './types'
import { validateRevisionV2 } from './validators'

export interface DomainRevisionDraftV2<T=unknown> {
  record_type:string
  record_schema:string
  record_id:string
  parent_revision_ids:readonly string[]
  record_status:'active'|'deleted'
  record_data:T|null
}

export interface BuildSignedDomainRevisionV2Options<T=unknown> {
  diaryId:string
  epochId:string
  draft:DomainRevisionDraftV2<T>
  writerContext:WriterContextV2
  privateKey:CryptoKey
  revisionIdBytes?:Uint8Array
  createdAt?:string
}

export async function buildSignedDomainRevisionV2<T=unknown>(options:BuildSignedDomainRevisionV2Options<T>):Promise<RevisionV2<T>>{
  fixedBase64Url(options.diaryId,16,'diary_id');fixedBase64Url(options.epochId,16,'epoch_id')
  fixedBase64Url(options.draft.record_id,16,'record_id')
  if(options.draft.record_schema.endsWith('-sw-v2'))throw new Error('Domain RevisionV2 builder does not create control revisions.')
  const schema=V2_SCHEMA_REGISTRY[options.draft.record_schema]
  if(!schema)throw new Error('Domain RevisionV2 schema is not in the frozen v2 allowlist.')
  if(options.draft.record_status==='active')validateDomainData(schema,options.draft.record_data)
  else if(options.draft.record_data!==null)throw new Error('Deleted RevisionV2 must have null record_data.')

  const revisionIdBytes=options.revisionIdBytes??randomBytes(32)
  if(revisionIdBytes.byteLength!==32)throw new Error('RevisionV2 revision ID must contain 32 bytes.')
  const revision:RevisionV2<T>={
    record_type:options.draft.record_type,
    record_schema:options.draft.record_schema,
    record_id:options.draft.record_id,
    revision_id:base64Url(revisionIdBytes),
    parent_revision_ids:[...options.draft.parent_revision_ids],
    record_status:options.draft.record_status,
    record_data:options.draft.record_data,
    migration_origin:null,
    protocol_created_at:options.createdAt??new Date().toISOString(),
    writer_context:{...options.writerContext},
    writer_signature:null,
  }
  revision.writer_signature=await signEd25519V2(options.privateKey,revisionSigningBytesV2(options.diaryId,options.epochId,revision))
  await validateRevisionV2(revision)
  return revision
}
