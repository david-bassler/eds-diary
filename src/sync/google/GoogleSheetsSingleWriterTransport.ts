import { base64Url, concatBytes, fixedBase64Url, utf8 } from '../../security/crypto/bytes'
import { sha256 } from '../../security/crypto/core'
import { canonicalBytes } from '../../security/crypto/canonical'
import { ProviderBoundRemoteTransport, SINGLE_WRITER_PROFILE, TransportError, type RemoteCandidate, type RemoteSnapshot } from '../core/contracts'

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

export interface GoogleTransportBinding {
  diaryId: string
  epochId: string
  /** permissionId returned by drive.about.get, never an email address. */
  ownerPermissionId: string
  googleAccountBinding: string
}

const GRID_CHUNK_ROWS = 1_000
const MAX_GRID_ROWS = 100_000
const MAX_REMOTE_CANONICAL_BYTES = 134_217_728
const MAX_CANONICAL_ROW_BYTES = 21_936

async function expectedEpochLocator(binding: GoogleTransportBinding): Promise<string> {
  return base64Url((await sha256(concatBytes(
    utf8('sync-v5/epoch-locator'), new Uint8Array([0]),
    fixedBase64Url(binding.diaryId, 16), fixedBase64Url(binding.epochId, 16),
  ))).slice(0, 16))
}

async function expectedAccountBinding(binding: GoogleTransportBinding): Promise<string> {
  return base64Url(await sha256(concatBytes(
    utf8('eds-diary/google-account/v5'), new Uint8Array([0]),
    fixedBase64Url(binding.diaryId, 16), new Uint8Array([0]), utf8(binding.ownerPermissionId),
  )))
}

/** Strict Google wire adapter. Large grids are never requested before dimensions
 * are checked, and record data is subsequently fetched in bounded ranges. */
export class GoogleSheetsSingleWriterTransport extends ProviderBoundRemoteTransport {
  readonly profileId = SINGLE_WRITER_PROFILE
  private readonly sheetIds = new Map<string, number>()
  constructor(private readonly api: GoogleApiClient, private readonly binding?: GoogleTransportBinding) {super()}

  async discover(locator: string): Promise<readonly RemoteCandidate[]> {
    try {
      const name = `sync-${locator}`
      const escaped = name.replaceAll("'", "\\'")
      const q = encodeURIComponent(`name = '${escaped}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)
      const files: DriveFile[] = []
      let token: string | undefined
      do {
        const suffix = token ? `&pageToken=${encodeURIComponent(token)}` : ''
        const result = await this.api.request<{files?: DriveFile[]; nextPageToken?: string}>(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,mimeType,trashed,appProperties),nextPageToken&pageSize=1000${suffix}`)
        files.push(...(result.files ?? [])); token = result.nextPageToken
      } while (token)
      return files.flatMap((file) => file.id && file.name === name ? [{remoteId: file.id, locator}] : [])
    } catch (error) { throw normalize(error) }
  }

  async create(locator: string, manifest: readonly string[]): Promise<void> {
    try {
      const created = await this.api.request<{spreadsheetId?: string; sheets?: Sheet[]}>('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST', body: JSON.stringify({properties: {title: `sync-${locator}`}, sheets: [
          {properties: {title: '_m', sheetType: 'GRID', gridProperties: {rowCount: 1, columnCount: 4}}},
          {properties: {title: '_r', sheetType: 'GRID', gridProperties: {rowCount: 1, columnCount: 3}}},
        ]}),
      })
      if (!created.spreadsheetId) throw new TransportError('unknown_outcome', 'Create response omitted the candidate ID.')
      if(manifest.length)throw new TransportError('provider_incompatible','Manifest bytes must be written in the separately persisted manifest phase.')
    } catch (error) { throw normalize(error, true) }
  }

  async writeManifest(remoteId:string,manifest:readonly string[]):Promise<void>{
    if(manifest.length!==4)throw new TransportError('integrity_failure','Manifest must contain four exact cells.')
    try{const data=await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`),sheetId=data.sheets?.find(sheet=>sheet.properties?.title==='_m')?.properties?.sheetId;if(sheetId===undefined)throw new TransportError('integrity_failure','Manifest sheet missing.');await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:4},rows:[{values:manifest.map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}]})})}catch(error){throw normalize(error,true)}
  }

  async readProperties(remoteId:string):Promise<Readonly<Record<string,string>>>{try{return(await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=appProperties`)).appProperties??{}}catch(error){throw normalize(error)}}
  async patchProperties(remoteId:string,properties:Readonly<Record<string,string>>):Promise<void>{if(Object.keys(properties).sort().join('\0')!=='app_format\0epoch_locator'||properties.app_format!=='sync-v5')throw new TransportError('integrity_failure','Unexpected protocol properties.');try{await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,appProperties`,{method:'PATCH',body:JSON.stringify({appProperties:properties})})}catch(error){throw normalize(error,true)}}
  async orphanCandidates(remoteIds:readonly string[]):Promise<void>{for(const id of [...remoteIds].sort()){try{await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed`,{method:'PATCH',body:JSON.stringify({trashed:true})})}catch(error){throw normalize(error,true)}}}

  private async verifyDrive(remoteId: string,preBound=false): Promise<void> {
    if (!this.binding) throw new TransportError('integrity_failure', 'Trusted diary/account binding is required.')
    const file = await this.api.request<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?fields=id,mimeType,trashed,ownedByMe,shared,driveId,isAppAuthorized,appProperties`)
    if (file.mimeType !== 'application/vnd.google-apps.spreadsheet' || file.trashed !== false || file.ownedByMe !== true || file.shared !== false || file.driveId !== undefined || file.isAppAuthorized !== true) throw new TransportError('integrity_failure', 'Drive file invariants failed.')
    const properties = file.appProperties ?? {}
    const keys = Object.keys(properties).sort()
    const empty=keys.length===0
    if ((!preBound||!empty)&&(keys.join('\0') !== 'app_format\0epoch_locator' || properties.app_format !== 'sync-v5' || properties.epoch_locator !== await expectedEpochLocator(this.binding))) throw new TransportError('integrity_failure', 'Protocol appProperties do not match the trusted epoch.')
    if (this.binding.googleAccountBinding !== await expectedAccountBinding(this.binding)) throw new TransportError('integrity_failure', 'Trusted account binding does not match permissionId.')
    const permissions: Array<{id?: string; type?: string; role?: string; deleted?: boolean}> = []
    let token: string | undefined
    do {
      const suffix = token ? `&pageToken=${encodeURIComponent(token)}` : ''
      const page = await this.api.request<{permissions?: typeof permissions; nextPageToken?: string}>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}/permissions?fields=permissions(id,type,role,deleted),nextPageToken&includePermissionsForView=published&pageSize=100${suffix}`)
      permissions.push(...(page.permissions ?? [])); token = page.nextPageToken
    } while (token)
    if (permissions.length !== 1 || permissions[0]?.id !== this.binding.ownerPermissionId || permissions[0]?.type !== 'user' || permissions[0]?.role !== 'owner' || permissions[0]?.deleted === true) throw new TransportError('integrity_failure', 'Drive permission invariants failed.')
  }

  private structure(data: Spreadsheet): {manifest: Sheet; records: Sheet; recordRows: number} {
    const sheets = data.sheets ?? []
    if (sheets.length !== 2) throw new TransportError('integrity_failure', 'Exactly two sheets are required.')
    const manifest = sheets.find((sheet) => sheet.properties?.title === '_m')
    const records = sheets.find((sheet) => sheet.properties?.title === '_r')
    if (!manifest || !records || sheets.some((sheet) => sheet.properties?.sheetType !== 'GRID' || Boolean(sheet.merges?.length))) throw new TransportError('integrity_failure', 'Spreadsheet structure is incompatible.')
    const mp = manifest.properties!, rp = records.properties!, rowCount = rp.gridProperties?.rowCount
    if (mp.gridProperties?.columnCount !== 4 || mp.gridProperties.rowCount !== 1 || rp.gridProperties?.columnCount !== 3 || !rowCount || rowCount > MAX_GRID_ROWS || rp.sheetId === undefined) throw new TransportError('integrity_failure', 'Grid bounds are incompatible.')
    return {manifest, records, recordRows: rowCount}
  }

  private rowsFromGrid(sheet: Sheet, start: number, end: number): Array<Cell[] | undefined> {
    const rows: Array<Cell[] | undefined> = new Array(end - start)
    for (const grid of sheet.data ?? []) {
      const offset = grid.startRow ?? start
      for (const [index, row] of (grid.rowData ?? []).entries()) {
        const absolute = offset + index
        if (absolute >= start && absolute < end) rows[absolute - start] = row.values
      }
    }
    return rows
  }

  async inspectCandidate(remoteId:string):Promise<RemoteSnapshot>{return this.readGrid(remoteId,true)}
  async read(remoteId: string): Promise<RemoteSnapshot> {return this.readGrid(remoteId,false)}
  private async readGrid(remoteId: string,preBound:boolean): Promise<RemoteSnapshot> {
    try {
      await this.verifyDrive(remoteId,preBound)
      const structureFields = 'sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),merges)'
      const structure = this.structure(await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?fields=${encodeURIComponent(structureFields)}`))
      this.sheetIds.set(remoteId, structure.records.properties!.sheetId!)
      const gridFields = 'sheets(properties(sheetId,title),data(startRow,rowData(values(userEnteredValue,effectiveValue(errorValue)))))'
      const manifestData = await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?ranges=${encodeURIComponent("'_m'!A1:D1")}&includeGridData=true&fields=${encodeURIComponent(gridFields)}`)
      const manifestSheet = manifestData.sheets?.find((sheet) => sheet.properties?.title === '_m')
      if (!manifestSheet) throw new TransportError('integrity_failure', 'Manifest grid is missing.')
      const manifestRow = this.rowsFromGrid(manifestSheet, 0, 1)[0]
      const manifest = manifestRow ? rawStrings(manifestRow, 4) : []
      const physical: Array<Cell[] | undefined> = new Array(structure.recordRows)
      for (let start = 0; start < structure.recordRows; start += GRID_CHUNK_ROWS) {
        const end = Math.min(start + GRID_CHUNK_ROWS, structure.recordRows)
        const range = `'_r'!A${start + 1}:C${end}`
        const chunk = await this.api.request<Spreadsheet>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(gridFields)}`)
        const sheet = chunk.sheets?.find((item) => item.properties?.title === '_r')
        if (!sheet) throw new TransportError('integrity_failure', 'Record grid chunk is missing.')
        const rows = this.rowsFromGrid(sheet, start, end)
        rows.forEach((row, index) => { physical[start + index] = row })
      }
      let last = physical.length - 1
      while (last >= 0 && (!physical[last] || physical[last]!.length === 0)) last -= 1
      const rows: string[][] = []
      let byteCount = 0
      for (let index = 0; index <= last; index++) {
        const row = physical[index]
        if (!row || row.length === 0) throw new TransportError('integrity_failure', 'The protocol log contains a physical gap.')
        const strings = rawStrings(row, 3)
        const rowBytes=canonicalBytes(strings).byteLength
        if(rowBytes>MAX_CANONICAL_ROW_BYTES)throw new TransportError('integrity_failure','Canonical remote row exceeds its byte bound.')
        byteCount += rowBytes
        if (byteCount > MAX_REMOTE_CANONICAL_BYTES) throw new TransportError('integrity_failure', 'Remote canonical byte bound exceeded.')
        rows.push(strings)
      }
      return {manifest, rows}
    } catch (error) { throw normalize(error) }
  }

  async append(remoteId: string, row: readonly [string, string, string]): Promise<void> {
    try {
      const sheetId = this.sheetIds.get(remoteId)
      if (sheetId === undefined) throw new TransportError('conflict_or_unexpected_remote_change', 'A strict read is required before append.')
      const body = JSON.stringify({requests: [{appendCells: {sheetId, fields: 'userEnteredValue', rows: [{values: row.map((value) => ({userEnteredValue: {stringValue: value}}))}]}}]})
      if (utf8(body).byteLength > 24_000) throw new TransportError('integrity_failure', 'Append request exceeds the row bound.')
      await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}:batchUpdate`, {method: 'POST', body})
    } catch (error) { throw normalize(error, true) }
  }
}
