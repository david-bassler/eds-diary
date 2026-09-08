import {
  loadTables,
  replaceTable,
  type SheetCell,
  type SheetSpecs,
} from '../../data/googleSheets'
import { registerSyncFeature } from '../../data/syncManager'
import type { ActivityEntry } from './activityEntry'
import { normalizeActivityColor } from './activityColors'
import {
  listActivityEntries,
  storeActivityEntriesFromSync,
} from './activityRepository'

const ENTRY_SHEET_TITLE = 'Aktivitaeten'

const ENTRY_HEADERS = [
  'ID',
  'Datum',
  'Beginn',
  'Ende',
  'Aktivitaet',
  'Notiz',
  'Status',
  'Erstellt',
  'Aktualisiert',
  'Farbe',
] as const

export const activitySheetSpecs: SheetSpecs = {
  [ENTRY_SHEET_TITLE]: ENTRY_HEADERS,
}

function text(cell: SheetCell | undefined): string {
  return cell === undefined ? '' : String(cell)
}

function fromRow(row: SheetCell[]): ActivityEntry | null {
  const id = text(row[0]).trim()
  const date = text(row[1]).trim()
  const startTime = text(row[2]).trim()
  const endTime = text(row[3]).trim()
  const activityName = text(row[4]).trim()
  if (!id || !date || !startTime || !endTime || !activityName) return null

  const createdAt = text(row[7]).trim() || new Date(0).toISOString()
  const updatedAt = text(row[8]).trim() || createdAt

  return {
    id,
    date,
    startTime,
    endTime,
    activityName,
    color: normalizeActivityColor(text(row[9]).trim(), activityName),
    note: text(row[5]).trim(),
    status: text(row[6]) === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function toRow(entry: ActivityEntry): readonly SheetCell[] {
  return [
    entry.id,
    entry.date,
    entry.startTime,
    entry.endTime,
    entry.activityName,
    entry.note,
    entry.status,
    entry.createdAt,
    entry.updatedAt,
    entry.color,
  ]
}

function mergeById(
  localEntries: readonly ActivityEntry[],
  remoteEntries: readonly ActivityEntry[],
): ActivityEntry[] {
  const merged = new Map<string, ActivityEntry>()

  for (const entry of [...remoteEntries, ...localEntries]) {
    const existing = merged.get(entry.id)
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      merged.set(entry.id, entry)
    }
  }

  return [...merged.values()]
}

async function pushActivityData(): Promise<void> {
  const entries = await listActivityEntries({ includeDeleted: true })
  await replaceTable(ENTRY_SHEET_TITLE, ENTRY_HEADERS, entries.map(toRow))
}

export async function syncActivityEntries(): Promise<void> {
  const localEntries = await listActivityEntries({ includeDeleted: true })
  const tables = await loadTables(activitySheetSpecs)

  const remoteEntries = (tables[ENTRY_SHEET_TITLE] ?? []).flatMap((row) => {
    const entry = fromRow(row)
    return entry ? [entry] : []
  })

  const mergedEntries = mergeById(localEntries, remoteEntries)
  await storeActivityEntriesFromSync(mergedEntries)
  await replaceTable(
    ENTRY_SHEET_TITLE,
    ENTRY_HEADERS,
    mergedEntries.map(toRow),
  )
}

export function initializeActivitySync(): void {
  registerSyncFeature('activityEntries', {
    push: pushActivityData,
    full: syncActivityEntries,
  })
}
