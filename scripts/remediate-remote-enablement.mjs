import fs from 'node:fs'

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,value){fs.writeFileSync(path,value)}
function replaceOnce(source,before,after,label){
  const first=source.indexOf(before)
  if(first<0)throw new Error(`Missing ${label}`)
  if(source.indexOf(before,first+before.length)>=0)throw new Error(`Duplicate ${label}`)
  return source.slice(0,first)+after+source.slice(first+before.length)
}

{
  const path='src/data/productiveRotationService.ts'
  let source=read(path)
  source=replaceOnce(source,
`interface ConcreteRotationState extends ProductiveRotationState {newKeyId:string;newWrapId:string;creationLocator:string;successorManifestFingerprint:string;createdAt:string}`,
`interface ConcreteRotationState extends ProductiveRotationState {newKeyId:string;newWrapId:string;creationLocator:string;successorManifestFingerprint:string;createdAt:string;migrationKind:'normal'|'remote_enablement'}`,
'rotation state migration kind')
  source=replaceOnce(source,
`  constructor(private readonly transport:GoogleSheetsSingleWriterTransport,private readonly urs:Uint8Array,private readonly now=()=>new Date().toISOString(),private readonly fault?:ProductiveRotationFault){}`,
`  constructor(private readonly transport:GoogleSheetsSingleWriterTransport,private readonly urs:Uint8Array,private readonly now=()=>new Date().toISOString(),private readonly fault?:ProductiveRotationFault,private readonly migrationKind:'normal'|'remote_enablement'='normal'){}
  static remoteEnablement(transport:GoogleSheetsSingleWriterTransport,urs:Uint8Array,now=()=>new Date().toISOString(),fault?:ProductiveRotationFault):ProductiveRotationService{return new ProductiveRotationService(transport,urs,now,fault,'remote_enablement')}`,
'rotation constructor')
  source=replaceOnce(source,
`  async rotate():Promise<CompletedRotation>{
    const source=await this.repository.verifiedActiveEpoch();this.source=source
    if(!source.state.remote_binding||source.state.remote_binding.remote_resource_id==='')throw new Error('Rotation requires an authenticated remote source.')
    const stored=await indexedDbRotationPersistence().read() as ConcreteRotationState|null,startFresh=stored?.step==='switched',existing=startFresh?null:stored,newEpochId=base64Url(randomBytes(16)),creationLocator=base64Url(randomBytes(16))
    const initial:ConcreteRotationState=existing??{rotationId:base64Url(randomBytes(32)),oldEpochId:source.context.epochId,newEpochId,newKeyId:base64Url(randomBytes(16)),newWrapId:base64Url(randomBytes(16)),creationLocator,successorManifestFingerprint:'',createdAt:this.now(),step:'prepared',copiedEnvelopeIds:[]}
    const state=await runRotation(this.dependencies(startFresh),initial)`,
`  async rotate():Promise<CompletedRotation>{
    const source=await this.repository.verifiedActiveEpoch();this.source=source
    if(this.urs.byteLength!==32)throw new Error('Recovery secret must contain 32 bytes.')
    if(this.migrationKind==='normal'){
      if(!source.state.remote_binding||source.state.remote_binding.remote_resource_id==='')throw new Error('Rotation requires an authenticated remote source.')
    }else if(source.state.remote_binding!==null||source.state.remote_anchor!==null||source.state.epoch_status!=='local_offline')throw new Error('Remote enablement requires a local-offline source epoch.')
    const stored=await indexedDbRotationPersistence().read() as ConcreteRotationState|null,startFresh=stored?.step==='switched',existing=startFresh?null:stored,newEpochId=base64Url(randomBytes(16)),creationLocator=base64Url(randomBytes(16))
    if(existing&&(existing.migrationKind??'normal')!==this.migrationKind)throw new Error('A different epoch migration is already in progress.')
    const initial:ConcreteRotationState=existing??{rotationId:base64Url(randomBytes(32)),oldEpochId:source.context.epochId,newEpochId,newKeyId:base64Url(randomBytes(16)),newWrapId:base64Url(randomBytes(16)),creationLocator,successorManifestFingerprint:'',createdAt:this.now(),migrationKind:this.migrationKind,step:'prepared',copiedEnvelopeIds:[]}
    const state=await runRotation(this.dependencies(startFresh),initial)`,
'rotate entry')
  source=replaceOnce(source,
`if(productive.sourceAnchor&&productive.sourceSemanticSnapshot&&productive.sourceLineageSnapshot)`,
`if(Object.prototype.hasOwnProperty.call(productive,'sourceAnchor')&&productive.sourceSemanticSnapshot&&productive.sourceLineageSnapshot)`,
'local source snapshot fault marker')
  source=replaceOnce(source,
`manifest_fingerprint:fingerprint,remote_binding:null`,
`manifest_fingerprint:fingerprint,recovery_urs_commitment:commitment,remote_binding:null`,
'successor recovery commitment')
  source=replaceOnce(source,
`      verifyAndFreezeSource:async()=>{const source=await this.repository.verifiedActiveEpoch();if(source.state.rotation_state_ref?.state!=='source_frozen_verified')throw new Error('Final source snapshot requires a persisted freeze.');const remote=source.state.remote_binding!,material={localEnvelopes:source.envelopes,localHeadRevisionIds:new Set(heads(source.revisions).map(r=>r.revision_id))},verifier=new FullRemoteVerifier({rootKey:source.rootKey,diaryId:source.context.diaryId,epochId:source.context.epochId,expectedManifestFingerprint:source.context.manifestFingerprint,expectedKeyId:source.context.keyId,expectedRecoveryGeneration:source.state.recovery_generation,expectedRecoveryCommitment:source.state.recovery_urs_commitment,expectedGoogleAccountBinding:remote.remote_identity_binding,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:source.state.remote_anchor,...material}),snapshot=await this.transport.read(remote.remote_resource_id);await verifier.verify(snapshot);const anchor=await createAnchor(source.context.diaryId,source.context.epochId,snapshot.rows),store=new IndexedDbCoordinatorStore(source.context.epochId,source.context.wrapId);await store.commitVerifiedPull(snapshot.rows,anchor,await store.generation());const refreshed=await this.repository.verifiedActiveEpoch(),hashes=await snapshots(refreshed.revisions);this.source=refreshed;return{anchor,semanticSnapshot:hashes.semantic,lineageSnapshot:hashes.lineage}},`,
`      verifyAndFreezeSource:async raw=>{const state=raw as ConcreteRotationState,source=await this.repository.verifiedActiveEpoch();if(source.state.rotation_state_ref?.state!=='source_frozen_verified')throw new Error('Final source snapshot requires a persisted freeze.');if(state.migrationKind==='remote_enablement'){if(source.state.remote_binding!==null||source.state.remote_anchor!==null||source.state.epoch_status!=='local_offline')throw new Error('Remote enablement source changed after freeze.');const hashes=await snapshots(source.revisions);this.source=source;return{anchor:null,semanticSnapshot:hashes.semantic,lineageSnapshot:hashes.lineage}}const remote=source.state.remote_binding;if(!remote)throw new Error('Remote rotation source binding disappeared.');const material={localEnvelopes:source.envelopes,localHeadRevisionIds:new Set(heads(source.revisions).map(r=>r.revision_id))},verifier=new FullRemoteVerifier({rootKey:source.rootKey,diaryId:source.context.diaryId,epochId:source.context.epochId,expectedManifestFingerprint:source.context.manifestFingerprint,expectedKeyId:source.context.keyId,expectedRecoveryGeneration:source.state.recovery_generation,expectedRecoveryCommitment:source.state.recovery_urs_commitment,expectedGoogleAccountBinding:remote.remote_identity_binding,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:source.state.remote_anchor,...material}),snapshot=await this.transport.read(remote.remote_resource_id);await verifier.verify(snapshot);const anchor=await createAnchor(source.context.diaryId,source.context.epochId,snapshot.rows),store=new IndexedDbCoordinatorStore(source.context.epochId,source.context.wrapId);await store.commitVerifiedPull(snapshot.rows,anchor,await store.generation());const refreshed=await this.repository.verifiedActiveEpoch(),hashes=await snapshots(refreshed.revisions);this.source=refreshed;return{anchor,semanticSnapshot:hashes.semantic,lineageSnapshot:hashes.lineage}},`,
'verify and freeze source')
  source=replaceOnce(source,
`      verifyRecoverySecret:async()=>{const source=this.source??await this.repository.verifiedActiveEpoch(),expected=await recoveryCommitment(this.urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation);if(expected!==source.state.recovery_urs_commitment)throw new Error('Recovery secret does not match the source commitment.')},`,
`      verifyRecoverySecret:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement')return;const source=this.source??await this.repository.verifiedActiveEpoch(),expected=await recoveryCommitment(this.urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation);if(expected!==source.state.recovery_urs_commitment)throw new Error('Recovery secret does not match the source commitment.')},`,
'verify recovery secret')
  source=replaceOnce(source,
`migration_kind:'normal',source:{source_epoch_id:source.context.epochId,source_manifest_fingerprint:source.context.manifestFingerprint,source_anchor:state.sourceAnchor,`,
`migration_kind:state.migrationKind,source:{source_epoch_id:source.context.epochId,source_manifest_fingerprint:source.context.manifestFingerprint,source_anchor:state.migrationKind==='remote_enablement'?null:state.sourceAnchor,`,
'migration control kind')
  source=replaceOnce(source,
`      prepareAnnouncementEnvelope:async raw=>this.prepareAnnouncement(raw as ConcreteRotationState),
      appendReadbackAndFullVerifyAnnouncement:async raw=>this.publishAnnouncement(raw as ConcreteRotationState),`,
`      prepareAnnouncementEnvelope:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement')return;await this.prepareAnnouncement(state)},
      appendReadbackAndFullVerifyAnnouncement:async raw=>{const state=raw as ConcreteRotationState;if(state.migrationKind==='remote_enablement')return;await this.publishAnnouncement(state)},`,
'local enablement announcement no-op')
  source=replaceOnce(source,
`await this.repository.atomicSwitch(context,state);`,
`await this.repository.atomicSwitch(context,state,state.migrationKind);`,
'atomic switch migration kind')
  write(path,source)
}

{
  const path='src/data/localDatabase.ts'
  const lines=read(path).split('\n')
  const index=lines.findIndex(line=>line.startsWith('  async atomicSwitch(successor:EpochContext,rotation:RotationState):Promise<void>{'))
  if(index<0)throw new Error('Missing atomic switch')
  lines.splice(index,1,...`  async atomicSwitch(successor:EpochContext,rotation:RotationState,mode:'normal'|'remote_enablement'='normal'):Promise<void>{
    const db=await openDatabase(),initial=await loadEpoch(db)
    await withDiaryLock(initial.context.diaryId,async()=>{
      const source=await loadEpoch(db),successorMaterial=await loadEpochFor(db,successor.epochId,successor.wrapId),sourceMaterial=await loadEpochFor(db,source.context.epochId,source.context.wrapId)
      if(rotation.step!=='announcement_durable'||sourceMaterial.state.rotation_state_ref?.state!=='announcement_durable')throw new Error('Epoch migration is not durably ready to switch.')
      if(mode==='normal'){
        const frozenAnchor=rotation.sourceAnchor as RemoteAnchor|undefined
        if(!sourceMaterial.state.remote_anchor||!frozenAnchor||sourceMaterial.state.remote_anchor.covered_row_count<=frozenAnchor.covered_row_count)throw new Error('Source announcement is not durable.')
      }else if(sourceMaterial.state.remote_binding!==null||sourceMaterial.state.remote_anchor!==null||sourceMaterial.state.epoch_status!=='local_offline')throw new Error('Remote enablement source is no longer local-only.')
      if(!successorMaterial.state.remote_binding||!successorMaterial.state.remote_anchor)throw new Error('Successor binding or verified anchor is missing.')
      const hash=await rotationStateHash(rotation),ref={operation_id:rotation.rotationId,state:rotation.step,state_record_hash:hash},oldState={...sourceMaterial.state,epoch_status:'retired' as const,operation_generation:sourceMaterial.state.operation_generation+1},newState={...successorMaterial.state,epoch_status:'active' as const,rotation_state_ref:ref,operation_generation:successorMaterial.state.operation_generation+1},oldTag=await stateTag(sourceMaterial.rootKey,sourceMaterial.epochSalt,oldState),newTag=await stateTag(successorMaterial.rootKey,successorMaterial.epochSalt,newState),tx=db.transaction([STORES.context,STORES.state],'readwrite')
      tx.objectStore(STORES.context).put(successor);tx.objectStore(STORES.state).put({id:source.context.epochId,state:oldState,tag:oldTag} satisfies StoredState);tx.objectStore(STORES.state).put({id:successor.epochId,state:newState,tag:newTag} satisfies StoredState);await complete(tx)
    })
  }`.split('\n'))
  write(path,lines.join('\n'))
}

{
  const path='src/test/productiveRotationService.test.ts'
  let source=read(path)
  source=replaceOnce(source,
`  },120_000)
})`,
`  },120_000)

  it('enables a remote epoch from a local-offline source without inventing a source remote',async()=>{
    const createdAt='2026-09-16T14:00:00.000Z',urs=randomBytes(32),google=new GoogleBoundary(),repository=new IndexedDbRotationRepository()
    await putRecord(LOCAL_STORES.painEntries,pain('local-enable'))
    const source=await repository.verifiedActiveEpoch()
    expect(source.state.epoch_status).toBe('local_offline')
    expect(source.state.remote_binding).toBeNull()
    expect(source.state.remote_anchor).toBeNull()
    const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(google.client,source.context.diaryId,source.context.epochId)
    const result=await ProductiveRotationService.remoteEnablement(transport,urs,()=>createdAt).rotate(),active=await repository.verifiedActiveEpoch(),retired=await repository.verifiedEpoch(source.context)
    expect(result.state.step).toBe('switched')
    expect(google.creates).toBe(1)
    expect([...google.remotes.values()].filter(item=>!item.trashed)).toHaveLength(1)
    expect(retired.state.epoch_status).toBe('retired')
    expect(retired.state.remote_binding).toBeNull()
    expect(retired.state.remote_anchor).toBeNull()
    expect(retired.revisions.filter(revision=>revision.record_schema==='rotation-announcement-sw-v1')).toHaveLength(0)
    expect(active.state.epoch_status).toBe('active')
    expect(active.state.remote_binding?.remote_resource_id).toBeTruthy()
    expect(active.state.remote_anchor?.covered_row_count).toBeGreaterThan(0)
    const migrations=active.revisions.filter(revision=>revision.record_schema==='epoch-migration-sw-v1')
    expect(migrations).toHaveLength(1)
    const migration=migrations[0]!.record_data as {migration_kind:string;source:{source_anchor:unknown}}
    expect(migration.migration_kind).toBe('remote_enablement')
    expect(migration.source.source_anchor).toBeNull()
    expect(result.state.successorSemanticSnapshot).toBe(result.state.sourceSemanticSnapshot)
    expect(result.recovery.recovery_artifact_id).toBeTruthy()
    expect(result.backup.backup_id).toBeTruthy()
    await expect(putRecord(LOCAL_STORES.painEntries,pain('post-enable-write'))).resolves.toBeUndefined()
  },60_000)
})`,
'local remote enablement test')
  write(path,source)
}
