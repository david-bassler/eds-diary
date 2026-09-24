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
import type { GoogleSheetsSingleWriterTransport } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { manifestCellsArrayV6, manifestFingerprintV6, type ManifestCellsV6 } from '../security/v2/manifest'
import type { VerifiedRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'
import { openRecoveryArtifactV6, type RecoveryArtifactV6 } from '../security/v2/recovery'
import type { CreationPersistence, CreationState } from '../sync/core/creation'
import type { FreshCanonicalV2Source } from '../security/v2/domainWrite'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { ProductiveReadOnlyJoinV2Service } from '../data/readOnlyJoinV2Service'

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
  async discover(locator:string):Promise<readonly RemoteCandidate[]>{return[{remoteId:this.remoteId,locator}]}
  async create():Promise<void>{}
  async read(id:string):Promise<RemoteSnapshot>{if(id!==this.remoteId)throw new Error('wrong remote');return structuredClone(this.snapshot)}
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

async function seedV1Source(urs:Uint8Array,createdAt:string):Promise<{transport:MemoryTransport;session:V1Session;sourceEpochId:string;diaryId:string;account:string}>{
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
  return{transport:remote,session:new V1Session(remote,account),sourceEpochId:source.context.epochId,diaryId:source.context.diaryId,account}
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

  it('joins a fully activated productive v1->v2 successor read-only on a fresh second-device profile',async()=>{
    const createdAt='2026-09-23T12:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    if(!v2.remote||!v2.recovery)throw new Error('productive profile-upgrade fixture did not publish successor/recovery state')

    const successorRemote=v2.remote,recoveryArtifact=structuredClone(v2.recovery)
    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    globalThis.localStorage?.clear?.()

    const v2Transport={
      providerId:'google-drive-sheets-v1',
      profileId:SINGLE_WRITER_V2_PROFILE,
      discover:(locator:string)=>successorRemote.discover(locator),
      read:(remoteId:string)=>successorRemote.read(remoteId),
      authenticatedAccountBinding:async()=>v2.account,
    } as unknown as GoogleSheetsTransferableSingleWriterV2Transport
    const v1Transport={
      providerId:'google-drive-sheets-v1',
      profileId:SINGLE_WRITER_V1_PROFILE,
      discover:(locator:string)=>source.transport.discover(locator),
      read:(remoteId:string)=>source.transport.read(remoteId),
      authenticatedAccountBinding:async()=>source.account,
    } as unknown as GoogleSheetsSingleWriterTransport
    const joinSession:TransferableSingleWriterV2ProviderSession={
      providerId:'google-drive-sheets-v1',
      profileId:SINGLE_WRITER_V2_PROFILE,
      async transportForEpoch(){return v2Transport},
      async v1TransportForEpoch(){return v1Transport},
      async remoteIdentityBinding(){return v2.account},
      async codecForEpoch(diaryId,epochId,rootKey){return new GoogleSheetsTransferableSingleWriterV2ProfileCodec(diaryId,epochId,rootKey,v2.account)},
      freshCanonicalSource(){throw new Error('unused')},
      async creationProperties(){throw new Error('unused')},
      async createOrReconcileEpoch(){throw new Error('unused')},
      async publishRecoveryArtifact(){throw new Error('unused')},
      async discoverRecoveryFamilyArtifacts(){return[{remoteResourceId:'recovery-v6',artifact:structuredClone(recoveryArtifact)}]},
      async findRecoveryArtifact(){return structuredClone(recoveryArtifact)},
      async loadRecoveryArtifact(){return structuredClone(recoveryArtifact)},
      async disconnect(){},
    }

    const joined=await new ProductiveReadOnlyJoinV2Service(joinSession).join(urs)
    expect(joined.epochId).toBe(upgraded.successor_epoch_id)
    expect(joined.resumed).toBe(false)
    const recovered=await openRecoveryArtifactV6(recoveryArtifact,urs)
    const epochSalt=await deriveEpochSaltV2(fromBase64Url(joined.diaryId),fromBase64Url(joined.epochId))
    const state=await new IndexedDbV2LocalSecurityStore().loadState(recovered.rootKey,epochSalt,joined.epochId)
    expect(state.writer_status).toBe('read_only')
    expect(state.writer_generation).toBeNull()
    expect(state.writer_grant_id).toBeNull()
    expect(state.activation_lineage_cache_ref).not.toBeNull()
    expect(await activeProtocolSelectionV2()).toMatchObject({epoch_id:joined.epochId,operation_id:joined.joinId})
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

  it('rejects duplicate physical profile-upgrade Announcement rows at the activation boundary',async()=>{
    const createdAt='2026-09-23T14:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-announcement_durable'&&!armed){armed=true;throw new Error('armed-duplicate-announcement')}
    }).upgrade()).rejects.toThrow('armed-duplicate-announcement')
    const announcement=source.transport.snapshot.rows.at(-1)!
    source.transport.snapshot.rows.push([...announcement])
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()).rejects.toThrow(/profile_upgrade_source_race|exactly one physical Source Announcement/)
    expect(await activeProtocolSelectionV2()).toBeNull()
  },90_000)

  it('rejects duplicate physical Successor Confirmation rows at the activation boundary',async()=>{
    const createdAt='2026-09-23T15:30:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation_durable'&&!armed){armed=true;throw new Error('armed-duplicate-confirmation')}
    }).upgrade()).rejects.toThrow('armed-duplicate-confirmation')
    if(!v2.remote)throw new Error('successor missing in test fixture')
    const confirmation=v2.remote.snapshot.rows.at(-1)!
    v2.remote.snapshot.rows.push([...confirmation])
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()).rejects.toThrow(/profile_upgrade_successor_cutover_race|exactly one physical Successor Confirmation/)
    expect(await activeProtocolSelectionV2()).toBeNull()
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
