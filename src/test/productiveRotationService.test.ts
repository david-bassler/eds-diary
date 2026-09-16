import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProductiveRotationService } from '../data/productiveRotationService'
import { DOMAIN_SCHEMA_REGISTRY, IndexedDbRotationRepository, __localDatabaseTesting } from '../data/localDatabase'
import { fromBase64Url } from '../security/crypto/bytes'
import { randomBytes, recoveryCommitment } from '../security/crypto/core'
import { journalInitial, stateTag } from '../security/localState'
import { manifestFingerprint, prepareManifest, schemaRegistryHash, SCHEMA_ALLOWLIST } from '../security/manifest'
import { epochLocator, GoogleSheetsSingleWriterTransport } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'
import { createAnchor } from '../sync/core/prefix'

interface Remote {id:string;name:string;manifest:string[];rows:string[][];properties:Record<string,string>;trashed:boolean}
class GoogleBoundary {
  readonly permission='productive-rotation-test-owner'
  readonly remotes=new Map<string,Remote>()
  creates=0
  private next=1
  readonly client=issueControlledTestGoogleClient({identity:()=>this.permission,request:<T>(url:string,init?:RequestInit)=>this.request<T>(url,init)})
  private cells(values:readonly string[]){return values.map(value=>({userEnteredValue:{stringValue:value}}))}
  private async request<T>(url:string,init?:RequestInit):Promise<T>{
    if(url.includes('/about?'))return{user:{permissionId:this.permission}} as T
    if(url.includes('/drive/v3/files?q=')){const query=decodeURIComponent(new URL(url).searchParams.get('q')??''),name=/name = '([^']+)'/.exec(query)?.[1];return{files:[...this.remotes.values()].filter(item=>!item.trashed&&item.name===name).map(item=>({id:item.id,name:item.name,mimeType:'application/vnd.google-apps.spreadsheet',trashed:false,appProperties:item.properties}))} as T}
    if(url==='https://sheets.googleapis.com/v4/spreadsheets'&&init?.method==='POST'){const body=JSON.parse(String(init.body)) as {properties:{title:string}},id=`successor-${this.next++}`;this.remotes.set(id,{id,name:body.properties.title,manifest:[],rows:[],properties:{},trashed:false});this.creates++;return{spreadsheetId:id} as T}
    const id=/spreadsheets\/([^/:?]+)/.exec(url)?.[1]??/drive\/v3\/files\/([^/?]+)/.exec(url)?.[1]
    const remote=id?this.remotes.get(decodeURIComponent(id)):undefined
    if(remote&&url.includes('/permissions?'))return{permissions:[{id:this.permission,type:'user',role:'owner',deleted:false}]} as T
    if(remote&&url.includes('/drive/v3/files/')){if(init?.method==='PATCH'){const body=JSON.parse(String(init.body)) as {appProperties?:Record<string,string>;trashed?:boolean};if(body.appProperties)remote.properties={...body.appProperties};if(body.trashed)remote.trashed=true}return{id:remote.id,mimeType:'application/vnd.google-apps.spreadsheet',trashed:remote.trashed,ownedByMe:true,shared:false,isAppAuthorized:true,appProperties:remote.properties} as T}
    if(remote&&url.includes(':batchUpdate')){const body=JSON.parse(String(init?.body)) as {requests:Array<{updateCells?:{rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>};appendCells?:{rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>}}>};for(const request of body.requests){if(request.updateCells)remote.manifest=request.updateCells.rows[0]!.values.map(value=>value.userEnteredValue.stringValue);if(request.appendCells)remote.rows.push(request.appendCells.rows[0]!.values.map(value=>value.userEnteredValue.stringValue))}return{} as T}
    if(remote&&url.includes('sheets(properties')&&!url.includes('ranges='))return{sheets:[{properties:{sheetId:1,title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}},merges:[]},{properties:{sheetId:2,title:'_r',sheetType:'GRID',gridProperties:{rowCount:Math.max(1,remote.rows.length),columnCount:3}},merges:[]}]} as T
    if(remote&&url.includes('ranges=')&&decodeURIComponent(url).includes("'_m'"))return{sheets:[{properties:{sheetId:1,title:'_m'},data:remote.manifest.length?[{startRow:0,rowData:[{values:this.cells(remote.manifest)}]}]:[]}]} as T
    if(remote&&url.includes('ranges=')&&decodeURIComponent(url).includes("'_r'"))return{sheets:[{properties:{sheetId:2,title:'_r'},data:remote.rows.length?[{startRow:0,rowData:remote.rows.map(row=>({values:this.cells(row)}))}]:[]}]} as T
    throw new Error(`Unexpected Google test request: ${init?.method??'GET'} ${url}`)
  }
}

describe('ProductiveRotationService',()=>{
  beforeEach(async()=>{indexedDB.deleteDatabase('eds-diary');globalThis.localStorage?.clear?.()})
  it('rotates through persistent envelopes, coordinators, verified anchors and the atomic switch',async()=>{
    const urs=randomBytes(32),google=new GoogleBoundary(),repository=new IndexedDbRotationRepository(),source=await repository.verifiedActiveEpoch(),transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(google.client,source.context.diaryId,source.context.epochId),account=await transport.authenticatedAccountBinding(),createdAt='2026-09-16T12:00:00.000Z',commitment=await recoveryCommitment(urs,fromBase64Url(source.context.diaryId),source.state.recovery_generation)
    const manifest=await prepareManifest(source.rootKey,source.epochSalt,{diaryId:source.context.diaryId,epochId:source.context.epochId},{diary_id:source.context.diaryId,epoch_id:source.context.epochId,key_id:source.context.keyId,recovery_generation:source.state.recovery_generation,recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5',crypto_suite:'A256GCM-HKDF-SHA256-v5',sync_profile:'google-sheets-single-writer-v1',created_at:createdAt,google_account_binding:account,predecessor_epochs:[],record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),protocol_limits:{max_payload_bytes:16380,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000,max_unique_canonical_bytes:134217728,max_remote_physical_rows:100000,max_remote_physical_canonical_bytes:134217728,max_canonical_row_bytes:21936}})
    const sourceRemote:Remote={id:'source',name:'sync-source',manifest:[manifest.format,manifest.version,manifest.manifestIv,manifest.manifestCiphertext],rows:[],properties:{app_format:'sync-v5',epoch_locator:await epochLocator(source.context.diaryId,source.context.epochId)},trashed:false};google.remotes.set(sourceRemote.id,sourceRemote)
    const fingerprint=await manifestFingerprint(manifest),db=await __localDatabaseTesting.openDatabase(),anchor=await createAnchor(source.context.diaryId,source.context.epochId,[]),state={...source.state,manifest_fingerprint:fingerprint,recovery_urs_commitment:commitment,epoch_status:'active' as const,remote_binding:{provider_id:'google-sheets-single-writer-v1' as const,remote_resource_id:'source',remote_identity_binding:account},remote_anchor:anchor,local_journal_hash:await journalInitial(source.context.diaryId,source.context.epochId)},tag=await stateTag(source.rootKey,source.epochSalt,state),tx=db.transaction([__localDatabaseTesting.STORES.state,__localDatabaseTesting.STORES.context],'readwrite');tx.objectStore(__localDatabaseTesting.STORES.state).put({id:source.context.epochId,state,tag});tx.objectStore(__localDatabaseTesting.STORES.context).put({...source.context,manifestFingerprint:fingerprint});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
    const result=await new ProductiveRotationService(transport,urs,()=>createdAt).rotate(),active=await repository.verifiedActiveEpoch(),successor=[...google.remotes.values()].find(item=>item.id!=='source')!
    expect(result.state.step).toBe('switched');expect(google.creates).toBe(1);expect(successor.name).toBe(`sync-${(result.state as typeof result.state&{creationLocator:string}).creationLocator}`);expect(successor.properties.epoch_locator).toBe(await epochLocator(active.context.diaryId,active.context.epochId));expect(successor.name.slice(5)).not.toBe(successor.properties.epoch_locator);expect(fromBase64Url(successor.name.slice(5))).toHaveLength(16);expect(fromBase64Url(successor.properties.epoch_locator!)).toHaveLength(16);expect(successor.rows.length).toBeGreaterThan(0);expect(sourceRemote.rows).toHaveLength(1);expect(active.state.epoch_status).toBe('active');expect(active.state.remote_anchor).not.toBeNull();const retired=await repository.verifiedEpoch({...source.context,manifestFingerprint:fingerprint}),announcement=retired.revisions.find(revision=>revision.record_schema==='rotation-announcement-sw-v1');expect(retired.state.epoch_status).toBe('retired');expect((announcement?.record_data as {successor_creation_locator:string}).successor_creation_locator).toBe(successor.name.slice(5));expect(result.recovery.recovery_artifact_id).toBeTruthy();expect(result.backup.backup_id).toBeTruthy();const successorRows=structuredClone(successor.rows),sourceRows=structuredClone(sourceRemote.rows),resumed=await new ProductiveRotationService(transport,urs,()=>createdAt).rotate();expect(resumed.state.step).toBe('switched');expect(google.creates).toBe(1);expect(successor.rows).toEqual(successorRows);expect(sourceRemote.rows).toEqual(sourceRows)
  },30_000)
})
