import { describe, expect, it } from 'vitest'
import { base64Url, concatBytes, fixedBase64Url, utf8 } from '../security/crypto/bytes'
import { deriveEpochSalt, recoveryCommitment, randomBytes } from '../security/crypto/core'
import { activateRecoveredRoot, createRecovery, recoverRootKeyCandidate } from '../security/recovery'
import { manifestFingerprint, prepareManifest, schemaRegistryHash, SCHEMA_ALLOWLIST } from '../security/manifest'
import { prepareEnvelope, envelopeRow } from '../security/envelopes'
import { singletonRecordId, type Revision } from '../security/revisions'
import { createAnchor } from '../sync/core/prefix'
import { DOMAIN_SCHEMA_REGISTRY } from '../data/localDatabase'
import { advanceRotation, maySwitchRotation, oldEpochWritable, runRotation, type ProductiveRotationState, type RotationState } from '../security/rotation'
import { FullRemoteVerifier, IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterTransport, type GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'

const b = (n: number, length: number) => base64Url(new Uint8Array(length).fill(n))

describe('recovery continuity', () => {
  it('activates only after authenticated discovery and a complete positive bootstrap verification',async()=>{
    const diary=b(31,16),epoch=b(32,16),keyId=b(33,16),root=randomBytes(32),urs=randomBytes(32),permission='controlled-provider-permission',generation=4,commitment=await recoveryCommitment(urs,new Uint8Array(16).fill(31),generation)
    const locator=base64Url((await (await import('../security/crypto/core')).sha256(concatBytes(utf8('sync-v5/epoch-locator'),new Uint8Array([0]),fixedBase64Url(diary,16),fixedBase64Url(epoch,16)))).slice(0,16));let manifest:readonly string[]=[],rows:ReadonlyArray<readonly string[]>=[]
    const client=issueControlledTestGoogleClient({identity:()=>permission,request:async<T>(url:string)=>{
      if(url.includes('/about?'))return{user:{permissionId:permission}} as T
      if(url.includes('/files?q='))return{files:[{id:'remote-positive',name:'sync-recovery-locator'}]} as T
      if(url.includes('/permissions?'))return{permissions:[{id:permission,type:'user',role:'owner',deleted:false}]} as T
      if(url.includes('/drive/v3/files/'))return{mimeType:'application/vnd.google-apps.spreadsheet',trashed:false,ownedByMe:true,shared:false,isAppAuthorized:true,appProperties:{app_format:'sync-v5',epoch_locator:locator}} as T
      if(url.includes('ranges=')&&url.includes("'_m'"))return{sheets:[{properties:{title:'_m'},data:[{startRow:0,rowData:[{values:manifest.map(value=>({userEnteredValue:{stringValue:value}}))}]}]}]} as T
      if(url.includes('ranges=')&&url.includes("'_r'"))return{sheets:[{properties:{title:'_r'},data:[{startRow:0,rowData:rows.map(row=>({values:row.map(value=>({userEnteredValue:{stringValue:value}}))}))}]}]} as T
      if(url.includes('sheets(properties'))return{sheets:[{properties:{sheetId:1,title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}}},{properties:{sheetId:2,title:'_r',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:3}}}]} as T
      throw new Error(`Unexpected test request: ${url}`)
    }})
    const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(client,diary,epoch),account=await transport.authenticatedAccountBinding(),salt=await deriveEpochSalt(new Uint8Array(16).fill(31),new Uint8Array(16).fill(32)),protectedManifest={diary_id:diary,epoch_id:epoch,key_id:keyId,recovery_generation:generation,recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5' as const,crypto_suite:'A256GCM-HKDF-SHA256-v5' as const,sync_profile:'google-sheets-single-writer-v1' as const,created_at:'2026-09-16T10:00:00.000Z',google_account_binding:account,predecessor_epochs:[],record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),protocol_limits:{max_payload_bytes:16380 as const,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000 as const,max_unique_canonical_bytes:134217728 as const,max_remote_physical_rows:100000 as const,max_remote_physical_canonical_bytes:134217728 as const,max_canonical_row_bytes:21936 as const}},preparedManifest=await prepareManifest(root,salt,{diaryId:diary,epochId:epoch},protectedManifest),fingerprint=await manifestFingerprint(preparedManifest);manifest=[preparedManifest.format,preparedManifest.version,preparedManifest.manifestIv,preparedManifest.manifestCiphertext]
    const revision:Revision={record_type:'pain_type_settings',record_schema:'pain-type-settings/v1',record_id:await singletonRecordId(diary,'pain_type_settings'),revision_id:b(41,32),parent_revision_ids:[],record_status:'active',record_data:{values:['synthetic']},migration_origin:null,protocol_created_at:'2026-09-16T10:00:00.000Z'},envelope=await prepareEnvelope(root,salt,{diaryId:diary,epochId:epoch},revision,{reserve:async()=>undefined,persist:async()=>undefined});rows=[envelopeRow(envelope)]
    const artifact=await createRecovery({diary_id:diary,epoch_id:epoch,key_id:keyId,RK_epoch:base64Url(root),manifest_fingerprint:fingerprint,remote_anchor:await createAnchor(diary,epoch,rows),google_account_binding:account,recovery_generation:generation,created_at:'2026-09-16T10:01:00.000Z'},urs),candidate=await recoverRootKeyCandidate(artifact,urs),authority=await IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(transport,'recovery-locator','remote-positive'),verifier=new RecoveryBootstrapVerifier({authority,schemas:DOMAIN_SCHEMA_REGISTRY});let persisted=false
    await activateRecoveredRoot(candidate,verifier,async()=>{persisted=true});expect(persisted).toBe(true)
  })
  it('returns an untrusted candidate whose commitment still requires authenticated bootstrap verification', async () => {
    const urs = randomBytes(32)
    const root = randomBytes(32)
    const payload = {
      diary_id: b(1, 16), epoch_id: b(2, 16), key_id: b(3, 16), RK_epoch: base64Url(root),
      manifest_fingerprint: b(4, 32), remote_anchor: { anchor_profile: 'google-sheets-single-writer-v1' as const, covered_row_count: 0, prefix_hash: b(0, 32) },
      google_account_binding: b(5, 32), recovery_generation: 1, created_at: '2026-09-15T12:00:00.000Z',
    }
    const artifact = await createRecovery(payload, urs)
    const candidate = await recoverRootKeyCandidate(artifact, urs)
    expect(candidate.rootKey).toEqual(root)
    expect(candidate.recoveryCommitment).toBe(await recoveryCommitment(urs, new Uint8Array(16).fill(1), 1))
    await expect(recoverRootKeyCandidate(artifact, randomBytes(32))).rejects.toThrow()
  })
  it('rejects self-confirmation through a caller-assembled epoch verifier', async()=>{
    const urs=randomBytes(32),root=randomBytes(32),payload={diary_id:b(1,16),epoch_id:b(2,16),key_id:b(3,16),RK_epoch:base64Url(root),manifest_fingerprint:b(4,32),remote_anchor:{anchor_profile:'google-sheets-single-writer-v1' as const,covered_row_count:0,prefix_hash:b(0,32)},google_account_binding:b(5,32),recovery_generation:1,created_at:'2026-09-15T12:00:00.000Z'},candidate=await recoverRootKeyCandidate(await createRecovery(payload,urs),urs)
    const forged=new FullRemoteVerifier({rootKey:candidate.rootKey,diaryId:payload.diary_id,epochId:payload.epoch_id,expectedManifestFingerprint:payload.manifest_fingerprint,expectedKeyId:payload.key_id,expectedRecoveryGeneration:1,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:payload.google_account_binding,schemas:{},oldAnchor:payload.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()})
    await expect(activateRecoveredRoot(candidate,forged as unknown as RecoveryBootstrapVerifier,async()=>undefined)).rejects.toThrow('independently authenticated')
    const forgedAuthority={source:'authenticated-remote',remoteResourceId:'independently-discovered-file',authenticatedAccountBinding:payload.google_account_binding,load:async()=>({manifest:[],rows:[]})}
    expect(()=>new RecoveryBootstrapVerifier({authority:forgedAuthority as never,schemas:{}})).toThrow('forged')
    const transport=new InMemoryTransport();transport.remotes.set('locator-resource',{manifest:[],rows:[]})
    await expect(IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(transport as never,'locator','locator-resource')).rejects.toThrow('productive Google identity boundary')
  })
  it('rejects a self-confirming provider stub and derives identity inside the controlled boundary',async()=>{
    const diary=b(1,16),epoch=b(2,16),permission='provider-permission-7'
    const stub:GoogleApiClient={identity:()=>permission,request:async<T>()=>({user:{permissionId:permission}} as T)}
    await expect(GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(stub,diary,epoch)).rejects.toThrow('authenticated provider boundary')
    const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(issueControlledTestGoogleClient(stub),diary,epoch)
    expect(await transport.authenticatedAccountBinding()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const mismatched=issueControlledTestGoogleClient({...stub,identity:()=> 'different-session'})
    await expect(GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(mismatched,diary,epoch)).rejects.toThrow('could not be authenticated')
  })
})

describe('productive rotation orchestration',()=>{it('persists and executes every irreversible gate in order',async()=>{let persisted:ProductiveRotationState|null=null;let hash='';const calls:string[]=[];const initial:ProductiveRotationState={rotationId:'r',oldEpochId:'o',newEpochId:'n',step:'prepared',copiedEnvelopeIds:[]};const state=await runRotation({persistence:{read:async()=>persisted,write:async(value,nextHash)=>{persisted=structuredClone(value) as ProductiveRotationState;hash=nextHash},readBack:async()=>({state:persisted!,hash})},verifyAndFreezeSource:async()=>({anchor:{},semanticSnapshot:'semantic',lineageSnapshot:'lineage'}),createAndVerifyRootWrap:async()=>{calls.push('wrap')},verifyRecoverySecret:async()=>undefined,planSuccessor:async()=>undefined,createOrReconcileSuccessor:async()=>undefined,copySemanticHeadsAndMigration:async()=>{calls.push('copy')},fullVerifySuccessor:async()=>({semanticSnapshot:'semantic'}),createAndBootstrapRecovery:async()=>{calls.push('recovery');return'a'},createAndTestRestoreBackup:async()=>{calls.push('backup');return'b'},prepareAnnouncementEnvelope:async()=>{calls.push('announcement')},appendReadbackAndFullVerifyAnnouncement:async()=>{calls.push('durable')},atomicSwitchAndRetireSource:async()=>{calls.push('switch')}},initial);expect(state.step).toBe('switched');expect(calls).toEqual(['wrap','copy','recovery','backup','announcement','durable','switch'])})})

describe('rotation crash persistence',()=>{it('resumes after every durable write without duplicating successor or announcement',async()=>{
  const initial:ProductiveRotationState={rotationId:'rotation',oldEpochId:'old',newEpochId:'new',step:'prepared',copiedEnvelopeIds:[]};let persisted:ProductiveRotationState|null=null,hash='',successors=0,announcements=0;const crashed=new Set<string>()
  const persistence={read:async()=>persisted,write:async(value:RotationState,nextHash:string)=>{persisted=structuredClone(value) as ProductiveRotationState;hash=nextHash;const key=`${value.step}:${'sourceSemanticSnapshot'in value}`;if(!crashed.has(key)){crashed.add(key);throw new Error('crash')}},readBack:async()=>({state:persisted!,hash})}
  const deps={persistence,verifyAndFreezeSource:async()=>({anchor:{covered:true},semanticSnapshot:'same',lineageSnapshot:'lineage'}),createAndVerifyRootWrap:async()=>undefined,verifyRecoverySecret:async()=>undefined,planSuccessor:async()=>undefined,createOrReconcileSuccessor:async()=>{successors=1},copySemanticHeadsAndMigration:async()=>undefined,fullVerifySuccessor:async()=>({semanticSnapshot:'same'}),createAndBootstrapRecovery:async()=> 'recovery',createAndTestRestoreBackup:async()=> 'backup',prepareAnnouncementEnvelope:async()=>{announcements=1},appendReadbackAndFullVerifyAnnouncement:async()=>undefined,atomicSwitchAndRetireSource:async()=>undefined}
  let completed:ProductiveRotationState|undefined
  while(!completed){try{completed=await runRotation(deps,initial)}catch(error){expect(error).toHaveProperty('message','crash')}}
  expect(completed.step).toBe('switched');expect(crashed.size).toBe(14);expect(successors).toBe(1);expect(announcements).toBe(1)
},30_000)})

describe('rotation gates', () => {
  it('freezes before source snapshot and switches only after durable announcement', () => {
    let state: RotationState = { rotationId: 'r', oldEpochId: 'o', newEpochId: 'n', step: 'prepared', copiedEnvelopeIds: [] }
    for (const step of ['root_wrap_verified', 'source_frozen_verified', 'recovery_secret_verified', 'successor_planned', 'successor_bound', 'copying', 'successor_verified', 'recovery_verified', 'backup_verified', 'announcement_pending', 'announcement_durable'] as const) {
      state = advanceRotation(state, step)
      if (step === 'source_frozen_verified') expect(oldEpochWritable(state)).toBe(false)
    }
    expect(maySwitchRotation(state)).toBe(true)
    expect(oldEpochWritable(state)).toBe(false)
  })
})
