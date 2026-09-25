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
import { withDiaryLockV2, type StoredWriterDeviceKeyV2 } from './localState'
import type { CanonicalFullResultV2 } from './verifier'
import { stateAfterCanonicalVerifyV6 } from './stateReconciliation'

export type DomainRecordTypeV2='pain_entry'|'activity_entry'|'medication_entry'|'medication_prescription'|'pain_type_settings'|'activity_type_settings'
export interface PrepareDomainRevisionV2Input<T=unknown>{
  recordType:DomainRecordTypeV2
  recordId:string
  /**
   * Normal app writes omit this field and derive the single current parent from
   * the same fresh canonical_full used for authorization. Explicit parents are
   * reserved for conflict-merge flows.
   */
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

async function usableWriterKey(
  store:IndexedDbV2LocalSecurityStore,
  keyId:string,
  diaryId:string,
  epochId:string,
):Promise<StoredWriterDeviceKeyV2|null>{
  try{return await store.loadWriterKey(keyId,diaryId,epochId)}catch{return null}
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
    const before=await this.store.loadState(rootKey,epochSalt,remote.epoch_id)
    const key=await usableWriterKey(this.store,before.writer_signing_key_id,before.diary_id,before.epoch_id)
    const reconciled=await stateAfterCanonicalVerifyV6(before,remote,verified.snapshot.rows,key!==null&&key.writer_device_id===before.writer_device_id)
    const committed=await this.store.commitVerifiedDispositions(
      rootKey,
      epochSalt,
      before.operation_generation,
      reconciled,
      verified.acceptedEnvelopeIds,
      verified.staleWriterEnvelopeIds,
      {
        remote_rows:verified.snapshot.rows,
        current_writer:{
          writer_generation:remote.current_writer.writer_generation,
          writer_grant_id:remote.current_writer.writer_grant_id,
          writer_device_id:remote.current_writer.writer_device_id,
          writer_key_id:remote.current_writer.writer_key_id,
        },
        source_epoch_sealed:remote.source_epoch_sealed,
        recovery_rekey_rotation_required:remote.current_recovery.recovery_rekey_rotation_required,
      },
    )
    if(await this.authority.canPrepareDomainWrite(verified)!=='writer')throw new Error('Fresh canonical v2 authority does not permit domain-write preparation.')
    return withDiaryLockV2(remote.diary_id,async()=>{
      const local=await this.store.loadState(rootKey,epochSalt,remote.epoch_id)
      if(local.operation_generation!==committed.operation_generation)throw new Error('Local v2 security state changed after fresh canonical verification; retry with a new full verify.')
      if(await this.authority.canPrepareDomainWrite(verified)!=='writer')throw new Error('Fresh canonical v2 authority changed before domain-write preparation.')
      if(local.writer_status!=='writer_active'||local.writer_generation===null||local.writer_grant_id===null)throw new Error('Local StateV6 is not writer_active.')
      if(!key||key.writer_device_id!==local.writer_device_id)throw new Error('Local WriterDeviceKeyV2 is missing or not bound to the local device; writer operation is read-only.')

      const recordSchema=V2_RECORD_SCHEMA_BY_TYPE[input.recordType]
      const schema=V2_SCHEMA_REGISTRY[recordSchema]
      if(!schema)throw new Error('Domain schema is not registered in v2.')
      const currentHeads=[...(remote.accepted_revision_graph.heads_by_record.get(input.recordId)??[])]
      let parentRevisionIds:[...string[]]
      if(input.parentRevisionIds===undefined){
        if(currentHeads.length>1)throw new Error(`Record ${input.recordId} has ${currentHeads.length} unresolved v2 heads.`)
        parentRevisionIds=currentHeads
      }else{
        parentRevisionIds=[...input.parentRevisionIds]
        if(parentRevisionIds.length>8)throw new Error('Explicit v2 merge parents exceed the protocol parent bound.')
        if(parentRevisionIds.length&&parentRevisionIds.some(parent=>!currentHeads.includes(parent)))throw new Error('Explicit v2 merge parents must be current canonical heads.')
      }
      for(const parentId of parentRevisionIds){
        const parent=remote.accepted_revision_graph.revisions.get(parentId)
        if(!parent)throw new Error('Domain revision parent is not in the freshly verified accepted graph.')
        if(parent.record_id!==input.recordId||parent.record_type!==input.recordType||parent.record_schema!==recordSchema)throw new Error('Domain revision parent belongs to a different record.')
      }
      if(input.status==='active'){
        if(input.data===null)throw new Error('Active domain revision requires record_data.')
        validateDomainData(schema,input.data)
      }else if(input.data!==null)throw new Error('Deleted domain revision must use null record_data.')

      const reservation=await this.store.reserveEnvelope(local.epoch_id,verified.snapshot.rows)
      const revision:RevisionV2<T>={
        record_type:input.recordType,
        record_schema:recordSchema,
        record_id:input.recordId,
        revision_id:base64Url(randomBytes(32)),
        parent_revision_ids:parentRevisionIds,
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
