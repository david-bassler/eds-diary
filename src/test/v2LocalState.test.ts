import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { deriveEpochSaltV2, generateWriterDeviceKeyV2 } from '../security/v2/crypto'
import { localJournalInitialV2, type EpochLocalSecurityStateV6 } from '../security/v2/localState'
import { IndexedDbV2LocalSecurityStore, __v2LocalPersistenceTesting } from '../security/v2/localPersistence'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import { TransferableSingleWriterV2WriteAuthority, v2VerifiedRemoteState } from '../security/v2/writeAuthority'
import { V2DomainWritePreparer } from '../security/v2/domainWrite'
import { createAnchorV2 } from '../security/v2/prefix'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'

const b=(fill:number,length:number)=>base64Url(new Uint8Array(length).fill(fill))
const rootKey=new Uint8Array(32).fill(21)
const painData={
  startedAt:'2026-09-23T08:00:00.000Z',
  endedAt:'',
  locations:[],
  intensity:4,
  qualities:[],
  cause:'',
  occursWhen:'',
  note:'v2 fixture',
  createdAt:'2026-09-23T08:00:00.000Z',
  updatedAt:'2026-09-23T08:00:00.000Z',
}

async function fixture(){
  const diaryId=b(1,16),epochId=b(2,16),epochSalt=await deriveEpochSaltV2(new Uint8Array(16).fill(1),new Uint8Array(16).fill(2))
  const writer=await generateWriterDeviceKeyV2(),writerDeviceId=b(3,16),anchor=await createAnchorV2(diaryId,epochId,[])
  const initial:EpochLocalSecurityStateV6={
    local_state_version:6,
    diary_id:diaryId,
    epoch_id:epochId,
    key_id:b(4,16),
    manifest_fingerprint:b(5,32),
    recovery_generation:0,
    recovery_urs_commitment:b(6,32),
    recovery_urs_id:null,
    recovery_rekey_rotation_required:false,
    recovery_rekey_transition_id:null,
    remote_binding:{storage_provider_id:'google-drive-sheets-v1',sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:'remote-1',remote_identity_binding:'subject-1'},
    remote_anchor:null,
    epoch_status:'active',
    operation_generation:0,
    rotation_state_ref:null,
    migration_state_ref:null,
    writer_operation_state_ref:null,
    recovery_operation_state_ref:null,
    activation_lineage_cache_ref:null,
    local_journal_count:0,
    local_journal_hash:await localJournalInitialV2(diaryId,epochId),
    writer_status:'read_only',
    writer_device_id:writerDeviceId,
    writer_signing_key_id:writer.writerKeyId,
    writer_generation:null,
    writer_grant_id:null,
    verified_writer_device_id:null,
    verified_writer_key_id:null,
    verified_writer_generation:null,
    verified_writer_grant_id:null,
    recovery_takeover_key_id:null,
    recovery_credential_history_sha256:null,
    stale_writer_pending_count:0,
  }
  const result:CanonicalFullResultV2={
    kind:'canonical_full',
    profile_id:SINGLE_WRITER_V2_PROFILE,
    diary_id:diaryId,
    epoch_id:epochId,
    manifest_fingerprint:initial.manifest_fingerprint,
    remote_anchor:anchor,
    current_writer:{
      writer_generation:1,
      writer_grant_id:b(7,32),
      writer_device_id:writerDeviceId,
      writer_key_id:writer.writerKeyId,
      writer_public_key:base64Url(writer.publicKeyRaw),
      source_epoch_sealed:false,
    },
    current_recovery:{
      recovery_generation:0,
      recovery_urs_commitment:b(6,32),
      recovery_urs_id:b(8,32),
      recovery_takeover_key_id:b(9,32),
      recovery_takeover_public_key:b(10,32),
      recovery_rekey_rotation_required:false,
      recovery_rekey_transition_id:null,
    },
    recovery_credential_history:[{recovery_generation:0,recovery_urs_id:b(8,32),recovery_takeover_key_id:b(9,32)}],
    source_epoch_sealed:false,
    accepted_revision_graph:{revisions:new Map(),heads_by_record:new Map()},
    accepted_epoch_migration:null,
    accepted_activation_confirmation:null,
    activation_state:'native_active',
    dispositions:[],
    verified_envelope_ids:new Set(),
    accepted_envelope_ids:new Set(),
    stale_writer_envelope_ids:new Set(),
    authority_history_by_prefix:new Map(),
    recovery_history_by_prefix:new Map(),
  }
  return{diaryId,epochId,epochSalt,writer,writerDeviceId,initial,result}
}

beforeEach(async()=>{await __v2LocalPersistenceTesting.reset()})

describe('EpochLocalSecurityStateV6 persistence and writer gate',()=>{
  it('MAC-authenticates StateV6, persists a non-extractable WriterDeviceKeyV2 and promotes only after canonical reconciliation',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const reconciled=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    await store.replaceState(rootKey,f.epochSalt,0,reconciled)
    const loaded=await store.loadState(rootKey,f.epochSalt,f.epochId)
    expect(loaded.writer_status).toBe('writer_active')
    expect(loaded.remote_anchor).toEqual(f.result.remote_anchor)
    expect((await store.loadWriterKey(f.writer.writerKeyId,f.diaryId,f.epochId))?.private_key.extractable).toBe(false)
  })

  it('never promotes staged or mismatched authority into normal write access',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const staged={...f.result,activation_state:'staged_confirmation_missing' as const}
    const reconciled=await stateAfterCanonicalVerifyV6(f.initial,staged,[],true)
    await store.replaceState(rootKey,f.epochSalt,0,reconciled)
    const verified=v2VerifiedRemoteState(staged,{manifest:[],rows:[]},reconciled.operation_generation)
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId))
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('read_only')

    const wrong={...f.result,current_writer:{...f.result.current_writer,writer_device_id:b(33,16)}}
    const afterWrong=await stateAfterCanonicalVerifyV6(await store.loadState(rootKey,f.epochSalt,f.epochId),wrong,[],true)
    expect(afterWrong.writer_status).toBe('read_only')
  })

  it('requires the exact persisted canonical anchor before preparing any immutable domain envelope',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId))
    const preparer=new V2DomainWritePreparer(store,authority)
    const staleVerified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]},f.initial.operation_generation)

    await expect(preparer.prepareAndPersist(staleVerified,rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(11,16),status:'active',data:painData}))
      .rejects.toThrow(/authority|writer/i)
    expect(await store.envelopes(f.epochId)).toHaveLength(0)

    const reconciled=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    await store.replaceState(rootKey,f.epochSalt,0,reconciled)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]},reconciled.operation_generation)
    const prepared=await preparer.prepareAndPersist(verified,rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(11,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:05:00.000Z'})
    expect(prepared.revision.writer_context).toEqual({
      writer_generation:1,
      writer_grant_id:f.result.current_writer.writer_grant_id,
      writer_device_id:f.writerDeviceId,
      writer_key_id:f.writer.writerKeyId,
    })
    expect(prepared.revision.writer_signature).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(await store.envelopes(f.epochId)).toHaveLength(1)
    const committed=await store.loadState(rootKey,f.epochSalt,f.epochId)
    expect(committed.local_journal_count).toBe(1)
    await expect(preparer.prepareAndPersist(verified,rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(12,16),status:'active',data:painData}))
      .rejects.toThrow(/consumed|authority/i)
    expect(await store.envelopes(f.epochId)).toHaveLength(1)
  })

  it('fails closed on Pending-Rekey and on any non-terminal mutation ref',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const active=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    await store.replaceState(rootKey,f.epochSalt,0,active)
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId))
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]},active.operation_generation)
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('writer')

    const pendingRemote={...f.result,current_recovery:{...f.result.current_recovery,recovery_rekey_rotation_required:true,recovery_rekey_transition_id:b(12,32)}}
    const pending=await stateAfterCanonicalVerifyV6(active,pendingRemote,[],true)
    await store.replaceState(rootKey,f.epochSalt,active.operation_generation,pending)
    await expect(authority.canPrepareDomainWrite(v2VerifiedRemoteState(pendingRemote,{manifest:[],rows:[]},pending.operation_generation))).resolves.toBe('read_only')

    const operationBlocked:EpochLocalSecurityStateV6={...pending,recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null,rotation_state_ref:{operation_id:'rotation-1',state:'copying',state_record_hash:b(13,32)},operation_generation:pending.operation_generation+1}
    await store.replaceState(rootKey,f.epochSalt,pending.operation_generation,operationBlocked)
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('read_only')
  })

  it('rejects rollback and same-height prefix replacement during StateV6 reconciliation',async()=>{
    const f=await fixture(),first=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    const conflicting={...f.result,remote_anchor:{...f.result.remote_anchor,prefix_hash:b(77,32)}}
    await expect(stateAfterCanonicalVerifyV6(first,conflicting,[],true)).rejects.toThrow()
  })
})
