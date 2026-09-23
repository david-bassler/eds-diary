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
import {
  manifestCellsArrayV6,
  manifestFingerprintV6,
  openManifestTrustRootV6,
  openManifestV6,
  prepareManifestV6,
  V6_PROTOCOL_LIMITS,
  type ProtectedManifestV6,
} from '../security/v2/manifest'
import { createAnchorV2 } from '../security/v2/prefix'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { TransferableSingleWriterV2Verifier } from '../security/v2/verifier'
import {
  createRecoveryArtifactV6,
  openRecoveryArtifactV6,
  recoveryArtifactLocatorV6,
  recoveryFamilyLocatorV6,
  type RecoveryArtifactV6,
} from '../security/v2/recovery'
import { recoveryArtifactFromGridV6, recoveryArtifactToGridV6 } from '../security/v2/recoveryGrid'
import { createBackupV6, testRestoreBackupV6 } from '../security/v2/backup'
import { createRecoveryTakeoverStagingV2, VerifiedRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'
import { IndexedDbV2LocalSecurityStore, VerifiedPersistedRecoveryArtifactV6, __v2LocalPersistenceTesting, isVerifiedPersistedRecoveryArtifactV6 } from '../security/v2/localPersistence'
import { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import {
  epochLocatorV2,
  googleAccountBindingV2,
  GoogleSheetsTransferableSingleWriterV2Transport,
  type GoogleApiClient,
} from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { epochLocator } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import { googleV2ProviderSessionFromAuthenticatedClient } from '../sync/google/GoogleTransferableSingleWriterV2Provider'

const id=(fill:number,length:number)=>base64Url(new Uint8Array(length).fill(fill))
const bytes=(fill:number,length:number)=>new Uint8Array(length).fill(fill)
const createdAt='2026-09-23T12:00:00.000Z'

async function nativeFixture(){
  const diaryId=id(1,16),epochId=id(2,16),keyId=id(3,16),creationLocator=id(4,16)
  const rootKey=bytes(5,32),urs=bytes(6,32)
  const epochSalt=await deriveEpochSaltV2(bytes(1,16),bytes(2,16))
  const writer=await generateWriterDeviceKeyV2(),recovery=await generateRecoveryTakeoverKeyMaterialV2()
  const recoveryGeneration=0
  const recoveryUrsId=await recoveryUrsIdV2(urs)
  const recoveryCommitment=await recoveryCommitmentV2(urs,bytes(1,16),recoveryGeneration)
  const accountBinding=await googleAccountBindingV2(diaryId,'permission-owner-v2')
  const grantId=id(7,32),writerDeviceId=id(8,16)
  const history=[{
    recovery_generation:recoveryGeneration,
    recovery_urs_id:recoveryUrsId,
    recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,
  }]
  const manifest:ProtectedManifestV6={
    diary_id:diaryId,
    epoch_id:epochId,
    key_id:keyId,
    creation_locator:creationLocator,
    recovery_generation:recoveryGeneration,
    recovery_urs_commitment:recoveryCommitment,
    recovery_urs_id:recoveryUrsId,
    recovery_credential_history:history,
    diary_marker:'epoch-manifest-v6',
    crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6',
    sync_profile:SINGLE_WRITER_V2_PROFILE,
    created_at:createdAt,
    google_account_binding:accountBinding,
    predecessor_epochs:[],
    record_schema_allowlist:[...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST],
    record_schema_registry_hash:V2_SCHEMA_REGISTRY_HASH,
    protocol_limits:structuredClone(V6_PROTOCOL_LIMITS),
    epoch_start_authority_mode:'genesis_grant_required',
    epoch_start_writer_generation:1,
    epoch_start_writer_grant_id:grantId,
    epoch_start_writer_device_id:writerDeviceId,
    epoch_start_writer_key_id:writer.writerKeyId,
    epoch_start_writer_public_key:base64Url(writer.publicKeyRaw),
    recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,
    recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
  }
  const cells=await prepareManifestV6(rootKey,epochSalt,{diaryId,epochId},manifest,bytes(9,12))
  const fingerprint=await manifestFingerprintV6(cells)
  const trustRoot=(await openManifestTrustRootV6(rootKey,epochSalt,{diaryId,epochId},cells)).trustRoot
  const grant:WriterGrantV2={
    grant_id:grantId,
    writer_generation:1,
    writer_device_id:writerDeviceId,
    writer_key_id:writer.writerKeyId,
    writer_public_key:base64Url(writer.publicKeyRaw),
    previous_grant_id:null,
    previous_writer_generation:0,
    recovery_generation:0,
    reason:'initial',
    authority_anchor:await createAnchorV2(diaryId,epochId,[]),
    authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null},
  }
  const revision:RevisionV2<WriterGrantV2>={
    record_type:'writer_grant',
    record_schema:'writer-grant-sw-v2',
    record_id:id(10,16),
    revision_id:id(11,32),
    parent_revision_ids:[],
    record_status:'control',
    record_data:grant,
    migration_origin:null,
    protocol_created_at:createdAt,
    writer_context:null,
    writer_signature:null,
  }
  const envelope=await sealRevisionEnvelopeV2(rootKey,epochSalt,{diaryId,epochId},revision,bytes(12,32),bytes(13,12))
  const row=envelopeRowV2(envelope)
  const canonical=await new TransferableSingleWriterV2Verifier().verifyCanonicalFull(trustRoot,rootKey,[row])
  const recoveryArtifact=await createRecoveryArtifactV6({
    diary_id:diaryId,
    epoch_id:epochId,
    key_id:keyId,
    RK_epoch:base64Url(rootKey),
    manifest_fingerprint:fingerprint,
    remote_anchor:canonical.remote_anchor,
    google_account_binding:accountBinding,
    recovery_generation:0,
    recovery_urs_commitment:recoveryCommitment,
    recovery_urs_id:recoveryUrsId,
    recovery_credential_history:history,
    recovery_takeover_key_id:recovery.recoveryTakeoverKeyId,
    recovery_takeover_public_key:base64Url(recovery.publicKeyRaw),
    recovery_takeover_private_key_pkcs8:base64Url(recovery.privateKeyPkcs8),
    activation_lineage:[],
    recovery_authority_transition_proof:null,
    created_at:createdAt,
  },urs,bytes(14,16),bytes(15,32),bytes(16,12))
  return{diaryId,epochId,keyId,creationLocator,rootKey,urs,epochSalt,writer,recovery,manifest,cells,fingerprint,trustRoot,row,canonical,recoveryArtifact,accountBinding}
}

beforeEach(async()=>{await __v2LocalPersistenceTesting.reset()})

describe('ManifestV6 and v2 Google profile',()=>{
  it('round-trips the exact protected ManifestV6 and derives the verifier trust root',async()=>{
    const f=await nativeFixture()
    const opened=await openManifestV6(f.rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},f.cells)
    expect(opened).toEqual(f.manifest)
    expect((await openManifestTrustRootV6(f.rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},f.cells)).trustRoot.manifest_fingerprint).toBe(f.fingerprint)
    await expect(openManifestV6(f.rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},{...f.cells,format:'sync-v6',manifestCiphertext:`${f.cells.manifestCiphertext}A`})).rejects.toBeTruthy()
  })

  it('rejects a structurally valid but provenance-free ManifestV6 trust root',async()=>{
    const f=await nativeFixture()
    const unbranded=structuredClone(f.trustRoot)
    await expect(new TransferableSingleWriterV2Verifier().verifyCanonicalFull(unbranded,f.rootKey,[f.row]))
      .rejects.toThrow(/authenticated cell provenance/)
  })

  it('rejects non-singleton first-v2 recovery history and self-predecessor manifests',async()=>{
    const f=await nativeFixture()
    const prior={recovery_generation:0,recovery_urs_id:id(90,32),recovery_takeover_key_id:id(91,32)}
    const current={recovery_generation:1,recovery_urs_id:f.manifest.recovery_urs_id,recovery_takeover_key_id:f.manifest.recovery_takeover_key_id}
    await expect(prepareManifestV6(f.rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},{
      ...f.manifest,
      recovery_generation:1,
      recovery_urs_commitment:id(93,32),
      recovery_credential_history:[prior,current],
    })).rejects.toThrow(/exactly one Recovery/)
    await expect(prepareManifestV6(f.rootKey,f.epochSalt,{diaryId:f.diaryId,epochId:f.epochId},{
      ...f.manifest,
      predecessor_epochs:[{epoch_id:f.epochId,manifest_fingerprint:id(92,32)}],
    })).rejects.toThrow(/predecessor cannot equal/)
  })

  it('keeps creation-manifest verification authority-free while canonical_full still requires the genesis grant',async()=>{
    const f=await nativeFixture()
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(f.diaryId,f.epochId,f.rootKey,f.accountBinding)
    const snapshot={manifest:manifestCellsArrayV6(f.cells),rows:[]}
    await expect(codec.verifyCreationCandidate(snapshot)).resolves.toEqual({manifestFingerprint:f.fingerprint})
    await expect(codec.verifyRemote(snapshot)).rejects.toMatchObject({code:'manifest_genesis_missing'})
    const verified=await codec.verifyRemote({manifest:snapshot.manifest,rows:[f.row]})
    expect(verified.profileId).toBe(SINGLE_WRITER_V2_PROFILE)
    expect(verified.manifestFingerprint).toBe(f.fingerprint)
  })

  it('rejects invalid create/manifest/row mutations before issuing a Google request',async()=>{
    class Client implements GoogleApiClient{
      calls:string[]=[]
      async request<T>(url:string):Promise<T>{
        this.calls.push(url)
        if(new URL(url).pathname==='/drive/v3/about')return{user:{permissionId:'permission-owner-v2'}} as T
        throw new Error(`Unexpected request: ${url}`)
      }
      identity():string{return'permission-owner-v2'}
    }
    const f=await nativeFixture(),client=new Client();issueControlledTestGoogleClient(client)
    const transport=await GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(client,f.diaryId,f.epochId)
    const baseline=client.calls.length
    await expect(transport.create(f.creationLocator,['sync-v5'])).rejects.toMatchObject({code:'provider_incompatible'})
    await expect(transport.writeManifest('unused',['sync-v5','5',id(1,12),id(2,16)])).rejects.toMatchObject({code:'integrity_failure'})
    await expect(transport.append('unused',[id(3,32),id(4,12),'AA'])).rejects.toMatchObject({code:'integrity_failure'})
    expect(client.calls).toHaveLength(baseline)
  })

  it('uses v6 locator/account domains and rejects v1 protocol properties on the v2 transport',async()=>{
    class Client implements GoogleApiClient{
      calls:string[]=[]
      async request<T>(url:string):Promise<T>{
        this.calls.push(url)
        if(new URL(url).pathname==='/drive/v3/about')return{user:{permissionId:'permission-owner-v2'}} as T
        throw new Error(`Unexpected request: ${url}`)
      }
      identity():string{return'permission-owner-v2'}
    }
    const client=new Client();issueControlledTestGoogleClient(client)
    const transport=await GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(client,(await nativeFixture()).diaryId,(await nativeFixture()).epochId)
    expect(transport.profileId).toBe(SINGLE_WRITER_V2_PROFILE)
    const f=await nativeFixture()
    expect(await epochLocatorV2(f.diaryId,f.epochId)).not.toBe(await epochLocator(f.diaryId,f.epochId))
    expect(await transport.authenticatedAccountBinding()).toBe(await googleAccountBindingV2(f.diaryId,'permission-owner-v2'))
    await expect(transport.patchProperties('unused',{app_format:'sync-v5',epoch_locator:await epochLocatorV2(f.diaryId,f.epochId)})).rejects.toMatchObject({code:'integrity_failure'})
  })
})

describe('V2 provider fresh canonical source',()=>{
  it('performs a new authenticated provider read and canonical_full verification on every verifyNow call',async()=>{
    const f=await nativeFixture(),remoteId='remote-v2-fresh-source'
    const locator=await epochLocatorV2(f.diaryId,f.epochId)
    class Client implements GoogleApiClient{
      readonly calls:string[]=[]
      async request<T>(url:string):Promise<T>{
        this.calls.push(url)
        const parsed=new URL(url)
        if(parsed.origin==='https://www.googleapis.com'&&parsed.pathname==='/drive/v3/about')return{user:{permissionId:'permission-owner-v2'}} as T
        if(parsed.origin==='https://www.googleapis.com'&&parsed.pathname===`/drive/v3/files/${remoteId}`){
          return{id:remoteId,mimeType:'application/vnd.google-apps.spreadsheet',trashed:false,ownedByMe:true,shared:false,isAppAuthorized:true,appProperties:{app_format:'sync-v6',epoch_locator:locator}} as T
        }
        if(parsed.origin==='https://www.googleapis.com'&&parsed.pathname===`/drive/v3/files/${remoteId}/permissions`){
          return{permissions:[{id:'permission-owner-v2',type:'user',role:'owner',deleted:false}]} as T
        }
        if(parsed.origin==='https://sheets.googleapis.com'&&parsed.pathname===`/v4/spreadsheets/${remoteId}`){
          const range=parsed.searchParams.get('ranges')??''
          if(range.includes("'_m'!A1:D1")){
            return{sheets:[{properties:{sheetId:1,title:'_m'},data:[{startRow:0,rowData:[{values:manifestCellsArrayV6(f.cells).map(value=>({userEnteredValue:{stringValue:value}}))}]}]}]} as T
          }
          if(range.includes("'_r'!A1:C1")){
            return{sheets:[{properties:{sheetId:2,title:'_r'},data:[{startRow:0,rowData:[{values:f.row.map(value=>({userEnteredValue:{stringValue:value}}))}]}]}]} as T
          }
          return{sheets:[
            {properties:{sheetId:1,title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}},merges:[]},
            {properties:{sheetId:2,title:'_r',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:3}},merges:[]},
          ]} as T
        }
        throw new Error(`Unexpected request: ${url}`)
      }
      identity():string{return'permission-owner-v2'}
    }
    const client=new Client();issueControlledTestGoogleClient(client)
    const session=googleV2ProviderSessionFromAuthenticatedClient(client)
    const source=session.freshCanonicalSource(f.diaryId,f.epochId,f.rootKey,remoteId)
    await expect(source.verifyNow()).resolves.toMatchObject({profileId:SINGLE_WRITER_V2_PROFILE,manifestFingerprint:f.fingerprint})
    const firstReadCount=client.calls.filter(url=>url.includes(`/v4/spreadsheets/${remoteId}`)).length
    await expect(source.verifyNow()).resolves.toMatchObject({profileId:SINGLE_WRITER_V2_PROFILE,manifestFingerprint:f.fingerprint})
    const secondReadCount=client.calls.filter(url=>url.includes(`/v4/spreadsheets/${remoteId}`)).length
    expect(firstReadCount).toBeGreaterThan(0)
    expect(secondReadCount).toBe(firstReadCount*2)
    expect(client.calls.filter(url=>url.includes('/drive/v3/about'))).toHaveLength(2)
  })
})

describe('V2 creation crash-resume binding',()=>{
  it('rejects resuming a persisted creation intent with different immutable manifest bytes',async()=>{
    const f=await nativeFixture()
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(f.diaryId,f.epochId,f.rootKey,f.accountBinding)
    const states=new Map<string,import('../sync/core/creation').CreationState>()
    const persistence={
      async read(locator:string){return structuredClone(states.get(locator)??null)},
      async write(state:import('../sync/core/creation').CreationState){states.set(state.locator,structuredClone(state))},
    }
    const transport={
      providerId:'google-drive-sheets-v1',
      profileId:SINGLE_WRITER_V2_PROFILE,
      async discover(){return[]},
      async create(){},
      async read(){return{manifest:[],rows:[]}},
      async append(){},
    }
    const {runCreationStateMachine}=await import('../sync/core/creation')
    const initial={
      locator:f.creationLocator,
      manifestFingerprint:f.fingerprint,
      status:'planned' as const,
      remoteId:null,
      diaryId:f.diaryId,
      epochId:f.epochId,
      keyId:f.keyId,
      operationGeneration:0,
    }
    await runCreationStateMachine(initial,manifestCellsArrayV6(f.cells),transport,codec,persistence)
    const mutated=[...manifestCellsArrayV6(f.cells)] as string[]
    mutated[3]=`${mutated[3]}A`
    await expect(runCreationStateMachine(initial,mutated,transport,codec,persistence)).rejects.toThrow(/immutable requested resource/)
  })
})

describe('V2 creation one-shot persistence',()=>{
  it('persists and cryptographically readback-verifies Takeover staging and exact RecoveryArtifactV6 bytes',async()=>{
    const f=await nativeFixture(),store=new IndexedDbV2LocalSecurityStore()
    const staging=await createRecoveryTakeoverStagingV2({
      diaryId:f.diaryId,
      epochId:f.epochId,
      recoveryGeneration:0,
      recoveryTakeoverKeyId:f.recovery.recoveryTakeoverKeyId,
      recoveryTakeoverPublicKey:base64Url(f.recovery.publicKeyRaw),
      recoveryTakeoverPrivateKeyPkcs8:f.recovery.privateKeyPkcs8,
      manifestFingerprint:f.fingerprint,
      urs:f.urs,
      salt:bytes(30,32),
      iv:bytes(31,12),
    })
    expect(()=>new (VerifiedRecoveryTakeoverStagingV2 as unknown as {new(staging:typeof staging,token:symbol):VerifiedRecoveryTakeoverStagingV2})(staging,Symbol('forged')))
      .toThrow(/only be created by the verifier/)
    expect(()=>new (VerifiedPersistedRecoveryArtifactV6 as unknown as {new(
      artifact:RecoveryArtifactV6,
      artifactSha256:string,
      familyLocator:string,
      artifactLocator:string,
      diaryId:string,
      epochId:string,
      token:symbol,
    ):VerifiedPersistedRecoveryArtifactV6})(
      f.recoveryArtifact,id(80,32),id(81,16),id(82,16),f.diaryId,f.epochId,Symbol('forged'),
    )).toThrow(/only be created after persistent readback verification/)
    const verifiedStaging=await store.persistRecoveryTakeoverStaging(staging,f.urs)
    expect(verifiedStaging.staging.manifest_fingerprint).toBe(f.fingerprint)
    const persisted=await store.persistRecoveryArtifactV6(f.urs,f.diaryId,f.epochId,f.recoveryArtifact)
    expect(isVerifiedPersistedRecoveryArtifactV6(persisted)).toBe(true)
    expect(persisted.artifact).toEqual(f.recoveryArtifact)
    await expect(store.persistRecoveryArtifactV6(f.urs,f.diaryId,f.epochId,{...f.recoveryArtifact,wrapped_payload:`${f.recoveryArtifact.wrapped_payload}A`})).rejects.toBeTruthy()
  })
})

describe('RecoveryArtifactV6 and SyncBackupV6',()=>{
  it('round-trips the URS-bound takeover material through the exact 45-row recovery grid',async()=>{
    const f=await nativeFixture()
    const opened=await openRecoveryArtifactV6(f.recoveryArtifact,f.urs)
    expect(opened.rootKey).toEqual(f.rootKey)
    expect(opened.payload.manifest_fingerprint).toBe(f.fingerprint)
    const grid=await recoveryArtifactToGridV6(f.recoveryArtifact)
    expect(grid).toHaveLength(45)
    await expect(recoveryArtifactFromGridV6(grid)).resolves.toEqual(f.recoveryArtifact)
    const tampered=[...grid];tampered[44]='unexpected'
    await expect(recoveryArtifactFromGridV6(tampered)).rejects.toThrow(/trailing data/)
    expect(await recoveryFamilyLocatorV6(f.urs)).not.toBe(await recoveryArtifactLocatorV6(f.urs,f.diaryId,f.epochId))
    expect(await recoveryArtifactLocatorV6(f.urs,f.diaryId,f.epochId)).not.toBe(await recoveryArtifactLocatorV6(f.urs,f.diaryId,id(99,16)))
  })

  it('creates and test-restores a closed SyncBackupV6 through ManifestV6 and the production v2 verifier',async()=>{
    const f=await nativeFixture()
    const backup=await createBackupV6({
      rootKey:f.rootKey,
      epochSalt:f.epochSalt,
      urs:f.urs,
      diaryId:f.diaryId,
      epochId:f.epochId,
      keyId:f.keyId,
      epochManifestPublic:manifestCellsArrayV6(f.cells),
      canonical:f.canonical,
      recoveryArtifact:f.recoveryArtifact,
      recordRows:[f.row],
      pendingOutboxRows:[],
      staleWriterPendingRows:[],
      activationState:'activated',
      createdAt,
    },bytes(20,32),bytes(21,12))
    const restored=await testRestoreBackupV6({
      rootKey:f.rootKey,epochSalt:f.epochSalt,urs:f.urs,diaryId:f.diaryId,epochId:f.epochId,keyId:f.keyId,
    },backup,new TransferableSingleWriterV2Verifier())
    expect(restored.canonical.remote_anchor).toEqual(f.canonical.remote_anchor)
    expect(restored.activation_state).toBe('activated')
    expect(restored.access).toBe('read_only')
    const tampered:RecoveryArtifactV6={...backup.recovery_artifact,wrapped_payload:`${backup.recovery_artifact.wrapped_payload}A`}
    await expect(testRestoreBackupV6({
      rootKey:f.rootKey,epochSalt:f.epochSalt,urs:f.urs,diaryId:f.diaryId,epochId:f.epochId,keyId:f.keyId,
    },{...backup,recovery_artifact:tampered},new TransferableSingleWriterV2Verifier())).rejects.toBeTruthy()
  })
})
