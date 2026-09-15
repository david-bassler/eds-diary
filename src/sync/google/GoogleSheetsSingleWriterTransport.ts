import { SINGLE_WRITER_PROFILE, TransportError, type RemoteCandidate, type RemoteSnapshot, type RemoteTransport } from '../core/contracts'

export interface GoogleApiClient { request<T>(url: string, init?: RequestInit): Promise<T>; identity(): string }
interface Cell { userEnteredValue?: { stringValue?: string; formulaValue?: string; numberValue?: number; boolValue?: boolean }; effectiveValue?: { errorValue?: unknown } }
interface Sheet { properties?: { sheetId?: number; title?: string; sheetType?: string; gridProperties?: { rowCount?: number; columnCount?: number } }; merges?: unknown[]; data?: Array<{ startRow?: number; rowData?: Array<{ values?: Cell[] }> }> }
interface Spreadsheet { sheets?: Sheet[] }
interface DriveFile { id?: string; name?: string; mimeType?: string; trashed?: boolean; ownedByMe?: boolean; shared?: boolean; driveId?: string; isAppAuthorized?: boolean; appProperties?: Record<string,string> }

function statusOf(error: unknown): number { return typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0 }
function normalize(error: unknown, mutation = false): TransportError {
  if (error instanceof TransportError) return error
  const status=statusOf(error); const code=status===401?'auth_required':status===403?'permission_denied':status===404?'not_found':status===409||status===412?'conflict_or_unexpected_remote_change':status===429?'rate_limited':status>=500?(mutation?'unknown_outcome':'temporary_failure'):'provider_incompatible'
  return new TransportError(code,error instanceof Error?error.message:'Provider request failed.')
}
function rawStrings(cells: Cell[], expectedColumns: number): string[] {
  if(cells.length!==expectedColumns)throw new TransportError('integrity_failure','Protocol row has the wrong column count.')
  return cells.map((cell)=>{const entered=cell.userEnteredValue;if(!entered||Object.keys(entered).length!==1||typeof entered.stringValue!=='string'||cell.effectiveValue?.errorValue)throw new TransportError('integrity_failure','Only user-entered string values are accepted.');return entered.stringValue})
}

export class GoogleSheetsSingleWriterTransport implements RemoteTransport {
  readonly profileId=SINGLE_WRITER_PROFILE
  private readonly sheetIds=new Map<string,number>()
  constructor(private readonly api:GoogleApiClient){}
  async discover(locator:string):Promise<readonly RemoteCandidate[]>{
    try { const name=`sync-${locator}`;const escaped=name.replaceAll("'","\\'");const q=encodeURIComponent(`name = '${escaped}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);const result=await this.api.request<{files?:DriveFile[]}>(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,mimeType,trashed,appProperties)&pageSize=1000`);return(result.files??[]).flatMap((file)=>file.id&&file.name===name?[{remoteId:file.id,locator}]:[])}catch(error){throw normalize(error)}
  }
  async create(locator:string,manifest:readonly string[]):Promise<void>{
    let id:string
    try { const created=await this.api.request<{spreadsheetId?:string}>('https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',body:JSON.stringify({properties:{title:`sync-${locator}`},sheets:[{properties:{title:'_m',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:4}}},{properties:{title:'_r',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:3}}}]})});if(!created.spreadsheetId)throw new TransportError('unknown_outcome','Create response omitted the candidate ID.');id=created.spreadsheetId }catch(error){throw normalize(error,true)}
    try { await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{updateCells:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:4},rows:[{values:manifest.map((value)=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}]})}) }catch(error){throw normalize(error,true)}
  }
  private async verifyDrive(remoteId:string):Promise<void>{
    const file=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties`)
    if(file.mimeType!=='application/vnd.google-apps.spreadsheet'||file.trashed!==false||file.ownedByMe!==true||file.shared!==false||file.driveId!==undefined||file.isAppAuthorized!==true)throw new TransportError('integrity_failure','Drive file invariants failed.')
    let token:string|undefined;const permissions:unknown[]=[]
    do { const suffix=token?`&pageToken=${encodeURIComponent(token)}`:'';const page=await this.api.request<{permissions?:Array<{id?:string;type?:string;role?:string;deleted?:boolean}>;nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}/permissions?fields=permissions(id,type,role,deleted),nextPageToken&includePermissionsForView=published&pageSize=100${suffix}`);permissions.push(...(page.permissions??[]));token=page.nextPageToken }while(token)
    const identity=this.api.identity();if(permissions.length!==1||!permissions.every((permission)=>{const p=permission as {id?:string;type?:string;role?:string;deleted?:boolean};return p.id===identity&&p.type==='user'&&p.role==='owner'&&!p.deleted}))throw new TransportError('integrity_failure','Drive permission invariants failed.')
  }
  async read(remoteId:string):Promise<RemoteSnapshot>{
    try { await this.verifyDrive(remoteId);const fields='sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),merges,data(startRow,rowData(values(userEnteredValue,effectiveValue(errorValue)))))';const data=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?includeGridData=true&fields=${encodeURIComponent(fields)}`);const sheets=data.sheets??[];if(sheets.length!==2)throw new TransportError('integrity_failure','Exactly two sheets are required.');const manifest=sheets.find((sheet)=>sheet.properties?.title==='_m'),records=sheets.find((sheet)=>sheet.properties?.title==='_r');if(!manifest||!records||sheets.some((sheet)=>sheet.properties?.sheetType!=='GRID'||Boolean(sheet.merges?.length)))throw new TransportError('integrity_failure','Spreadsheet structure is incompatible.');const mp=manifest.properties!,rp=records.properties!;if(mp.gridProperties?.columnCount!==4||mp.gridProperties.rowCount!==1||rp.gridProperties?.columnCount!==3||!rp.gridProperties.rowCount||rp.gridProperties.rowCount>100000||rp.sheetId===undefined)throw new TransportError('integrity_failure','Grid bounds are incompatible.');this.sheetIds.set(remoteId,rp.sheetId);const manifestRows=manifest.data?.flatMap((grid)=>grid.rowData??[])??[];if(manifestRows.length!==1)throw new TransportError('integrity_failure','Manifest must have one physical row.');const rows=(records.data?.flatMap((grid)=>grid.rowData??[])??[]).map((row)=>row.values??[]);let last=rows.length-1;while(last>=0&&(rows[last]?.length??0)===0)last-=1;for(let i=0;i<=last;i++)if((rows[i]?.length??0)===0)throw new TransportError('integrity_failure','The protocol log contains a gap.');return{manifest:rawStrings(manifestRows[0].values??[],4),rows:rows.slice(0,last+1).map((row)=>rawStrings(row,3))} }catch(error){throw normalize(error)}
  }
  async append(remoteId:string,row:readonly[string,string,string]):Promise<void>{
    try { const sheetId=this.sheetIds.get(remoteId);if(sheetId===undefined)throw new TransportError('conflict_or_unexpected_remote_change','A strict read is required before append.');const body=JSON.stringify({requests:[{appendCells:{sheetId,fields:'userEnteredValue',rows:[{values:row.map((value)=>({userEnteredValue:{stringValue:value}}))}]}}]});if(new TextEncoder().encode(body).byteLength>24000)throw new TransportError('integrity_failure','Append request exceeds the row bound.');await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}:batchUpdate`,{method:'POST',body}) }catch(error){throw normalize(error,true)}
  }
}
