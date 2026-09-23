import { fromBase64Url, base64Url, randomBytes } from '../crypto/bytes'
import { validateDomainData } from '../domainSchemaValidator'
import type { VerifiedRemoteState, WriteAuthority } from '../../sync/core/contracts'
import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { revisionSigningBytesV2, signEd25519V2 } from './crypto'
import { sealRevisionEnvelopeV2 } from './envelopes'
import { IndexedDbV2LocalSecurityStore } from './localPersistence'
import { V2_SCHEMA_REGISTRY } from './schemaRegistry'
import { V2_RECORD_SCHEMA_BY_TYPE, type RevisionV2 } from './types'
import { validateRevisionV2 } from './validators'

export type DomainRecordTypeV2='pain_entry'|'activity_entry'|'medication_entry'|'medication_prescription'|'pain_type_settings'|'activity_type_settings'
export interface PrepareDomainRevisionV2Input<T=unknown>{
  recordType:DomainRecordTypeV2
  recordId:string
  parentRevisionIds?:readonly string[]
  status:'active'|'deleted'
  data:T|null
  protocolCreatedAt?:string
}

export interface PreparedDomainWriteV2<T=unknown>{
  revision:RevisionV2<T>
  envelope:{envelopeId:string;iv:string;ciphertext:string;bytesHash:string}
}

export class V2DomainWritePreparer {
  constructor(
    private readonly store:IndexedDbV2LocalSecurityStore,
    private readonly authority:WriteAuthority,
  ){
    if(authority.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2DomainWritePreparer requires v2 WriteAuthority.')
  }

  async prepareAndPersist<T>(
    verified:VerifiedRemoteState,
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    input:PrepareDomainRevisionV2Input<T>,
  ):Promise<PreparedDomainWriteV2<T>>{
    if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Fresh canonical v2 verification is required before domain-write preparation.')
    if(await this.authority.canPrepareDomainWrite(verified)!=='writer')throw new Error('Fresh canonical v2 authority does not permit domain-write preparation.')

    const local=await this.store.loadState(rootKey,epochSalt,(verified.profileState as {epoch_id?:string}).epoch_id??'')
    if(local.writer_status!=='writer_active'||local.writer_generation===null||local.writer_grant_id===null)throw new Error('Local StateV6 is not writer_active.')
    const key=await this.store.loadWriterKey(local.writer_signing_key_id,local.diary_id,local.epoch_id)
    if(!key)throw new Error('Local WriterDeviceKeyV2 is missing; writer operation is read-only.')

    const recordSchema=V2_RECORD_SCHEMA_BY_TYPE[input.recordType]
    const schema=V2_SCHEMA_REGISTRY[recordSchema]
    if(!schema)throw new Error('Domain schema is not registered in v2.')
    if(input.status==='active'){
      if(input.data===null)throw new Error('Active domain revision requires record_data.')
      validateDomainData(schema,input.data)
    }else if(input.data!==null)throw new Error('Deleted domain revision must use null record_data.')

    const reservation=await this.store.reserveEnvelope(local.epoch_id)
    const revision:RevisionV2<T>={
      record_type:input.recordType,
      record_schema:recordSchema,
      record_id:input.recordId,
      revision_id:base64Url(randomBytes(32)),
      parent_revision_ids:[...(input.parentRevisionIds??[])],
      record_status:input.status,
      record_data:input.data,
      migration_origin:null,
      protocol_created_at:input.protocolCreatedAt??new Date().toISOString(),
      writer_context:{
        writer_generation:local.writer_generation,
        writer_grant_id:local.writer_grant_id,
        writer_device_id:local.writer_device_id,
        writer_key_id:local.writer_signing_key_id,
      },
      writer_signature:null,
    }
    revision.writer_signature=await signEd25519V2(key.private_key,revisionSigningBytesV2(local.diary_id,local.epoch_id,revision))
    await validateRevisionV2(revision)

    const envelope=await sealRevisionEnvelopeV2(
      rootKey,
      epochSalt,
      {diaryId:local.diary_id,epochId:local.epoch_id},
      revision,
      fromBase64Url(reservation.envelope_id),
      fromBase64Url(reservation.iv),
    )
    const after=await this.store.commitReservedEnvelope(rootKey,epochSalt,local.operation_generation,reservation,envelope)
    if(after.local_journal_count!==local.local_journal_count+1)throw new Error('V2 domain envelope journal commit did not advance exactly once.')
    return{revision,envelope}
  }
}
