import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProductiveRotationService, type ProductiveRotationFaultPoint } from '../data/productiveRotationService'
import { DOMAIN_SCHEMA_REGISTRY, IndexedDbRotationRepository, LOCAL_STORES, __localDatabaseTesting, putRecord } from '../data/localDatabase'
import { fromBase64Url } from '../security/crypto/bytes'
import { recoverRootKeyCandidate } from '../security/recovery'
import { randomBytes, recoveryCommitment } from '../security/crypto/core'
import { createBestEffortRootWrap, stateTag } from '../security/localState'
import { manifestFingerprint, prepareManifest, schemaRegistryHash, SCHEMA_ALLOWLIST } from '../security/manifest'
import { epochLocator } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'
import { googleProviderSessionFromAuthenticatedClient } from '../sync/google/GoogleSingleWriterProvider'
import { createAnchor } from '../sync/core/prefix'
import { RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'

interface Remote {id:string;name:string;manifest:string[];rows:string[][];properties:Record<string,string>;trashed:boolean;artifact?:string}
type AppendCrashTarget='source'|'successor'|null

const pain=(id:string)=>({id,startedAt:'2026-09-16T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'synthetic rotation fixture',createdAt:'2026-09-16T10:00:00.000Z',updatedAt:'2026-09-16T10:00:00.000Z'})

class GoogleBoundary {
  readonly permission='productive-rotation-test-owner'
  readonly remotes=new Map<string,Remote>()
  readonly appendCounts=new Map<string,number>()
  creates=0
  crashAfterAppend:AppendCrashTarget=null
  private next=1
  readonly client=issueControlledTestGoogleClient({identity:()=>this.permission,request:<T>(url:string,init?:RequestInit)=>this.request<T>(url,init)})
  private cells(values:readonly string[]){return values.map(value=>({userEnteredValue:{stringValue:value}}))}
  private async request<T>(url:string,init?:RequestInit):Promise<T>{
    if(url.includes('/about?'))return{user:{permissionId:this.permission}} as T
    if(url.includes('/drive/v3/files?q=')){const query=decodeURIComponent(new URL(url).searchParams.get('q')??''),name=/name = '([^']+)'/.exec(query)?.[1],epoch=/key='epoch_locator' and value='([^']+)'/.exec(query)?.[1],recovery=/key='recovery_locator' and value='([^']+)'/.exec(query)?.[1];return{files:[...this.remotes.values()].filter(item=>!item.trashed&&((name&&item.name===name)||(epoch&&item.properties.epoch_locator===epoch)||(recovery&&item.properties.recovery_locator===recovery))).map(item=>({id:item.id,name:item.name,mimeType:'application/vnd.google-apps.spreadsheet',trashed:false,appProperties:item.properties}))} as T}
    if(url==='https://sheets.googleapis.com/v4/spreadsheets'&&init?.method==='POST'){const body=JSON.parse(String(init.body)) as {properties:{title:string};sheets?:Array<{properties?:{title?:string}}>},recovery=body.sheets?.[0]?.properties?.title==='_a',id=`${recovery?'recovery':'successor'}-${this.next++}`;this.remotes.set(id,{id,name:body.properties.title,manifest:[],rows:[],properties:{},trashed:false,...(recovery?{artifact:''}:{})});if(!recovery)this.creates++;return{spreadsheetId:id} as T}
    const id=/spreadsheets\/([^/:?]+)/.exec(url)?.[1]??/drive\/v3\/files\/([^/?]+)/.exec(url)?.[1]
    const remote=id?this.remotes.get(decodeURIComponent(id)):undefined
    if(remote&&url.includes('/permissions?'))return{permissions:[{id:this.permission,type:'user',role:'owner',deleted:false}]} as T
    if(remote&&url.includes('/drive/v3/files/')){if(init?.method==='PATCH'){const body=JSON.parse(String(init.body)) as {appProperties?:Record<string,string>;trashed?:boolean};if(body.appProperties)remote.properties={...body.appProperties};if(body.trashed)remote.trashed=true}return{id:remote.id,name:remote.name,mimeType:'application/vnd.google-apps.spreadsheet',trashed:remote.trashed,ownedByMe:true,shared:false,isAppAuthorized:true,appProperties:remote.properties} as T}
    if(remote&&url.includes(':batchUpdate')){
      const body=JSON.parse(String(init?.body)) as {requests:Array<{updateCells?:{rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>};appendCells?:{rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>}}>}
      for(const request of body.requests){
        if(request.updateCells){const values=request.updateCells.rows[0]!.values.map(value=>value.userEnteredValue.stringValue);if(remote.artifact!==undefined)remote.artifact=values[0]??'';else remote.manifest=values}
        if(request.appendCells){
          const row=request.appendCells.rows[0]!.values.map(value=>value.userEnteredValue.stringValue)
          remote.rows.push(row)
          const key=`${remote.id}:${row[0]}`;this.appendCounts.set(key,(this.appendCounts.get(key)??0)+1)
          const matches=this.crashAfterAppend==='source'?remote.id==='source':this.crashAfterAppend==='successor'?remote.id!=='source':false
          if(matches){const target=this.crashAfterAppend;this.crashAfterAppend=null;throw Object.assign(new Error(`simulated crash after ${target} append`),{status:400})}
        }
      }
      return{} as T
    }
    if(remote&&url.includes('sheets(properties')&&!url.includes('ranges=')){if(remote.artifact!==undefined)return{sheets:[{properties:{sheetId:1,title:'_a',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:1}},merges:[]}]} as T;return{sheets:[{properties:{sheetId:1,title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}},merges:[]},{properties:{sheetId:2,title:'_r',sheetType:'GRID',gridProperties:{rowCount:Math.max(1,remote.rows.length),columnCount:3}},merges:[]}]} as T}
    if(remote&&url.includes('ranges=')&&decodeURIComponent(url).includes("'_a'"))return{sheets:[{properties:{sheetId:1,title:'_a'},data:remote.artifact?[{startRow:0,rowData:[{values:this.cells([remote.artifact])}]}]:[]}]} as T
    if(remote&&url.includes('ranges=')&&decodeURIComponent(url).includes("'_m'"))return{sheets:[{properties:{sheetId:1,title:'_m'},data:remote.manifest.length?[{startRow:0,rowData:[{values:this.cells(remote.manifest)}]}]:[]}]} as T
    if(remote&&url.includes('ranges=')&&decodeURIComponent(url).includes("'_r'"))return{sheets:[{properties:{sheetId:2,title:'_r'},data:remote.rows.length?[{startRow:0,rowData:remote.rows.map(row=>({values:this.cells(row)}))}]:[]}]} as T
    throw new Error(`Unexpected Google test request: ${init?.method??'GET'} ${url}`)
  }
}

function transactionComplete(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}
function deleteDatabase():Promise<void>{return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('eds-diary');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Test database deletion was blocked.'))})}

describe('ProductiveRotationService',()=>{
  beforeEach(async()=>{await __localDatabaseTesting.resetForTesting();await deleteDatabase();globalThis.localStorage?.clear?.()})

  it('survives the productive crash/resume matrix and a second complete rotation',async()=>{
    const createdAt='2026-09-16T12:00:00.000Z',urs=randomBytes(32),google=new GoogleBoundary(),repository=new IndexedDbRotationRepository()
    await putRecord(LOCAL_STORES.painEntries,pain('rotation-active'))
    await putRecord(LOCAL_STORES.painEntries,pain('rotation-tombstone'))
    await putRecord(LOCAL_STORES.painEntries,{...pain('rotation-tombstone'),status:'deleted' as const})
    const source=await repository.verifiedActiveEpoch(),sourceRows=source.envelopes.map(envelope=>[envelope.envelopeId,envelope.iv,envelope.ciphertext]),session=googleProviderSessionFromAuthenticatedClient(google.client),transport=await session.transportForEpoch(source.context.diaryId,source.context.epochId),account=await session.remoteIdentityBinding(transport),commitment=await recoveryCommitment(urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation)
    const manifest=await prepareManifest(source.rootKey,source.epochSalt,{diaryId:source.context.diaryId,epochId:source.context.epochId},{diary_id:source.context.diaryId,epoch_id:source.context.epochId,key_id:source.context.keyId,recovery_generation:source.state.recovery_generation,recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5',crypto_suite:'A256GCM-HKDF-SHA256-v5',sync_profile:'google-sheets-single-writer-v1',created_at:createdAt,google_account_binding:account,predecessor_epochs:[],record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),protocol_limits:{max_payload_bytes:16380,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000,max_unique_canonical_bytes:134217728,max_remote_physical_rows:100000,max_remote_physical_canonical_bytes:134217728,max_canonical_row_bytes:21936}})
    const fingerprint=await manifestFingerprint(manifest),sourceContext={...source.context,manifestFingerprint:fingerprint},sourceRemote:Remote={id:'source',name:'sync-source',manifest:[manifest.format,manifest.version,manifest.manifestIv,manifest.manifestCiphertext],rows:sourceRows,properties:{app_format:'sync-v5',epoch_locator:await epochLocator(source.context.diaryId,source.context.epochId)},trashed:false};google.remotes.set(sourceRemote.id,sourceRemote)
    const db=await __localDatabaseTesting.openDatabase(),keyTx=db.transaction(__localDatabaseTesting.STORES.wrappingKeys,'readonly'),key=await new Promise<CryptoKey>((resolve,reject)=>{const request=keyTx.objectStore(__localDatabaseTesting.STORES.wrappingKeys).get(source.context.wrapId);request.onsuccess=()=>resolve((request.result as {key:CryptoKey}).key);request.onerror=()=>reject(request.error)});await transactionComplete(keyTx);const wrap=await createBestEffortRootWrap(source.rootKey,key,{diary_id:source.context.diaryId,epoch_id:source.context.epochId,key_id:source.context.keyId,manifest_fingerprint:fingerprint},fromBase64Url(source.context.wrapId)),anchor=await createAnchor(source.context.diaryId,source.context.epochId,sourceRows),state={...source.state,manifest_fingerprint:fingerprint,recovery_urs_commitment:commitment,epoch_status:'active' as const,remote_binding:{provider_id:'google-sheets-single-writer-v1' as const,remote_resource_id:'source',remote_identity_binding:account},remote_anchor:anchor},tag=await stateTag(source.rootKey,source.epochSalt,state),tx=db.transaction([__localDatabaseTesting.STORES.state,__localDatabaseTesting.STORES.context,__localDatabaseTesting.STORES.wraps],'readwrite');tx.objectStore(__localDatabaseTesting.STORES.state).put({id:source.context.epochId,state,tag});tx.objectStore(__localDatabaseTesting.STORES.context).put(sourceContext);tx.objectStore(__localDatabaseTesting.STORES.wraps).put({id:source.context.epochId,wrap});await transactionComplete(tx)

    const runFault=async(point:ProductiveRotationFaultPoint)=>{let fired=false;const service=new ProductiveRotationService(session,transport,urs,()=>createdAt,current=>{if(current===point&&!fired){fired=true;throw new Error(`fault:${point}`)}});await expect(service.rotate()).rejects.toThrow(`fault:${point}`);expect(fired).toBe(true)}
    await runFault('after-root-wrap')
    await runFault('after-freeze')
    await expect(putRecord(LOCAL_STORES.painEntries,{...pain('rotation-active'),note:'mutation must stay frozen'})).rejects.toThrow('frozen')
    await runFault('after-source-snapshot')
    await runFault('after-successor-create')
    await runFault('after-first-copied-head')
    await runFault('after-migration-envelope')

    google.crashAfterAppend='successor'
    await expect(new ProductiveRotationService(session,transport,urs,()=>createdAt).rotate()).rejects.toThrow('simulated crash after successor append')
    expect(google.crashAfterAppend).toBeNull()
    await runFault('after-successor-anchor-durable')
    expect([...google.appendCounts.values()].every(count=>count===1)).toBe(true)

    await runFault('after-recovery-verified')
    const stagedRecovery=[...google.remotes.values()].filter(item=>!item.trashed&&item.properties.app_format==='sync-recovery-v5')
    expect(stagedRecovery).toHaveLength(1)
    expect(stagedRecovery[0]?.artifact).toBe('')
    await runFault('after-backup-verified')
    await runFault('after-announcement-envelope')

    sourceRemote.rows.push([...sourceRemote.rows[0]!])
    await expect(new ProductiveRotationService(session,transport,urs,()=>createdAt).rotate()).rejects.toThrow(/Source changed around the rotation announcement|no longer immediately extends/)
    const recoveryAfterBlockedCutover=[...google.remotes.values()].filter(item=>!item.trashed&&item.properties.app_format==='sync-recovery-v5')
    expect(recoveryAfterBlockedCutover).toHaveLength(1)
    expect(recoveryAfterBlockedCutover[0]?.artifact).toBe('')
    sourceRemote.rows.pop()

    google.crashAfterAppend='source'
    await expect(new ProductiveRotationService(session,transport,urs,()=>createdAt).rotate()).rejects.toThrow('simulated crash after source append')
    expect(google.crashAfterAppend).toBeNull()
    await runFault('after-announcement-durable')
    const recoveryAfterAnnouncement=[...google.remotes.values()].filter(item=>!item.trashed&&item.properties.app_format==='sync-recovery-v5')
    expect(recoveryAfterAnnouncement).toHaveLength(1)
    expect(recoveryAfterAnnouncement[0]?.artifact).not.toBe('')
    expect([...google.appendCounts.values()].every(count=>count===1)).toBe(true)

    await runFault('before-atomic-switch')
    await runFault('after-atomic-switch')

    const result=await new ProductiveRotationService(session,transport,urs,()=>createdAt).rotate(),active=await repository.verifiedActiveEpoch(),successors=[...google.remotes.values()].filter(item=>item.id!=='source'&&!item.trashed&&item.name.startsWith('sync-'))
    expect(result.state.step).toBe('switched')
    expect(google.creates).toBe(1)
    expect(successors).toHaveLength(1)
    const successor=successors[0]!
    expect(successor.name).toBe(`sync-${(result.state as typeof result.state&{creationLocator:string}).creationLocator}`)
    expect(successor.properties.epoch_locator).toBe(await epochLocator(active.context.diaryId,active.context.epochId))
    expect(successor.name.slice(5)).not.toBe(successor.properties.epoch_locator)
    expect(fromBase64Url(successor.name.slice(5))).toHaveLength(16)
    expect(fromBase64Url(successor.properties.epoch_locator!)).toHaveLength(16)
    expect(new Set(successor.rows.map(row=>row[0])).size).toBe(successor.rows.length)
    expect(new Set(sourceRemote.rows.map(row=>row[0])).size).toBe(sourceRemote.rows.length)
    expect([...google.appendCounts.values()].every(count=>count===1)).toBe(true)
    expect(active.state.epoch_status).toBe('active')
    expect(active.state.remote_anchor?.covered_row_count).toBe(successor.rows.length)

    const retired=await repository.verifiedEpoch(sourceContext),announcements=retired.revisions.filter(revision=>revision.record_schema==='rotation-announcement-sw-v1'),migration=active.revisions.filter(revision=>revision.record_schema==='epoch-migration-sw-v1'),copied=active.revisions.filter(revision=>revision.record_status!=='control')
    expect(retired.state.epoch_status).toBe('retired')
    expect(retired.state.remote_anchor?.covered_row_count).toBe(sourceRemote.rows.length)
    expect(announcements).toHaveLength(1)
    expect((announcements[0]!.record_data as {successor_creation_locator:string}).successor_creation_locator).toBe(successor.name.slice(5))
    expect(migration).toHaveLength(1)
    expect((migration[0]!.record_data as {active_head_count:number;tombstone_head_count:number}).active_head_count).toBe(1)
    expect((migration[0]!.record_data as {active_head_count:number;tombstone_head_count:number}).tombstone_head_count).toBe(1)
    expect(copied).toHaveLength(2)
    expect(copied.map(revision=>revision.record_status).sort()).toEqual(['active','deleted'])
    expect(result.state.successorSemanticSnapshot).toBe(result.state.sourceSemanticSnapshot)
    expect(result.recovery.recovery_artifact_id).toBeTruthy()
    expect(result.backup.backup_id).toBeTruthy()

    const firstRecoveryCandidate=await recoverRootKeyCandidate(result.recovery,urs),firstSuccessorRows=structuredClone(successor.rows),secondTransport=await session.transportForEpoch(active.context.diaryId,active.context.epochId),second=await new ProductiveRotationService(session,secondTransport,urs,()=> '2026-09-16T11:00:00.000Z').rotate(),secondRecoveryCandidate=await recoverRootKeyCandidate(second.recovery,urs),active2=await repository.verifiedActiveEpoch(),secondSuccessors=[...google.remotes.values()].filter(item=>item.id!=='source'&&item.id!==successor.id&&!item.trashed&&item.name.startsWith('sync-'))
    expect(second.state.step).toBe('switched')
    expect(secondRecoveryCandidate.payload.created_at>firstRecoveryCandidate.payload.created_at).toBe(true)
    expect(second.state.rotationId).not.toBe(result.state.rotationId)
    expect(google.creates).toBe(2)
    expect(active2.context.epochId).not.toBe(active.context.epochId)
    expect(secondSuccessors).toHaveLength(1)
    expect(successor.rows).toHaveLength(firstSuccessorRows.length+1)
    const firstSuccessorRetired=await repository.verifiedEpoch(active.context),secondMigration=active2.revisions.filter(revision=>revision.record_schema==='epoch-migration-sw-v1'),secondDomainHeads=active2.revisions.filter(revision=>revision.record_status!=='control')
    expect(firstSuccessorRetired.state.epoch_status).toBe('retired')
    expect(firstSuccessorRetired.revisions.filter(revision=>revision.record_schema==='rotation-announcement-sw-v1')).toHaveLength(1)
    expect(secondMigration).toHaveLength(1)
    expect(secondDomainHeads).toHaveLength(2)
    expect(secondDomainHeads.map(revision=>revision.record_status).sort()).toEqual(['active','deleted'])
    expect(second.state.successorSemanticSnapshot).toBe(second.state.sourceSemanticSnapshot)
    expect([...google.appendCounts.values()].every(count=>count===1)).toBe(true)

    await expect(putRecord(LOCAL_STORES.painEntries,{...pain('post-second-rotation-write'),note:'second successor remains writable after switched'})).resolves.toBeUndefined()
  },120_000)

  it('replaces a lost recovery key without requiring the old secret',async()=>{
    const createdAt='2026-09-16T15:00:00.000Z',oldUrs=randomBytes(32),newUrs=randomBytes(32),google=new GoogleBoundary(),repository=new IndexedDbRotationRepository()
    await putRecord(LOCAL_STORES.painEntries,pain('rekey-data'))
    const local=await repository.verifiedActiveEpoch(),session=googleProviderSessionFromAuthenticatedClient(google.client),initialTransport=await session.transportForEpoch(local.context.diaryId,local.context.epochId)
    await ProductiveRotationService.remoteEnablement(session,initialTransport,oldUrs,()=>createdAt).rotate()
    const before=await repository.verifiedActiveEpoch(),rekeyTransport=await session.transportForEpoch(before.context.diaryId,before.context.epochId)
    const result=await ProductiveRotationService.recoveryRekey(session,rekeyTransport,newUrs,()=> '2026-09-16T16:00:00.000Z').rotate()
    const after=await repository.verifiedActiveEpoch(),remoteArtifact=await session.loadRecoveryArtifact(newUrs),candidate=await recoverRootKeyCandidate(remoteArtifact,newUrs)
    const recoveryFile=[...google.remotes.values()].find(item=>!item.trashed&&item.properties.app_format==='sync-recovery-v5')
    expect(recoveryFile).toBeTruthy()
    recoveryFile!.name='user-renamed-recovery-artifact'
    expect((await session.loadRecoveryArtifact(newUrs)).recovery_artifact_id).toBe(remoteArtifact.recovery_artifact_id)
    expect(result.state.step).toBe('switched')
    expect(after.state.recovery_generation).toBe(before.state.recovery_generation+1)
    expect(candidate.payload.epoch_id).toBe(after.context.epochId)
    expect(candidate.payload.recovery_generation).toBe(after.state.recovery_generation)
    expect(after.revisions.some(revision=>(revision.record_data as {migration_kind?:string}|null)?.migration_kind==='recovery_rekey')).toBe(true)
    const oldArtifact=await session.loadRecoveryArtifact(oldUrs),oldCandidate=await recoverRootKeyCandidate(oldArtifact,oldUrs),oldTransport=await session.transportForEpoch(oldCandidate.payload.diary_id,oldCandidate.payload.epoch_id),oldLocator=await session.recoveryLocator(oldCandidate.payload.diary_id,oldCandidate.payload.epoch_id),oldResources=await oldTransport.discover(oldLocator)
    expect(oldResources).toHaveLength(1)
    const oldAuthority=await session.recoveryAuthority(oldTransport,oldLocator,oldResources[0]!.remoteId),oldVerifier=new RecoveryBootstrapVerifier({authority:oldAuthority,schemas:DOMAIN_SCHEMA_REGISTRY})
    await expect(oldVerifier.verifyCandidate(oldCandidate)).rejects.toThrow('retired epoch')
    await expect(session.loadRecoveryArtifact(randomBytes(32))).rejects.toThrow('No remote recovery artifact')
  },90_000)

  it('enables a remote epoch from a local-offline source without inventing a source remote',async()=>{
    const createdAt='2026-09-16T14:00:00.000Z',urs=randomBytes(32),google=new GoogleBoundary(),repository=new IndexedDbRotationRepository()
    await putRecord(LOCAL_STORES.painEntries,pain('local-enable'))
    const source=await repository.verifiedActiveEpoch()
    expect(source.state.epoch_status).toBe('local_offline')
    expect(source.state.remote_binding).toBeNull()
    expect(source.state.remote_anchor).toBeNull()
    const session=googleProviderSessionFromAuthenticatedClient(google.client),transport=await session.transportForEpoch(source.context.diaryId,source.context.epochId)
    const result=await ProductiveRotationService.remoteEnablement(session,transport,urs,()=>createdAt).rotate(),active=await repository.verifiedActiveEpoch(),retired=await repository.verifiedEpoch(source.context)
    expect(result.state.step).toBe('switched')
    expect(google.creates).toBe(1)
    expect([...google.remotes.values()].filter(item=>!item.trashed&&item.name.startsWith('sync-'))).toHaveLength(1)
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
})
