import { canonicalJson, parseStrictJson } from '../../security/crypto/canonical'
import { utf8 } from '../../security/crypto/bytes'
import { recoverRootKeyCandidate, recoveryArtifactLocator, type RecoveryArtifact } from '../../security/recovery'
import { isAuthenticatedGoogleApiClient } from './GoogleAuthProvider'
import type { GoogleApiClient } from './GoogleSheetsSingleWriterTransport'

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
  userEnteredValue?:{stringValue?:string}
  effectiveValue?:{errorValue?:unknown}
}
interface Sheet {
  properties?:{sheetId?:number;title?:string;sheetType?:string;gridProperties?:{rowCount?:number;columnCount?:number}}
  merges?:unknown[]
  data?:Array<{startRow?:number;rowData?:Array<{values?:Cell[]}>}>
}
interface Spreadsheet { spreadsheetId?:string;sheets?:Sheet[] }

const NAME_PREFIX='eds-diary-recovery-'
const FORMAT='sync-recovery-v5'
const MAX_ARTIFACT_CHARS=20_000

function escapeDriveQuery(value:string):string{return value.replaceAll('\\','\\\\').replaceAll("'","\\'")}
function expectedProperties(locator:string):Readonly<Record<string,string>>{return{app_format:FORMAT,recovery_locator:locator}}
function sameProperties(actual:Readonly<Record<string,string>>,expected:Readonly<Record<string,string>>):boolean{return JSON.stringify(Object.entries(actual).sort())===JSON.stringify(Object.entries(expected).sort())}

export class GoogleRecoveryArtifactStore {
  constructor(private readonly api:GoogleApiClient){
    if(!isAuthenticatedGoogleApiClient(api))throw new Error('Recovery artifact storage requires an authenticated Google API capability.')
  }

  private async candidates(locator:string):Promise<DriveFile[]>{
    const name=`${NAME_PREFIX}${locator}`,queries=[
      `name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      `appProperties has { key='recovery_locator' and value='${locator}' } and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    ],found=new Map<string,DriveFile>()
    for(const query of queries){
      let token:string|undefined
      do{
        const q=encodeURIComponent(query),suffix=token?`&pageToken=${encodeURIComponent(token)}`:''
        const result=await this.api.request<{files?:DriveFile[];nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties),nextPageToken&pageSize=1000${suffix}`)
        for(const file of result.files??[])if(file.id&&(file.name===name||file.appProperties?.recovery_locator===locator))found.set(file.id,file)
        token=result.nextPageToken
      }while(token)
    }
    return[...found.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  }

  private async verifyFile(remoteId:string,locator:string,allowEmptyProperties=false):Promise<void>{
    const file=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,name,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties`)
    if(file.id!==remoteId||file.name!==`${NAME_PREFIX}${locator}`||file.mimeType!=='application/vnd.google-apps.spreadsheet'||file.trashed!==false||file.ownedByMe!==true||file.shared!==false||file.driveId!==undefined||file.isAppAuthorized!==true)throw new Error('Recovery artifact Drive invariants failed.')
    const properties=file.appProperties??{}
    if(!(allowEmptyProperties&&Object.keys(properties).length===0)&&!sameProperties(properties,expectedProperties(locator)))throw new Error('Recovery artifact properties do not match the secret-derived locator.')
    const permissions:Array<{id?:string;type?:string;role?:string;deleted?:boolean}>=[]
    let token:string|undefined
    do{
      const suffix=token?`&pageToken=${encodeURIComponent(token)}`:''
      const page=await this.api.request<{permissions?:typeof permissions;nextPageToken?:string}>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}/permissions?fields=permissions(id,type,role,deleted),nextPageToken&pageSize=100${suffix}`)
      permissions.push(...(page.permissions??[]));token=page.nextPageToken
    }while(token)
    if(permissions.length!==1||permissions[0]?.id!==this.api.identity()||permissions[0]?.type!=='user'||permissions[0]?.role!=='owner'||permissions[0]?.deleted===true)throw new Error('Recovery artifact Drive permissions are not private owner-only.')
  }

  private async artifactSheetId(remoteId:string):Promise<number>{
    const structure=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?fields=${encodeURIComponent('sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),merges)')}`),sheets=structure.sheets??[]
    if(sheets.length!==1)throw new Error('Recovery artifact spreadsheet structure is invalid.')
    const sheet=sheets[0],properties=sheet?.properties
    if(properties?.title!=='_a'||properties.sheetType!=='GRID'||properties.gridProperties?.rowCount!==1||properties.gridProperties?.columnCount!==1||(sheet?.merges?.length??0)!==0||properties.sheetId===undefined)throw new Error('Recovery artifact spreadsheet structure is invalid.')
    return properties.sheetId
  }

  private async readArtifactText(remoteId:string):Promise<string|null>{
    await this.artifactSheetId(remoteId)
    const fields='sheets(properties(sheetId,title),data(startRow,rowData(values(userEnteredValue,effectiveValue(errorValue)))))'
    const data=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?ranges=${encodeURIComponent("'_a'!A1:A1")}&includeGridData=true&fields=${encodeURIComponent(fields)}`)
    const sheet=data.sheets?.find(item=>item.properties?.title==='_a'),cell=sheet?.data?.[0]?.rowData?.[0]?.values?.[0]
    if(!cell)return null
    if(cell.effectiveValue?.errorValue||!cell.userEnteredValue||Object.keys(cell.userEnteredValue).length!==1||typeof cell.userEnteredValue.stringValue!=='string')throw new Error('Recovery artifact cell is not an exact string value.')
    return cell.userEnteredValue.stringValue
  }

  private async create(locator:string):Promise<string>{
    try{
      await this.api.request<Spreadsheet>('https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',body:JSON.stringify({properties:{title:`${NAME_PREFIX}${locator}`},sheets:[{properties:{title:'_a',sheetType:'GRID',gridProperties:{rowCount:1,columnCount:1}}}]})})
    }catch{/* Unknown create outcomes are established by discovery below. */}
    const candidates=await this.candidates(locator)
    if(candidates.length!==1||!candidates[0]?.id)throw new Error(candidates.length>1?'Recovery artifact creation is ambiguous.':'Recovery artifact resource could not be reconciled.')
    return candidates[0].id
  }

  async publish(secret:Uint8Array,artifact:RecoveryArtifact):Promise<void>{
    const locator=await recoveryArtifactLocator(secret),encoded=canonicalJson(artifact as never)
    if(encoded.length>MAX_ARTIFACT_CHARS)throw new Error('Recovery artifact exceeds the remote cell bound.')
    let candidates=await this.candidates(locator)
    if(candidates.length>1)throw new Error('Recovery artifact discovery is ambiguous.')
    const remoteId=candidates[0]?.id??await this.create(locator)
    await this.verifyFile(remoteId,locator,true)
    const properties=await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=appProperties`)
    if(!sameProperties(properties.appProperties??{},expectedProperties(locator))){
      await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,appProperties`,{method:'PATCH',body:JSON.stringify({appProperties:expectedProperties(locator)})})
    }
    await this.verifyFile(remoteId,locator)
    const prior=await this.readArtifactText(remoteId)
    if(prior!==null&&prior!==encoded){
      const priorArtifact=parseStrictJson(utf8(prior)) as unknown as RecoveryArtifact
      const [previous,next]=await Promise.all([recoverRootKeyCandidate(priorArtifact,secret),recoverRootKeyCandidate(artifact,secret)])
      if(previous.payload.diary_id!==next.payload.diary_id)throw new Error('Recovery artifact locator is already bound to a different diary.')
      if(next.payload.recovery_generation<previous.payload.recovery_generation||(next.payload.recovery_generation===previous.payload.recovery_generation&&next.payload.created_at<=previous.payload.created_at))throw new Error('Recovery artifact rollback or ambiguous replacement was rejected.')
    }
    if(prior!==encoded){
      const sheetId=await this.artifactSheetId(remoteId)
      try{
        await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{stringValue:encoded}}]}],fields:'userEnteredValue'}}]})})
      }catch{/* Readback decides whether the write took effect. */}
    }
    if(await this.readArtifactText(remoteId)!==encoded)throw new Error('Recovery artifact remote write did not reconcile.')
    candidates=await this.candidates(locator)
    if(candidates.length!==1||candidates[0]?.id!==remoteId)throw new Error('Recovery artifact resource is no longer unique.')
  }

  async load(secret:Uint8Array):Promise<RecoveryArtifact>{
    const locator=await recoveryArtifactLocator(secret),candidates=await this.candidates(locator)
    if(candidates.length!==1||!candidates[0]?.id)throw new Error(candidates.length?'Recovery artifact discovery is ambiguous.':'No remote recovery artifact matches this recovery key.')
    await this.verifyFile(candidates[0].id,locator)
    const text=await this.readArtifactText(candidates[0].id)
    if(!text)throw new Error('Remote recovery artifact is empty.')
    const parsed=parseStrictJson(utf8(text)) as unknown
    if(canonicalJson(parsed as never)!==text)throw new Error('Remote recovery artifact is not stored canonically.')
    return parsed as RecoveryArtifact
  }
}
