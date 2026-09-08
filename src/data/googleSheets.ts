export type SheetCell = string | number | boolean
export type SheetSpecs = Record<string, readonly string[]>

export interface GoogleConfig {
  clientId: string
  sheetId: string
}

export type GoogleStatusKind = 'neutral' | 'good' | 'bad'

interface GoogleTokenResponse {
  access_token?: string
  error?: string
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
  }): GoogleTokenClient
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2
      }
    }
  }
}

interface SpreadsheetCreateResponse {
  spreadsheetId?: string
}

interface SpreadsheetMetadataResponse {
  sheets?: Array<{
    properties?: {
      title?: string
    }
  }>
}

interface ValueRangeResponse {
  values?: SheetCell[][]
}

interface BatchGetResponse {
  valueRanges?: ValueRangeResponse[]
}

const CONFIG_KEY = 'eds-diary-google-config-v1'
const CLIENT_ID =
  '708446377117-vhj86jrhngsj0i289vffdl4q1nfri7c3.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

const connectionListeners = new Set<(connected: boolean) => void>()
const statusListeners = new Set<(message: string, kind: GoogleStatusKind) => void>()

let accessToken = ''
let tokenClient: GoogleTokenClient | null = null
let requestTail: Promise<void> = Promise.resolve()
let knownSheetId = ''
let knownTitles: Set<string> | null = null
const ensuredHeaders = new Map<string, string>()
let currentStatus = {
  message: 'Nicht verbunden. Lokale Speicherung ist aktiv.',
  kind: 'neutral' as GoogleStatusKind,
}

function loadConfig(): GoogleConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { clientId: CLIENT_ID, sheetId: '' }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { clientId: CLIENT_ID, sheetId: '' }
    }

    const value = parsed as Record<string, unknown>
    return {
      clientId: CLIENT_ID,
      sheetId: typeof value.sheetId === 'string' ? value.sheetId : '',
    }
  } catch {
    return { clientId: CLIENT_ID, sheetId: '' }
  }
}

let config = loadConfig()

function emitConnection(): void {
  for (const listener of connectionListeners) listener(isGoogleConnected())
}

function emitStatus(message: string, kind: GoogleStatusKind = 'neutral'): void {
  currentStatus = { message, kind }
  for (const listener of statusListeners) listener(message, kind)
}

function resetSheetCache(): void {
  knownSheetId = config.sheetId
  knownTitles = null
  ensuredHeaders.clear()
}

function normalizeSheetId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : trimmed
}

export function getGoogleConfig(): GoogleConfig {
  return { ...config }
}

export function setGoogleConfig(next: GoogleConfig): GoogleConfig {
  const previousSheetId = config.sheetId

  config = {
    clientId: CLIENT_ID,
    sheetId: normalizeSheetId(next.sheetId),
  }

  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))

  if (config.sheetId !== previousSheetId) resetSheetCache()

  return getGoogleConfig()
}

export function isGoogleConnected(): boolean {
  return Boolean(accessToken)
}

export function isGoogleSyncReady(): boolean {
  return isGoogleConnected() && Boolean(config.sheetId)
}

export function onGoogleConnection(
  listener: (connected: boolean) => void,
): () => void {
  connectionListeners.add(listener)
  listener(isGoogleConnected())
  return () => connectionListeners.delete(listener)
}

export function onGoogleStatus(
  listener: (message: string, kind: GoogleStatusKind) => void,
): () => void {
  statusListeners.add(listener)
  listener(currentStatus.message, currentStatus.kind)
  return () => statusListeners.delete(listener)
}

export function connectGoogle(): void {
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) {
    throw new Error('Google Identity ist noch nicht geladen. Bitte kurz warten und erneut versuchen.')
  }

  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          emitStatus(`Google-Anmeldung fehlgeschlagen: ${response.error}`, 'bad')
          return
        }

        accessToken = response.access_token ?? ''
        emitConnection()
        emitStatus(
          'Verbunden. Der Google Access Token bleibt nur im Arbeitsspeicher.',
          'good',
        )
      },
    })
  }

  tokenClient.requestAccessToken({ prompt: 'consent' })
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('Retry-After')

  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000)

    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.max(1000, date - Date.now())
  }

  return Math.min(12_000, 1000 * 2 ** attempt)
}

async function apiAttempt<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new Error('Bitte zuerst mit Google verbinden.')

  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { ...options, headers })

    if (response.status === 401) {
      accessToken = ''
      emitConnection()
      throw new Error('Google-Zugriff ist abgelaufen. Bitte erneut verbinden.')
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < 4) {
      const waitMilliseconds = retryDelay(response, attempt)
      emitStatus(
        response.status === 429
          ? `Google begrenzt gerade die Anfragen. Neuer Versuch in etwa ${Math.ceil(waitMilliseconds / 1000)} s …`
          : 'Google ist vorübergehend nicht erreichbar. Neuer Versuch läuft …',
      )
      await sleep(waitMilliseconds)
      continue
    }

    const body = await response.text()
    throw new Error(`Google API: ${response.status} ${body.slice(0, 260)}`)
  }

  throw new Error(
    'Google-Synchronisierung konnte nach mehreren Versuchen nicht abgeschlossen werden.',
  )
}

function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const run = requestTail.then(
    () => apiAttempt<T>(url, options),
    () => apiAttempt<T>(url, options),
  )

  requestTail = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}

function sheetsUrl(path = ''): string {
  if (!config.sheetId) throw new Error('Keine Spreadsheet-ID eingetragen.')
  return `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}${path}`
}

function headerSignature(headers: readonly string[]): string {
  return headers.join('\u001f')
}

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

export async function createSpreadsheet(
  sheetSpecs: SheetSpecs,
): Promise<GoogleConfig> {
  const titles = Object.keys(sheetSpecs)
  if (!titles.length) throw new Error('Mindestens ein Tabellenblatt wird benötigt.')

  const data = await api<SpreadsheetCreateResponse>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: 'EDS Schmerztagebuch' },
        sheets: titles.map((title) => ({ properties: { title } })),
      }),
    },
  )

  if (!data.spreadsheetId) {
    throw new Error('Google hat keine Spreadsheet-ID zurückgegeben.')
  }

  config = { ...config, sheetId: data.spreadsheetId }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  resetSheetCache()
  await ensureSheets(sheetSpecs)
  return getGoogleConfig()
}

export async function batchGetValues(
  ranges: readonly string[],
): Promise<ValueRangeResponse[]> {
  if (!ranges.length) return []

  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&')
  const data = await api<BatchGetResponse>(
    sheetsUrl(`/values:batchGet?majorDimension=ROWS&${query}`),
  )

  return Array.isArray(data.valueRanges) ? data.valueRanges : []
}

export async function batchWriteValues(
  data: ReadonlyArray<{
    range: string
    majorDimension: 'ROWS'
    values: readonly (readonly SheetCell[])[]
  }>,
): Promise<void> {
  if (!data.length) return

  await api(sheetsUrl('/values:batchUpdate'), {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })
}

export async function batchClearValues(ranges: readonly string[]): Promise<void> {
  if (!ranges.length) return

  await api(sheetsUrl('/values:batchClear'), {
    method: 'POST',
    body: JSON.stringify({ ranges }),
  })
}

export async function ensureSheets(sheetSpecs: SheetSpecs): Promise<void> {
  if (!config.sheetId) throw new Error('Keine Spreadsheet-ID eingetragen.')
  if (knownSheetId !== config.sheetId) resetSheetCache()

  const pending = Object.entries(sheetSpecs).filter(
    ([title, headers]) => ensuredHeaders.get(title) !== headerSignature(headers),
  )
  if (!pending.length) return

  if (!knownTitles) {
    const metadata = await api<SpreadsheetMetadataResponse>(
      sheetsUrl('?fields=sheets.properties.title'),
    )
    knownTitles = new Set(
      (metadata.sheets ?? [])
        .map((sheet) => sheet.properties?.title)
        .filter((title): title is string => Boolean(title)),
    )
  }

  const titles = knownTitles
  const missingTitles = pending
    .map(([title]) => title)
    .filter((title) => !titles.has(title))

  if (missingTitles.length) {
    await api(sheetsUrl(':batchUpdate'), {
      method: 'POST',
      body: JSON.stringify({
        requests: missingTitles.map((title) => ({
          addSheet: { properties: { title } },
        })),
      }),
    })
    for (const title of missingTitles) titles.add(title)
  }

  const ranges = pending.map(
    ([title, headers]) => `${title}!A1:${columnName(headers.length)}1`,
  )
  const headerData = await batchGetValues(ranges)
  const missingHeaders: Array<{
    range: string
    majorDimension: 'ROWS'
    values: readonly (readonly SheetCell[])[]
  }> = []

  pending.forEach(([title, headers], index) => {
    const values = headerData[index]?.values
    if (!Array.isArray(values) || !values.length) {
      missingHeaders.push({
        range: `${title}!A1:${columnName(headers.length)}1`,
        majorDimension: 'ROWS',
        values: [headers],
      })
    }
  })

  await batchWriteValues(missingHeaders)

  for (const [title, headers] of pending) {
    ensuredHeaders.set(title, headerSignature(headers))
  }
}

export async function replaceTables(
  tables: Record<
    string,
    {
      headers: readonly string[]
      rows: readonly (readonly SheetCell[])[]
    }
  >,
): Promise<void> {
  const entries = Object.entries(tables)
  if (!entries.length) return

  const specs = Object.fromEntries(
    entries.map(([title, table]) => [title, table.headers]),
  )
  await ensureSheets(specs)

  await batchWriteValues(
    entries.map(([title, table]) => ({
      range: `${title}!A1:${columnName(table.headers.length)}${table.rows.length + 1}`,
      majorDimension: 'ROWS' as const,
      values: [table.headers, ...table.rows],
    })),
  )

  await batchClearValues(
    entries.map(
      ([title, table]) => `${title}!A${table.rows.length + 2}:ZZ`,
    ),
  )
}

export async function replaceTable(
  title: string,
  headers: readonly string[],
  rows: readonly (readonly SheetCell[])[],
): Promise<void> {
  await replaceTables({ [title]: { headers, rows } })
}

export async function loadTables(
  sheetSpecs: SheetSpecs,
): Promise<Record<string, SheetCell[][]>> {
  const entries = Object.entries(sheetSpecs)
  if (!entries.length) return {}

  await ensureSheets(sheetSpecs)

  const ranges = entries.map(
    ([title, headers]) => `${title}!A2:${columnName(headers.length)}`,
  )
  const result = await batchGetValues(ranges)

  return Object.fromEntries(
    entries.map(([title], index) => [
      title,
      Array.isArray(result[index]?.values) ? result[index].values : [],
    ]),
  )
}

export async function loadTable(
  title: string,
  headers: readonly string[],
): Promise<SheetCell[][]> {
  const result = await loadTables({ [title]: headers })
  return result[title] ?? []
}

export function googleSheetUrl(): string {
  return config.sheetId
    ? `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`
    : ''
}
