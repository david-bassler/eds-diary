import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  recoveryCommitmentV2,
  recoveryUrsIdV2,
} from '../security/v2/crypto'
import { V2_SCHEMA_REGISTRY_HASH } from '../security/v2/schemaRegistry'
import { SINGLE_WRITER_V2_SCHEMA_ALLOWLIST, type RevisionV2, type WriterGrantV2 } from '../security/v2/types'
import { manifestCellsArrayV6, manifestFingerprintV6, prepareManifestV6, V6_PROTOCOL_LIMITS, type ProtectedManifestV6 } from '../security/v2/manifest'
import { createAnchorV2 } from '../security/v2/prefix'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { TransferableSingleWriterV2Verifier } from '../security/v2/verifier'
import { createRecoveryArtifactV6 } from '../security/v2/recovery'
import { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import { googleAccountBindingV2 } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { SINGLE_WRITER_V2_PROFILE, type VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { IndexedDbV2LocalSecurityStore, __v2LocalPersistenceTesting } from '../security/v2/localPersistence'
import { ProductiveReadOnlyJoinV2Service } from '../data/readOnlyJoinV2Service'
import { __localDatabaseTesting, activeEpochSyncContext, activeProtocolSelectionV2 } from '../data/localDatabase'

const id=(fill:number,length:number)=>base64Url(new Uint8Array(length).fill(fill))
const bytes=(fill:number,length:number)=>new Uint8Array(length).fill(fill)
const createdAt='2026-09-24T06:00:00.000Z'

async function nativeJoinFixture(){
  const diaryId=id(1,16),epochId=id(2,16),keyId=id(3,16),creationLocator=id(4,16)
  const rootKey=bytes(5,32),urs=bytes(6,32),epochSalt=await deriveEpochSaltV2(bytes(1,16),bytes(2,16))
  const writer=await generateWriterDeviceKeyV2(),recovery=await generateRecoveryTakeoverKeyMaterialV2()
  const recoveryUrsId=await recoveryUrsIdV2(urs),recoveryCommitment=await recoveryCommitmentV2(urs,bytes(1,16),0)
  const accountBinding=await googleAccountBindingV2(diaryId,'permission-owner-v2')
  const writerDeviceId=id(8,16),grantId=id(7,32)
  const history=[{recovery_generation:0,recovery_urs_id:recoveryUrsId,recovery_takeover_key_id:recovery.recoveryTakeoverKeyId}]
  const manifest:ProtectedManifestV6={
    diary_id:diaryId,epoch_id:epochId,key_id:keyId,creation_locator:creationLocator,
    recovery_generation:0,recovery_urs_commitment:recoveryCommitment,recovery_urs_id:recoveryUrsId,
    recovery_credential_history:history,diary_marker:'epoch-manifest-v6',crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6',
    sync_profile:SINGLE_WRITER_V2_PROFILE,created_at:createdAt,google_account_binding:accountBinding,predecessor_epochs:[],
    record_schema_allowlist:[...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST],record_schema_registry_hash:V2_SCHEMA_REGISTRY_HASH,
    protocol_limits:structuredClone(V6_PROTOCOL_LIMITS),epoch_start_authority_mode:'genesis_grant_required',
    epoch_start_writer_generation:1,epoch_start_writer_grant_id:grantId,epoch_start_writer_device_id:writerDeviceId,
    epoch_start_writer_key_id:writer.writerKeyId,epoch_start_writer_public_key:base64Url(writer.publicKeyRaw),
    recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
  }
  const cells=await prepareManifestV6(rootKey,epochSalt,{diaryId,epochId},manifest,bytes(9,12))
  const fingerprint=await manifestFingerprintV6(cells)
  const grant:WriterGrantV2={
    grant_id:grantId,writer_generation:1,writer_device_id:writerDeviceId,writer_key_id:writer.writerKeyId,
    writer_public_key:base64Url(writer.publicKeyRaw),previous_grant_id:null,previous_writer_generation:0,recovery_generation:0,
    reason:'initial',authority_anchor:await createAnchorV2(diaryId,epochId,[]),authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null},
  }
  const revision:RevisionV2<WriterGrantV2>={
    record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:id(10,16),revision_id:id(11,32),
    parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:createdAt,
    writer_context:null,writer_signature:null,
  }
  const envelope=await sealRevisionEnvelopeV2(rootKey,epochSalt,{diaryId,epochId},revision,bytes(12,32),bytes(13,12))
  const row=envelopeRowV2(envelope)
  const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(diaryId,epochId,rootKey,accountBinding)
  const snapshot={manifest:manifestCellsArrayV6(cells),rows:[row]}
  const verified=await codec.verifyRemote(snapshot),canonical=verified.profileState as Awaited<ReturnType<TransferableSingleWriterV2Verifier['verifyCanonicalFull']>>
  const artifact=await createRecoveryArtifactV6({
    diary_id:diaryId,epoch_id:epochId,key_id:keyId,RK_epoch:base64Url(rootKey),
    manifest_fingerprint:fingerprint,remote_anchor:canonical.remote_anchor,google_account_binding:accountBinding,
    recovery_generation:0,recovery_urs_commitment:recoveryCommitment,recovery_urs_id:recoveryUrsId,recovery_credential_history:history,
    recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
    recovery_takeover_private_key_pkcs8:base64Url(recovery.privateKeyPkcs8),activation_lineage:[],
    recovery_authority_transition_proof:null,created_at:createdAt,
  },urs,bytes(14,16),bytes(15,32),bytes(16,12))
  return{diaryId,epochId,keyId,rootKey,urs,epochSalt,writer,writerDeviceId,cells,fingerprint,row,snapshot,verified,canonical,artifact,accountBinding}
}

function sessionFor(f:Awaited<ReturnType<typeof nativeJoinFixture>>,calls:{family:number}):TransferableSingleWriterV2ProviderSession{
  const remoteId='remote-native-v2'
  const transport={
    profileId:SINGLE_WRITER_V2_PROFILE,
    providerId:'google-drive-sheets-v1',
    async discover(){return[{remoteId,locator:'ignored'}]},
    async read(){return f.snapshot},
    async authenticatedAccountBinding(){return f.accountBinding},
  }
  const codec={async verifyRemote():Promise<VerifiedRemoteState>{return f.verified}}
  return{
    providerId:'google-drive-sheets-v1',
    profileId:SINGLE_WRITER_V2_PROFILE,
    async transportForEpoch(){return transport as never},
    async v1TransportForEpoch(){throw new Error('native v2 Join must not read a v1 predecessor')},
    async remoteIdentityBinding(){return f.accountBinding},
    async codecForEpoch(){return codec as never},
    freshCanonicalSource(){throw new Error('unused')},
    async creationProperties(){throw new Error('unused')},
    async createOrReconcileEpoch(){throw new Error('unused')},
    async publishRecoveryArtifact(){throw new Error('unused')},
    async discoverRecoveryFamilyArtifacts(){calls.family+=1;return[{remoteResourceId:'recovery-native-v2',artifact:f.artifact}]},
    async findRecoveryArtifact(){return f.artifact},
    async loadRecoveryArtifact(){return f.artifact},
    async disconnect(){},
  }
}

beforeEach(async()=>{
  await __localDatabaseTesting.resetForTesting()
  await new Promise<void>((resolve,reject)=>{
    const request=indexedDB.deleteDatabase('eds-diary')
    request.addEventListener('success',()=>resolve(),{once:true})
    request.addEventListener('error',()=>reject(request.error),{once:true})
    request.addEventListener('blocked',()=>reject(new Error('Local test database reset was blocked.')),{once:true})
  })
  await __v2LocalPersistenceTesting.reset()
})

describe('productive v2 read-only Join',()=>{
  it('bootstraps a native v2 leaf into active/read_only with a fresh non-authorized local WriterDeviceKeyV2',async()=>{
    const f=await nativeJoinFixture(),calls={family:0},service=new ProductiveReadOnlyJoinV2Service(sessionFor(f,calls))
    const joined=await service.join(f.urs)
    expect(calls.family).toBe(1)
    expect(joined).toMatchObject({diaryId:f.diaryId,epochId:f.epochId,manifestFingerprint:f.fingerprint,remoteResourceId:'remote-native-v2',resumed:false})
    expect(joined.writerDeviceId).not.toBe(f.writerDeviceId)
    expect(joined.writerKeyId).not.toBe(f.writer.writerKeyId)

    const state=await new IndexedDbV2LocalSecurityStore().loadState(f.rootKey,f.epochSalt,f.epochId)
    expect(state.epoch_status).toBe('active')
    expect(state.writer_status).toBe('read_only')
    expect(state.writer_generation).toBeNull()
    expect(state.writer_grant_id).toBeNull()
    expect(state.verified_writer_device_id).toBe(f.writerDeviceId)
    expect(state.verified_writer_key_id).toBe(f.writer.writerKeyId)
    expect(state.remote_anchor).toEqual(f.canonical.remote_anchor)
    expect(state.activation_lineage_cache_ref).toBeNull()

    const selected=await activeProtocolSelectionV2()
    expect(selected).toMatchObject({diary_id:f.diaryId,epoch_id:f.epochId,manifest_fingerprint:f.fingerprint,operation_id:joined.joinId})
    expect((await activeEpochSyncContext()).state.epoch_status).toBe('retired')
  })

  it('resumes the exact persisted local identity after a crash between Join bundle and local switch',async()=>{
    const f=await nativeJoinFixture(),calls={family:0},store=new IndexedDbV2LocalSecurityStore()
    const crashing=new ProductiveReadOnlyJoinV2Service(sessionFor(f,calls),store,async point=>{
      if(point==='after-join-bundle')throw new Error('injected join crash')
    })
    await expect(crashing.join(f.urs)).rejects.toThrow(/injected join crash/)
    expect(await activeProtocolSelectionV2()).toBeNull()
    const persisted=await store.loadState(f.rootKey,f.epochSalt,f.epochId)
    expect(persisted.writer_status).toBe('read_only')
    const persistedDevice=persisted.writer_device_id,persistedKey=persisted.writer_signing_key_id

    const resumed=await new ProductiveReadOnlyJoinV2Service(sessionFor(f,calls),store).join(f.urs)
    expect(resumed.resumed).toBe(true)
    expect(resumed.writerDeviceId).toBe(persistedDevice)
    expect(resumed.writerKeyId).toBe(persistedKey)
    expect(await activeProtocolSelectionV2()).toMatchObject({operation_id:resumed.joinId,epoch_id:f.epochId})
  })

  it('blocks an unrelated non-fresh local profile before Recovery-family discovery',async()=>{
    const f=await nativeJoinFixture(),calls={family:0}
    const db=await __localDatabaseTesting.openDatabase(),stores=__localDatabaseTesting.STORES
    const tx=db.transaction(stores.operations,'readwrite')
    tx.objectStore(stores.operations).add({id:'unrelated-local-operation',value:{}})
    await new Promise<void>((resolve,reject)=>{
      tx.addEventListener('complete',()=>resolve(),{once:true})
      tx.addEventListener('abort',()=>reject(tx.error),{once:true})
      tx.addEventListener('error',()=>reject(tx.error),{once:true})
    })
    await expect(new ProductiveReadOnlyJoinV2Service(sessionFor(f,calls)).join(f.urs)).rejects.toThrow(/fresh local profile|non-empty local persistence/)
    expect(calls.family).toBe(0)
    expect(await activeProtocolSelectionV2()).toBeNull()
  })

  it('rejects a wrong Recovery Key before creating any v2 local Join state',async()=>{
    const f=await nativeJoinFixture(),calls={family:0}
    await expect(new ProductiveReadOnlyJoinV2Service(sessionFor(f,calls)).join(bytes(99,32))).rejects.toBeTruthy()
    expect(await activeProtocolSelectionV2()).toBeNull()
    const store=new IndexedDbV2LocalSecurityStore()
    await expect(store.loadState(f.rootKey,f.epochSalt,f.epochId)).rejects.toThrow(/missing/)
  })
})
