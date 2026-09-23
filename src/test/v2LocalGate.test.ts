import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { IndexedDbV2LocalSecurityStore } from '../data/v2LocalSecurityStore'
import { base64Url, randomBytes } from '../security/crypto/bytes'
import { generateWriterDeviceKeyV2, revisionSigningBytesV2, signEd25519V2 } from '../security/v2/crypto'
import { V2DomainWriteService } from '../security/v2/domainWrite'
import { openRevisionEnvelopeV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import {
  createBestEffortRootWrapV6,
  createPrfRootWrapV6,
  journalInitialV2,
  openBestEffortRootWrapV6,
  openPrfRootWrapV6,
  recoveryCredentialHistoryHashV2,
  validateEpochLocalSecurityStateV6,
  validateRootWrapV6,
  type EpochLocalSecurityStateV6,
} from '../security/v2/localState'
import { createAnchorV2 } from '../security/v2/prefix'
import { TransferableWriterAuthorityV2 } from '../security/v2/writeAuthority'
import type { RevisionV2 } from '../security/v2/types'
import type { CanonicalFullResultV2, RecoveryStateSnapshotV2, WriterAuthoritySnapshotV2 } from '../security/v2/verifier'
import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE, type VerifiedRemoteState } from '../sync/core/contracts'
import { deriveEpochSaltV2 } from '../security/v2/crypto'

const b=(value:number,length:number)=>base64Url(new Uint8Array(length).fill(value))
const rootKey=new Uint8Array(32).fill(31)
const diary=b(1,16),epoch=b(2,16),keyId=b(3,16),fingerprint=b(4,32),device=b(5,16),grant=b(6,32)
const ursId=b(7,32),commitment=b(8,32),takeoverId=b(9,32),takeoverPublic=b(10,32)

const databases:IndexedDbV2LocalSecurityStore[]=[]
function store():IndexedDbV2LocalSecurityStore{
  const instance=new IndexedDbV2LocalSecurityStore(`eds-diary-v2-security-test-${base64Url(randomBytes(8))}`)
  databases.push(instance);return instance
}
afterEach(async()=>{for(const instance of databases.splice(0))await instance.deleteForTesting()})

const pain=(note='v2 write')=>({
  startedAt:'2026-09-23T07:00:00.000Z',
  endedAt:'',
  locations:[],
  intensity:4,
  qualities:[],
  cause:'',
  occursWhen:'',
  note,
  createdAt:'2026-09-23T07:00:00.000Z',
  updatedAt:'2026-09-23T07:00:00.000Z',
})

async function stateFor(writerKeyId:string,anchor:Awaited<ReturnType<typeof createAnchorV2>>,overrides:Partial<EpochLocalSecurityStateV6>={}):Promise<EpochLocalSecurityStateV6>{
  const history=[{recovery_generation:0,recovery_urs_id:ursId,recovery_takeover_key_id:takeoverId}]
  return{
    local_state_version:6,
    diary_id:diary,
    epoch_id:epoch,
    key_id:keyId,
    manifest_fingerprint:fingerprint,
    recovery_generation:0,
    recovery_urs_commitment:commitment,
    recovery_urs_id:ursId,
    recovery_rekey_rotation_required:false,
    recovery_rekey_transition_id:null,
    remote_binding:{storage_provider_id:GOOGLE_DRIVE_SHEETS_PROVIDER,sync_profile:SINGLE_WRITER_V2_PROFILE,remote_resource_id:'remote-v2',remote_identity_binding:'account-binding'},
    remote_anchor:anchor,
    epoch_status:'active',
    operation_generation:0,
    rotation_state_ref:null,
    migration_state_ref:null,
    writer_operation_state_ref:null,
    recovery_operation_state_ref:null,
    activation_lineage_cache_ref:null,
    local_journal_count:0,
    local_journal_hash:await journalInitialV2(diary,epoch),
    writer_status:'writer_active',
    writer_device_id:device,
    writer_signing_key_id:writerKeyId,
    writer_generation:1,
    writer_grant_id:grant,
    verified_writer_device_id:device,
    verified_writer_key_id:writerKeyId,
    verified_writer_generation:1,
    verified_writer_grant_id:grant,
    recovery_takeover_key_id:takeoverId,
    recovery_credential_history_sha256:await recoveryCredentialHistoryHashV2(history),
    stale_writer_pending_count:0,
    ...overrides,
  }
}

function verified(
  authority:WriterAuthoritySnapshotV2,
  anchor:Awaited<ReturnType<typeof createAnchorV2>>,
  rows:ReadonlyArray<readonly string[]>=[],
  recovery:RecoveryStateSnapshotV2={
    recovery_generation:0,recovery_urs_commitment:commitment,recovery_urs_id:ursId,
    recovery_takeover_key_id:takeoverId,recovery_takeover_public_key:takeoverPublic,
    recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null,
  },
):VerifiedRemoteState{
  const history=[{recovery_generation:recovery.recovery_generation,recovery_urs_id:recovery.recovery_urs_id,recovery_takeover_key_id:recovery.recovery_takeover_key_id}]
  const canonical:CanonicalFullResultV2={
    kind:'canonical_full',
    profile_id:SINGLE_WRITER_V2_PROFILE,
    diary_id:diary,
    epoch_id:epoch,
    manifest_fingerprint:fingerprint,
    remote_anchor:anchor,
    current_writer:authority,
    current_recovery:recovery,
    recovery_credential_history:history,
    source_epoch_sealed:false,
    accepted_revision_graph:{revisions:new Map(),heads_by_record:new Map()},
    accepted_epoch_migration:null,
    accepted_activation_confirmation:null,
    activation_state:'native_active',
    dispositions:[],
    verified_envelope_ids:new Set(rows.map(row=>row[0]!)),
    accepted_envelope_ids:new Set(rows.map(row=>row[0]!)),
    stale_writer_envelope_ids:new Set(),
    authority_history_by_prefix:new Map([[0,authority]]),
    recovery_history_by_prefix:new Map([[0,recovery]]),
  }
  return{
    profileId:SINGLE_WRITER_V2_PROFILE,
    profileState:canonical,
    snapshot:{manifest:[],rows},
    manifestFingerprint:fingerprint,
    retired:false,
    verifiedEnvelopeIds:canonical.verified_envelope_ids,
    acceptedEnvelopeIds:canonical.accepted_envelope_ids,
    staleWriterEnvelopeIds:canonical.stale_writer_envelope_ids,
  }
}

describe('EpochLocalSecurityStateV6 and writer gate',()=>{
  it('rejects StateV6 shape/cross-field drift and authenticates the closed state',async()=>{
    const anchor=await createAnchorV2(diary,epoch,[])
    const s=await stateFor(b(11,32),anchor)
    expect(validateEpochLocalSecurityStateV6(s)).toEqual(s)
    expect(()=>validateEpochLocalSecurityStateV6({...s,migration_state_ref:{operation_id:b(12,32),state:'x',state_record_hash:b(13,32)}})).toThrow(/migration_state_ref/)
    expect(()=>validateEpochLocalSecurityStateV6({...s,recovery_rekey_rotation_required:true,recovery_rekey_transition_id:null})).toThrow(/Pending-Rekey/)
    expect(()=>validateEpochLocalSecurityStateV6({...s,writer_status:'read_only',writer_generation:1})).toThrow(/read_only/)
    expect(()=>validateEpochLocalSecurityStateV6({...s,epoch_status:'orphaned'})).toThrow(/orphaned/)
    expect(()=>validateEpochLocalSecurityStateV6({...s,unexpected:true})).toThrow(/unknown or missing/)
  })

  it('keeps RootWrapV6 one-shot material and v6 PRF domain separate from v5 state',async()=>{
    const repo=store(),wrapIdBytes=new Uint8Array(16).fill(40),wrapId=base64Url(wrapIdBytes)
    const bestKey=await repo.createBestEffortWrappingKey(wrapId)
    const identity={diary_id:diary,epoch_id:epoch,key_id:keyId,manifest_fingerprint:fingerprint}
    const best=await createBestEffortRootWrapV6(rootKey,bestKey,identity,wrapIdBytes,new Uint8Array(12).fill(41))
    expect(validateRootWrapV6(best)).toEqual(best)
    await repo.persistRootWrap(epoch,best)
    expect(await repo.readRootWrap(epoch)).toEqual(best)
    await expect(openBestEffortRootWrapV6(best,bestKey)).resolves.toEqual(rootKey)
    await expect(repo.loadBestEffortWrappingKey(b(42,16))).resolves.toBeNull()

    const credential=new Uint8Array([1,2,3,4]),prfOutput=new Uint8Array(32).fill(43),evalInput=new Uint8Array(32).fill(44),wrapSalt=new Uint8Array(32).fill(45)
    await expect(createPrfRootWrapV6(rootKey,{credentialId:credential,prfEvalInput:evalInput,prfOutput,rpId:'example.test',verified:false} as never,identity,new Uint8Array(16).fill(46),wrapSalt,new Uint8Array(12).fill(47))).rejects.toThrow(/unverified/)
    const prf=await createPrfRootWrapV6(rootKey,{credentialId:credential,prfEvalInput:evalInput,prfOutput,rpId:'example.test',verified:true},identity,new Uint8Array(16).fill(46),wrapSalt,new Uint8Array(12).fill(47))
    expect(prf.mode_metadata.prf_profile).toBe('webauthn-prf-v6-1')
    await expect(openPrfRootWrapV6(prf,credential,prfOutput)).resolves.toEqual(rootKey)
    await expect(openPrfRootWrapV6(prf,new Uint8Array([9]),prfOutput)).rejects.toThrow(/credential mismatch/)
    expect(()=>validateRootWrapV6({...prf,mode_metadata:{...prf.mode_metadata,prf_profile:'webauthn-prf-v5-1'}})).toThrow(/profile|metadata/)
  })

  it('persists a non-extractable writer CryptoKey and verifies its diary/epoch/device binding on load',async()=>{
    const repo=store(),record=await repo.createAndPersistWriterKey(diary,epoch,device)
    expect(record.private_key.extractable).toBe(false)
    expect(record.private_key.usages).toEqual(['sign'])
    await expect(repo.loadAndVerifyWriterKey(diary,epoch,device,record.writer_signing_key_id)).resolves.toMatchObject({writer_device_id:device,writer_signing_key_id:record.writer_signing_key_id})
    await expect(repo.loadAndVerifyWriterKey(diary,epoch,b(14,16),record.writer_signing_key_id)).rejects.toThrow(/identity binding/)
    const raw=await repo.openForTesting(),tx=raw.transaction('writerDeviceKeysV2','readwrite'),stored=await new Promise<Record<string,unknown>>((resolve,reject)=>{const request=tx.objectStore('writerDeviceKeysV2').get(record.writer_signing_key_id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    stored.writer_public_key=b(15,32);tx.objectStore('writerDeviceKeysV2').put(stored);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
    await expect(repo.loadAndVerifyWriterKey(diary,epoch,device,record.writer_signing_key_id)).rejects.toThrow(/public key ID/)
  })

  it('does not persist a domain RevisionV2 until a fresh canonical verify authorizes the exact local writer',async()=>{
    const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
    await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor))
    const authority:WriterAuthoritySnapshotV2={writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id,writer_public_key:key.writer_public_key,source_epoch_sealed:false}
    let verifies=0
    const service=new V2DomainWriteService(diary,epoch,{
      store:repo,
      requireUnlockedRoot:async()=>({rootKey}),
      providerSessionActive:()=>true,
      freshCanonicalVerify:async()=>{verifies++;expect(await repo.listOutbox(epoch)).toEqual([]);return verified(authority,anchor)},
    })
    const prepared=await service.prepareDomainWrite({
      record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(16,16),
      parent_revision_ids:[],record_status:'active',record_data:pain(),
    })
    expect(verifies).toBe(1)
    expect(await repo.listOutbox(epoch)).toContainEqual(prepared.envelope)
    const salt=await deriveEpochSaltV2(new Uint8Array(16).fill(1),new Uint8Array(16).fill(2))
    const opened=await openRevisionEnvelopeV2(rootKey,salt,{diaryId:diary,epochId:epoch},prepared.envelope)
    expect(opened.writer_context).toEqual({writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id})
    const loaded=await repo.readState(rootKey,epoch)
    expect(loaded).toMatchObject({local_journal_count:1,writer_status:'writer_active',verified_writer_key_id:key.writer_signing_key_id})
  })

  it('blocks before persistence when provider session, current authority, Pending-Rekey or operation state fails',async()=>{
    for(const scenario of ['session','authority','rekey','operation'] as const){
      const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
      const overrides:Partial<EpochLocalSecurityStateV6>=scenario==='operation'?{rotation_state_ref:{operation_id:b(17,32),state:'copying',state_record_hash:b(18,32)}}:{}
      await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor,overrides))
      const remoteKey=scenario==='authority'?await generateWriterDeviceKeyV2():null
      const remoteAuthority:WriterAuthoritySnapshotV2=scenario==='authority'
        ?{writer_generation:2,writer_grant_id:b(19,32),writer_device_id:b(20,16),writer_key_id:remoteKey!.writerKeyId,writer_public_key:base64Url(remoteKey!.publicKeyRaw),source_epoch_sealed:false}
        :{writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id,writer_public_key:key.writer_public_key,source_epoch_sealed:false}
      const recovery:RecoveryStateSnapshotV2=scenario==='rekey'
        ?{recovery_generation:1,recovery_urs_commitment:b(21,32),recovery_urs_id:b(22,32),recovery_takeover_key_id:b(23,32),recovery_takeover_public_key:b(24,32),recovery_rekey_rotation_required:true,recovery_rekey_transition_id:b(25,32)}
        :{recovery_generation:0,recovery_urs_commitment:commitment,recovery_urs_id:ursId,recovery_takeover_key_id:takeoverId,recovery_takeover_public_key:takeoverPublic,recovery_rekey_rotation_required:false,recovery_rekey_transition_id:null}
      const service=new V2DomainWriteService(diary,epoch,{store:repo,requireUnlockedRoot:async()=>({rootKey}),providerSessionActive:()=>scenario!=='session',freshCanonicalVerify:async()=>verified(remoteAuthority,anchor,[],recovery)})
      await expect(service.prepareDomainWrite({record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(26,16),parent_revision_ids:[],record_status:'active',record_data:pain(scenario)})).rejects.toBeTruthy()
      expect(await repo.listOutbox(epoch)).toEqual([])
    }
  })

  it('fails closed on a missing writer key instead of silently regenerating one',async()=>{
    const repo=store(),anchor=await createAnchorV2(diary,epoch,[]),missing=b(27,32)
    await repo.persistState(rootKey,await stateFor(missing,anchor))
    const authority:WriterAuthoritySnapshotV2={writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:missing,writer_public_key:b(28,32),source_epoch_sealed:false}
    const service=new V2DomainWriteService(diary,epoch,{store:repo,requireUnlockedRoot:async()=>({rootKey}),providerSessionActive:()=>true,freshCanonicalVerify:async()=>verified(authority,anchor)})
    await expect(service.prepareDomainWrite({record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(29,16),parent_revision_ids:[],record_status:'active',record_data:pain()})).rejects.toThrow(/read_only/)
    expect((await repo.readState(rootKey,epoch))?.writer_status).toBe('read_only')
    expect(await repo.listOutbox(epoch)).toEqual([])
  })

  it('rejects divergence between generic VerifiedRemoteState semantics and canonical v2 profile state',async()=>{
    const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
    await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor))
    const authority:WriterAuthoritySnapshotV2={writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id,writer_public_key:key.writer_public_key,source_epoch_sealed:false}
    const gate=new TransferableWriterAuthorityV2({readLocalState:async()=>(await repo.readState(rootKey,epoch))!,inspectPreparedRevision:async()=>{throw new Error('not used')}})
    const divergent=verified(authority,anchor)
    divergent.retired=true
    await expect(gate.canPrepareDomainWrite(divergent)).rejects.toThrow(/seal\/retirement/)
    const divergentSets=verified(authority,anchor)
    divergentSets.acceptedEnvelopeIds=new Set([b(37,32)])
    await expect(gate.canPrepareDomainWrite(divergentSets)).rejects.toThrow(/semantic envelope sets|dispositions/)
  })

  it('never turns an unconfirmed staged successor into normal local writer authority',async()=>{
    const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
    await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor))
    const authority:WriterAuthoritySnapshotV2={writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id,writer_public_key:key.writer_public_key,source_epoch_sealed:false}
    const staged=verified(authority,anchor),profile=staged.profileState as CanonicalFullResultV2
    profile.activation_state='staged_confirmation_missing'
    const service=new V2DomainWriteService(diary,epoch,{store:repo,requireUnlockedRoot:async()=>({rootKey}),providerSessionActive:()=>true,freshCanonicalVerify:async()=>staged})
    await expect(service.prepareDomainWrite({record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(36,16),parent_revision_ids:[],record_status:'active',record_data:pain('staged')})).rejects.toThrow(/unconfirmed staged successor/)
    expect(await repo.listOutbox(epoch)).toEqual([])
  })

  it('rejects corrupted prepared-envelope metadata before immutable local persistence',async()=>{
    const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
    await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor))
    const epochSalt=await deriveEpochSaltV2(new Uint8Array(16).fill(1),new Uint8Array(16).fill(2))
    const revision:RevisionV2={
      record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(38,16),revision_id:b(39,32),parent_revision_ids:[],record_status:'active',record_data:pain('hash mismatch'),migration_origin:null,protocol_created_at:'2026-09-23T07:31:00.000Z',
      writer_context:{writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id},writer_signature:null,
    }
    revision.writer_signature=await signEd25519V2(key.private_key,revisionSigningBytesV2(diary,epoch,revision))
    const envelope=await sealRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:diary,epochId:epoch},revision,new Uint8Array(32).fill(48),new Uint8Array(12).fill(49))
    await repo.reserveEnvelope(epoch,envelope.envelopeId)
    await expect(repo.persistPreparedEnvelope(rootKey,epoch,{...envelope,bytesHash:b(50,32)},0)).rejects.toThrow(/bytesHash/)
    expect(await repo.listOutbox(epoch)).toEqual([])
  })

  it('binds verifyBeforePush to the exact prepared RevisionV2 signature and quarantines stale authority',async()=>{
    const repo=store(),key=await repo.createAndPersistWriterKey(diary,epoch,device),anchor=await createAnchorV2(diary,epoch,[])
    await repo.persistState(rootKey,await stateFor(key.writer_signing_key_id,anchor))
    const epochSalt=await deriveEpochSaltV2(new Uint8Array(16).fill(1),new Uint8Array(16).fill(2))
    const wrong=await generateWriterDeviceKeyV2()
    const unsigned:RevisionV2={
      record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(30,16),revision_id:b(31,32),parent_revision_ids:[],record_status:'active',record_data:pain('bad signature'),migration_origin:null,protocol_created_at:'2026-09-23T07:30:00.000Z',
      writer_context:{writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id},writer_signature:null,
    }
    unsigned.writer_signature=await signEd25519V2(wrong.privateKey,revisionSigningBytesV2(diary,epoch,unsigned))
    const envelope=await sealRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:diary,epochId:epoch},unsigned,new Uint8Array(32).fill(32),new Uint8Array(12).fill(33))
    const authority:WriterAuthoritySnapshotV2={writer_generation:1,writer_grant_id:grant,writer_device_id:device,writer_key_id:key.writer_signing_key_id,writer_public_key:key.writer_public_key,source_epoch_sealed:false}
    const gate=new TransferableWriterAuthorityV2({readLocalState:async()=>(await repo.readState(rootKey,epoch))!,inspectPreparedRevision:async item=>openRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:diary,epochId:epoch},item)})
    await expect(gate.verifyBeforePush(envelope,verified(authority,anchor),'initial')).resolves.toBe('quarantine_stale_writer')

    const newWriter=await generateWriterDeviceKeyV2()
    const changed:WriterAuthoritySnapshotV2={writer_generation:2,writer_grant_id:b(34,32),writer_device_id:b(35,16),writer_key_id:newWriter.writerKeyId,writer_public_key:base64Url(newWriter.publicKeyRaw),source_epoch_sealed:false}
    await expect(gate.verifyBeforePush(envelope,verified(changed,anchor),'unknown_outcome_retry')).resolves.toBe('quarantine_stale_writer')
  })
})
