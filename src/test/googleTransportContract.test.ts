import { describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'
import { epochLocator, GoogleSheetsSingleWriterTransport, type GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { TransportError } from '../sync/core/contracts'

const diaryId=base64Url(new Uint8Array(16).fill(1))
const epochId=base64Url(new Uint8Array(16).fill(2))
const owner='permission-owner-1'
const manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','BBBBBBBBBBBBBBBBBBBBBB'] as const

class ContractClient implements GoogleApiClient {
  readonly calls:Array<{url:string;init?:RequestInit}>=[]
  failAppend=false
  async request<T>(url:string,init?:RequestInit):Promise<T>{
    this.calls.push({url,init})
    const parsed=new URL(url)
    if(parsed.pathname==='/drive/v3/about')return {user:{permissionId:owner}} as T
    if(parsed.pathname==='/drive/v3/files/file-1/permissions')return {permissions:[{id:owner,type:'user',role:'owner',deleted:false}]} as T
    if(parsed.pathname==='/drive/v3/files/file-1'&&parsed.searchParams.get('fields')?.startsWith('id,mimeType'))return {id:'file-1',mimeType:'application/vnd.google-apps.spreadsheet',trashed:false,ownedByMe:true,shared:false,isAppAuthorized:true,appProperties:{app_format:'sync-v5',epoch_locator:await epochLocator(diaryId,epochId)}} as T
    if(parsed.hostname==='sheets.googleapis.com'&&parsed.pathname==='/v4/spreadsheets/file-1'&&!parsed.searchParams.has('ranges'))return {sheets:[{properties:{sheetId:1,title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}},merges:[]},{properties:{sheetId:2,title:'_r',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:3}},merges:[]}]} as T
    if(parsed.hostname==='sheets.googleapis.com'&&parsed.pathname==='/v4/spreadsheets/file-1'&&parsed.searchParams.get('ranges')==="'_m'!A1:D1")return {sheets:[{properties:{sheetId:1,title:'_m'},data:[{startRow:0,rowData:[{values:manifest.map(value=>({userEnteredValue:{stringValue:value}}))}]}]}]} as T
    if(parsed.hostname==='sheets.googleapis.com'&&parsed.pathname==='/v4/spreadsheets/file-1'&&parsed.searchParams.get('ranges')==="'_r'!A1:C1")return {sheets:[{properties:{sheetId:2,title:'_r'},data:[]}]} as T
    if(url==='https://sheets.googleapis.com/v4/spreadsheets'&&init?.method==='POST')return {spreadsheetId:'created-1'} as T
    if(url.includes('spreadsheets/file-1:batchUpdate')&&init?.method==='POST'){
      if(this.failAppend){const error=Object.assign(new Error('provider timeout'),{status:503});throw error}
      return {} as T
    }
    throw new Error(`Unexpected Google contract request: ${url}`)
  }
  identity():string{return owner}
}

async function transport(client:ContractClient):Promise<GoogleSheetsSingleWriterTransport>{issueControlledTestGoogleClient(client);return GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(client,diaryId,epochId)}

describe('Google single-writer provider contract',()=>{
  it('creates only the strict two-grid resource and never writes a manifest during create',async()=>{const client=new ContractClient(),adapter=await transport(client);await adapter.create('locator-1',[]);const call=client.calls.find(item=>item.url==='https://sheets.googleapis.com/v4/spreadsheets'&&item.init?.method==='POST');expect(call).toBeTruthy();const body=JSON.parse(String(call?.init?.body)) as {properties:{title:string};sheets:Array<{properties:{title:string;sheetType:string;gridProperties:{rowCount:number;columnCount:number}}}>};expect(body.properties.title).toBe('sync-locator-1');expect(body.sheets).toEqual([{properties:{title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}}},{properties:{title:'_r',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:3}}}])})

  it('requires a strict read before append and uses AppendCells with exact persisted row bytes',async()=>{const client=new ContractClient(),adapter=await transport(client),row=['env','iv','cipher'] as const;await expect(adapter.append('file-1',row)).rejects.toMatchObject({code:'conflict_or_unexpected_remote_change'});const snapshot=await adapter.read('file-1');expect(snapshot.manifest).toEqual(manifest);expect(snapshot.rows).toEqual([]);await adapter.append('file-1',row);const mutation=[...client.calls].reverse().find(item=>item.url.includes('spreadsheets/file-1:batchUpdate')&&item.init?.method==='POST');const body=JSON.parse(String(mutation?.init?.body)) as {requests:Array<{appendCells:{sheetId:number;fields:string;rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>}}>};expect(body.requests[0]?.appendCells.sheetId).toBe(2);expect(body.requests[0]?.appendCells.fields).toBe('userEnteredValue');expect(body.requests[0]?.appendCells.rows[0]?.values.map(cell=>cell.userEnteredValue.stringValue)).toEqual(row)})

  it('maps an ambiguous append failure to unknown_outcome',async()=>{const client=new ContractClient(),adapter=await transport(client);await adapter.read('file-1');client.failAppend=true;await expect(adapter.append('file-1',['env','iv','cipher'])).rejects.toSatisfy((error:unknown)=>error instanceof TransportError&&error.code==='unknown_outcome')})
})
