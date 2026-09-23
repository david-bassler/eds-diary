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
import { withDiaryLockV2 } from './localState'
import type { CanonicalFullResultV2 } from './verifier'
import { stateAfterCanonicalVerifyV6 } from './stateReconciliation'

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
export interface FreshCanonicalV2Source {
  /** Must perform a new provider read plus canonical_full verification on every call. */
  verifyNow():Promise<VerifiedRemoteState>
}

function canonicalResult(verified:VerifiedRemoteState):CanonicalFullResultV2{
  if(verified.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Fresh canonical v2 verification is required before domain-write preparation.')
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full'||result.profile_id!==SINGLE_WRITER_V2_PROFILE)throw new Error('Fresh source returned a non-canonical v2 state.')
  return result
}

export class V2DomainWritePreparer {
  constructor(
    private readonly store:IndexedDbV2LocalSecurityStore,
    private readonly authority:WriteAuthority,
    private readonly freshSource:FreshCanonicalV2Source,
  ){
    if(authority.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2DomainWritePreparer requires v2 WriteAuthority.')
  }

  async prepareAndPersist<T>(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    input:PrepareDomainRevisionV2Input<T>,
  ):Promise<PreparedDomainWriteV2<T>>{
    // Freshness is an invocation property, not a time lease: every normal
    // domain-write attempt performs a new full remote read/verify here.
    const verified=await this.freshSource.verifyNow()
    const remote=canonicalResult(verified)
    return withDiaryLockV2(remote.diary_id,async()=>{
      const before=await this.store.loadState(rootKey,epochSalt,remote.epoch_id)
      const key=await this.store.loadWriterKey(before.writer_signing_key_id,before.diary_id,before.epoch_id)
      const keyUsable=key!==null&&key.writer_device_id===before.writer_device_id
      const reconciled=await stateAfterCanonicalVerifyV6(before,remote,verified.snapshot.rows,keyUsable)
      await this.store.replaceState(rootKey,epochSalt,before.operation_generation,reconciled)

      if(await this.authority.canPrepareDomainWrite(verified)!=='writer')throw new Error('Fresh canonical v2 authority does not permit domain-write preparation.')
      const local=await this.store.loadState(rootKey,epochSalt,remote.epoch_id)
      if(local.writer_status!=='writer_active'||local.writer_generation===null||local.writer_grant_id===null)throw new Error('Local StateV6 is not writer_active.')
      if(!key||key.writer_device_id!==local.writer_device_id)throw new Error('Local WriterDeviceKeyV2 is missing or not bound to the local device; writer operation is read-only.')

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
      const after=await this.store.commitReservedEnvelope(rootKey,epochSalt,local.operation_generation,reservation,envelope,{
        writer_generation:local.writer_generation,
        writer_grant_id:local.writer_grant_id,
        writer_device_id:local.writer_device_id,
        writer_key_id:local.writer_signing_key_id,
      })
      if(after.local_journal_count!==local.local_journal_count+1)throw new Error('V2 domain envelope journal commit did not advance exactly once.')
      return{revision,envelope}
    })
  }
}
