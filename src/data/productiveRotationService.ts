import { createBackup, testRestoreBackup, type SyncBackupV5 } from '../security/backup'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { deriveEpochSalt, randomBytes, recoveryCommitment, sha256 } from '../security/crypto/core'
import { envelopeRow, openEnvelope, type PreparedEnvelope } from '../security/envelopes'
import { manifestFingerprint, prepareManifest, schemaRegistryHash, SCHEMA_ALLOWLIST, type ProtectedManifestV1 } from '../security/manifest'
import { activateRecoveredRoot, createRecovery, recoverRootKeyCandidate, type RecoveryArtifact } from '../security/recovery'
import { createEpochMigrationData, runRotation, type ProductiveRotationState, type RotationOrchestratorDependencies, type RotationPersistence, type RotationState } from '../security/rotation'
import { validateRevisionGraphV1, type RevisionV1 } from '../security/revisions'
import { journalInitial, type EpochLocalSecurityStateV5 } from '../security/localState'
import { runCreationStateMachine, type CreationState } from '../sync/core/creation'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import { createAnchorV1, type RemoteAnchorV1 } from '../sync/core/prefix'
import { SingleWriterV1RemoteVerifier, RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'
import { singleWriterV1WriteAuthority } from '../sync/core/writeAuthority'
import { SINGLE_WRITER_V1_PROFILE, TransportError, type RemoteTransport } from '../sync/core/contracts'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import { DOMAIN_SCHEMA_REGISTRY, IndexedDbCoordinatorStore, IndexedDbRotationRepository, indexedDbCreationPersistence, indexedDbRotationPersistence, type EpochContext, type VerifiedEpochMaterial } from './localDatabase'
import { persistRecoveredProfile } from './recoveryProfile'

interface ConcreteRotationState extends ProductiveRotationState {newKeyId:string;newWrapId:string;creationLocator:string;successorManifestFingerprint:string;createdAt:string;migrationKind:'normal'|'remote_enablement'|'recovery_rekey';recoveryGeneration?:number}
export interface CompletedRotation {state:ProductiveRotationState;recovery:RecoveryArtifact;backup:SyncBackupV5}
export type ProductiveRotationFaultPoint =
  | 'after-root-wrap'
  | 'after-freeze'
  | 'after-source-snapshot'
  | 'after-successor-create'
  | 'after-first-copied-head'
  | 'after-migration-envelope'
  | 'after-successor-anchor-durable'
  | 'after-recovery-verified'
  | 'after-backup-verified'
  | 'after-announcement-envelope'
  | 'after-announcement-durable'
  | 'before-atomic-switch'
  | 'after-atomic-switch'
export type ProductiveRotationFault = (point:ProductiveRotationFaultPoint)=>void|Promise<void>

const digest=async(value:unknown)=>base64Url(await sha256(canonicalBytes(value as never)))
const monotonicIsoAfter=(candidate:string,previous:string):string=>{
  const candidateMs=Date.parse(candidate),previousMs=Date.parse(previous)
  if(!Number.isFinite(candidateMs)||!Number.isFinite(previousMs))throw new Error('Recovery artifact timestamp is invalid.')
  const next=Math.max(candidateMs,previousMs+1),value=new Date(next).toISOString()
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))throw new Error('Recovery artifact timestamp exceeded the v1 timestamp domain.')
  return value
}
const deterministicId=async(value:unknown,bytes=32)=>base64Url((await sha256(canonicalBytes(value as never))).slice(0,bytes))
function compareCanonical(left:unknown,right:unknown):number{const a=canonicalBytes(left as never),b=canonicalBytes(right as never),length=Math.min(a.byteLength,b.byteLength);for(let index=0;index<length;index++){if(a[index]!==b[index])return a[index]!-b[index]!}return a.byteLength-b.byteLength}
function heads(revisions:readonly RevisionV1[]):RevisionV1[]{const graph=validateRevisionGraphV1(revisions);return[...graph.headsByRecord.values()].flatMap(ids=>[...ids].map(id=>graph.revisions.get(id)!)).sort((a,b)=>a.revision_id.localeCompare(b.revision_id))}
async function snapshots(revisions:readonly RevisionV1[]):Promise<{semantic:string;lineage:string;heads:RevisionV1[]}>{const selected=heads(revisions).filter(revision=>revision.record_status!=='control'),semanticEntries=selected.map(r=>({record_type:r.record_type,record_schema:r.record_schema,record_id:r.record_id,record_status:r.record_status,record_data:r.record_data})).sort(compareCanonical);return{heads:selected,semantic:await digest(semanticEntries),lineage:await digest(selected.map(r=>({record_id:r.record_id,revision_id:r.revision_id,parent_revision_ids:r.parent_revision_ids})))}}
const manifestCells=(manifest:Awaited<ReturnType<typeof prepareManifest>>)=>[manifest.format,manifest.version,manifest.manifestIv,manifest.manifestCiphertext] as const

/** Concrete production rotation. Only the provider wire is injected; every
 * cryptographic, persistence, creation, verification, recovery and backup
 * operation is the same implementation used by the product. */
export class ProductiveRotationService {
  private readonly repository=new IndexedDbRotationRepository()
  private source?:VerifiedEpochMaterial
  private successorManifest?:readonly[string,string,string,string]
  private successorRemoteId?:string
  private successorTransport?:RemoteTransport
  constructor(private readonly session:SingleWriterProviderSession,private readonly transport:RemoteTransport,private readonly urs:Uint8Array,private readonly now=()=>new Date().toISOString(),private readonly fault?:ProductiveRotationFault,private readonly migrationKind:'normal'|'remote_enablement'|'recovery_rekey'='normal'){if(session.profileId!==SINGLE_WRITER_V1_PROFILE||transport.profileId!==SINGLE_WRITER_V1_PROFILE)throw new Error('ProductiveRotationService currently supports only single-writer-v1.');if(session.providerId!==transport.providerId)throw new Error('Rotation transport provider identity does not match the authenticated session.')}
  static remoteEnablement(session:SingleWriterProviderSession,transport:RemoteTransport,urs:Uint8Array,now=()=>new Date().toISOString(),fault?:ProductiveRotationFault):ProductiveRotationService{return new ProductiveRotationService(session,transport,urs,now,fault,'remote_enablement')}
  static recoveryRekey(session:SingleWriterProviderSession,transport:RemoteTransport,newUrs:Uint8Array,now=()=>new Date().toISOString(),fault?:ProductiveRotationFault):ProductiveRotationService{return new ProductiveRotationService(session,transport,newUrs,now,fault,'recovery_rekey')}

  async rotate():Promise<CompletedRotation>{
    const source=await this.repository.verifiedActiveEpoch();this.source=source
    if(this.urs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
    if(this.migrationKind!=='remote_enablement'){
      if(!source.state.remote_binding||source.state.remote_binding.remote_resource_id==='')throw new Error('Rotation requires an authenticated remote source.')
    }else if(source.state.remote_binding!==null||source.state.remote_anchor!==null||source.state.epoch_status!=='local_offline')throw new Error('Remote enablement requires a local-offline source epoch.')
    const stored=await indexedDbRotationPersistence().read() as ConcreteRotationState|null,startFresh=stored?.step==='switched',existing=startFresh?null:stored,newEpochId=base64Url(randomBytes(16)),creationLocator=base64Url(randomBytes(16))
    if(existing&&(existing.migrationKind??'normal')!==this.migrationKind)throw new Error('A different epoch migration is already in progress.')
    const initial:ConcreteRotationState=existing??{rotationId:base64Url(randomBytes(32)),oldEpochId:source.context.epochId,newEpochId,newKeyId:base64Url(randomBytes(16)),newWrapId:base64Url(randomBytes(16)),creationLocator,successorManifestFingerprint:'',createdAt:this.now(),migrationKind:this.migrationKind,recoveryGeneration:this.targetRecoveryGeneration(source),step:'prepared',copiedEnvelopeIds:[]}
    const state=await runRotation(this.dependencies(startFresh),initial)
    const recovery=await this.repository.artifact<RecoveryArtifact>(`${state.rotationId}:recovery`),backup=await this.repository.artifact<SyncBackupV5>(`${state.rotationId}:backup`)
    if(!recovery||!backup)throw new Error('Completed rotation artifacts are missing.');return{state,recovery,backup}
  }

  private async hit(point:ProductiveRotationFaultPoint):Promise<void>{await this.fault?.(point)}
  private targetRecoveryGeneration(source:VerifiedEpochMaterial):number{return source.state.recovery_generation+(this.migrationKind==='recovery_rekey'?1:0)}

  /** Only persistence events that are themselves the security boundary are
   * faulted here. Side-effect phases are faulted inside their concrete
   * dependency before the next rotation marker is persisted. */
  private persistence(startFresh=false):RotationPersistence{
    const base=indexedDbRotationPersistence();let firstRead=true
    return{
      read:async()=>{const value=await base.read(),replaceCompleted=startFresh&&firstRead&&value?.step==='switched';firstRead=false;return replaceCompleted?null:value},
      readBack:()=>base.readBack(),
      write:async(state:RotationState,hash:string)=>{
        await base.write(state,hash)
        if(state.step==='source_frozen_verified'){
          const productive=state as ProductiveRotationState
          if(Object.prototype.hasOwnProperty.call(productive,'sourceAnchor')&&productive.sourceSemanticSnapshot&&productive.sourceLineageSnapshot)await this.hit('after-source-snapshot')
          else await this.hit('after-freeze')
        }
      },
    }
  }

  private dependencies(startFresh=false):RotationOrchestratorDependencies{
    const persistence=this.persistence(startFresh)
    return{persistence,
      createAndVerifyRootWrap:async raw=>{const state=raw as ConcreteRotationState;if(await this.repository.artifact(`${state.rotationId}:context`))return;const source=this.source??await this.repository.verifiedActiveEpoch(),rootKey=randomBytes(32),salt=await deriveEpochSalt(fromBase64Url(source.context.diaryId),fromBase64Url(state.newEpochId)),account=await this.session.remoteIdentityBinding(this.transport),targetGeneration=state.recoveryGeneration??this.targetRecoveryGeneration(source),commitment=await recoveryCommitment(this.urs,fromBase64Url(source.context.diaryId),targetGeneration),payload:ProtectedManifestV1={diary_id:source.context.diaryId,epoch_id:state.newEpochId,key_id:state.newKeyId,recovery_generation:targetGeneration,recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5',crypto_suite:'A256GCM-HKDF-SHA256-v5',sync_profile:SINGLE_WRITER_V1_PROFILE,created_at:state.createdAt,google_account_binding:account,predecessor_epochs:[{epoch_id:source.context.epochId,manifest_fingerprint:source.context.manifestFingerprint}],record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),protocol_limits:{max_payload_bytes:16380,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000,max_unique_canonical_bytes:134217728,max_remote_physical_rows:100000,max_remote_physical_canonical_bytes:134217728,max_canonical_row_bytes:21936}},manifest=await prepareManifest(rootKey,salt,{diaryId:source.context.diaryId,epochId:state.newEpochId},payload),fingerprint=await manifestFingerprint(manifest),context:EpochContext={id:'active',diaryId:source.context.diaryId,epochId:state.newEpochId,keyId:state.newKeyId,manifestFingerprint:fingerprint,wrapId:state.newWrapId},next:EpochLocalSecurityStateV5={...source.state,epoch_id:state.newEpochId,key_id:state.newKeyId,manifest_fingerprint:fingerprint,recovery_generation:targetGeneration,recovery_urs_commitment:commitment,remote_binding:null,remote_anchor:null,epoch_status:'local_offline',operation_generation:0,rotation_state_ref:null,migration_state_ref:null,local_journal_count:0,local_journal_hash:await journalInitial(source.context.diaryId,state.newEpochId)};await this.repository.persistSuccessor({context,rootKey,state:next});await this.repository.putArtifact(`${state.rotationId}:manifest`,manifestCells(manifest));await this.repository.putArtifact(`${state.rotationId}:context`,context);await this.hit('after-root-wrap')},
      verifyAndFreezeSource:async raw=>{
        const state=raw as ConcreteRotationState,source=await this.repository.verifiedActiveEpoch()
        if(source.state.rotation_state_ref?.state!=='source_frozen_verified')throw new Error('Final source snapshot requires a persisted freeze.')
        if(state.migrationKind==='remote_enablement'){if(source.state.remote_binding!==null||source.state.remote_anchor!==null||source.state.epoch_status!=='local_offline')throw new Error('Remote enablement source changed after freeze.');const hashes=await snapshots(source.revisions);this.source=source;return{anchor:null,semanticSnapshot:hashes.semantic,lineageSnapshot:hashes.lineage}}
        if(source.state.epoch_status==='retired')throw new Error('A retired source epoch cannot be rotated.')
        await this.syncSourceBeforeFreeze(source)
        const synchronized=await this.repository.verifiedActiveEpoch(),remote=synchronized.state.remote_binding
        if(!remote||synchronized.state.epoch_status==='retired')throw new Error('Remote rotation source is no longer active.')
        const verifier=this.sourceVerifier(synchronized,synchronized.state.remote_anchor),snapshot=await this.transport.read(remote.remote_resource_id),verified=await verifier.verify(snapshot)
        if(verified.retired)throw new Error('A competing rotation already retired the source epoch.')
        const anchor=await createAnchorV1(synchronized.context.diaryId,synchronized.context.epochId,snapshot.rows),store=new IndexedDbCoordinatorStore(synchronized.context.epochId,synchronized.context.wrapId)
        await store.commitVerifiedPull(verified,anchor,await store.generation())
        const refreshed=await this.repository.verifiedActiveEpoch(),hashes=await snapshots(refreshed.revisions);this.source=refreshed
        return{anchor,semanticSnapshot:hashes.semantic,lineageSnapshot:hashes.lineage}
      },
      verifyRecoverySecret:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement'||state.migrationKind==='recovery_rekey')return;const source=this.source??await this.repository.verifiedActiveEpoch(),expected=await recoveryCommitment(this.urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation);if(expected!==source.state.recovery_urs_commitment)throw new Error('Recovery secret does not match the source commitment.')},
      planSuccessor:async raw=>{const state=raw as ConcreteRotationState,manifest=await this.repository.artifact<readonly[string,string,string,string]>(`${state.rotationId}:manifest`);if(!manifest)throw new Error('Staged successor manifest missing.');this.successorManifest=manifest},
      createOrReconcileSuccessor:async raw=>{const state=raw as ConcreteRotationState,manifest=this.successorManifest??await this.repository.artifact<readonly[string,string,string,string]>(`${state.rotationId}:manifest`);if(!manifest)throw new Error('Successor manifest missing.');const context=await this.context(state),verifier=await this.successorVerifier(state,[],null),codec=this.session.codec(verifier),creation:CreationState={locator:state.creationLocator,manifestFingerprint:context.manifestFingerprint,status:'planned',remoteId:null,diaryId:context.diaryId,epochId:state.newEpochId,keyId:state.newKeyId,expectedProperties:await this.session.creationProperties(context.diaryId,state.newEpochId),operationGeneration:(await this.repository.verifiedActiveEpoch()).state.operation_generation},wire=await this.successorWire(state);const result=await runCreationStateMachine(creation,manifest,wire,codec,indexedDbCreationPersistence());if(result.status!=='bound'||!result.remoteId)throw new Error('Successor creation did not bind uniquely.');this.successorRemoteId=result.remoteId;await this.repository.putArtifact(`${state.rotationId}:remote`,result.remoteId);await this.repository.bindRemote(context,{provider_id:SINGLE_WRITER_V1_PROFILE,remote_resource_id:result.remoteId,remote_identity_binding:await this.session.remoteIdentityBinding(wire)});await this.hit('after-successor-create')},
      copySemanticHeadsAndMigration:async raw=>this.copyHeadsAndMigration(raw as ConcreteRotationState),
      fullVerifySuccessor:async raw=>{const state=raw as ConcreteRotationState,context=await this.context(state),material=await this.repository.verifiedEpoch(context),verifier=await this.successorVerifier(state,material.envelopes,material.state.remote_anchor),remote=await this.remoteId(state),snapshot=await(await this.successorWire(state)).read(remote);await verifier.verify(snapshot);const anchor=await createAnchorV1(context.diaryId,state.newEpochId,snapshot.rows);if(JSON.stringify(anchor)!==JSON.stringify(material.state.remote_anchor))throw new Error('Successor verified anchor is not durable.');const semantic=await this.successorSemantic(state,material.envelopes);return{semanticSnapshot:semantic}},
      createAndBootstrapRecovery:async raw=>{const state=raw as ConcreteRotationState,context=await this.context(state),root=await this.repository.successorRoot(state.newEpochId,state.newWrapId),remoteId=await this.remoteId(state),wire=await this.successorWire(state),snapshot=await wire.read(remoteId),anchor=await createAnchorV1(context.diaryId,state.newEpochId,snapshot.rows),account=await this.session.remoteIdentityBinding(wire),stored=await this.repository.artifact<RecoveryArtifact>(`${state.rotationId}:recovery`),createdAt=stored?null:await this.recoveryArtifactCreatedAt(state),artifact=stored??await createRecovery({diary_id:context.diaryId,epoch_id:state.newEpochId,key_id:state.newKeyId,RK_epoch:base64Url(root),manifest_fingerprint:context.manifestFingerprint,remote_anchor:anchor,google_account_binding:account,recovery_generation:state.recoveryGeneration??this.targetRecoveryGeneration(this.source??await this.repository.verifiedActiveEpoch()),created_at:createdAt!},this.urs),candidate=await recoverRootKeyCandidate(artifact,this.urs),authority=await this.session.recoveryAuthority(wire,state.creationLocator,remoteId),verifier=new RecoveryBootstrapVerifier({authority,schemas:DOMAIN_SCHEMA_REGISTRY});await activateRecoveredRoot(candidate,verifier,(verifiedCandidate,bootstrap)=>persistRecoveredProfile(verifiedCandidate,bootstrap,DOMAIN_SCHEMA_REGISTRY,{databaseName:`eds-diary-recovery-gate-${state.rotationId}`,cleanupAfterVerify:true}));if(!stored)await this.repository.putArtifact(`${state.rotationId}:recovery`,artifact);if(state.migrationKind==='remote_enablement')await this.session.publishRecoveryArtifact(this.urs,artifact);else await this.session.prepareRecoveryArtifactSlot(this.urs,artifact);await this.hit('after-recovery-verified');return artifact.recovery_artifact_id},
      createAndTestRestoreBackup:async raw=>{const state=raw as ConcreteRotationState,context=await this.context(state),root=await this.repository.successorRoot(state.newEpochId,state.newWrapId),remoteId=await this.remoteId(state),snapshot=await(await this.successorWire(state)).read(remoteId),envelopes=await this.repository.successorEnvelopes(state.newEpochId),stored=await this.repository.artifact<SyncBackupV5>(`${state.rotationId}:backup`),backup=stored??await createBackup({rootKey:root,epochSalt:await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(state.newEpochId)),diaryId:context.diaryId,epochId:state.newEpochId,keyId:state.newKeyId,manifestFingerprint:context.manifestFingerprint,epochManifestPublic:snapshot.manifest as readonly[string,string,string,string],remoteRows:snapshot.rows as ReadonlyArray<readonly[string,string,string]>,localEnvelopes:envelopes,remoteBound:true,createdAt:this.now()}),verifier=await this.successorVerifier(state,envelopes,null);await testRestoreBackup({rootKey:root,epochSalt:await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(state.newEpochId)),diaryId:context.diaryId,epochId:state.newEpochId,keyId:state.newKeyId,manifestFingerprint:context.manifestFingerprint},backup,verifier);if(!stored)await this.repository.putArtifact(`${state.rotationId}:backup`,backup);await this.hit('after-backup-verified');return backup.backup_id},
      prepareAnnouncementEnvelope:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement')return;await this.prepareAnnouncement(state)},
      appendReadbackAndFullVerifyAnnouncement:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement')return;await this.publishAnnouncement(state)},
      atomicSwitchAndRetireSource:async raw=>{const state=raw as ConcreteRotationState,context=await this.context(state),active=await this.repository.verifiedActiveEpoch();if(active.context.epochId===state.newEpochId){if(active.state.epoch_status!=='active')throw new Error('Successor is active context but not active epoch.');return}if(!state.recoveryArtifactId||!state.backupId||state.successorSemanticSnapshot!==state.sourceSemanticSnapshot)throw new Error('Rotation switch prerequisites are incomplete.');if(!await this.repository.artifact(`${state.rotationId}:recovery`)||!await this.repository.artifact(`${state.rotationId}:backup`))throw new Error('Verified recovery or backup artifact is missing.');if(state.migrationKind!=='remote_enablement')await this.verifySourceStillAtAnnouncement(state);await this.hit('before-atomic-switch');await this.repository.atomicSwitch(context,state,state.migrationKind==='remote_enablement'?'remote_enablement':'normal');await this.hit('after-atomic-switch')},
    }
  }

  private async context(state:ConcreteRotationState):Promise<EpochContext>{const value=await this.repository.artifact<EpochContext>(`${state.rotationId}:context`);if(!value)throw new Error('Successor context missing.');return value}
  private async recoveryArtifactCreatedAt(state:ConcreteRotationState):Promise<string>{
    const local=this.now()
    if(state.migrationKind!=='normal')return local
    const source=this.source??await this.repository.verifiedActiveEpoch()
    const prior=await this.session.findRecoveryArtifact(this.urs)
    if(!prior)return local
    const candidate=await recoverRootKeyCandidate(prior,this.urs),payload=candidate.payload
    if(payload.diary_id!==source.context.diaryId||payload.epoch_id!==source.context.epochId||payload.key_id!==source.context.keyId||payload.manifest_fingerprint!==source.context.manifestFingerprint||payload.recovery_generation!==source.state.recovery_generation||candidate.recoveryCommitment!==source.state.recovery_urs_commitment)throw new Error('Current remote recovery artifact does not match the rotation source.')
    return monotonicIsoAfter(local,payload.created_at)
  }
  private async successorWire(state:ConcreteRotationState):Promise<RemoteTransport>{if(this.successorTransport)return this.successorTransport;const context=await this.context(state);return this.successorTransport=await this.session.transportForEpoch(context.diaryId,state.newEpochId)}
  private async remoteId(state:ConcreteRotationState):Promise<string>{return this.successorRemoteId??await this.repository.artifact<string>(`${state.rotationId}:remote`)??Promise.reject(new Error('Successor remote missing.'))}
  private async successorVerifier(state:ConcreteRotationState,envelopes:readonly PreparedEnvelope[],anchor:RemoteAnchorV1|null):Promise<SingleWriterV1RemoteVerifier>{const context=await this.context(state),root=await this.repository.successorRoot(state.newEpochId,state.newWrapId),source=this.source??await this.repository.verifiedActiveEpoch();return new SingleWriterV1RemoteVerifier({rootKey:root,diaryId:context.diaryId,epochId:state.newEpochId,expectedManifestFingerprint:context.manifestFingerprint,expectedKeyId:state.newKeyId,expectedRecoveryGeneration:state.recoveryGeneration??this.targetRecoveryGeneration(source),expectedRecoveryCommitment:await recoveryCommitment(this.urs,fromBase64Url(context.diaryId),state.recoveryGeneration??this.targetRecoveryGeneration(source)),expectedGoogleAccountBinding:await this.session.remoteIdentityBinding(await this.successorWire(state)),schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:anchor,localEnvelopes:envelopes,localHeadRevisionIds:new Set()})}
  private sourceVerifier(material:VerifiedEpochMaterial,oldAnchor:RemoteAnchorV1|null):SingleWriterV1RemoteVerifier{
    const remote=material.state.remote_binding
    if(!remote)throw new Error('Remote source binding is missing.')
    return new SingleWriterV1RemoteVerifier({rootKey:material.rootKey,diaryId:material.context.diaryId,epochId:material.context.epochId,expectedManifestFingerprint:material.context.manifestFingerprint,expectedKeyId:material.context.keyId,expectedRecoveryGeneration:material.state.recovery_generation,expectedRecoveryCommitment:material.state.recovery_urs_commitment,expectedGoogleAccountBinding:remote.remote_identity_binding,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor,localEnvelopes:material.envelopes,localHeadRevisionIds:new Set(heads(material.revisions).map(revision=>revision.revision_id))})
  }
  private async syncSourceBeforeFreeze(source:VerifiedEpochMaterial):Promise<void>{
    const remote=source.state.remote_binding
    if(!remote)throw new Error('Remote rotation source binding disappeared.')
    const coordinator=new SingleWriterCoordinator(source.context.diaryId,source.context.epochId,remote.remote_resource_id,this.transport,this.session.codec(this.sourceVerifier(source,source.state.remote_anchor)),new IndexedDbCoordinatorStore(source.context.epochId,source.context.wrapId),false,singleWriterV1WriteAuthority())
    coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
  }
  private async syncEpoch(state:ConcreteRotationState,context:EpochContext,transport:RemoteTransport):Promise<void>{
    const material=await this.repository.verifiedEpoch(context),remote=material.state.remote_binding
    if(!remote)throw new Error('Remote binding missing before synchronization.')
    const verifier=context.epochId===state.newEpochId?await this.successorVerifier(state,material.envelopes,material.state.remote_anchor):this.sourceVerifier(material,material.state.remote_anchor)
    const coordinator=new SingleWriterCoordinator(context.diaryId,context.epochId,remote.remote_resource_id,transport,this.session.codec(verifier),new IndexedDbCoordinatorStore(context.epochId,context.wrapId),false,singleWriterV1WriteAuthority());coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
  }
  private async copyHeadsAndMigration(state:ConcreteRotationState):Promise<void>{
    const source=this.source??await this.repository.verifiedActiveEpoch(),context=await this.context(state),sourceHashes=await snapshots(source.revisions);let active=0,tombstone=0,copied=0
    for(const head of sourceHashes.heads){if(head.record_status==='deleted')tombstone++;else active++;const revision:RevisionV1={...head,revision_id:await deterministicId(['rotation-copy-revision-v1',state.rotationId,head.revision_id]),parent_revision_ids:[],migration_origin:{sources:[{source_epoch_id:source.context.epochId,source_record_id:head.record_id,source_revision_ids:[head.revision_id]}]},protocol_created_at:state.createdAt};await this.repository.prepareRotationEnvelope(`${state.rotationId}:copy:${head.revision_id}`,context,revision);copied++;if(copied===1)await this.hit('after-first-copied-head')}
    const migrationData=createEpochMigrationData({migration_id:state.rotationId,migration_kind:state.migrationKind,source:{source_epoch_id:source.context.epochId,source_manifest_fingerprint:source.context.manifestFingerprint,source_anchor:state.migrationKind==='remote_enablement'?null:state.sourceAnchor,source_lineage_snapshot_hash:sourceHashes.lineage,source_semantic_snapshot_hash:sourceHashes.semantic},result_semantic_snapshot_hash:sourceHashes.semantic,active_head_count:active,tombstone_head_count:tombstone}),revision:RevisionV1={record_type:'epoch_migration',record_schema:'epoch-migration-sw-v1',record_id:await deterministicId(['rotation-migration-record-v1',state.rotationId],16),revision_id:await deterministicId(['rotation-migration-revision-v1',state.rotationId]),parent_revision_ids:[],record_status:'control',record_data:migrationData,migration_origin:null,protocol_created_at:state.createdAt};await this.repository.prepareRotationEnvelope(`${state.rotationId}:migration`,context,revision);await this.hit('after-migration-envelope')
    await this.syncEpoch(state,context,await this.successorWire(state));await this.hit('after-successor-anchor-durable')
  }
  private async successorSemantic(state:ConcreteRotationState,envelopes:readonly PreparedEnvelope[]):Promise<string>{const context=await this.context(state),root=await this.repository.successorRoot(state.newEpochId,state.newWrapId),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(state.newEpochId)),revisions:RevisionV1[]=[];for(const envelope of envelopes){const revision=await openEnvelope(root,salt,{diaryId:context.diaryId,epochId:state.newEpochId},envelope);if(revision.record_status!=='control')revisions.push(revision)}return(await snapshots(revisions)).semantic}
  private async prepareAnnouncement(state:ConcreteRotationState):Promise<void>{const source=this.source??await this.repository.verifiedActiveEpoch(),context=await this.context(state),revision:RevisionV1={record_type:'rotation_announcement',record_schema:'rotation-announcement-sw-v1',record_id:await deterministicId(['rotation-announcement-record-v1',state.rotationId],16),revision_id:await deterministicId(['rotation-announcement-revision-v1',state.rotationId]),parent_revision_ids:[],record_status:'control',record_data:{rotation_id:state.rotationId,from_epoch_id:source.context.epochId,successor_epoch_id:state.newEpochId,successor_creation_locator:state.creationLocator,successor_manifest_fingerprint:context.manifestFingerprint,rotation_kind:'normal'},migration_origin:null,protocol_created_at:state.createdAt};const envelope=await this.repository.prepareRotationEnvelope(`${state.rotationId}:announcement`,source.context,revision);await this.repository.putArtifact(`${state.rotationId}:announcement`,envelope);await this.hit('after-announcement-envelope')}
  private async publishAnnouncement(state:ConcreteRotationState):Promise<void>{
    const source=this.source??await this.repository.verifiedActiveEpoch(),material=await this.repository.verifiedEpoch(source.context),remote=material.state.remote_binding,frozen=state.sourceAnchor as RemoteAnchorV1|undefined,announcement=await this.repository.artifact<PreparedEnvelope>(`${state.rotationId}:announcement`),recovery=await this.repository.artifact<RecoveryArtifact>(`${state.rotationId}:recovery`)
    if(!remote||!frozen||!announcement||!recovery||material.state.epoch_status==='retired')throw new Error('Rotation announcement prerequisites are incomplete or retired.')
    const row=envelopeRow(announcement),sameRow=(candidate:readonly string[])=>candidate.length===3&&candidate.every((cell,index)=>cell===row[index]),store=new IndexedDbCoordinatorStore(material.context.epochId,material.context.wrapId),verifier=this.sourceVerifier(material,frozen)
    let snapshot=await this.transport.read(remote.remote_resource_id)
    if(snapshot.rows.length===frozen.covered_row_count){
      const beforeVerified=await verifier.verify(snapshot)
      if(beforeVerified.retired)throw new Error('A competing rotation already retired the source epoch.')
      const beforeAnchor=await createAnchorV1(material.context.diaryId,material.context.epochId,snapshot.rows)
      if(JSON.stringify(beforeAnchor)!==JSON.stringify(frozen))throw new Error('Source prefix changed after the rotation freeze.')
      const pending=await store.pending(beforeVerified)
      if(pending.length!==1||pending[0]?.envelopeId!==announcement.envelopeId)throw new Error('Frozen source contains unexpected pending envelopes before its announcement.')
      await this.session.prepareRecoveryArtifactSlot(this.urs,recovery)
      try{await this.transport.append(remote.remote_resource_id,row)}catch(error){if(!(error instanceof TransportError)||error.code!=='unknown_outcome')throw error}
      snapshot=await this.transport.read(remote.remote_resource_id)
      if(snapshot.rows.length===frozen.covered_row_count)throw new TransportError('unknown_outcome','Rotation announcement outcome remains unresolved; retry only after a fresh read.')
    }
    if(snapshot.rows.length!==frozen.covered_row_count+1||!sameRow(snapshot.rows[frozen.covered_row_count]??[]))throw new Error('Source changed around the rotation announcement; v1 cutover is fail-stopped.')
    const prefixAnchor=await createAnchorV1(material.context.diaryId,material.context.epochId,snapshot.rows.slice(0,frozen.covered_row_count))
    if(JSON.stringify(prefixAnchor)!==JSON.stringify(frozen))throw new Error('Rotation announcement no longer immediately extends the frozen source prefix.')
    const verified=await verifier.verify(snapshot)
    if(!verified.retired)throw new Error('Rotation announcement did not retire the source epoch.')
    const anchor=await createAnchorV1(material.context.diaryId,material.context.epochId,snapshot.rows)
    await store.commitVerifiedPull(verified,anchor,await store.generation())
    this.source=await this.repository.verifiedEpoch(source.context)
    await this.session.publishRecoveryArtifact(this.urs,recovery)
    await this.hit('after-announcement-durable')
  }
  private async verifySourceStillAtAnnouncement(state:ConcreteRotationState):Promise<void>{
    const material=await this.repository.verifiedActiveEpoch(),remote=material.state.remote_binding
    if(material.context.epochId!==state.oldEpochId||!remote||!material.state.remote_anchor)throw new Error('Source is not the expected active epoch before switch.')
    const snapshot=await this.transport.read(remote.remote_resource_id),verified=await this.sourceVerifier(material,material.state.remote_anchor).verify(snapshot)
    if(!verified.retired)throw new Error('Source is not durably retired immediately before switch.')
    const anchor=await createAnchorV1(material.context.diaryId,material.context.epochId,snapshot.rows)
    if(JSON.stringify(anchor)!==JSON.stringify(material.state.remote_anchor))throw new Error('Source advanced after its durable rotation announcement; switch is blocked.')
  }
}
