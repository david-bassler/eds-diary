import { canonicalBytes } from '../../security/crypto/canonical'
import { recoveryArtifactFromGridV6, recoveryArtifactToGridV6, RECOVERY_GRID_ROWS_V6 } from '../../security/v2/recoveryGrid'
import {
  openRecoveryArtifactV6,
  recoveryArtifactHashV6,
  recoveryArtifactLocatorV6,
  recoveryFamilyLocatorV6,
  type RecoveryArtifactV6,
} from '../../security/v2/recovery'
import { isAuthenticatedGoogleApiClient } from './GoogleAuthProvider'
import { googleAccountBindingV2, type GoogleApiClient } from './GoogleSheetsTransferableSingleWriterV2Transport'
import { isVerifiedPersistedRecoveryArtifactV6, type VerifiedPersistedRecoveryArtifactV6 } from '../../security/v2/localPersistence'

interface DriveFile {
  id?:string
  name?:string
  mimeType?:string
  trashed?:boolean
  ownedByMe?:boolean
  shared?:boolean
  driveId?:string
  isAppAuthorized?:boolean
  appProperties?:Record<string,string>
}
interface Cell {
  userEnteredValue?:{stringValue?:string;formulaValue?:string;numberValue?:number;boolValue?:boolean}
  effectiveValue?:{errorValue?:unknown}
}
interface Sheet {
  properties?:{sheetId?:number;title?:string;sheetType?:string;gridProperties?:{rowCount?:number;columnCount?:number}}
  merges?:unknown[]
  data?:Array<{startRow?:number;rowData?:Array<{values?:Cell[]}>}>
}
interface Spreadsheet {spreadsheetId?:string;sheets?:Sheet[]}

const NAME_PREFIX='eds-diary-recovery-'
const FORMAT='sync-recovery-v6'

function escapeDriveQuery(value:string):string{return value.replaceAll('\\','\\\\').replaceAll("'","\\'")}
function sameProperties(actual:Readonly<Record<string,string>>,expected:Readonly<Record<string,string>>):boolean{
  return JSON.stringify(Object.entries(actual).sort())===JSON.stringify(Object.entries(expected).sort())
}
function artifactBytes(artifact:RecoveryArtifactV6):string{return new TextDecoder().decode(canonicalBytes(artifact as never))}

export class GoogleRecoveryArtifactStoreV6 {
  constructor(private readonly api:GoogleApiClient){
    if(!isAuthenticatedGoogleApiClient(api))throw new Error('RecoveryArtifactV6 storage requires an authenticated Google API capability.')
  }

  private expectedProperties(familyLocator:string,artifactLocator:string):Readonly<Record<string,string>>{
    return{app_format:FORMAT,recovery_family_locator:familyLocator,recovery_artifact_locator:artifactLocator}
  }

  private async candidates(artifactLocator:string):Promise<DriveFile[]>{
    const name=`${NAME_PREFIX}${artifactLocator}`,queries=[
      `name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      `appProperties has { key='recovery_artifact_locator' and value='${artifactLocator}' } and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    ],found=new Map<string,DriveFile>()
    for(const query of queries){
      let token:string|undefined
      do{
        const q=encodeURIComponent(query),suffix=token?`&pageToken=${encodeURIComponent(token)}`:''
        const result=await this.api.request<{files?:DriveFile[];nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties),nextPageToken&pageSize=1000${suffix}`)
        for(const file of result.files??[])if(file.id&&(file.name===name||file.appProperties?.recovery_artifact_locator===artifactLocator))found.set(file.id,file)
        token=result.nextPageToken
      }while(token)
    }
    return[...found.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  }

  async discoverFamily(urs:Uint8Array):Promise<readonly string[]>{
    const family=await recoveryFamilyLocatorV6(urs),query=encodeURIComponent(`appProperties has { key='recovery_family_locator' and value='${family}' } and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)
    const ids:string[]=[]
    let token:string|undefined
    do{
      const suffix=token?`&pageToken=${encodeURIComponent(token)}`:''
      const result=await this.api.request<{files?:DriveFile[];nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id),nextPageToken&pageSize=1000${suffix}`)
      for(const file of result.files??[])if(file.id)ids.push(file.id)
      token=result.nextPageToken
    }while(token)
    return[...new Set(ids)].sort()
  }

  private async verifyFile(remoteId:string,expected:Readonly<Record<string,string>>,allowEmptyProperties:boolean):Promise<void>{
    const file=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,name,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties`)
    if(file.id!==remoteId||file.mimeType!=='application/vnd.google-apps.spreadsheet'||file.trashed!==false||file.ownedByMe!==true||file.shared!==false||file.driveId!==undefined||file.isAppAuthorized!==true)throw new Error('RecoveryArtifactV6 Drive invariants failed.')
    const properties=file.appProperties??{}
    if(!(allowEmptyProperties&&Object.keys(properties).length===0)&&!sameProperties(properties,expected))throw new Error('RecoveryArtifactV6 appProperties mismatch.')
    const permissions:Array<{id?:string;type?:string;role?:string;deleted?:boolean}>=[]
    let token:string|undefined
    do{
      const suffix=token?`&pageToken=${encodeURIComponent(token)}`:''
      const page=await this.api.request<{permissions?:typeof permissions;nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}/permissions?fields=permissions(id,type,role,deleted),nextPageToken&pageSize=100${suffix}`)
      permissions.push(...(page.permissions??[]));token=page.nextPageToken
    }while(token)
    if(permissions.length!==1||permissions[0]?.id!==this.api.identity()||permissions[0]?.type!=='user'||permissions[0]?.role!=='owner'||permissions[0]?.deleted===true)throw new Error('RecoveryArtifactV6 Drive permissions are not private owner-only.')
  }

  private async sheetId(remoteId:string):Promise<number>{
    const structure=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?fields=${encodeURIComponent('sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),merges)')}`)
    const sheets=structure.sheets??[]
    if(sheets.length!==1)throw new Error('RecoveryArtifactV6 spreadsheet structure is invalid.')
    const sheet=sheets[0],p=sheet?.properties
    if(p?.title!=='_a'||p.sheetType!=='GRID'||p.gridProperties?.rowCount!==RECOVERY_GRID_ROWS_V6||p.gridProperties?.columnCount!==1||(sheet?.merges?.length??0)!==0||p.sheetId===undefined)throw new Error('RecoveryArtifactV6 spreadsheet structure is invalid.')
    return p.sheetId
  }

  private rowsFromGrid(sheet:Sheet):string[]{
    const cells=Array<string>(RECOVERY_GRID_ROWS_V6).fill('')
    for(const grid of sheet.data??[]){
      const start=grid.startRow??0
      for(const [offset,row] of (grid.rowData??[]).entries()){
        const index=start+offset
        if(index<0||index>=RECOVERY_GRID_ROWS_V6)throw new Error('RecoveryArtifactV6 grid contains out-of-range data.')
        const values=row.values??[]
        if(values.length>1)throw new Error('RecoveryArtifactV6 grid contains extra columns.')
        const cell=values[0]
        if(!cell)continue
        if(cell.effectiveValue?.errorValue)throw new Error('RecoveryArtifactV6 grid contains an error value.')
        if(!cell.userEnteredValue)continue
        if(Object.keys(cell.userEnteredValue).length!==1||typeof cell.userEnteredValue.stringValue!=='string')throw new Error('RecoveryArtifactV6 grid requires exact string cells.')
        cells[index]=cell.userEnteredValue.stringValue
      }
    }
    return cells
  }

  private async readArtifact(remoteId:string):Promise<RecoveryArtifactV6|null>{
    await this.sheetId(remoteId)
    const fields='sheets(properties(sheetId,title),data(startRow,rowData(values(userEnteredValue,effectiveValue(errorValue)))))'
    const data=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?ranges=${encodeURIComponent("'_a'!A1:A45")}&includeGridData=true&fields=${encodeURIComponent(fields)}`)
    const sheet=data.sheets?.find(item=>item.properties?.title==='_a')
    if(!sheet)throw new Error('RecoveryArtifactV6 grid is missing.')
    const cells=this.rowsFromGrid(sheet)
    if(cells.every(cell=>cell===''))return null
    return recoveryArtifactFromGridV6(cells)
  }

  private async createBlank(artifactLocator:string):Promise<void>{
    try{
      await this.api.request<Spreadsheet>('https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',body:JSON.stringify({
        properties:{title:`${NAME_PREFIX}${artifactLocator}`},
        sheets:[{properties:{title:'_a',sheetType:'GRID',gridProperties:{rowCount:RECOVERY_GRID_ROWS_V6,columnCount:1}}}],
      })})
    }catch{/* Unknown create outcome is decided exclusively by discovery/readback. */}
  }

  private async trash(remoteIds:readonly string[]):Promise<void>{
    for(const id of [...remoteIds].sort()){
      try{await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed`,{method:'PATCH',body:JSON.stringify({trashed:true})})}
      catch{/* Convergence is decided by subsequent discovery. */}
    }
  }

  private async classify(
    candidates:readonly DriveFile[],
    expectedProperties:Readonly<Record<string,string>>,
    expectedArtifact:RecoveryArtifactV6,
  ):Promise<Array<{id:string;kind:'empty'|'exact'|'conflicting'}>>{
    const expectedBytes=artifactBytes(expectedArtifact),result:Array<{id:string;kind:'empty'|'exact'|'conflicting'}>=[]
    for(const candidate of candidates){
      if(!candidate.id)continue
      try{
        await this.verifyFile(candidate.id,expectedProperties,true)
        const props=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(candidate.id)}?fields=appProperties`)
        const actual=props.appProperties??{}
        if(Object.keys(actual).length!==0&&!sameProperties(actual,expectedProperties)){result.push({id:candidate.id,kind:'conflicting'});continue}
        const artifact=await this.readArtifact(candidate.id)
        result.push({id:candidate.id,kind:artifact===null?'empty':artifactBytes(artifact)===expectedBytes?'exact':'conflicting'})
      }catch{result.push({id:candidate.id,kind:'conflicting'})}
    }
    return result.sort((a,b)=>a.id.localeCompare(b.id))
  }

  async publish(urs:Uint8Array,persisted:VerifiedPersistedRecoveryArtifactV6):Promise<string>{
    if(!isVerifiedPersistedRecoveryArtifactV6(persisted))throw new Error('Persistent/readback-verified RecoveryArtifactV6 is required before remote publish.')
    const {artifact,diaryId,epochId}=persisted
    const payload=(await openRecoveryArtifactV6(artifact,urs)).payload
    if(payload.diary_id!==diaryId||payload.epoch_id!==epochId)throw new Error('RecoveryArtifactV6 publish context mismatch.')
    if(payload.google_account_binding!==await googleAccountBindingV2(diaryId,this.api.identity()))throw new Error('RecoveryArtifactV6 Google account binding mismatch.')
    const family=await recoveryFamilyLocatorV6(urs),locator=await recoveryArtifactLocatorV6(urs,diaryId,epochId)
    if(family!==persisted.familyLocator||locator!==persisted.artifactLocator||await recoveryArtifactHashV6(artifact)!==persisted.artifactSha256)throw new Error('Persisted RecoveryArtifactV6 identity no longer matches publish input.')
    const expected=this.expectedProperties(family,locator)
    const converge=async():Promise<{chosen:string|null;classified:Awaited<ReturnType<GoogleRecoveryArtifactStoreV6['classify']>>}>=>{
      const classified=await this.classify(await this.candidates(locator),expected,artifact)
      if(classified.some(item=>item.kind==='conflicting'))throw new Error('RecoveryArtifactV6 discovery is conflicting.')
      if(!classified.length)return{chosen:null,classified}
      const exact=classified.filter(item=>item.kind==='exact'),chosen=(exact[0]??classified[0])!.id
      const duplicates=classified.filter(item=>item.id!==chosen).map(item=>item.id)
      if(duplicates.length){
        await this.trash(duplicates)
        const visible=await this.candidates(locator)
        if(visible.some(item=>item.id&&duplicates.includes(item.id)))throw new Error('RecoveryArtifactV6 duplicate convergence is ambiguous.')
      }
      return{chosen,classified}
    }

    let {chosen}=await converge()
    if(!chosen){
      await this.createBlank(locator)
      ;({chosen}=await converge())
      if(!chosen)throw new Error('RecoveryArtifactV6 create outcome remains unresolved.')
    }

    await this.verifyFile(chosen,expected,true)
    const props=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(chosen)}?fields=appProperties`)
    if(!sameProperties(props.appProperties??{},expected)){
      try{await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(chosen)}?fields=id,appProperties`,{method:'PATCH',body:JSON.stringify({appProperties:expected})})}
      catch{/* readback decides */}
    }
    await this.verifyFile(chosen,expected,false)
    const prior=await this.readArtifact(chosen)
    if(prior&&artifactBytes(prior)!==artifactBytes(artifact))throw new Error('RecoveryArtifactV6 immutable slot already contains different bytes.')
    if(!prior){
      const cells=await recoveryArtifactToGridV6(artifact),sheetId=await this.sheetId(chosen)
      try{
        await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(chosen)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{updateCells:{
          range:{sheetId,startRowIndex:0,endRowIndex:RECOVERY_GRID_ROWS_V6,startColumnIndex:0,endColumnIndex:1},
          rows:cells.map(value=>({values:[{userEnteredValue:{stringValue:value}}]})),
          fields:'userEnteredValue',
        }}]})})
      }catch{/* full grid readback decides */}
    }
    const readback=await this.readArtifact(chosen)
    if(!readback||artifactBytes(readback)!==artifactBytes(artifact))throw new Error('RecoveryArtifactV6 write outcome did not reconcile.')
    ;({chosen}=await converge())
    if(!chosen)throw new Error('RecoveryArtifactV6 final discovery failed.')
    return chosen
  }

  async find(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6|null>{
    const family=await recoveryFamilyLocatorV6(urs),locator=await recoveryArtifactLocatorV6(urs,diaryId,epochId),expected=this.expectedProperties(family,locator)
    const candidates=await this.candidates(locator)
    if(candidates.length===0)return null
    if(candidates.length!==1||!candidates[0]?.id)throw new Error('RecoveryArtifactV6 discovery is ambiguous.')
    await this.verifyFile(candidates[0].id,expected,false)
    const artifact=await this.readArtifact(candidates[0].id)
    if(!artifact)return null
    const payload=(await openRecoveryArtifactV6(artifact,urs)).payload
    if(payload.diary_id!==diaryId||payload.epoch_id!==epochId||payload.google_account_binding!==await googleAccountBindingV2(diaryId,this.api.identity()))throw new Error('RecoveryArtifactV6 discovered payload binding mismatch.')
    return artifact
  }

  async load(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6>{
    const artifact=await this.find(urs,diaryId,epochId)
    if(!artifact)throw new Error('No RecoveryArtifactV6 matches this diary/epoch and recovery key.')
    return artifact
  }

  async expectedArtifactIdentity(urs:Uint8Array,diaryId:string,epochId:string,artifact:RecoveryArtifactV6):Promise<{familyLocator:string;artifactLocator:string;artifactSha256:string}>{
    return{familyLocator:await recoveryFamilyLocatorV6(urs),artifactLocator:await recoveryArtifactLocatorV6(urs,diaryId,epochId),artifactSha256:await recoveryArtifactHashV6(artifact)}
  }
}
