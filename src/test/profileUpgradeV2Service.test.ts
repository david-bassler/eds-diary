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
  enrollActivePassphraseRootWrap,
  enrollActivePrfRootWrap,
  localRootWrapStatus,
  lockActiveRoot,
  unlockActiveRootWithPassphrase,
  unlockActiveRootWithPrf,
} from '../data/localDatabase'
import { IndexedDbV2LocalSecurityStore, __v2LocalPersistenceTesting, type VerifiedPersistedRecoveryArtifactV6 } from '../security/v2/localPersistence'
import { IndexedDbV2CoordinatorStore } from '../security/v2/coordinatorStore'
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
import { ProductiveReadOnlyJoinV2Service } from '../data/readOnlyJoinV2Service'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  recoveryCommitmentV2,
  recoveryUrsIdV2,
  randomProtocolIdV2,
  revisionSigningBytesV2,
  signEd25519V2,
  writerGrantSigningBytesV2,
} from '../security/v2/crypto'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { validateRevisionV2 } from '../security/v2/validators'
import { createAnchorV2 } from '../security/v2/prefix'
import type { RecoveryAuthorityTransitionV2, RevisionV2, RotationAnnouncementV2, WriterGrantV2 } from '../security/v2/types'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import { createTransferDescriptorV2, ProductiveWriterHandoffV2Service } from '../data/writerHandoffV2Service'
import { localJournalInitialV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from '../security/v2/localState'
import { ProductiveNativeRotationV2Service } from '../data/nativeRotationV2Service'
import { ProductiveRecoveryRekeyV2Service } from '../data/recoveryRekeyV2Service'
import type { RotationOperationStateV2 } from '../security/v2/profileUpgrade'
import { TransferableSingleWriterV2WriteAuthority } from '../security/v2/writeAuthority'
import { clearAuthenticatedRemoteSession, continuePendingRecoveryRekeyV2, forceTakeoverV2, installAuthenticatedRemoteSession, joinExistingV2Diary, remoteSessionStatus } from '../data/initializeDataLayer'
import { __v2ApplicationRuntimeTesting } from '../data/v2ApplicationRuntime'
import { createPainEntry, listPainEntries } from '../features/pain/painRepository'

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
    readonly authenticatedBinding:string|null=null,
  ){}
  async authenticatedAccountBinding():Promise<string>{
    if(this.authenticatedBinding===null)throw new Error('Fixture authenticated account binding is unavailable.')
    return this.authenticatedBinding
  }
  appendCounts=new Map<string,number>()
  appendAttempts=0
  unknownAfterAppend=false
  unknownWithoutAppend=0
  onUnknownWithoutAppend:(()=>void|Promise<void>)|null=null
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
    this.appendAttempts+=1
    if(this.unknownWithoutAppend>0){
      this.unknownWithoutAppend-=1
      const hook=this.onUnknownWithoutAppend
      this.onUnknownWithoutAppend=null
      await hook?.()
      throw new TransportError('unknown_outcome','simulated unresolved append')
    }
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
  private readonly remotesByEpoch=new Map<string,MemoryTransport>()
  private readonly v1RemotesByEpoch=new Map<string,MemoryTransport>()
  recovery:RecoveryArtifactV6|null=null
  private readonly recoveryByEpoch=new Map<string,RecoveryArtifactV6>()
  private readonly recoveryByEpochAndUrs=new Map<string,RecoveryArtifactV6>()
  private recoveryKey(epochId:string,urs:Uint8Array):string{return `${epochId}:${base64Url(urs)}`}
  creates=0
  private readonly creation=new Map<string,CreationState>()
  async transportForEpoch(diaryId:string,epochId:string):Promise<GoogleSheetsTransferableSingleWriterV2Transport>{
    void diaryId
    return (this.remotesByEpoch.get(epochId)??this.preCreationTransport) as unknown as GoogleSheetsTransferableSingleWriterV2Transport
  }
  registerV1Epoch(epochId:string,transport:MemoryTransport):void{this.v1RemotesByEpoch.set(epochId,transport)}
  async v1TransportForEpoch(_diaryId:string,epochId:string):Promise<GoogleSheetsSingleWriterTransport>{
    const transport=this.v1RemotesByEpoch.get(epochId)
    if(!transport)throw new Error('Authenticated v1 lineage transport is unavailable.')
    return transport as unknown as GoogleSheetsSingleWriterTransport
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
    const remoteId=this.creates===0?'successor-v2':`successor-v2-${this.creates+1}`
    this.remote=new MemoryTransport(SINGLE_WRITER_V2_PROFILE,remoteId,{manifest:[...manifestCellsArrayV6(args.manifest)],rows:[]},this.account)
    this.remotesByEpoch.set(args.epochId,this.remote)
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
  async publishRecoveryArtifact(urs:Uint8Array,persisted:VerifiedPersistedRecoveryArtifactV6):Promise<string>{
    this.recovery=structuredClone(persisted.artifact)
    this.recoveryByEpoch.set(persisted.epochId,structuredClone(persisted.artifact))
    this.recoveryByEpochAndUrs.set(this.recoveryKey(persisted.epochId,urs),structuredClone(persisted.artifact))
    return'recovery-v6'
  }
  async discoverRecoveryFamilyArtifacts(urs:Uint8Array):Promise<readonly {remoteResourceId:string;artifact:RecoveryArtifactV6}[]>{
    const suffix=`:${base64Url(urs)}`
    return [...this.recoveryByEpochAndUrs.entries()]
      .filter(([key])=>key.endsWith(suffix))
      .map(([key,artifact])=>({remoteResourceId:`recovery-${key.slice(0,key.length-suffix.length)}`,artifact:structuredClone(artifact)}))
  }
  async findRecoveryArtifact(urs?:Uint8Array,_diaryId?:string,epochId?:string):Promise<RecoveryArtifactV6|null>{
    const artifact=epochId&&urs?this.recoveryByEpochAndUrs.get(this.recoveryKey(epochId,urs)):epochId?this.recoveryByEpoch.get(epochId):this.recovery
    return artifact?structuredClone(artifact):null
  }
  async loadRecoveryArtifact(urs?:Uint8Array,_diaryId?:string,epochId?:string):Promise<RecoveryArtifactV6>{
    const artifact=epochId&&urs?this.recoveryByEpochAndUrs.get(this.recoveryKey(epochId,urs)):epochId?this.recoveryByEpoch.get(epochId):this.recovery
    if(!artifact)throw new Error('missing recovery')
    return structuredClone(artifact)
  }
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
  const fingerprint=await manifestFingerprint(manifest),remote=new MemoryTransport(SINGLE_WRITER_V1_PROFILE,'source-v1',{manifest:[manifest.format,manifest.version,manifest.manifestIv,manifest.manifestCiphertext],rows:rows.map(row=>[...row])},account)
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
    parent_revision_ids:[],record_status:'active',record_data:{startedAt:createdAt,endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'post activation domain',createdAt,updatedAt:createdAt},
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

async function persistLocalPreparedDomainRow(v2:V2Session,urs:Uint8Array,createdAt:string){
  const ctx=await successorSecurityContext(v2,urs)
  const state=await ctx.store.loadState(ctx.recovered.rootKey,ctx.epochSalt,ctx.payload.epoch_id)
  if(state.writer_status!=='writer_active'||state.writer_generation===null||state.writer_grant_id===null)throw new Error('local domain fixture requires current Writer')
  const key=await ctx.store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
  if(!key)throw new Error('local domain fixture WriterDeviceKeyV2 missing')
  const reservation=await ctx.store.reserveEnvelope(state.epoch_id,ctx.remote.snapshot.rows)
  const unsigned:RevisionV2={
    record_type:'pain_entry',record_schema:'pain-entry/v1',
    record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
    parent_revision_ids:[],record_status:'active',
    record_data:{startedAt:createdAt,endedAt:'',locations:[],intensity:5,qualities:[],cause:'',occursWhen:'',note:'local handoff gate fixture',createdAt,updatedAt:createdAt},
    migration_origin:null,protocol_created_at:createdAt,
    writer_context:{
      writer_generation:state.writer_generation,writer_grant_id:state.writer_grant_id,
      writer_device_id:state.writer_device_id,writer_key_id:state.writer_signing_key_id,
    },
    writer_signature:null,
  }
  const revision={...unsigned,writer_signature:await signEd25519V2(key.private_key,revisionSigningBytesV2(state.diary_id,state.epoch_id,unsigned))}
  const envelope=await sealRevisionEnvelopeV2(ctx.recovered.rootKey,ctx.epochSalt,{diaryId:state.diary_id,epochId:state.epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
  const after=await ctx.store.commitReservedEnvelope(ctx.recovered.rootKey,ctx.epochSalt,state.operation_generation,reservation,envelope,{
    writer_generation:state.writer_generation,writer_grant_id:state.writer_grant_id,
    writer_device_id:state.writer_device_id,writer_key_id:state.writer_signing_key_id,
  })
  return{...ctx,envelope,state:after}
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

async function prepareSealRow(v2:V2Session,urs:Uint8Array,createdAt:string):Promise<Row>{
  const ctx=await successorSecurityContext(v2,urs),successorEpochId=base64Url(randomBytes(16))
  const rotation:RotationAnnouncementV2={
    rotation_id:base64Url(randomBytes(32)),from_epoch_id:ctx.payload.epoch_id,
    successor_epoch_id:successorEpochId,successor_creation_locator:base64Url(randomBytes(16)),
    successor_manifest_fingerprint:base64Url(randomBytes(32)),rotation_kind:'normal',
    source_writer_generation:ctx.state.verified_writer_generation!,source_writer_grant_id:ctx.state.verified_writer_grant_id!,
    successor_recovery_generation:ctx.state.recovery_generation,
    source_anchor_before_announcement:await createAnchorV2(ctx.payload.diary_id,ctx.payload.epoch_id,ctx.remote.snapshot.rows),
    successor_staging_anchor:await createAnchorV2(ctx.payload.diary_id,successorEpochId,[]),recovery_transition_id:null,
  }
  const unsigned:RevisionV2<RotationAnnouncementV2>={
    record_type:'rotation_announcement',record_schema:'rotation-announcement-sw-v2',
    record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
    parent_revision_ids:[],record_status:'control',record_data:rotation,migration_origin:null,protocol_created_at:createdAt,
    writer_context:{
      writer_generation:ctx.state.verified_writer_generation!,writer_grant_id:ctx.state.verified_writer_grant_id!,
      writer_device_id:ctx.state.verified_writer_device_id!,writer_key_id:ctx.state.verified_writer_key_id!,
    },writer_signature:null,
  }
  const revision={...unsigned,writer_signature:await signEd25519V2(ctx.writer.private_key,revisionSigningBytesV2(ctx.payload.diary_id,ctx.payload.epoch_id,unsigned))}
  const envelope=await sealRevisionEnvelopeV2(ctx.recovered.rootKey,ctx.epochSalt,{diaryId:ctx.payload.diary_id,epochId:ctx.payload.epoch_id},revision,randomBytes(32),randomBytes(12))
  return envelopeRowV2(envelope)
}

describe('ProductiveProfileUpgradeV2Service',()=>{
  beforeEach(async()=>{
    await clearAuthenticatedRemoteSession().catch(()=>undefined)
    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    __v2ApplicationRuntimeTesting.reset()
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
    const sourceAnnouncement=source.transport.snapshot.rows.at(-1)!
    source.transport.snapshot.rows.push([...sourceAnnouncement])
    const successorConfirmation=successorRemote.snapshot.rows.at(-1)!
    successorRemote.snapshot.rows.push([...successorConfirmation])
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

  it('rejects a direct Handoff persistence call whose predecessor Grant is not the authenticated current Writer',async()=>{
    const createdAt='2026-09-23T12:33:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(state.writer_status!=='writer_active'||state.writer_generation===null||state.writer_grant_id===null||state.remote_anchor===null)throw new Error('source fixture is not current Writer')
    const sourceKey=await store.loadWriterKey(state.writer_signing_key_id,state.diary_id,state.epoch_id)
    if(!sourceKey)throw new Error('source fixture WriterDeviceKeyV2 missing')
    const target=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16))
    const reservation=await store.reserveEnvelope(state.epoch_id,v2.remote.snapshot.rows)
    const grant:WriterGrantV2={
      grant_id:randomProtocolIdV2(32),
      writer_generation:state.writer_generation+1,
      writer_device_id:targetDeviceId,
      writer_key_id:target.writerKeyId,
      writer_public_key:base64Url(target.publicKeyRaw),
      previous_grant_id:base64Url(new Uint8Array(32).fill(117)),
      previous_writer_generation:state.writer_generation,
      recovery_generation:state.recovery_generation,
      reason:'handoff',
      authority_anchor:{...state.remote_anchor},
      authorization:{kind:'writer_handoff',signer_key_id:state.writer_signing_key_id,signature:null},
    }
    grant.authorization.signature=await signEd25519V2(sourceKey.private_key,writerGrantSigningBytesV2(state.diary_id,state.epoch_id,grant))
    const revision:RevisionV2<WriterGrantV2>={
      record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:base64Url(randomBytes(16)),revision_id:base64Url(randomBytes(32)),
      parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:createdAt,writer_context:null,writer_signature:null,
    }
    await validateRevisionV2(revision)
    const envelope=await sealRevisionEnvelopeV2(recovered.rootKey,epochSalt,{diaryId:state.diary_id,epochId:state.epoch_id},revision,fromBase64Url(reservation.envelope_id),fromBase64Url(reservation.iv))
    const operation={
      format:'writer-grant-operation-v2' as const,version:2 as const,operation_id:randomProtocolIdV2(32),operation_kind:'handoff' as const,
      epoch_id:state.epoch_id,stage:'prepared' as const,authority_anchor:{...state.remote_anchor},
      prepared_envelope:{envelope_id:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext},
      expected_writer_generation:grant.writer_generation,expected_writer_grant_id:grant.grant_id,
    }
    await expect(store.persistPreparedWriterGrantOperationBundle({
      rootKey:recovered.rootKey,epochSalt,expectedOperationGeneration:state.operation_generation,reservation,envelope,operation,
    })).rejects.toThrow(/does not bind the authenticated current Writer/)
    expect(await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,state.epoch_id)).toBeNull()
    expect(v2.remote.snapshot.rows.some(row=>row[0]===envelope.envelopeId)).toBe(false)
  },120_000)

  it('rejects a direct stale Handoff transition while the authenticated authority anchor is unchanged',async()=>{
    const createdAt='2026-09-23T12:35:30.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(54))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-false-stale')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-false-stale')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const before=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(before.remote_anchor).toEqual(operation.authority_anchor)
    await expect(store.advanceWriterGrantOperationBinding(
      recovered.rootKey,epochSalt,upgraded.successor_epoch_id,before.operation_generation,'prepared',{...operation,stage:'stale'},
    )).rejects.toThrow(/requires authenticated remote (?:prefix )?advancement/)
    expect((await store.loadWriterGrantOperation(operation.operation_id)).stage).toBe('prepared')
    expect((await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).writer_operation_state_ref?.state).toBe('prepared')
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('prepared')
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
  },120_000)

  it('rejects same-height different-hash StateV6 as stale Handoff evidence',async()=>{
    const createdAt='2026-09-23T12:35:45.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(55))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-same-height-fork')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-same-height-fork')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const before=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!before.remote_anchor)throw new Error('prepared Handoff state missing remote anchor')
    const forkHash=base64Url(new Uint8Array(32).fill(before.remote_anchor.prefix_hash===base64Url(new Uint8Array(32).fill(55))?56:55))
    const forked={...before,operation_generation:before.operation_generation+1,remote_anchor:{...before.remote_anchor,prefix_hash:forkHash}}
    await store.replaceState(recovered.rootKey,epochSalt,before.operation_generation,forked)
    const forkState=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(forkState.remote_anchor?.covered_row_count).toBe(operation.authority_anchor.covered_row_count)
    expect(forkState.remote_anchor?.prefix_hash).not.toBe(operation.authority_anchor.prefix_hash)
    await expect(store.advanceWriterGrantOperationBinding(
      recovered.rootKey,epochSalt,upgraded.successor_epoch_id,forkState.operation_generation,'prepared',{...operation,stage:'stale'},
    )).rejects.toThrow(/requires authenticated remote prefix advancement/)
    expect((await store.loadWriterGrantOperation(operation.operation_id)).stage).toBe('prepared')
    expect((await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).writer_operation_state_ref?.state).toBe('prepared')
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('prepared')
  },120_000)

  it('rejects a direct durable Handoff transition before canonical readback evidence',async()=>{
    const createdAt='2026-09-23T12:36:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(53))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-false-durable')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-false-durable')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const before=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    await expect(store.advanceWriterGrantOperationBinding(
      recovered.rootKey,epochSalt,upgraded.successor_epoch_id,before.operation_generation,'prepared',{...operation,stage:'durable'},
    )).rejects.toThrow(/requires canonical durable ceremony evidence/)
    expect((await store.loadWriterGrantOperation(operation.operation_id)).stage).toBe('prepared')
    expect((await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).writer_operation_state_ref?.state).toBe('prepared')
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('prepared')
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
  },120_000)

  it('refuses TransferDescriptorV2 creation on the current Writer without locally demoting it',async()=>{
    const createdAt='2026-09-23T12:35:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.recovery)throw new Error('handoff fixture missing recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore()
    const before=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(before.writer_status).toBe('writer_active')
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).createTransferDescriptor()).rejects.toThrow(/locally read-only/)
    const after=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(after.writer_status).toBe('writer_active')
    expect(after.writer_generation).toBe(before.writer_generation)
    expect(after.writer_grant_id).toBe(before.writer_grant_id)
  },120_000)

  it('transfers Writer authority cooperatively and lets the target adopt only after its own full verify',async()=>{
    const createdAt='2026-09-23T12:40:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),sourceState=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(sourceState.writer_status).toBe('writer_active')
    const rootWrap=await store.loadRootWrapV6(upgraded.successor_epoch_id)

    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16))
    const targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const targetDescriptorState:EpochLocalSecurityStateV6={...sourceState,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null}
    const descriptor=await createTransferDescriptorV2(targetDescriptorState,targetKey,new Uint8Array(32).fill(41))

    const handed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff(descriptor)
    expect(handed.stage).toBe('durable')
    expect(handed.expectedWriterGeneration).toBe(sourceState.writer_generation!+1)
    const sourceAfter=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(sourceAfter.writer_status).toBe('read_only')
    expect(sourceAfter.writer_generation).toBeNull()
    expect(sourceAfter.verified_writer_device_id).toBe(targetDeviceId)
    expect(sourceAfter.writer_operation_state_ref?.state).toBe('durable')

    await __v2LocalPersistenceTesting.reset()
    const targetStore=new IndexedDbV2LocalSecurityStore()
    await targetStore.persistRootWrapV6(rootWrap.wrap,rootWrap.bestEffortWrappingKey)
    await targetStore.persistWriterKey(targetKey,recovered.payload.diary_id,recovered.payload.epoch_id)
    const targetState:EpochLocalSecurityStateV6={
      ...sourceState,
      operation_generation:0,
      rotation_state_ref:null,
      writer_operation_state_ref:null,
      recovery_operation_state_ref:null,
      activation_lineage_cache_ref:null,
      local_journal_count:0,
      local_journal_hash:await localJournalInitialV2(recovered.payload.diary_id,recovered.payload.epoch_id),
      writer_status:'read_only',
      writer_device_id:targetDeviceId,
      writer_signing_key_id:targetPair.writerKeyId,
      writer_generation:null,
      writer_grant_id:null,
      stale_writer_pending_count:0,
    }
    await targetStore.initializeState(recovered.rootKey,epochSalt,targetState)
    const adopted=await new ProductiveWriterHandoffV2Service(v2,targetStore,()=>createdAt).adoptGrantedWriter()
    expect(adopted.writer_status).toBe('writer_active')
    expect(adopted.writer_device_id).toBe(targetDeviceId)
    expect(adopted.writer_signing_key_id).toBe(targetPair.writerKeyId)
    expect(adopted.writer_generation).toBe(handed.expectedWriterGeneration)
    expect(adopted.writer_grant_id).toBe(handed.expectedWriterGrantId)
  },120_000)

  it('reconciles a handoff append-after-commit unknown outcome without a duplicate Grant append',async()=>{
    const createdAt='2026-09-23T12:45:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(42))
    v2.remote.unknownAfterAppend=true
    const result=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff(descriptor)
    expect(result.stage).toBe('durable')
    const operation=await store.loadWriterGrantOperation(result.operationId)
    expect(v2.remote.appendCounts.get(operation.prepared_envelope.envelope_id)).toBe(1)
  },120_000)

  it('rejects an invalid TransferDescriptorV2 PoP before persisting or appending a Handoff Grant',async()=>{
    const createdAt='2026-09-23T12:47:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(45))
    const tampered={...descriptor,possession_signature:base64Url(new Uint8Array(64).fill(99))}
    const attempts=v2.remote.appendAttempts
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff(tampered)).rejects.toThrow(/possession signature failed/)
    expect(v2.remote.appendAttempts).toBe(attempts)
    expect(await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).toBeNull()
  },120_000)

  it('does not blind-loop WriterGrant retries after repeated unknown outcomes without a remote commit',async()=>{
    const createdAt='2026-09-23T12:48:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(46))
    const before=v2.remote.appendAttempts
    v2.remote.unknownWithoutAppend=2
    const unresolved=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff(descriptor)
    expect(unresolved.stage).toBe('append_unknown')
    expect(v2.remote.appendAttempts-before).toBe(2)
    const unresolvedOperation=await store.loadWriterGrantOperation(unresolved.operationId)
    expect(v2.remote.snapshot.rows.some(row=>row[0]===unresolvedOperation.prepared_envelope.envelope_id)).toBe(false)

    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('durable')
    expect(v2.remote.appendAttempts-before).toBe(3)
  },120_000)

  it('resumes the exact prepared Handoff after crashes before and after the remote append',async()=>{
    const createdAt='2026-09-23T12:50:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(43))

    let beforeAppend=true
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&beforeAppend){beforeAppend=false;throw new Error('handoff-crash:prepared')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared')
    const prepared=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(prepared?.stage).toBe('prepared')
    if(!prepared)throw new Error('prepared Handoff operation missing')
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(recovered.payload.diary_id,recovered.payload.epoch_id,recovered.rootKey,v2.account)
    const beforeGrant=await codec.verifyRemote(await v2.remote.read('successor-v2'))
    const genericPending=await new IndexedDbV2CoordinatorStore(upgraded.successor_epoch_id,recovered.rootKey,epochSalt,store).pending(beforeGrant)
    expect(genericPending.some(envelope=>envelope.envelopeId===prepared.prepared_envelope.envelope_id)).toBe(false)

    let afterAppend=true
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-append-attempt'&&afterAppend){afterAppend=false;throw new Error('handoff-crash:append')}
    }).handoff()).rejects.toThrow('handoff-crash:append')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('handoff operation missing after crash')
    expect(v2.remote.appendCounts.get(operation.prepared_envelope.envelope_id)).toBe(1)

    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('durable')
    expect(resumed.operationId).toBe(operation.operation_id)
    expect(v2.remote.appendCounts.get(operation.prepared_envelope.envelope_id)).toBe(1)
  },120_000)

  it('stales a prepared Handoff when the epoch is sealed before append',async()=>{
    const createdAt='2026-09-23T12:51:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(52))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-seal')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-seal')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const attempts=v2.remote.appendAttempts
    await v2.remote.append('successor-v2',await prepareSealRow(v2,urs,createdAt))
    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('stale')
    expect(v2.remote.appendAttempts).toBe(attempts+1)
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
    const after=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(after.writer_status).toBe('read_only')
    expect(after.writer_operation_state_ref?.state).toBe('stale')
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('stale_writer_pending')
  },120_000)

  it('stales a prepared Handoff when Recovery-Rekey becomes pending before append',async()=>{
    const createdAt='2026-09-23T12:52:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(51))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-rekey')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-rekey')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const attempts=v2.remote.appendAttempts
    await v2.remote.append('successor-v2',await prepareRecoveryTransitionRow(v2,urs,createdAt))
    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('stale')
    expect(v2.remote.appendAttempts).toBe(attempts+1)
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
    const after=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(after.recovery_rekey_rotation_required).toBe(true)
    expect(after.writer_operation_state_ref?.state).toBe('stale')
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('stale_writer_pending')
  },120_000)

  it('loses a concurrent g+1 race without appending its prepared Grant',async()=>{
    const createdAt='2026-09-23T12:53:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(50))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-competing-grant')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-competing-grant')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const attempts=v2.remote.appendAttempts
    const winner=await appendPostActivationHandoff(v2,urs,createdAt)
    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('stale')
    expect(v2.remote.appendAttempts).toBe(attempts+1)
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
    const after=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(after.writer_status).toBe('read_only')
    expect(after.verified_writer_device_id).toBe(winner.targetDeviceId)
    const ceremonyEntry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(entry=>entry.envelope_id===operation.prepared_envelope.envelope_id)
    expect(ceremonyEntry?.status).toBe('stale_writer_pending')
  },120_000)

  it('rejects a stale WriterGrant transition when a sibling outbox MAC is invalid',async()=>{
    const createdAt='2026-09-23T12:54:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const local=await persistLocalPreparedDomainRow(v2,urs,createdAt)
    await v2.remote.append('successor-v2',[local.envelope.envelopeId,local.envelope.iv,local.envelope.ciphertext])
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(local.recovered.payload.diary_id,local.recovered.payload.epoch_id,local.recovered.rootKey,v2.account)
    const verified=await codec.verifyRemote(await v2.remote.read('successor-v2'))
    const canonical=verified.profileState as CanonicalFullResultV2
    const beforePull=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    await new IndexedDbV2CoordinatorStore(upgraded.successor_epoch_id,local.recovered.rootKey,local.epochSalt,local.store).commitVerifiedPull(verified,canonical.remote_anchor,beforePull.operation_generation)
    const current=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...current,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(49))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,local.store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-journal-tamper')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-journal-tamper')
    const operation=await local.store.loadBoundWriterGrantOperation(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')

    const db=await __v2LocalPersistenceTesting.openDatabase(),storeName=__v2LocalPersistenceTesting.STORES.outbox
    const readTx=db.transaction(storeName,'readonly')
    const request=readTx.objectStore(storeName).get(`${upgraded.successor_epoch_id}:${local.envelope.envelopeId}`)
    const sibling=await new Promise<Record<string,unknown>>((resolve,reject)=>{
      request.addEventListener('success',()=>resolve(request.result as Record<string,unknown>),{once:true})
      request.addEventListener('error',()=>reject(request.error),{once:true})
    })
    await transactionComplete(readTx)
    const writeTx=db.transaction(storeName,'readwrite')
    writeTx.objectStore(storeName).put({...sibling,status:'stale_writer_pending'})
    await transactionComplete(writeTx)

    const beforeTransition=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    await expect(local.store.advanceWriterGrantOperationBinding(
      local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id,beforeTransition.operation_generation,'prepared',{...operation,stage:'stale'},
    )).rejects.toThrow(/outbox MAC failed/)
    expect((await local.store.loadWriterGrantOperation(operation.operation_id)).stage).toBe('prepared')
    expect((await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)).writer_operation_state_ref?.state).toBe('prepared')
  },120_000)

  it('marks a prepared Handoff stale when any physical row lands after its authority anchor before append',async()=>{
    const createdAt='2026-09-23T12:55:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(44))
    const existing=v2.remote.snapshot.rows.at(-1)
    if(!existing)throw new Error('handoff remote prefix missing')
    v2.remote.injectBeforeNextAppend=[existing[0]!,existing[1]!,existing[2]!]
    const result=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff(descriptor)
    expect(result.stage).toBe('stale')
    const operation=await store.loadWriterGrantOperation(result.operationId)
    const after=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    expect(after.writer_status).toBe('writer_active')
    expect(after.writer_operation_state_ref?.state).toBe('stale')
    const ceremonyEntry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(entry=>entry.envelope_id===operation.prepared_envelope.envelope_id)
    expect(ceremonyEntry?.status).toBe('stale_writer_pending')
    expect(after.stale_writer_pending_count).toBeGreaterThanOrEqual(1)
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(recovered.payload.diary_id,recovered.payload.epoch_id,recovered.rootKey,v2.account)
    const canonical=(await codec.verifyRemote(await v2.remote.read('successor-v2'))).profileState as {dispositions:readonly {envelope_id:string;disposition:string}[]}
    expect(canonical.dispositions.find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)?.disposition).toBe('stale_grant_rejected')
  },120_000)

  it('quarantines an absent prepared Handoff Grant when the authority anchor advances before resume',async()=>{
    const createdAt='2026-09-23T12:56:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const recovered=await openRecoveryArtifactV6(v2.recovery,urs),epochSalt=await deriveEpochSaltV2(fromBase64Url(recovered.payload.diary_id),fromBase64Url(recovered.payload.epoch_id))
    const store=new IndexedDbV2LocalSecurityStore(),state=await store.loadState(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...state,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(47))
    let crashed=false
    await expect(new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared'&&!crashed){crashed=true;throw new Error('handoff-crash:prepared-for-stale')}
    }).handoff(descriptor)).rejects.toThrow('handoff-crash:prepared-for-stale')
    const operation=await store.loadBoundWriterGrantOperation(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('prepared Handoff operation missing')
    const existing=v2.remote.snapshot.rows.at(-1)
    if(!existing)throw new Error('handoff remote prefix missing')
    v2.remote.snapshot.rows.push([...existing])
    const resumed=await new ProductiveWriterHandoffV2Service(v2,store,()=>createdAt).handoff()
    expect(resumed.stage).toBe('stale')
    expect(v2.remote.snapshot.rows.some(row=>row[0]===operation.prepared_envelope.envelope_id)).toBe(false)
    const entry=(await store.outbox(recovered.rootKey,epochSalt,upgraded.successor_epoch_id)).find(item=>item.envelope_id===operation.prepared_envelope.envelope_id)
    expect(entry?.status).toBe('stale_writer_pending')
  },120_000)

  it('blocks Handoff on unresolved local domain work but permits the same row after terminal stale quarantine',async()=>{
    const createdAt='2026-09-23T12:57:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    if(!v2.remote||!v2.recovery)throw new Error('handoff fixture missing successor/recovery state')
    const local=await persistLocalPreparedDomainRow(v2,urs,createdAt)
    const current=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    const targetPair=await generateWriterDeviceKeyV2(),targetDeviceId=base64Url(randomBytes(16)),targetKey:StoredWriterDeviceKeyV2={writer_signing_key_id:targetPair.writerKeyId,writer_device_id:targetDeviceId,writer_public_key:base64Url(targetPair.publicKeyRaw),private_key:targetPair.privateKey}
    const descriptor=await createTransferDescriptorV2({...current,writer_status:'read_only',writer_device_id:targetDeviceId,writer_signing_key_id:targetPair.writerKeyId,writer_generation:null,writer_grant_id:null},targetKey,new Uint8Array(32).fill(48))
    await expect(new ProductiveWriterHandoffV2Service(v2,local.store,()=>createdAt).handoff(descriptor)).rejects.toThrow(/all local Writer envelopes/)
    const beforeQuarantine=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    await local.store.updateOutboxStatus(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id,local.envelope.envelopeId,beforeQuarantine.operation_generation,'stale_writer_pending')
    const result=await new ProductiveWriterHandoffV2Service(v2,local.store,()=>createdAt).handoff(descriptor)
    expect(result.stage).toBe('durable')
    const after=await local.store.loadState(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)
    expect(after.writer_status).toBe('read_only')
    const staleEntry=(await local.store.outbox(local.recovered.rootKey,local.epochSalt,upgraded.successor_epoch_id)).find(entry=>entry.envelope_id===local.envelope.envelopeId)
    expect(staleEntry?.status).toBe('stale_writer_pending')
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

  it('persists the freshest Confirmation retry prefix when a retry appears between activation reads',async()=>{
    const createdAt='2026-09-23T15:40:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation-append'&&!armed){armed=true;throw new Error('armed-confirmation-anchor-race')}
    }).upgrade()).rejects.toThrow('armed-confirmation-anchor-race')
    if(!v2.remote)throw new Error('successor missing in test fixture')
    const confirmation=v2.remote.snapshot.rows.at(-1)!
    v2.remote.afterNextRead=()=>{v2.remote!.snapshot.rows.push([...confirmation])}
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

  it('supersedes before activated Backup when the activated Successor is sealed by a valid v2 RotationAnnouncement',async()=>{
    const createdAt='2026-09-23T15:57:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    let armed=false
    await expect(new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt,point=>{
      if(point==='after-confirmation_durable'&&!armed){armed=true;throw new Error('armed-post-activation-seal')}
    }).upgrade()).rejects.toThrow('armed-post-activation-seal')
    if(!v2.remote)throw new Error('successor missing in test fixture')
    const sealRow=await prepareSealRow(v2,urs,createdAt)
    v2.remote.snapshot.rows.push([...sealRow])
    const result=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(result.stage).toBe('post_activation_superseded')
    expect(result.activated_backup_id).toBeNull()
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

  it('performs a productive native v2 to v2 normal rotation and carries Writer/Recovery authority',async()=>{
    const createdAt='2026-09-25T07:20:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const sourceEpochId=upgraded.successor_epoch_id
    const result=await new ProductiveNativeRotationV2Service(v2,urs,new IndexedDbV2LocalSecurityStore(),()=>createdAt).rotate('normal')
    expect(result.stage).toBe('switched')
    expect(result.rotation_kind).toBe('normal')
    expect(result.source_epoch_id).toBe(sourceEpochId)
    expect(result.successor_epoch_id).not.toBe(sourceEpochId)
    expect(v2.creates).toBe(2)
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(result.successor_epoch_id)

    const successorArtifact=await v2.loadRecoveryArtifact(urs,source.diaryId,result.successor_epoch_id)
    const successorRecovered=await openRecoveryArtifactV6(successorArtifact,urs)
    expect(successorRecovered.payload.activation_lineage).toHaveLength(2)
    expect(successorRecovered.payload.activation_lineage.at(-1)?.kind).toBe('v2_rotation')
    const successorSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(result.successor_epoch_id))
    const successorState=await new IndexedDbV2LocalSecurityStore().loadState(successorRecovered.rootKey,successorSalt,result.successor_epoch_id)
    expect(successorState.epoch_status).toBe('active')
    expect(successorState.writer_status).toBe('writer_active')
    expect(successorState.recovery_rekey_rotation_required).toBe(false)

    const sourceArtifact=await v2.loadRecoveryArtifact(urs,source.diaryId,sourceEpochId)
    const sourceRecovered=await openRecoveryArtifactV6(sourceArtifact,urs)
    const sourceSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(sourceEpochId))
    const sourceState=await new IndexedDbV2LocalSecurityStore().loadState(sourceRecovered.rootKey,sourceSalt,sourceEpochId)
    expect(sourceState.epoch_status).toBe('retired')
    expect(sourceState.writer_status).toBe('read_only')
  },120_000)

  it('resumes native v2 rotation after crashing immediately after the durable Source freeze',async()=>{
    const createdAt='2026-09-25T07:25:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt,async point=>{
      if(point==='after-source-freeze'&&!crashed){crashed=true;throw new Error('native-rotation-crash:source-freeze')}
    }).rotate('normal')).rejects.toThrow('native-rotation-crash:source-freeze')
    const selectedBefore=await activeProtocolSelectionV2()
    if(!selectedBefore)throw new Error('active v2 source selection missing after injected crash')
    const sourceArtifact=await v2.loadRecoveryArtifact(urs,source.diaryId,selectedBefore.epoch_id)
    const sourceRecovered=await openRecoveryArtifactV6(sourceArtifact,urs),sourceSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(selectedBefore.epoch_id))
    const frozen=await store.loadState(sourceRecovered.rootKey,sourceSalt,selectedBefore.epoch_id)
    expect(frozen.rotation_state_ref?.state).toBe('source_frozen_verified')

    const resumed=await new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt).rotate('normal')
    expect(resumed.stage).toBe('switched')
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(resumed.successor_epoch_id)
  },120_000)

  it('completes two-phase Recovery-Rekey through mandatory recovery_rekey successor rotation',async()=>{
    const createdAt='2026-09-25T07:30:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const sourceEpochId=upgraded.successor_epoch_id
    const result=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(result.stage).toBe('completed')
    expect(result.toRecoveryGeneration).toBe(1)
    expect(result.successorEpochId).not.toBeNull()
    expect(result.successorEpochId).not.toBe(sourceEpochId)
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(result.successorEpochId)

    const successorArtifact=await v2.loadRecoveryArtifact(newUrs,source.diaryId,result.successorEpochId!)
    const successorRecovered=await openRecoveryArtifactV6(successorArtifact,newUrs)
    expect(successorRecovered.payload.recovery_generation).toBe(1)
    await expect(openRecoveryArtifactV6(successorArtifact,urs)).rejects.toBeTruthy()
    const successorSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(result.successorEpochId!))
    const successorState=await store.loadState(successorRecovered.rootKey,successorSalt,result.successorEpochId!)
    expect(successorState.epoch_status).toBe('active')
    expect(successorState.recovery_generation).toBe(1)
    expect(successorState.recovery_rekey_rotation_required).toBe(false)

    const sourceArtifact=await v2.loadRecoveryArtifact(newUrs,source.diaryId,sourceEpochId)
    const sourceRecovered=await openRecoveryArtifactV6(sourceArtifact,newUrs),sourceSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(sourceEpochId))
    const operation=await store.loadRecoveryRekeyOperation(result.operationId)
    expect(operation.stage).toBe('completed')
    expect(operation.completed_successor_epoch_id).toBe(result.successorEpochId)
    const sourceState=await store.loadState(sourceRecovered.rootKey,sourceSalt,sourceEpochId)
    expect(sourceState.epoch_status).toBe('retired')
  },120_000)

  it('resumes Recovery-Rekey from the exact prepared bundle after crash',async()=>{
    const createdAt='2026-09-25T07:35:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared-bundle'&&!crashed){crashed=true;throw new Error('rekey-crash:prepared')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:prepared')

    const sourceArtifact=await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id)
    const recovered=await openRecoveryArtifactV6(sourceArtifact,urs),salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const prepared=await store.loadBoundRecoveryRekeyOperation(recovered.rootKey,salt,upgraded.successor_epoch_id)
    if(!prepared)throw new Error('prepared Recovery-Rekey operation missing')
    expect(prepared.stage).toBe('new_material_staged')
    expect(prepared.artifact_publish_attempted).toBe(false)
    const exactTransition={...prepared.transition_envelope}

    const resumed=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(resumed.stage).toBe('completed')
    const finalOperation=await store.loadRecoveryRekeyOperation(prepared.operation_id)
    expect(finalOperation.transition_envelope).toEqual(exactTransition)
    expect(finalOperation.stage).toBe('completed')
  },120_000)


  it('keeps Recovery-Rekey ceremony disposition exclusively owned when generic Coordinator pulls the accepted transition',async()=>{
    const createdAt='2026-09-25T07:40:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-transition-append'&&!crashed){crashed=true;throw new Error('rekey-crash:after-transition-append')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:after-transition-append')

    const newArtifact=await v2.loadRecoveryArtifact(newUrs,source.diaryId,upgraded.successor_epoch_id)
    const opened=await openRecoveryArtifactV6(newArtifact,newUrs),salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const operation=await store.loadBoundRecoveryRekeyOperation(opened.rootKey,salt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('Recovery-Rekey operation missing after transition append crash')
    const beforeEntry=(await store.outbox(opened.rootKey,salt,upgraded.successor_epoch_id)).find(entry=>entry.envelope_id===operation.transition_envelope.envelope_id)
    expect(beforeEntry?.ceremony_owner).toBe('recovery_rekey')
    expect(beforeEntry?.status).toBe('prepared')

    const remote=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id)
    const codec=await v2.codecForEpoch(source.diaryId,upgraded.successor_epoch_id,opened.rootKey,remote)
    const verified=await codec.verifyRemote(await remote.read((remote as unknown as MemoryTransport).remoteId))
    const canonical=verified.profileState as CanonicalFullResultV2
    expect(verified.acceptedEnvelopeIds.has(operation.transition_envelope.envelope_id)).toBe(true)
    const state=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    const coordinator=new IndexedDbV2CoordinatorStore(upgraded.successor_epoch_id,opened.rootKey,salt,store)
    await coordinator.commitVerifiedPull(verified,canonical.remote_anchor,state.operation_generation)
    const afterGenericPull=(await store.outbox(opened.rootKey,salt,upgraded.successor_epoch_id)).find(entry=>entry.envelope_id===operation.transition_envelope.envelope_id)
    expect(afterGenericPull?.status).toBe('prepared')
    const reconciledState=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    const stillPending=await store.loadRecoveryRekeyOperation(operation.operation_id)
    expect(['transition_pending','transition_unknown']).toContain(stillPending.stage)
    await expect(store.advanceRecoveryRekeyOperationBinding(
      opened.rootKey,salt,upgraded.successor_epoch_id,reconciledState.operation_generation,stillPending.stage,{...stillPending,stage:'stale'},
    )).rejects.toThrow(/current Recovery transition cannot be terminalized as stale/)
    expect((await store.loadRecoveryRekeyOperation(operation.operation_id)).stage).toBe(stillPending.stage)

    const syntheticSuperseding={...stillPending,
      operation_id:base64Url(randomBytes(32)),operation_origin:'local_rekey' as const,stage:'new_material_staged' as const,
      supersedes_transition_id:stillPending.transition_id,superseded_by_transition_id:null,transition_id:base64Url(randomBytes(32)),
      artifact_publish_attempted:false,completed_successor_epoch_id:null,completed_successor_manifest_fingerprint:null,
    }
    await expect(store.initializeRecoveryRekeyOperationBinding(
      opened.rootKey,salt,reconciledState.operation_generation,syntheticSuperseding,
    )).rejects.toThrow(/post-durable pending operation/)
    expect((await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)).recovery_operation_state_ref?.operation_id).toBe(operation.operation_id)

    const resumed=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(resumed.stage).toBe('completed')
  },120_000)

  it('rejects direct recovery_rekey Source-rotation persistence without exact successor_rotation_required Phase-A state',async()=>{
    const createdAt='2026-09-25T07:45:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const artifact=await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),opened=await openRecoveryArtifactV6(artifact,urs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const state=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    if(!state.remote_anchor)throw new Error('active v2 source anchor missing')
    const operation:RotationOperationStateV2={
      format:'rotation-operation-v2',version:2,operation_id:base64Url(randomBytes(32)),rotation_kind:'recovery_rekey',
      source_epoch_id:upgraded.successor_epoch_id,successor_epoch_id:base64Url(randomBytes(16)),stage:'source_frozen_verified',
      source_anchor_before_announcement:{...state.remote_anchor},successor_staging_anchor:null,successor_activation_anchor:null,
      successor_creation_locator:null,successor_manifest_fingerprint:null,source_recovery_transition_id:base64Url(randomBytes(32)),
      activation_lineage_sha256:null,announcement_envelope:null,confirmation_envelope:null,activation_evidence_sha256:null,
      recovery_artifact_id:null,recovery_artifact_locator:null,recovery_artifact_sha256:null,staged_backup_id:null,activated_backup_id:null,
    }
    await expect(store.initializeNativeSourceRotationBundle({
      rootKey:opened.rootKey,epochSalt:salt,expectedOperationGeneration:state.operation_generation,
      operation,artifactId:`test-direct-rekey-rotation:${operation.operation_id}`,artifactValue:{kind:'invalid-direct-rekey-rotation'},
    })).rejects.toThrow(/authenticated current transition|Recovery-rekey/)
    const after=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    expect(after.rotation_state_ref).not.toMatchObject({operation_id:operation.operation_id})
  },120_000)


  it('does not keep normal writes fenced solely by a terminal stale Recovery-Rekey operation ref',async()=>{
    const createdAt='2026-09-25T07:50:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const artifact=await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),opened=await openRecoveryArtifactV6(artifact,urs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const state=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    const remote=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id),codec=await v2.codecForEpoch(source.diaryId,upgraded.successor_epoch_id,opened.rootKey,remote)
    const verified=await codec.verifyRemote(await remote.read((remote as unknown as MemoryTransport).remoteId))
    const terminal:EpochLocalSecurityStateV6={...state,recovery_operation_state_ref:{operation_id:base64Url(randomBytes(32)),state:'stale',state_record_hash:base64Url(randomBytes(32))}}
    const terminalAuthority=new TransferableSingleWriterV2WriteAuthority(()=>terminal,()=>null)
    expect(await terminalAuthority.canPrepareDomainWrite(verified)).toBe('writer')
    const nonTerminal:EpochLocalSecurityStateV6={...state,recovery_operation_state_ref:{operation_id:base64Url(randomBytes(32)),state:'transition_durable',state_record_hash:base64Url(randomBytes(32))}}
    const blockedAuthority=new TransferableSingleWriterV2WriteAuthority(()=>nonTerminal,()=>null)
    expect(await blockedAuthority.canPrepareDomainWrite(verified)).toBe('read_only')
  },120_000)


  it('resumes Recovery-Rekey after the durable artifact-publish-attempt fence without regenerating the operation',async()=>{
    const createdAt='2026-09-25T07:55:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-publish-attempt-fence'&&!crashed){crashed=true;throw new Error('rekey-crash:publish-fence')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:publish-fence')

    const oldArtifact=await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id)
    const oldOpened=await openRecoveryArtifactV6(oldArtifact,urs),salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const operation=await store.loadBoundRecoveryRekeyOperation(oldOpened.rootKey,salt,upgraded.successor_epoch_id)
    if(!operation)throw new Error('Recovery-Rekey operation missing after publish-attempt fence crash')
    expect(operation.stage).toBe('new_material_staged')
    expect(operation.artifact_publish_attempted).toBe(true)
    const operationId=operation.operation_id,artifactSha=operation.recovery_artifact_sha256,transition={...operation.transition_envelope}

    const resumed=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(resumed.stage).toBe('completed')
    expect(resumed.operationId).toBe(operationId)
    const final=await store.loadRecoveryRekeyOperation(operationId)
    expect(final.recovery_artifact_sha256).toBe(artifactSha)
    expect(final.transition_envelope).toEqual(transition)
  },120_000)

  it('stales a native rotation if the Source physical prefix advances after staged backup but before Announcement',async()=>{
    const createdAt='2026-09-25T08:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt,async point=>{
      if(point==='after-staged_backup_verified'&&!crashed){crashed=true;throw new Error('native-rotation-crash:staged-backup')}
    }).rotate('normal')).rejects.toThrow('native-rotation-crash:staged-backup')

    const sourceTransport=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id) as unknown as MemoryTransport
    const duplicate=sourceTransport.snapshot.rows[0]
    if(!duplicate||duplicate.length!==3)throw new Error('active v2 source has no row to use as physical retry')
    await sourceTransport.append(sourceTransport.remoteId,[duplicate[0]!,duplicate[1]!,duplicate[2]!])

    const result=await new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt).rotate('normal')
    expect(result.stage).toBe('stale')
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(upgraded.successor_epoch_id)
    const successorArtifact=await v2.findRecoveryArtifact(urs,source.diaryId,result.successor_epoch_id)
    expect(successorArtifact).not.toBeNull()
    const successorOpened=await openRecoveryArtifactV6(successorArtifact!,urs),successorSalt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(result.successor_epoch_id))
    const successorState=await store.loadState(successorOpened.rootKey,successorSalt,result.successor_epoch_id)
    expect(successorState.epoch_status).toBe('orphaned')
    expect(successorState.writer_status).toBe('read_only')
  },120_000)

  it('adopts a canonically durable Pending-Rekey after local RecoveryRekey operation metadata is lost',async()=>{
    const createdAt='2026-09-25T08:05:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-transition-durable'&&!crashed){crashed=true;throw new Error('rekey-crash:transition-durable')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:transition-durable')

    const newArtifact=await v2.loadRecoveryArtifact(newUrs,source.diaryId,upgraded.successor_epoch_id),opened=await openRecoveryArtifactV6(newArtifact,newUrs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const pending=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    expect(pending.recovery_rekey_rotation_required).toBe(true)
    expect(pending.recovery_operation_state_ref?.state).toBe('transition_durable')
    await store.replaceState(opened.rootKey,salt,pending.operation_generation,{...pending,operation_generation:pending.operation_generation+1,recovery_operation_state_ref:null})

    const adopted=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).adoptPending(newUrs)
    expect(adopted.stage).toBe('completed')
    expect(adopted.successorEpochId).not.toBeNull()
    const adoptedOperation=await store.loadRecoveryRekeyOperation(adopted.operationId)
    expect(adoptedOperation.operation_origin).toBe('remote_pending_rekey_adoption')
    expect(adoptedOperation.stage).toBe('completed')
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(adopted.successorEpochId)
  },120_000)


  it('completes Pending-Rekey after full device loss via fresh Join, Forced Takeover, adoption and Phase B',async()=>{
    const createdAt='2026-09-25T08:10:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-transition-durable'&&!crashed){crashed=true;throw new Error('rekey-crash:device-loss')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:device-loss')

    const sourceRemote=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id),sourceCodec=await v2.codecForEpoch(source.diaryId,upgraded.successor_epoch_id,(await openRecoveryArtifactV6(await v2.loadRecoveryArtifact(newUrs,source.diaryId,upgraded.successor_epoch_id),newUrs)).rootKey,sourceRemote)
    const pendingRemote=(await sourceCodec.verifyRemote(await sourceRemote.read((sourceRemote as unknown as MemoryTransport).remoteId))).profileState as CanonicalFullResultV2
    expect(pendingRemote.current_recovery.recovery_rekey_rotation_required).toBe(true)

    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    globalThis.localStorage?.clear?.()

    const replacementStore=new IndexedDbV2LocalSecurityStore()
    const joined=await joinExistingV2Diary(v2,newUrs)
    expect(joined.epochId).toBe(upgraded.successor_epoch_id)
    const replacementState=await replacementStore.loadState((await openRecoveryArtifactV6(await v2.loadRecoveryArtifact(newUrs,source.diaryId,upgraded.successor_epoch_id),newUrs)).rootKey,await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id)),upgraded.successor_epoch_id)
    expect(replacementState.writer_status).toBe('read_only')
    expect(replacementState.recovery_rekey_rotation_required).toBe(true)
    expect(await remoteSessionStatus()).toMatchObject({profile:'v2',writerStatus:'read_only',recoveryRekeyRequired:true})

    const takeover=await forceTakeoverV2(v2,newUrs)
    expect(takeover.stage).toBe('durable')
    expect(takeover.maintenanceOnly).toBe(true)
    expect(await remoteSessionStatus()).toMatchObject({profile:'v2',writerStatus:'writer_active',recoveryRekeyRequired:true})

    const adopted=await continuePendingRecoveryRekeyV2(v2,newUrs)
    expect(adopted.stage).toBe('completed')
    expect(adopted.successorEpochId).not.toBeNull()
    expect(await remoteSessionStatus()).toMatchObject({profile:'v2',writerStatus:'writer_active',recoveryRekeyRequired:false})
    const adoptedOperation=await replacementStore.loadRecoveryRekeyOperation(adopted.operationId)
    expect(adoptedOperation.operation_origin).toBe('remote_pending_rekey_adoption')
    expect(adoptedOperation.stage).toBe('completed')
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(adopted.successorEpochId)
  },120_000)


  it('atomically supersedes an older durable Recovery-Rekey when a newer transition becomes canonical',async()=>{
    const createdAt='2026-09-25T08:15:00.000Z',urs=randomBytes(32),firstUrs=randomBytes(32),secondUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-transition-durable'&&!crashed){crashed=true;throw new Error('rekey-crash:first-durable')}
    }).rekey(firstUrs)).rejects.toThrow('rekey-crash:first-durable')

    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('active v2 source missing after first durable rekey')
    const firstArtifact=await v2.loadRecoveryArtifact(firstUrs,source.diaryId,selection.epoch_id),firstOpened=await openRecoveryArtifactV6(firstArtifact,firstUrs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(selection.epoch_id))
    const firstOperation=await store.loadBoundRecoveryRekeyOperation(firstOpened.rootKey,salt,selection.epoch_id)
    if(!firstOperation)throw new Error('first durable Recovery-Rekey operation missing')
    expect(firstOperation.stage).toBe('transition_durable')

    const second=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(secondUrs)
    expect(second.stage).toBe('completed')
    const superseded=await store.loadRecoveryRekeyOperation(firstOperation.operation_id)
    expect(superseded.stage).toBe('superseded')
    expect(superseded.superseded_by_transition_id).toBe(second.transitionId)
    const secondOperation=await store.loadRecoveryRekeyOperation(second.operationId)
    expect(secondOperation.supersedes_transition_id).toBe(firstOperation.transition_id)
    expect(secondOperation.stage).toBe('completed')
    expect((await activeProtocolSelectionV2())?.epoch_id).toBe(second.successorEpochId)
  },120_000)

  it('rebinds the older durable Recovery-Rekey when a newer superseding transition loses its immediate-prefix race',async()=>{
    const createdAt='2026-09-25T08:20:00.000Z',urs=randomBytes(32),firstUrs=randomBytes(32),secondUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-transition-durable'&&!crashed){crashed=true;throw new Error('rekey-crash:first-durable-race')}
    }).rekey(firstUrs)).rejects.toThrow('rekey-crash:first-durable-race')

    const firstArtifact=await v2.loadRecoveryArtifact(firstUrs,source.diaryId,upgraded.successor_epoch_id),firstOpened=await openRecoveryArtifactV6(firstArtifact,firstUrs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const firstOperation=await store.loadBoundRecoveryRekeyOperation(firstOpened.rootKey,salt,upgraded.successor_epoch_id)
    if(!firstOperation)throw new Error('first durable Recovery-Rekey operation missing before race')
    expect(firstOperation.stage).toBe('transition_durable')

    const transport=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id) as unknown as MemoryTransport
    const duplicate=transport.snapshot.rows.at(-1)
    if(!duplicate||duplicate.length!==3)throw new Error('source has no durable row for supersession race injection')
    transport.injectBeforeNextAppend=[duplicate[0]!,duplicate[1]!,duplicate[2]!]
    const second=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(secondUrs)
    expect(second.stage).toBe('stale')
    const secondOperation=await store.loadRecoveryRekeyOperation(second.operationId)
    expect(secondOperation.supersedes_transition_id).toBe(firstOperation.transition_id)
    expect(secondOperation.stage).toBe('stale')
    const rebound=await store.loadBoundRecoveryRekeyOperation(firstOpened.rootKey,salt,upgraded.successor_epoch_id)
    expect(rebound?.operation_id).toBe(firstOperation.operation_id)
    expect(rebound?.stage).toBe('transition_durable')

    const resumedFirst=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(firstUrs)
    expect(resumedFirst.stage).toBe('completed')
    expect(resumedFirst.operationId).toBe(firstOperation.operation_id)
  },120_000)


  it('allows only the exact pre-publish Recovery-Rekey abort to terminal stale without setting the publish fence',async()=>{
    const createdAt='2026-09-25T08:25:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let crashed=false
    await expect(new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt,async point=>{
      if(point==='after-prepared-bundle'&&!crashed){crashed=true;throw new Error('rekey-crash:abort-before-publish')}
    }).rekey(newUrs)).rejects.toThrow('rekey-crash:abort-before-publish')

    const artifact=await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),opened=await openRecoveryArtifactV6(artifact,urs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(upgraded.successor_epoch_id))
    const state=await store.loadState(opened.rootKey,salt,upgraded.successor_epoch_id)
    const prepared=await store.loadBoundRecoveryRekeyOperation(opened.rootKey,salt,upgraded.successor_epoch_id)
    if(!prepared)throw new Error('prepared Recovery-Rekey operation missing for pre-publish abort')
    expect(prepared.stage).toBe('new_material_staged')
    expect(prepared.artifact_publish_attempted).toBe(false)
    await store.advanceRecoveryRekeyOperationBinding(
      opened.rootKey,salt,upgraded.successor_epoch_id,state.operation_generation,'new_material_staged',{...prepared,stage:'stale'},
    )
    const stale=await store.loadRecoveryRekeyOperation(prepared.operation_id)
    expect(stale.stage).toBe('stale')
    expect(stale.artifact_publish_attempted).toBe(false)
  },120_000)


  it('retries exact Recovery-Rekey transition bytes on a later resume after unresolved no-commit unknown outcomes',async()=>{
    const createdAt='2026-09-25T08:30:00.000Z',urs=randomBytes(32),newUrs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const sourceTransport=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id) as unknown as MemoryTransport
    sourceTransport.unknownWithoutAppend=2

    const first=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(first.stage).toBe('transition_unknown')
    const firstOperation=await store.loadRecoveryRekeyOperation(first.operationId)
    expect(firstOperation.stage).toBe('transition_unknown')
    expect(sourceTransport.snapshot.rows.some(row=>row[0]===firstOperation.transition_envelope.envelope_id)).toBe(false)

    const resumed=await new ProductiveRecoveryRekeyV2Service(v2,store,()=>createdAt).rekey(newUrs)
    expect(resumed.stage).toBe('completed')
    expect(resumed.operationId).toBe(first.operationId)
    expect(sourceTransport.snapshot.rows.filter(row=>row[0]===firstOperation.transition_envelope.envelope_id)).toHaveLength(1)
  },120_000)

  it('resumes a persisted native Announcement unknown state with one fresh exact-byte append',async()=>{
    const createdAt='2026-09-25T08:35:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const sourceTransport=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id) as unknown as MemoryTransport
    const service=new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt,point=>{
      if(point==='after-staged_backup_verified')sourceTransport.unknownWithoutAppend=2
    })
    const unresolved=await service.rotate('normal')
    expect(unresolved.stage).toBe('announcement_unknown')
    if(!unresolved.announcement_envelope)throw new Error('unknown Announcement operation lost its prepared envelope')
    expect(sourceTransport.snapshot.rows.some(row=>row[0]===unresolved.announcement_envelope!.envelope_id)).toBe(false)

    const resumed=await new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt).rotate('normal')
    expect(resumed.stage).toBe('switched')
    expect(resumed.operation_id).toBe(unresolved.operation_id)
    expect(sourceTransport.snapshot.rows.filter(row=>row[0]===unresolved.announcement_envelope!.envelope_id)).toHaveLength(1)
  },120_000)

  it('resumes a persisted native Confirmation unknown state with one fresh exact-byte append',async()=>{
    const createdAt='2026-09-25T08:40:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    let armed=false
    const service=new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt,point=>{
      if(point==='after-announcement_durable'&&!armed){
        armed=true
        if(!v2.remote)throw new Error('native Successor transport missing at Confirmation fault point')
        v2.remote.unknownWithoutAppend=2
      }
    })
    const unresolved=await service.rotate('normal')
    expect(unresolved.stage).toBe('confirmation_unknown')
    if(!unresolved.confirmation_envelope||!v2.remote)throw new Error('unknown Confirmation operation lost its prepared envelope/Successor')
    expect(v2.remote.snapshot.rows.some(row=>row[0]===unresolved.confirmation_envelope!.envelope_id)).toBe(false)

    const resumed=await new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt).rotate('normal')
    expect(resumed.stage).toBe('switched')
    expect(resumed.operation_id).toBe(unresolved.operation_id)
    expect(v2.remote.snapshot.rows.filter(row=>row[0]===unresolved.confirmation_envelope!.envelope_id)).toHaveLength(1)
  },120_000)

  it('rechecks the Successor before Announcement retry and refuses Source seal after an intervening Successor row',async()=>{
    const createdAt='2026-09-25T08:45:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session(),store=new IndexedDbV2LocalSecurityStore();v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    const sourceTransport=await v2.transportForEpoch(source.diaryId,upgraded.successor_epoch_id) as unknown as MemoryTransport
    let armed=false
    const result=await new ProductiveNativeRotationV2Service(v2,urs,store,()=>createdAt,point=>{
      if(point==='after-staged_backup_verified'&&!armed){
        armed=true
        if(!v2.remote)throw new Error('native Successor transport missing at Announcement fault point')
        const successor=v2.remote
        const duplicate=successor.snapshot.rows.at(-1)
        if(!duplicate||duplicate.length!==3)throw new Error('native Successor has no staging row for race injection')
        sourceTransport.unknownWithoutAppend=1
        sourceTransport.onUnknownWithoutAppend=()=>{successor.snapshot.rows.push([duplicate[0]!,duplicate[1]!,duplicate[2]!])}
      }
    }).rotate('normal')
    expect(result.stage).toBe('stale')
    if(!result.announcement_envelope)throw new Error('stale native rotation lost its Announcement envelope')
    expect(sourceTransport.snapshot.rows.some(row=>row[0]===result.announcement_envelope!.envelope_id)).toBe(false)
    const verified=await (await v2.codecForEpoch(source.diaryId,upgraded.successor_epoch_id,(await openRecoveryArtifactV6(await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),urs)).rootKey,sourceTransport)).verifyRemote(await sourceTransport.read(sourceTransport.remoteId))
    const canonical=verified.profileState as CanonicalFullResultV2
    expect(canonical.source_epoch_sealed).toBe(false)
  },120_000)


  it('routes the existing pain repository through v2 Writer authority and materializes the durable result offline',async()=>{
    const createdAt='2026-09-25T09:00:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    await installAuthenticatedRemoteSession(v2)
    if(!v2.remote)throw new Error('v2 active remote missing after profile upgrade')
    const beforeRows=v2.remote.snapshot.rows.length

    await createPainEntry({
      startedAt:'2026-09-25T09:01:00.000Z',
      intensity:7,
      locations:[],
      qualities:['stechend'],
      cause:'integration',
      occursWhen:'test',
      note:'v2 app routing',
    })
    expect(v2.remote.snapshot.rows.length).toBeGreaterThan(beforeRows)

    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(source.diaryId,upgraded.successor_epoch_id,(await openRecoveryArtifactV6(await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),urs)).rootKey,v2.account)
    const canonical=(await codec.verifyRemote(v2.remote.snapshot)).profileState as CanonicalFullResultV2
    const matching=[...canonical.accepted_revision_graph.revisions.values()].filter(revision=>revision.record_type==='pain_entry'&&revision.record_data&&typeof revision.record_data==='object'&&(revision.record_data as {note?:unknown}).note==='v2 app routing')
    expect(matching).toHaveLength(1)
    expect(matching[0]?.writer_context?.writer_generation).toBe(canonical.current_writer.writer_generation)

    await clearAuthenticatedRemoteSession()
    const offline=await listPainEntries({includeDeleted:true})
    expect(offline.some(entry=>entry.id===matching[0]!.record_id&&entry.note==='v2 app routing'&&entry.intensity===7)).toBe(true)
  },120_000)

  it('blocks the existing pain repository on a read-only joined device before persisting any new v2 envelope',async()=>{
    const createdAt='2026-09-25T09:05:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')

    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    __v2ApplicationRuntimeTesting.reset()
    globalThis.localStorage?.clear?.()

    const joined=await new ProductiveReadOnlyJoinV2Service(v2).join(urs)
    expect(joined.epochId).toBe(upgraded.successor_epoch_id)
    await installAuthenticatedRemoteSession(v2)
    const localStore=new IndexedDbV2LocalSecurityStore()
    const before=(await localStore.envelopes(joined.epochId)).length
    await expect(createPainEntry({intensity:5,note:'must-not-persist'})).rejects.toThrow(/read-only|authority|writer/i)
    const after=(await localStore.envelopes(joined.epochId)).length
    expect(after).toBe(before)
    expect((await listPainEntries({includeDeleted:true})).some(entry=>entry.note==='must-not-persist')).toBe(false)
  },120_000)

  it('fails closed when the authenticated v2 offline read-model index is tampered',async()=>{
    const createdAt='2026-09-25T09:10:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    await installAuthenticatedRemoteSession(v2)
    await createPainEntry({intensity:3,note:'read-model-tamper'})
    await clearAuthenticatedRemoteSession()

    const db=await __v2LocalPersistenceTesting.openDatabase(),tx=db.transaction(__v2LocalPersistenceTesting.STORES.readModels,'readwrite')
    const store=tx.objectStore(__v2LocalPersistenceTesting.STORES.readModels)
    const request=store.get(upgraded.successor_epoch_id)
    const model=await new Promise<Record<string,unknown>>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result as Record<string,unknown>);request.onerror=()=>reject(request.error)})
    store.put({...model,tag:base64Url(new Uint8Array(32).fill(201))})
    await transactionComplete(tx)
    await expect(listPainEntries({includeDeleted:true})).rejects.toThrow(/read-model MAC failed/)
  },120_000)


  it('does not import a foreign physical stale-writer row into a fresh read-only device outbox',async()=>{
    const createdAt='2026-09-25T09:15:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    await appendPostActivationHandoff(v2,urs,'2026-09-25T09:16:00.000Z')
    const staleRow=await appendPostActivationDomainRow(v2,urs,'2026-09-25T09:17:00.000Z')
    if(!v2.remote)throw new Error('v2 remote missing for foreign stale-row regression')
    const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(source.diaryId,upgraded.successor_epoch_id,(await openRecoveryArtifactV6(await v2.loadRecoveryArtifact(urs,source.diaryId,upgraded.successor_epoch_id),urs)).rootKey,v2.account)
    const remoteVerified=await codec.verifyRemote(v2.remote.snapshot)
    expect(remoteVerified.staleWriterEnvelopeIds.has(staleRow[0])).toBe(true)

    await __localDatabaseTesting.resetForTesting()
    await __v2LocalPersistenceTesting.reset()
    await deleteDatabase('eds-diary')
    await deleteDatabase('eds-diary-v2-security')
    __v2ApplicationRuntimeTesting.reset()
    globalThis.localStorage?.clear?.()

    const joined=await new ProductiveReadOnlyJoinV2Service(v2).join(urs)
    await installAuthenticatedRemoteSession(v2)
    const artifact=await v2.loadRecoveryArtifact(urs,source.diaryId,joined.epochId),opened=await openRecoveryArtifactV6(artifact,urs)
    const salt=await deriveEpochSaltV2(fromBase64Url(source.diaryId),fromBase64Url(joined.epochId)),store=new IndexedDbV2LocalSecurityStore()
    const state=await store.loadState(opened.rootKey,salt,joined.epochId)
    expect(state.stale_writer_pending_count).toBe(0)
    expect((await store.envelopes(joined.epochId)).some(envelope=>envelope.envelopeId===staleRow[0])).toBe(false)
    expect((await store.outbox(opened.rootKey,salt,joined.epochId)).some(entry=>entry.envelope_id===staleRow[0])).toBe(false)
  },120_000)


  it('routes passphrase protection to the active v2 RootWrapV6 and the retained same-diary v1 source',async()=>{
    const createdAt='2026-09-26T07:10:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    expect(await localRootWrapStatus()).toMatchObject({mode:'best-effort',locked:false})

    await enrollActivePassphraseRootWrap('v2-local-passphrase')
    expect(await localRootWrapStatus()).toMatchObject({mode:'passphrase',locked:false})

    const v2Wrap=await new IndexedDbV2LocalSecurityStore().loadRootWrapV6(upgraded.successor_epoch_id)
    expect(v2Wrap.wrap.mode).toBe('passphrase')
    expect(v2Wrap.bestEffortWrappingKey).toBeNull()

    const db=await __localDatabaseTesting.openDatabase(),contextTx=db.transaction(__localDatabaseTesting.STORES.context,'readonly')
    const contextRequest=contextTx.objectStore(__localDatabaseTesting.STORES.context).get('active')
    const context=await new Promise<{epochId:string}>((resolve,reject)=>{contextRequest.onsuccess=()=>resolve(contextRequest.result as {epochId:string});contextRequest.onerror=()=>reject(contextRequest.error)})
    await transactionComplete(contextTx)
    const wrapTx=db.transaction(__localDatabaseTesting.STORES.wraps,'readonly'),wrapRequest=wrapTx.objectStore(__localDatabaseTesting.STORES.wraps).get(context.epochId)
    const retained=await new Promise<{wrap:{mode:string}}>((resolve,reject)=>{wrapRequest.onsuccess=()=>resolve(wrapRequest.result as {wrap:{mode:string}});wrapRequest.onerror=()=>reject(wrapRequest.error)})
    await transactionComplete(wrapTx)
    expect(retained.wrap.mode).toBe('passphrase')

    await lockActiveRoot()
    expect(await localRootWrapStatus()).toMatchObject({mode:'passphrase',locked:true})
    await expect(unlockActiveRootWithPassphrase('wrong-passphrase')).rejects.toThrow()
    await unlockActiveRootWithPassphrase('v2-local-passphrase')
    expect(await localRootWrapStatus()).toMatchObject({mode:'passphrase',locked:false})
  },120_000)

  it('routes WebAuthn-PRF protection and unlock to the active v2 RootWrapV6',async()=>{
    const createdAt='2026-09-26T07:15:00.000Z',urs=randomBytes(32),source=await seedV1Source(urs,createdAt),v2=new V2Session()
    v2.registerV1Epoch(source.sourceEpochId,source.transport)
    const upgraded=await new ProductiveProfileUpgradeV2Service(source.session,source.transport,v2,urs,()=>createdAt).upgrade()
    expect(upgraded.stage).toBe('switched')
    const material={credentialId:randomBytes(24),prfEvalInput:randomBytes(32),prfOutput:randomBytes(32),rpId:'example.test'}
    await enrollActivePrfRootWrap(material)
    const status=await localRootWrapStatus()
    expect(status).toMatchObject({mode:'prf',locked:false,rpId:'example.test'})
    expect(status.credentialId).toBe(base64Url(material.credentialId))

    const v2Wrap=await new IndexedDbV2LocalSecurityStore().loadRootWrapV6(upgraded.successor_epoch_id)
    expect(v2Wrap.wrap.mode).toBe('prf')
    expect(v2Wrap.bestEffortWrappingKey).toBeNull()

    await lockActiveRoot()
    expect(await localRootWrapStatus()).toMatchObject({mode:'prf',locked:true})
    await expect(unlockActiveRootWithPrf(randomBytes(24),material.prfOutput)).rejects.toThrow(/credential/i)
    await unlockActiveRootWithPrf(material.credentialId,material.prfOutput)
    expect(await localRootWrapStatus()).toMatchObject({mode:'prf',locked:false})
  },120_000)

})
