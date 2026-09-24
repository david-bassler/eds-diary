import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import { deriveEpochSaltV2, generateWriterDeviceKeyV2, revisionSigningBytesV2, signEd25519V2 } from '../security/v2/crypto'
import { localJournalInitialV2, recoveryCredentialHistoryHashV2, withDiaryLockV2, type EpochLocalSecurityStateV6 } from '../security/v2/localState'
import { IndexedDbV2LocalSecurityStore, __v2LocalPersistenceTesting } from '../security/v2/localPersistence'
import { stateAfterCanonicalVerifyV6 } from '../security/v2/stateReconciliation'
import { TransferableSingleWriterV2WriteAuthority, v2VerifiedRemoteState } from '../security/v2/writeAuthority'
import { V2DomainWritePreparer } from '../security/v2/domainWrite'
import { IndexedDbV2CoordinatorStore } from '../security/v2/coordinatorStore'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { createAnchorV2 } from '../security/v2/prefix'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import type { RevisionV2 } from '../security/v2/types'

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
  const recoveryHistory=[{recovery_generation:0,recovery_urs_id:b(8,32),recovery_takeover_key_id:b(9,32)}]
  const initial:EpochLocalSecurityStateV6={
    local_state_version:6,
    diary_id:diaryId,
    epoch_id:epochId,
    key_id:b(4,16),
    manifest_fingerprint:b(5,32),
    recovery_generation:0,
    recovery_urs_commitment:b(6,32),
    recovery_urs_id:b(8,32),
    recovery_rekey_rotation_required:false,
    recovery_rekey_transition_id:null,
    remote_binding:{storage_provider_id:'google-drive-sheets-v1',sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:'remote-1',remote_identity_binding:'subject-1'},
    remote_anchor:anchor,
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
    verified_writer_device_id:writerDeviceId,
    verified_writer_key_id:writer.writerKeyId,
    verified_writer_generation:1,
    verified_writer_grant_id:b(7,32),
    recovery_takeover_key_id:b(9,32),
    recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(recoveryHistory),
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
    recovery_credential_history:recoveryHistory,
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
    const verified=v2VerifiedRemoteState(staged,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('read_only')

    const wrong={...f.result,current_writer:{...f.result.current_writer,writer_device_id:b(33,16)}}
    const afterWrong=await stateAfterCanonicalVerifyV6(await store.loadState(rootKey,f.epochSalt,f.epochId),wrong,[],true)
    expect(afterWrong.writer_status).toBe('read_only')
  })

  it('invokes a new canonical verify inside every domain-write attempt and never persists without usable local writer authority',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    let verifyCalls=0
    const freshSource={verifyNow:async()=>{verifyCalls+=1;return verified}}
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,freshSource)

    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(11,16),status:'active',data:painData}))
      .rejects.toThrow(/authority|writer|read-only/i)
    expect(verifyCalls).toBe(1)
    expect(await store.envelopes(f.epochId)).toHaveLength(0)

    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)

    const first=await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(11,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:05:00.000Z'})
    expect(first.revision.writer_context).toEqual({
      writer_generation:1,
      writer_grant_id:f.result.current_writer.writer_grant_id,
      writer_device_id:f.writerDeviceId,
      writer_key_id:f.writer.writerKeyId,
    })
    expect(first.revision.writer_signature).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(verifyCalls).toBe(2)
    expect(await store.envelopes(f.epochId)).toHaveLength(1)

    await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(12,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:06:00.000Z'})
    expect(verifyCalls).toBe(3)
    expect(await store.envelopes(f.epochId)).toHaveLength(2)
    expect((await store.loadState(rootKey,f.epochSalt,f.epochId)).local_journal_count).toBe(2)
  })

  it('rejects domain parents that are absent from or belong to another record in the fresh accepted graph before reservation',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const foreignParentId=b(48,32)
    const parent={record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(49,16),revision_id:foreignParentId,parent_revision_ids:[],record_status:'active' as const,record_data:painData,migration_origin:null,protocol_created_at:'2026-09-23T08:00:00.000Z',writer_context:{writer_generation:1,writer_grant_id:f.result.current_writer.writer_grant_id,writer_device_id:f.writerDeviceId,writer_key_id:f.writer.writerKeyId},writer_signature:b(50,64)}
    const graphResult:CanonicalFullResultV2={...f.result,accepted_revision_graph:{revisions:new Map([[foreignParentId,parent]]),heads_by_record:new Map([[parent.record_id,new Set([foreignParentId])]])}}
    const verified=v2VerifiedRemoteState(graphResult,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified})

    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(51,16),parentRevisionIds:[b(52,32)],status:'active',data:painData}))
      .rejects.toThrow(/parent is not in/)
    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(51,16),parentRevisionIds:[foreignParentId],status:'active',data:painData}))
      .rejects.toThrow(/different record/)
    expect(await store.envelopes(f.epochId)).toHaveLength(0)
  })

  it('treats a valid keypair stored under the wrong local device binding as read-only',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:b(44,16),
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified})
    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(45,16),status:'active',data:painData}))
      .rejects.toThrow(/authority|writer|read-only/i)
    expect((await store.loadState(rootKey,f.epochSalt,f.epochId)).writer_status).toBe('read_only')
    expect(await store.envelopes(f.epochId)).toHaveLength(0)
  })
  it('fails closed on Pending-Rekey and on any non-terminal mutation ref',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const active=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    await store.replaceState(rootKey,f.epochSalt,0,active)
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('writer')

    const pendingRemote={...f.result,current_recovery:{...f.result.current_recovery,recovery_rekey_rotation_required:true,recovery_rekey_transition_id:b(12,32)}}
    const pending=await stateAfterCanonicalVerifyV6(active,pendingRemote,[],true)
    await store.replaceState(rootKey,f.epochSalt,active.operation_generation,pending)
    await expect(authority.canPrepareDomainWrite(v2VerifiedRemoteState(pendingRemote,{manifest:[],rows:[]}))).resolves.toBe('read_only')

    const operationBlocked:EpochLocalSecurityStateV6={...pending,recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null,rotation_state_ref:{operation_id:b(14,32),state:'copying',state_record_hash:b(13,32)},operation_generation:pending.operation_generation+1}
    await store.replaceState(rootKey,f.epochSalt,pending.operation_generation,operationBlocked)
    await expect(authority.canPrepareDomainWrite(verified)).resolves.toBe('read_only')
  })


  it('downgrades a sealed current source to local read_only on canonical reconciliation',async()=>{
    const f=await fixture(),sealed={...f.result,source_epoch_sealed:true,current_writer:{...f.result.current_writer,source_epoch_sealed:true}}
    const reconciled=await stateAfterCanonicalVerifyV6(f.initial,sealed,[],true)
    expect(reconciled.writer_status).toBe('read_only')
    expect(reconciled.writer_generation).toBeNull()
    expect(reconciled.writer_grant_id).toBeNull()
  })

  it('uses verifier dispositions rather than physical row presence for v2 durability',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const initialVerified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>initialVerified})
    const prepared=await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(20,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:10:00.000Z'})
    const row=envelopeRowV2(prepared.envelope),remoteAnchor=await createAnchorV2(f.diaryId,f.epochId,[row])
    const staleResult:CanonicalFullResultV2={
      ...f.result,
      remote_anchor:remoteAnchor,
      dispositions:[{row_index:1,envelope_id:prepared.envelope.envelopeId,revision_id:prepared.revision.revision_id,disposition:'stale_writer_rejected'}],
      verified_envelope_ids:new Set([prepared.envelope.envelopeId]),
      accepted_envelope_ids:new Set(),
      stale_writer_envelope_ids:new Set([prepared.envelope.envelopeId]),
    }
    const verified=v2VerifiedRemoteState(staleResult,{manifest:[],rows:[row]})
    const coordinatorStore=new IndexedDbV2CoordinatorStore(f.epochId,rootKey,f.epochSalt,store)
    const generation=await coordinatorStore.generation()
    await coordinatorStore.commitVerifiedPull(verified,remoteAnchor,generation)
    expect(await coordinatorStore.pending(verified)).toEqual([])
    expect((await store.outbox(rootKey,f.epochSalt,f.epochId))[0]?.status).toBe('stale_writer_pending')
    expect((await store.loadState(rootKey,f.epochSalt,f.epochId)).stale_writer_pending_count).toBe(1)
  })

  it('quarantines a prepared envelope when its persisted writer provenance is no longer current',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const verified1=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified1})
    const prepared=await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(21,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:11:00.000Z'})

    const generation2={...f.result,current_writer:{...f.result.current_writer,writer_generation:2,writer_grant_id:b(22,32)}}
    const current=await store.loadState(rootKey,f.epochSalt,f.epochId)
    const reconciled=await stateAfterCanonicalVerifyV6(current,generation2,[],true)
    await store.replaceState(rootKey,f.epochSalt,current.operation_generation,reconciled)
    const verified2=v2VerifiedRemoteState(generation2,{manifest:[],rows:[]})
    await expect(authority.canPrepareDomainWrite(verified2)).resolves.toBe('writer')
    await expect(authority.verifyBeforePush(prepared.envelope,verified2,'initial')).resolves.toBe('quarantine_stale_writer')
  })

  it('fails closed when canonical writer state belongs to another epoch identity',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const active=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],false)
    await store.replaceState(rootKey,f.epochSalt,0,{...active,writer_status:'read_only',writer_generation:null,writer_grant_id:null})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const wrongDiary=v2VerifiedRemoteState({...f.result,diary_id:b(55,16)},{manifest:[],rows:[]})
    await expect(authority.canPrepareDomainWrite(wrongDiary)).resolves.toBe('read_only')
    const wrongEpoch=v2VerifiedRemoteState({...f.result,epoch_id:b(56,16)},{manifest:[],rows:[]})
    await expect(authority.canPrepareDomainWrite(wrongEpoch)).resolves.toBe('read_only')
    const wrongManifest=v2VerifiedRemoteState({...f.result,manifest_fingerprint:b(57,32)},{manifest:[],rows:[]})
    await expect(authority.canPrepareDomainWrite(wrongManifest)).resolves.toBe('read_only')
  })

  it('refuses push authorization when the supplied envelope bytes differ from the immutable persisted envelope',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified})
    const prepared=await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(53,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:13:00.000Z'})
    await expect(authority.verifyBeforePush({...prepared.envelope,ciphertext:`${prepared.envelope.ciphertext}A`},verified,'initial'))
      .rejects.toThrow(/immutable local persistence/)
  })

  it('fails closed before prepare or push when a persisted EnvelopeV6 row no longer matches the authenticated local journal',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const preparer=new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified})
    await preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(46,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:12:00.000Z'})

    const db=await __v2LocalPersistenceTesting.openDatabase()
    const tx=db.transaction(__v2LocalPersistenceTesting.STORES.envelopes,'readwrite')
    const entries=await new Promise<Array<Record<string,unknown>>>((resolve,reject)=>{
      const request=tx.objectStore(__v2LocalPersistenceTesting.STORES.envelopes).getAll()
      request.addEventListener('success',()=>resolve(request.result as Array<Record<string,unknown>>),{once:true})
      request.addEventListener('error',()=>reject(request.error),{once:true})
    })
    const first=entries[0]!
    tx.objectStore(__v2LocalPersistenceTesting.STORES.envelopes).put({...first,ciphertext:`${String(first.ciphertext)}A`})
    await new Promise<void>((resolve,reject)=>{tx.addEventListener('complete',()=>resolve(),{once:true});tx.addEventListener('error',()=>reject(tx.error),{once:true})})

    await expect(store.verifyLocalJournal(rootKey,f.epochSalt,f.epochId)).rejects.toThrow(/journal hash/)
    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(47,16),status:'active',data:painData}))
      .rejects.toThrow(/journal hash/)
    const coordinatorStore=new IndexedDbV2CoordinatorStore(f.epochId,rootKey,f.epochSalt,store)
    await expect(coordinatorStore.pending(verified)).rejects.toThrow(/journal hash/)
  })

  it('quarantines a locally prepared old-writer envelope during pull even when it is absent remotely',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const initialVerified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const prepared=await new V2DomainWritePreparer(store,authority,{verifyNow:async()=>initialVerified})
      .prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(60,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:20:00.000Z'})
    const takeover:CanonicalFullResultV2={
      ...f.result,
      current_writer:{...f.result.current_writer,writer_generation:2,writer_grant_id:b(61,32),writer_device_id:b(62,16),writer_key_id:b(63,32)},
    }
    const verified=v2VerifiedRemoteState(takeover,{manifest:[],rows:[]})
    const coordinatorStore=new IndexedDbV2CoordinatorStore(f.epochId,rootKey,f.epochSalt,store)
    await coordinatorStore.commitVerifiedPull(verified,takeover.remote_anchor,await coordinatorStore.generation())
    expect((await store.outbox(rootKey,f.epochSalt,f.epochId)).find(entry=>entry.envelope_id===prepared.envelope.envelopeId)?.status).toBe('stale_writer_pending')
    expect((await store.loadState(rootKey,f.epochSalt,f.epochId)).stale_writer_pending_count).toBe(1)
  })

  it('quarantines old local pending writes on the next fresh domain-write verification before returning read-only',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const initial=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const takeover:CanonicalFullResultV2={
      ...f.result,
      current_writer:{
        ...f.result.current_writer,
        writer_generation:2,
        writer_grant_id:b(75,32),
        writer_device_id:b(76,16),
        writer_key_id:b(77,32),
      },
    }
    let calls=0
    const authority=new TransferableSingleWriterV2WriteAuthority(
      ()=>store.loadState(rootKey,f.epochSalt,f.epochId),
      (envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope),
    )
    const preparer=new V2DomainWritePreparer(store,authority,{
      verifyNow:async()=>++calls===1?initial:v2VerifiedRemoteState(takeover,{manifest:[],rows:[]}),
    })
    const first=await preparer.prepareAndPersist(rootKey,f.epochSalt,{
      recordType:'pain_entry',recordId:b(78,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:25:00.000Z',
    })
    await expect(preparer.prepareAndPersist(rootKey,f.epochSalt,{
      recordType:'pain_entry',recordId:b(79,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:26:00.000Z',
    })).rejects.toThrow(/does not permit domain-write preparation/)
    const entry=(await store.outbox(rootKey,f.epochSalt,f.epochId)).find(item=>item.envelope_id===first.envelope.envelopeId)
    expect(entry?.status).toBe('stale_writer_pending')
    const state=await store.loadState(rootKey,f.epochSalt,f.epochId)
    expect(state.writer_status).toBe('read_only')
    expect(state.stale_writer_pending_count).toBe(1)
  })

  it('rejects a verified remote row that reuses a local envelope_id with different row bytes',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const initialVerified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const prepared=await new V2DomainWritePreparer(store,authority,{verifyNow:async()=>initialVerified})
      .prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(64,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:21:00.000Z'})
    const conflictingRow=[prepared.envelope.envelopeId,b(65,12),prepared.envelope.ciphertext] as const
    const remoteAnchor=await createAnchorV2(f.diaryId,f.epochId,[conflictingRow])
    const collision:CanonicalFullResultV2={
      ...f.result,
      remote_anchor:remoteAnchor,
      verified_envelope_ids:new Set([prepared.envelope.envelopeId]),
      accepted_envelope_ids:new Set([prepared.envelope.envelopeId]),
      dispositions:[{row_index:1,envelope_id:prepared.envelope.envelopeId,revision_id:prepared.revision.revision_id,disposition:'accepted'}],
    }
    const verified=v2VerifiedRemoteState(collision,{manifest:[],rows:[conflictingRow]})
    const coordinatorStore=new IndexedDbV2CoordinatorStore(f.epochId,rootKey,f.epochSalt,store)
    await expect(coordinatorStore.commitVerifiedPull(verified,remoteAnchor,await coordinatorStore.generation()))
      .rejects.toThrow(/collides with different immutable local bytes/)
  })

  it('detects deletion of an authenticated outbox entry instead of legitimizing it on the next pull',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    await store.persistWriterKey({
      writer_signing_key_id:f.writer.writerKeyId,
      writer_device_id:f.writerDeviceId,
      writer_public_key:base64Url(f.writer.publicKeyRaw),
      private_key:f.writer.privateKey,
    },f.diaryId,f.epochId)
    const verified=v2VerifiedRemoteState(f.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store.loadState(rootKey,f.epochSalt,f.epochId),(envelope)=>store.envelopeAuthority(rootKey,f.epochSalt,f.epochId,envelope))
    const prepared=await new V2DomainWritePreparer(store,authority,{verifyNow:async()=>verified})
      .prepareAndPersist(rootKey,f.epochSalt,{recordType:'pain_entry',recordId:b(66,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:22:00.000Z'})
    const db=await __v2LocalPersistenceTesting.openDatabase()
    const tx=db.transaction(__v2LocalPersistenceTesting.STORES.outbox,'readwrite')
    tx.objectStore(__v2LocalPersistenceTesting.STORES.outbox).delete(`${f.epochId}:${prepared.envelope.envelopeId}`)
    await new Promise<void>((resolve,reject)=>{tx.addEventListener('complete',()=>resolve(),{once:true});tx.addEventListener('error',()=>reject(tx.error),{once:true})})
    await expect(store.verifyLocalJournal(rootKey,f.epochSalt,f.epochId)).rejects.toThrow(/bijection/)
    const coordinatorStore=new IndexedDbV2CoordinatorStore(f.epochId,rootKey,f.epochSalt,store)
    await expect(coordinatorStore.commitVerifiedPull(verified,f.result.remote_anchor,await coordinatorStore.generation())).rejects.toThrow(/bijection/)
  })

  it('binds persisted outbox Writer authority to the writer_context encrypted inside RevisionV2',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const reservation=await store.reserveEnvelope(f.epochId,[])
    const revision:RevisionV2={
      record_type:'pain_entry',
      record_schema:'pain-entry/v1',
      record_id:b(67,16),
      revision_id:b(68,32),
      parent_revision_ids:[],
      record_status:'active',
      record_data:painData,
      migration_origin:null,
      protocol_created_at:'2026-09-23T08:23:00.000Z',
      writer_context:{writer_generation:1,writer_grant_id:b(7,32),writer_device_id:f.writerDeviceId,writer_key_id:f.writer.writerKeyId},
      writer_signature:null,
    }
    revision.writer_signature=await signEd25519V2(f.writer.privateKey,revisionSigningBytesV2(f.diaryId,f.epochId,revision))
    const envelope=await sealRevisionEnvelopeV2(rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    await expect(store.commitReservedEnvelope(rootKey,f.epochSalt,0,reservation,envelope,{
      writer_generation:2,
      writer_grant_id:b(69,32),
      writer_device_id:f.writerDeviceId,
      writer_key_id:f.writer.writerKeyId,
    })).rejects.toThrow(/Writer provenance/)
  })

  it('keeps orphaned epochs and stale-writer quarantine terminal',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    const orphaned={...f.initial,epoch_status:'orphaned' as const,operation_generation:1}
    await store.replaceState(rootKey,f.epochSalt,0,orphaned)
    await expect(store.replaceState(rootKey,f.epochSalt,1,{...orphaned,epoch_status:'active',operation_generation:2})).rejects.toThrow(/terminal/)

    await __v2LocalPersistenceTesting.reset()
    const f2=await fixture(),store2=new IndexedDbV2LocalSecurityStore()
    await store2.initializeState(rootKey,f2.epochSalt,f2.initial)
    await store2.persistWriterKey({
      writer_signing_key_id:f2.writer.writerKeyId,
      writer_device_id:f2.writerDeviceId,
      writer_public_key:base64Url(f2.writer.publicKeyRaw),
      private_key:f2.writer.privateKey,
    },f2.diaryId,f2.epochId)
    const verified=v2VerifiedRemoteState(f2.result,{manifest:[],rows:[]})
    const authority=new TransferableSingleWriterV2WriteAuthority(()=>store2.loadState(rootKey,f2.epochSalt,f2.epochId),(envelope)=>store2.envelopeAuthority(rootKey,f2.epochSalt,f2.epochId,envelope))
    const prepared=await new V2DomainWritePreparer(store2,authority,{verifyNow:async()=>verified})
      .prepareAndPersist(rootKey,f2.epochSalt,{recordType:'pain_entry',recordId:b(70,16),status:'active',data:painData,protocolCreatedAt:'2026-09-23T08:24:00.000Z'})
    let generation=(await store2.loadState(rootKey,f2.epochSalt,f2.epochId)).operation_generation
    generation=(await store2.updateOutboxStatus(rootKey,f2.epochSalt,f2.epochId,prepared.envelope.envelopeId,generation,'stale_writer_pending')).operation_generation
    await expect(store2.updateOutboxStatus(rootKey,f2.epochSalt,f2.epochId,prepared.envelope.envelopeId,generation,'pending')).rejects.toThrow(/terminal/)
  })

  it('fails closed on an EnvelopeV6 IV collision with verified remote history before encryption',async()=>{
    const f=await fixture(),store=new IndexedDbV2LocalSecurityStore()
    await store.initializeState(rootKey,f.epochSalt,f.initial)
    function deterministicRandom<T extends ArrayBufferView|null>(array:T):T{
      if(array instanceof Uint8Array)array.fill(array.byteLength===12?72:71)
      return array
    }
    const random=vi.spyOn(globalThis.crypto,'getRandomValues').mockImplementation(deterministicRandom)
    try{
      await expect(store.reserveEnvelope(f.epochId,[[b(73,32),b(72,12),'AA']])).rejects.toThrow(/IV reuse/)
    }finally{random.mockRestore()}
  })

  it('requires Web Locks in browser-like worker contexts instead of falling back unlocked',async()=>{
    vi.stubGlobal('importScripts',()=>undefined)
    vi.stubGlobal('navigator',{})
    try{
      await expect(withDiaryLockV2(b(74,16),async()=>undefined)).rejects.toThrow(/Web Locks/)
    }finally{vi.unstubAllGlobals()}
  })

  it('rejects rollback and same-height prefix replacement during StateV6 reconciliation',async()=>{
    const f=await fixture(),first=await stateAfterCanonicalVerifyV6(f.initial,f.result,[],true)
    const conflicting={...f.result,remote_anchor:{...f.result.remote_anchor,prefix_hash:b(77,32)}}
    await expect(stateAfterCanonicalVerifyV6(first,conflicting,[],true)).rejects.toThrow()
  })
})
