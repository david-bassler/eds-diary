export type SheetCell = string | number | boolean
export type SheetSpecs = Record<string, readonly string[]>

/** @deprecated Legacy whole-table Google configuration. Productive sync uses
 * the authenticated immutable-envelope data layer instead. */
export interface GoogleConfig {
  clientId: string
  sheetId: string
}

export type GoogleStatusKind = 'neutral' | 'good' | 'bad'

const DISABLED_MESSAGE =
  'Legacy plaintext Google-Sheets synchronization is disabled. Use the authenticated immutable-envelope sync path.'

const connectionListeners = new Set<(connected: boolean) => void>()
const statusListeners = new Set<(message: string, kind: GoogleStatusKind) => void>()
const disabledConfig: GoogleConfig = { clientId: '', sheetId: '' }

function disabled(): never {
  throw new Error(DISABLED_MESSAGE)
}

/** @deprecated Productive code must not persist provider or spreadsheet configuration here. */
export function getGoogleConfig(): GoogleConfig {
  return { ...disabledConfig }
}

/** @deprecated Manual spreadsheet binding is forbidden by the secure profile. */
export function setGoogleConfig(next: GoogleConfig): GoogleConfig {
  void next
  return disabled()
}

/** @deprecated Provider authentication no longer lives in this module. */
export function isGoogleConnected(): boolean {
  return false
}

/** @deprecated Productive readiness is represented by the secure synchronizer. */
export function isGoogleSyncReady(): boolean {
  return false
}

/** @deprecated Kept only so dead legacy feature modules remain type-compatible. */
export function onGoogleConnection(
  listener: (connected: boolean) => void,
): () => void {
  connectionListeners.add(listener)
  listener(false)
  return () => connectionListeners.delete(listener)
}

/** @deprecated Kept only so dead legacy feature modules remain type-compatible. */
export function onGoogleStatus(
  listener: (message: string, kind: GoogleStatusKind) => void,
): () => void {
  statusListeners.add(listener)
  listener(DISABLED_MESSAGE, 'neutral')
  return () => statusListeners.delete(listener)
}

/** @deprecated Authentication is handled by GoogleAuthProvider on the isolated auth origin. */
export function connectGoogle(): never {
  return disabled()
}

/** Utility retained for legacy table codecs and tests; it has no network authority. */
export function columnName(count: number): string {
  let value = count
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

/** @deprecated Legacy plaintext/table-shaped remote creation is disabled. */
export async function createSpreadsheet(sheetSpecs: SheetSpecs): Promise<GoogleConfig> {
  void sheetSpecs
  return disabled()
}

/** @deprecated Legacy plaintext/table-shaped remote reads are disabled. */
export async function batchGetValues(ranges: readonly string[]): Promise<Array<{ values?: SheetCell[][] }>> {
  void ranges
  return disabled()
}

/** @deprecated Legacy plaintext/table-shaped remote writes are disabled. */
export async function batchWriteValues(
  data: ReadonlyArray<{
    range: string
    majorDimension: 'ROWS'
    values: readonly (readonly SheetCell[])[]
  }>,
): Promise<void> {
  void data
  return disabled()
}

/** @deprecated Legacy plaintext/table-shaped remote writes are disabled. */
export async function batchClearValues(ranges: readonly string[]): Promise<void> {
  void ranges
  return disabled()
}

/** @deprecated Legacy plaintext/table-shaped remote mutation is disabled. */
export async function ensureSheets(sheetSpecs: SheetSpecs): Promise<void> {
  void sheetSpecs
  return disabled()
}

/** @deprecated Legacy whole-table writers are disabled. */
export async function replaceTables(
  tables: Record<
    string,
    {
      headers: readonly string[]
      rows: readonly (readonly SheetCell[])[]
    }
  >,
): Promise<void> {
  void tables
  return disabled()
}

/** @deprecated Legacy whole-table writers are disabled. */
export async function replaceTable(
  title: string,
  headers: readonly string[],
  rows: readonly (readonly SheetCell[])[],
): Promise<void> {
  void title
  void headers
  void rows
  return disabled()
}

/** @deprecated Legacy whole-table readers are disabled. */
export async function loadTables(
  sheetSpecs: SheetSpecs,
): Promise<Record<string, SheetCell[][]>> {
  void sheetSpecs
  return disabled()
}

/** @deprecated Legacy whole-table readers are disabled. */
export async function loadTable(
  title: string,
  headers: readonly string[],
): Promise<SheetCell[][]> {
  void title
  void headers
  return disabled()
}

/** @deprecated Manual spreadsheet IDs are not part of the secure profile. */
export function googleSheetUrl(): string {
  return ''
}
