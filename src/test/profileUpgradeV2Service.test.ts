import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ProductiveProfileUpgradeV2Service,
  type ProfileUpgradeV2FaultPoint,
} from '../data/profileUpgradeV2Service'
import {
  DOMAIN_SCHEMA_REGISTRY,
  IndexedDbRotationRepository,
  LOCAL_STORES,
  __localDatabaseTesting,
  activeProtocolSelectionV2,
  loadProfileUpgradeSourceOperationV2,
  persistProfileUpgradeSourceOperationV2,
  putRecord,
} from '../data/localDatabase'
import { IndexedDbV2LocalSecurityStore, __v2LocalPersistenceTesting, type VerifiedPersistedRecoveryArtifactV6 } from '../security/v2/localPersistence'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import { randomBytes, recoveryCommitment } from '../security/crypto/core'
import { createBestEffortRootWrap, stateTag } from '../security/localState'
import { manifestFingerprint, prepareManifest, schemaRegistryHash, SCHEMA_ALLOWLIST } from '../security/manifest'
import { createAnchor, assertExtendsAnchorV1 } from '../sync/core/prefix'
import {
  SINGLE_WRITER_V1_PROFILE,
  SINGLE_WRITER_V2_PROFILE,
  TransportError,
  type RemoteCandidate,
  type RemoteSnapshot,
  type RemoteTransport,
  type TransportProfileCodec,
  type VerifiedRemoteState,
} from '../sync/core/contracts'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import type { IndependentBootstrapAuthority } from '../sync/core/remoteVerifier'
import type { RecoveryArtifact } from '../security/recovery'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import type { GoogleSheetsTransferableSingleWriterV2Transport } from '../sync/google/GoogleSheetsTransferableSingleWriterV2Transport'
import { manifestCellsArrayV6, manifestFingerprintV6, type ManifestCellsV6 } from '../security/v2/manifest'
import type { VerifiedRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'
import { openRecoveryArtifactV6, type RecoveryArtifactV6 } from '../security/v2/recovery'
import type { CreationPersistence, CreationState } from '../sync/core/creation'
import type { FreshCanonicalV2Source } from '../security/v2/domainWrite'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  recoveryCommitmentV2,
  recoveryUrsIdV2,
  revisionSigningBytesV2,
  signEd25519V2,
  writerGrantSigningBytesV2,
} from '../security/v2/crypto'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { createAnchorV2 } from '../security/v2/prefix'
import type { RecoveryAuthorityTransitionV2, RevisionV2, WriterGrantV2 } from '../security/v2/types'

type Row=readonly[string,string,string]

const pain=(id:string)=>({id,startedAt:'2026-09-23T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'v2 profile upgrade fixture',createdAt:'2026-09-23T10:00:00.000Z',updatedAt:'2026-09-23T10:00:00.000Z'})
function transactionComplete(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}
function deleteDatabase(name:string):Promise<void>{return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error(`Test database deletion blocked: ${name}`))})}

class MemoryTransport implements RemoteTransport {
  readonly providerId='google-drive-sheets-v1'
  constructor(
    readonly profileId:string,
    readonly remoteId:string,
    readonly snapshot:RemoteSnapshot&{manifest:string[];rows:string[][]},
  ){}
  appendCounts=new Map<string,number>()
  unknownAfterAppend=false
  unknownWithoutAppend=0
  injectBeforeNextAppend:Row|null=null
  afterNextRead:(()=>void|Promise<void>)|null=null
  async discover(locator:string):Promise<readonly RemoteCandidate[]>{return[{remoteId:this.remoteId,locator}]}
  async create():Promise<void>{}
  async read(id:string):Promise<RemoteSnapshot>{
    if(id!==this.remoteId)throw new Error('wrong remote')
    const value=structuredClone(this.snapshot),hook=this.afterNextRead
    this.afterNextRead=null
    await hook?.()
    return value
  }
  async append(id:string,row:readonly[string,string,string]):Promise<void>{
    if(id!==this.remoteId)throw new Error('wrong remote')
    if(this.unknownWithoutAppend>0){this.unknownWithoutAppend-=1;throw new TransportError('unknown_outcome','simulated unresolved append')}
    if(this.injectBeforeNextAppend){this.snapshot.rows.push([...this.injectBeforeNextAppend]);this.injectBeforeNextAppend=null}
    this.snapshot.rows.push([...row])
    this.appendCounts.set(row[0],(this.appendCounts.get(row[0])??0)+1)
    if(this.unknownAfterAppend){this.unknownAfterAppend=false;throw new TransportError('unknown_outcome','simulated append-after-commit')}
  }
}

class V1Session implements SingleWriterProviderSession {
  readonly providerId='google-drive-sheets-v1'
  readonly profileId=SINGLE_WRITER_V1_PROFILE
  constructor(private readonly transport:MemoryTransport,private readonly account:string){}
  async transportForEpoch(){return this.transport}
  async remoteIdentityBinding(){return this.account}
  codec(verifier:{profileId:string;verify(snapshot:RemoteSnapshot):Promise<VerifiedRemoteState>}):TransportProfileCodec{
    return{
      profileId:SINGLE_WRITER_V1_PROFILE,
      validate(){},
      verifyRemote:snapshot=>verifier.verify(snapshot),
      row:envelope=>[envelope.envelopeId,envelope.iv,envelope.ciphertext],
      createAnchor:(diaryId,epochId,rows)=>createAnchor(diaryId,epochId,rows),
      assertExtendsAnchor:(anchor,diaryId,epochId,rows)=>assertExtendsAnchorV1(anchor as never,diaryId,epochId,rows),
    }
  }
  async creationProperties(){return{}}
  async recoveryLocator(){return''}
  async recoveryAuthority():Promise<IndependentBootstrapAuthority>{throw new Error('not used')}
  async prepareRecoveryArtifactSlot():Promise<void>{}
  async publishRecoveryArtifact():Promise<void>{}
  async findRecoveryArtifact():Promise<RecoveryArtifact|null>{return null}
  async loadRecoveryArtifact():Promise<RecoveryArtifact>{throw new Error('not used')}
  async disconnect():Promise<void>{}
}

class V2Session implements TransferableSingleWriterV2ProviderSession {
  readonly providerId='google-drive-sheets-v1'
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  readonly account=base64Url(new Uint8Array(32).fill(91))
  remote:MemoryTransport|null=null
  private readonly preCreationTransport=new MemoryTransport(SINGLE_WRITER_V2_PROFILE,'successor-v2',{manifest:[],rows:[]})
  recovery:RecoveryArtifactV6|null=null
  creates=0
  private readonly creation=new Map<string,CreationState>()
  async transportForEpoch(diaryId:string,epochId:string):Promise<GoogleSheetsTransferableSingleWriterV2Transport>{
    void diaryId;void epochId
    return (this.remote??this.preCreationTransport) as unknown as GoogleSheetsTransferableSingleWriterV2Transport
  }
  async remoteIdentityBinding():Promise<string>{return this.account}
  async codecForEpoch(diaryId:string,epochId:string,rootKey:Uint8Array,transport:RemoteTransport):Promise<GoogleSheetsTransferableSingleWriterV2ProfileCodec>{
    void transport
    return new GoogleSheetsTransferableSingleWriterV2ProfileCodec(diaryId,epochId,rootKey,this.account)
  }
  freshCanonicalSource(diaryId:string,epochId:string,rootKey:Uint8Array,remoteId:string):FreshCanonicalV2Source{
    return{verifyNow:async()=>{const transport=await this.transportForEpoch(diaryId,epochId),codec=await this.codecForEpoch(diaryId,epochId,rootKey,transport);return codec.verifyRemote(await transport.read(remoteId))}}
  }
  async creationProperties(){return{app_format:'sync-v6',epoch_locator:'fixture'}}
  async createOrReconcileEpoch(args:{
    diaryId:string;epochId:string;rootKey:Uint8Array;creationLocator:string;manifest:ManifestCellsV6
    transport:GoogleSheetsTransferableSingleWriterV2Transport;persistence:CreationPersistence;recoveryStaging:VerifiedRecoveryTakeoverStagingV2
  }):Promise<CreationState>{
    void args.transport;void args.recoveryStaging
    const existing=this.creation.get(args.creationLocator)
    if(existing)return structuredClone(existing)
    const remoteId='successor-v2'
    this.remote=new MemoryTransport(SINGLE_WRITER_V2_PROFILE,remoteId,{manifest:[...manifestCellsArrayV6(args.manifest)],rows:[]})
    this.creates+=1
    const clean:CreationState={
      locator:args.creationLocator,manifestFingerprint:await manifestFingerprintV6(args.manifest),status:'bound',remoteId,
      manifest:[...manifestCellsArrayV6(args.manifest)],manifestBytes:new TextDecoder().decode((await import('../security/crypto/canonical')).canonicalBytes([...manifestCellsArrayV6(args.manifest)])),
      diaryId:args.diaryId,epochId:args.epochId,operationGeneration:0,
    }
    await args.persistence.write(clean)
    const persisted=await args.persistence.read(args.creationLocator)
    if(!persisted)throw new Error('fixture creation persistence readback failed')
    this.creation.set(args.creationLocator,persisted)
    return structuredClone(persisted)
  }
  async publishRecoveryArtifact(_urs:Uint8Array,persisted:VerifiedPersistedRecoveryArtifactV6):Promise<string>{this.recovery=structuredClone(persisted.artifact);return'recovery-v6'}
  async findRecoveryArtifact():Promise<RecoveryArtifactV6|null>{return this.recovery?structuredClone(this.recovery):null}
  async loadRecoveryArtifact():Promise<RecoveryArtifactV6>{if(!this.recovery)throw new Error('missing recovery');return structuredClone(this.recovery)}
  async disconnect():Promise<void>{}
}

async function seedV1Source(urs:Uint8Array,createdAt:string):Promise<{transport:MemoryTransport;session:V1Session;sourceEpochId:string;diaryId:string}>{
  await putRecord(LOCAL_STORES.painEntries,pain('upgrade-active'))
  await putRecord(LOCAL_STORES.painEntries,pain('upgrade-deleted'))
  await putRecord(LOCAL_STORES.painEntries,{...pain('upgrade-deleted'),status:'deleted' as const})
  const repository=new IndexedDbRotationRepository(),source=await repository.verifiedActiveEpoch(),rows=source.envelopes.map(envelope=>[envelope.envelopeId,envelope.iv,envelope.ciphertext])
  const account=base64Url(new Uint8Array(32).fill(44)),commitment=await recoveryCommitment(urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation)
  const manifest=await prepareManifest(source.rootKey,source.epochSalt,{diaryId:source.context.diaryId,epochId:source.context.epochId},{
    diary_id:source.context.diaryId,epoch_id:source.context.epochId,key_id:source.context.keyId,recovery_generation:source.state.recovery_generation,
    recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5',crypto_suite:'A256GCM-HKDF-SHA256-v5',
    sync_profile:SINGLE_WRITER_V1_PROFILE,created_at:createdAt,google_account_binding:account,predecessor_epochs:[],
    record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),
    protocol_limits:{max_payload_bytes:16380,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000,max_unique_canonical_bytes:134217728,max_remote_physical_rows:100000,max_remote_physical_canonical_bytes:134217728,max_canonical_row_bytes:21936},
  })
  const fingerprint=await manifestFingerprint(manifest),remote=new MemoryTransport(SINGLE_WRITER_V1_PROFILE,'source-v1',{manifest:[manifest.format,manifest.version,manifest.manifestIv,manifest.manifestCiphertext],rows:rows.map(row=>[...row])})
  const db=await __localDatabaseTesting.openDatabase(),keyTx=db.transaction(__localDatabaseTesting.STORES.wrappingKeys,'readonly')
  const key=await new Promise<CryptoKey>((resolve,reject)=>{const request=keyTx.objectStore(__localDatabaseTesting.STORES.wrappingKeys).get(source.context.wrapId);request.onsuccess=()=>resolve((request.result as {key:CryptoKey}).key);request.onerror=()=>reject(request.error)})
  await transactionComplete(keyTx)
  const wrap=await createBestEffortRootWrap(source.rootKey,key,{diary_id:source.context.diaryId,epoch_id:source.context.epochId,key_id:source.context.keyId,manifest_fingerprint:fingerprint},fromBase64Url(source.context.wrapId))
  const anchor=await createAnchor(source.context.diaryId,source.context.epochId,rows),state={...source.state,manifest_fingerprint:fingerprint,recovery_urs_commitment:commitment,epoch_status:'active' as const,remote_binding:{provider_id:SINGLE_WRITER_V1_PROFILE,remote_resource_id:'source-v1',remote_identity_binding:account},remote_anchor:anchor}
  const tag=await stateTag(source.rootKey,source.epochSalt,state),tx=db.transaction([__localDatabaseTesting.STORES.state,__localDatabaseTesting.STORES.context,__localDatabaseTesting.STORES.wraps],'readwrite')
  tx.objectStore(__localDatabaseTesting.STORES.state).put({id:source.context.epochId,state,tag})
  tx.objectStore(__localDatabaseTesting.STORES.context).put({...source.context,manifestFingerprint:fingerprint})
  tx.objectStore(__localDatabaseTesting.STORES.wraps).put({id:source.context.epochId,wrap})
  await transactionComplete(tx)
  return{transport:remote,session:new V1Session(remote,account),sourceEpochId:source.context.epochId,diaryId:source.context.diaryId}
}


async function successorSecurityContext(v2:V2Session,urs:Uint8Array){
  if(!v2.remote||!v2.recovery)throw new Error('successor fixture is incomplete')
  const recovered=await openRecoveryArtifactV6(v2.recovery,urs),payload=recovered.payload
  const epochSalt=await deriveEpochSaltV2(fromBase64Url(payload.diary_id),fromBase64Url(payload.epoch_id))
  const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,payload.epoch_id)
  const writer=await store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
  if(!writer||state.verified_writer_generation===null||state.verified_writer_grant_id===null
    ||state.verified_writer_device_id===null||state.verified_writer_key_id===null)throw new Error('verified successor Writer authority is unavailable')
  return{remote:v2.remote,recovered,payload,epochSalt,store,state,writer}
}

async function appendPostActivationDomainRow(v2:V2Session,urs:Uint8Array,createdAt:string):Promise<Row>{
  const ctx=await successorSecurityContext(v2,urs)
  const unsigned:RevisionV2={
    record_type:'pain_entry',record_schema:'pain-entry/v1',
    record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
    parent_revision_ids:[],record_status:'active',record_data:(()=>{const {id:_,...data}=pain('post-activation-domain');return data})(),
    migration_origin:null,protocol_created_at:createdAt,
    writer_context:{
      writer_generation:ctx.state.verified_writer_generation!,
      writer_grant_id:ctx.state.verified_writer_grant_id!,
      writer_device_id:ctx.state.verified_writer_device_id!,
      writer_key_id:ctx.state.verified_writer_key_id!,
    },
    writer_signature:null,
  }
  const revision={...unsigned,writer_signature:await signEd25519V2(ctx.writer.private_key,revisionSigningBytesV2(ctx.payload.diary_id,ctx.payload.epoch_id,unsigned))}
  const envelope=await sealRevisionEnvelopeV2(ctx.recovered.rootKey,ctx.epochSalt,{diaryId:ctx.payload.diary_id,epochId:ctx.payload.epoch_id},revision,randomBytes(32),randomBytes(12))
  const row=envelopeRowV2(envelope);await ctx.remote.append(ctx.remote.remoteId,row);return row
}

async function appendPostActivationHandoff(v2:V2Session,urs:Uint8Array,createdAt:string){
  const ctx=await successorSecurityContext(v2,urs),target=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16))
  const grant:WriterGrantV2={
    grant_id:base64Url(randomBytes(32)),writer_generation:ctx.state.verified_writer_generation!+1,
    writer_device_id:targetDeviceId,writer_key_id:target.writerKeyId,writer_public_key:base64Url(target.publicKeyRaw),
    previous_grant_id:ctx.state.verified_writer_grant_id!,previous_writer_generation:ctx.state.verified_writer_generation!,
    recovery_generation:ctx.state.recovery_generation,reason:'handoff',
    authority_anchor:await createAnchorV2(ctx.payload.diary_id,ctx.payload.epoch_id,ctx.remote.snapshot.rows),
    authorization:{kind:'writer_handoff',signer_key_id:ctx.writer.writer_signing_key_id,signature:null},
  }
  grant.authorization.signature=await signEd25519V2(ctx.writer.private_key,writerGrantSigningBytesV2(ctx.payload.diary_id,ctx.payload.epoch_id,grant))
  const revision:RevisionV2<WriterGrantV2>={
    record_type:'writer_grant',record_schema:'writer-grant-sw-v2',
    record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
    parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:createdAt,
    writer_context:null,writer_signature:null,
  }
  const envelope=await sealRevisionEnvelopeV2(ctx.recovered.rootKey,ctx.epochSalt,{diaryId:ctx.payload.diary_id,epochId:ctx.payload.epoch_id},revision,randomBytes(32),randomBytes(12))
  await ctx.remote.append(ctx.remote.remoteId,envelopeRowV2(envelope))
  return{target,targetDeviceId,grant}
}

async function prepareRecoveryTransitionRow(v2:V2Session,urs:Uint8Array,createdAt:string):Promise<Row>{
  const ctx=await successorSecurityContext(v2,urs),nextUrs=randomBytes(32),nextRecovery=await generateRecoveryTakeoverKeyMaterialV2()
  const toGeneration=ctx.state.recovery_generation+1
  const transition:RecoveryAuthorityTransitionV2={
    transition_id:base64Url(randomBytes(32)),transition_kind:'recovery_rekey',
    from_recovery_generation:ctx.state.recovery_generation,from_recovery_urs_id:ctx.state.recovery_urs_id!,
    from_recovery_takeover_key_id:ctx.state.recovery_takeover_key_id!,
    to_recovery_generation:toGeneration,
    to_recovery_urs_commitment:await recoveryCommitmentV2(nextUrs,fromBase64Url(ctx.payload.diary_id),toGeneration),
    to_recovery_urs_id:await recoveryUrsIdV2(nextUrs),
    to_recovery_takeover_key_id:nextRecovery.recoveryTakeoverKeyId,
    to_recovery_takeover_public_key:base64Url(nextRecovery.publicKeyRaw),
    authority_anchor:await createAnchorV2(ctx.payload.diary_id,ctx.payload.epoch_id,ctx.remote.snapshot.rows),
  }
  const unsigned:RevisionV2<RecoveryAuthorityTransitionV2>={
    record_type:'recovery_authority_transition',record_schema:'recovery-authority-transition-sw-v2',
    record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
    parent_revision_ids:[],record_status:'control',record_data:transition,migration_origin:null,protocol_created_at:createdAt,
    writer_context:{
      writer_generation:ctx.state.verified_writer_generation!,writer_grant_id:ctx.state.verified_writer_grant_id!,
      writer_device_id:ctx.state.verified_writer_device_id!,writer_key_id:ctx.state.verified_writer_key_id!,
    },
    writer_signature:null,
  }
  const revision={...unsigned,writer_signature:await signEd25519V2(ctx.writer.private_key,revisionSigningBytesV2(ctx.payload.diary_id,ctx.payload.epoch_id,unsigned))}
  const envelope=await sealRevisionEnvelopeV2(ctx.recovered.rootKey,ctx.epochSalt,{diaryId:ctx.payload.diary_id,epochId:ctx.payload.epoch_id},revision,randomBytes(32),randomBytes(12))
  return envelopeRowV2(envelope)
}

describe('ProductiveProfileUpgradeV2Service',()=>{
  beforeEach(async()=>{
    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    globalThis.localStorage?.clear?.()
  })

  it('rejects direct v1 persistence attempts that skip the closed profile-upgrade stage machine',async()=>{
    const createdAt='2026-09-23T11:15:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let stopped=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-source_frozen_verified'&&!stopped){stopped=true;throw new Error('freeze-only')}
    }).upgrade()).rejects.toThrow('freeze-only')
    const current=await loadProfileUpgradeSourceOperationV2()
    if(!current)throw new Error('profile-upgrade operation missing in test')
    const skipped={
      ...current,
      stage:'successor_bound' as const,
      successor_creation_locator:base64Url(new Uint8Array(16).fill(101)),
      successor_manifest_fingerprint:base64Url(new Uint8Array(32).fill(102)),
    }
    await expect(persistProfileUpgradeSourceOperationV2(skipped)).rejects.toThrow(/Illegal RotationOperationStateV2 transition/)
  })

  it('rejects a local v1 write racing the final source freeze and succeeds only after a new full verify',async()=>{
    const createdAt='2026-09-23T11:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let injected=false
    const racing=new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,async point=>{
      if(point==='before-source-freeze-persist'&&!injected){
        injected=true
        await putRecord(LOCAL_STORES.painEntries,pain('freeze-race-write'))
      }
    })
    await expect(racing.upgrade()).rejects.toThrow(/changed after final profile-upgrade verification/)
    expect(await activeProtocolSelectionV2()).toBeNull()
    const final=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(final.stage).toBe('switched')
    expect(await activeProtocolSelectionV2()).toMatchObject({epoch_id:final.successor_epoch_id})
  },120_000)

  it('survives the productive v1->v2 crash matrix without changing one-shot bytes or duplicating semantic appends',async()=>{
    const createdAt='2026-09-23T12:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const stages:ProfileUpgradeV2FaultPoint[]=[
      'after-source_frozen_verified','after-successor_planned','after-genesis-append','after-successor_bound','after-copying',
      'after-successor_verified','after-activation-artifact','after-announcement_prepared','after-recovery_artifact_verified','after-staged_backup_verified',
      'after-source-append','after-announcement_durable','after-confirmation-append','after-confirmation_durable',
      'after-activated_backup_verified','after-local-selection','after-switched',
    ]
    for(const point of stages){
      let fired=false
      const service=new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,current=>{if(current===point&&!fired){fired=true;throw new Error(`fault:${point}`)}})
      await expect(service.upgrade()).rejects.toThrow(`fault:${point}`)
      expect(fired).toBe(true)
    }
    const final=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(final.stage).toBe('switched')
    expect(v2.creates).toBe(1)
    expect(v2.remote).not.toBeNull()
    const sourceSemantic=new Set(source.transport.snapshot.rows.map(row=>row[0]))
    const successorSemantic=new Set(v2.remote!.snapshot.rows.map(row=>row[0]))
    expect(sourceSemantic.size).toBe(source.transport.snapshot.rows.length)
    expect(successorSemantic.size).toBe(v2.remote!.snapshot.rows.length)
    expect([...source.transport.appendCounts.values()].every(count=>count===1)).toBe(true)
    expect([...v2.remote!.appendCounts.values()].every(count=>count===1)).toBe(true)
    const selection=await activeProtocolSelectionV2()
    expect(selection).toMatchObject({sync_profile:SINGLE_WRITER_V2_PROFILE,epoch_id:final.successor_epoch_id,operation_id:final.operation_id})
    expect(v2.recovery).not.toBeNull()
  },120_000)

  it('enters terminal source-race when a v1 row lands between the final read and one-shot Announcement append',async()=>{
    const createdAt='2026-09-23T14:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-staged_backup_verified'&&!armed){armed=true;throw new Error('armed-source-race')}
    }).upgrade()).rejects.toThrow('armed-source-race')
    const existing=source.transport.snapshot.rows[0]!
    source.transport.injectBeforeNextAppend=[existing[0]!,existing[1]!,existing[2]!]
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('stale')
    expect(await activeProtocolSelectionV2()).toBeNull()
    expect(result.activated_backup_id).toBeNull()
    expect(v2.remote).not.toBeNull()
  },90_000)

  it('accepts byte-identical physical profile-upgrade Announcement retries when the first post-freeze row is the prepared Announcement',async()=>{
    const createdAt='2026-09-23T14:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-staged_backup_verified'&&!armed){armed=true;throw new Error('armed-announcement-retry')}
    }).upgrade()).rejects.toThrow('armed-announcement-retry')
    const operation=await loadProfileUpgradeSourceOperationV2()
    if(!operation?.announcement_envelope)throw new Error('prepared Announcement missing')
    source.transport.injectBeforeNextAppend=[operation.announcement_envelope.envelope_id,operation.announcement_envelope.iv,operation.announcement_envelope.ciphertext]
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('switched')
    expect(source.transport.snapshot.rows.slice(operation.source_anchor_before_announcement.covered_row_count).filter(row=>row[0]===operation.announcement_envelope!.envelope_id)).toHaveLength(2)
  },90_000)

  it('includes immediate byte-identical Confirmation retries in successor_activation_anchor and still switches',async()=>{
    const createdAt='2026-09-23T15:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-announcement_durable'&&!armed){armed=true;throw new Error('armed-confirmation-retry')}
    }).upgrade()).rejects.toThrow('armed-confirmation-retry')
    const operation=await loadProfileUpgradeSourceOperationV2()
    if(!operation?.confirmation_envelope||!v2.remote)throw new Error('prepared Confirmation missing')
    v2.remote.injectBeforeNextAppend=[operation.confirmation_envelope.envelope_id,operation.confirmation_envelope.iv,operation.confirmation_envelope.ciphertext]
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('switched')
    expect(result.successor_activation_anchor?.covered_row_count).toBe(result.successor_staging_anchor!.covered_row_count+2)
  },90_000)

  it('accepts a valid post-activation Fachrow and includes it in the activated/final verified prefix',async()=>{
    const createdAt='2026-09-23T15:45:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation_durable'&&!armed){armed=true;throw new Error('armed-post-activation-domain')}
    }).upgrade()).rejects.toThrow('armed-post-activation-domain')
    const row=await appendPostActivationDomainRow(v2,urs,createdAt)
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('switched')
    expect(v2.remote!.snapshot.rows.some(candidate=>candidate[0]===row[0])).toBe(true)
    const ctx=await successorSecurityContext(v2,urs),state=await ctx.store.loadState(ctx.recovered.rootKey,ctx.epochSalt,ctx.payload.epoch_id)
    expect(state.remote_anchor?.covered_row_count).toBe(v2.remote!.snapshot.rows.length)
  },90_000)

  it('accepts a valid post-activation WriterGrant and derives final local read_only status from the latest authority',async()=>{
    const createdAt='2026-09-23T15:50:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation_durable'&&!armed){armed=true;throw new Error('armed-post-activation-handoff')}
    }).upgrade()).rejects.toThrow('armed-post-activation-handoff')
    const handoff=await appendPostActivationHandoff(v2,urs,createdAt)
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('switched')
    const ctx=await successorSecurityContext(v2,urs),state=await ctx.store.loadState(ctx.recovered.rootKey,ctx.epochSalt,ctx.payload.epoch_id)
    expect(state.verified_writer_grant_id).toBe(handoff.grant.grant_id)
    expect(state.verified_writer_device_id).toBe(handoff.targetDeviceId)
    expect(state.writer_status).toBe('read_only')
    expect(state.writer_generation).toBeNull()
  },90_000)

  it('uses the fresher activation-boundary read and supersedes before activated Backup when Recovery advances between reads',async()=>{
    const createdAt='2026-09-23T15:55:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation_durable'&&!armed){armed=true;throw new Error('armed-split-read-recovery')}
    }).upgrade()).rejects.toThrow('armed-split-read-recovery')
    if(!v2.remote)throw new Error('successor missing in test fixture')
    const transitionRow=await prepareRecoveryTransitionRow(v2,urs,createdAt)
    v2.remote.afterNextRead=()=>{v2.remote!.snapshot.rows.push([...transitionRow])}
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('post_activation_superseded')
    expect(result.activated_backup_id).toBeNull()
    expect(await activeProtocolSelectionV2()).toBeNull()
    const store=new IndexedDbV2LocalSecurityStore()
    expect(await store.operationArtifact(`${result.operation_id}:activated-backup`)).toBeNull()
  },90_000)

  it('enters terminal successor cutover-race when another row becomes first after the staging anchor',async()=>{
    const createdAt='2026-09-23T15:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-announcement_durable'&&!armed){armed=true;throw new Error('armed-successor-race')}
    }).upgrade()).rejects.toThrow('armed-successor-race')
    if(!v2.remote)throw new Error('successor missing in test fixture')
    const existing=v2.remote.snapshot.rows.at(-1)!
    v2.remote.injectBeforeNextAppend=[existing[0]!,existing[1]!,existing[2]!]
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('cutover_race')
    expect(await activeProtocolSelectionV2()).toBeNull()
    expect(result.activated_backup_id).toBeNull()
  },90_000)

  it('reconciles append-after-commit unknown outcomes without generating a second semantic control row',async()=>{
    const createdAt='2026-09-23T13:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    // Stop immediately after the staged backup so both append boundaries can be armed.
    let fired=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{if(point==='after-staged_backup_verified'&&!fired){fired=true;throw new Error('armed')}}).upgrade()).rejects.toThrow('armed')
    source.transport.unknownAfterAppend=true
    let confirmationArmed=false
    const service=new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-announcement_durable'&&!confirmationArmed){confirmationArmed=true;v2.remote!.unknownAfterAppend=true}
    })
    const result=await service.upgrade()
    expect(result.stage).toBe('switched')
    expect([...source.transport.appendCounts.values()].every(count=>count===1)).toBe(true)
    expect([...v2.remote!.appendCounts.values()].every(count=>count===1)).toBe(true)
  },90_000)
})
