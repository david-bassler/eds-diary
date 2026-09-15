import { SINGLE_WRITER_PROFILE, TransportError, type RemoteCandidate, type RemoteSnapshot, type RemoteTransport } from '../core/contracts'

export interface GoogleApiClient {
  request<T>(url: string, init?: RequestInit): Promise<T>
  identity(): string
}
interface ValuesResponse { values?: unknown[][] }
interface SearchResponse { files?: Array<{ id?: string; appProperties?: Record<string, string> }> }
interface CreateResponse { spreadsheetId?: string }

function normalize(error: unknown): TransportError {
  if (error instanceof TransportError) return error
  return new TransportError('unknown_outcome', error instanceof Error ? error.message : 'Unknown provider outcome.')
}

export class GoogleSheetsSingleWriterTransport implements RemoteTransport {
  readonly profileId = SINGLE_WRITER_PROFILE
  constructor(private readonly api: GoogleApiClient) {}
  async discover(locator: string): Promise<readonly RemoteCandidate[]> {
    const query = encodeURIComponent(`trashed = false and appProperties has { key='eds_locator' and value='${locator.replaceAll("'", "\\'")}' }`)
    const result = await this.api.request<SearchResponse>(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,appProperties)`)
    return (result.files ?? []).flatMap((file) => file.id ? [{ remoteId: file.id, locator }] : [])
  }
  async create(locator: string, manifest: readonly string[]): Promise<void> {
    try {
      const created = await this.api.request<CreateResponse>('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: 'EDS Diary encrypted sync' }, sheets: [{ properties: { title: '_m' }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: manifest.map((value) => ({ userEnteredValue: { stringValue: value } })) }] }] }, { properties: { title: '_r' } }] }) })
      if (!created.spreadsheetId) throw new Error('Create response did not identify the remote.')
      await this.api.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.spreadsheetId)}?fields=id`, { method: 'PATCH', body: JSON.stringify({ appProperties: { eds_locator: locator, eds_profile: SINGLE_WRITER_PROFILE } }) })
    } catch (error) { throw normalize(error) }
  }
  async read(remoteId: string): Promise<RemoteSnapshot> {
    try {
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}/values:batchGet?majorDimension=ROWS&ranges=_m!A1:D2&ranges=_r!A1:C100000`
      const result = await this.api.request<{ valueRanges?: ValuesResponse[] }>(base)
      const manifestRows = result.valueRanges?.[0]?.values ?? []
      const rows = result.valueRanges?.[1]?.values ?? []
      if (manifestRows.length !== 1) throw new TransportError('integrity_failure', 'Manifest must contain exactly one row.')
      const strings = (values: unknown[]): string[] => values.map((value) => { if (typeof value !== 'string') throw new TransportError('integrity_failure', 'Only raw strings are accepted.'); return value })
      return { manifest: strings(manifestRows[0] ?? []), rows: rows.map(strings) }
    } catch (error) { throw normalize(error) }
  }
  async append(remoteId: string, row: readonly [string, string, string]): Promise<void> {
    try { await this.api.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(remoteId)}/values/_r!A:C:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }) }) } catch (error) { throw normalize(error) }
  }
}
