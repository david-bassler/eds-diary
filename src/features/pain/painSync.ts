import {
  loadTable,
  replaceTable,
  type SheetCell,
  type SheetSpecs,
} from '../../data/googleSheets'
import { registerSyncFeature } from '../../data/syncManager'
import type { PainEntry, PainLocation } from './painEntry'
import {
  listPainEntries,
  storePainEntriesFromSync,
} from './painRepository'

const SHEET_TITLE = 'Schmerzeintraege'
const HEADERS = [
  'ID',
  'Beginn',
  'Ende',
  'Koerperregionen_JSON',
  'Schmerzstaerke',
  'Schmerzarten_JSON',
  'Notiz',
  'Status',
  'Erstellt',
  'Aktualisiert',
] as const

export const painSheetSpecs: SheetSpecs = {
  [SHEET_TITLE]: HEADERS,
}

function text(cell: SheetCell | undefined): string {
  return cell === undefined ? '' : String(cell)
}

function parseLocations(value: SheetCell | undefined): PainLocation[] {
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item): PainLocation[] => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const view = record.view
      const regionId = record.regionId

      if (
        (view !== 'front' && view !== 'back') ||
        typeof regionId !== 'string' ||
        !regionId.trim()
      ) {
        return []
      }

      return [{ view, regionId: regionId.trim() }]
    })
  } catch {
    return []
  }
}

function parseStrings(value: SheetCell | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    if (!Array.isArray(parsed)) return []

    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ]
  } catch {
    return []
  }
}

function parseIntensity(value: SheetCell | undefined): number | null {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(10, Math.max(0, parsed))
}

function fromRow(row: SheetCell[]): PainEntry | null {
  const id = text(row[0]).trim()
  if (!id) return null

  const createdAt = text(row[8]).trim() || new Date(0).toISOString()
  const updatedAt = text(row[9]).trim() || createdAt

  return {
    id,
    startedAt: text(row[1]).trim() || createdAt,
    endedAt: text(row[2]).trim(),
    locations: parseLocations(row[3]),
    intensity: parseIntensity(row[4]),
    qualities: parseStrings(row[5]),
    note: text(row[6]),
    status: text(row[7]) === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function toRow(entry: PainEntry): readonly SheetCell[] {
  return [
    entry.id,
    entry.startedAt,
    entry.endedAt,
    JSON.stringify(entry.locations),
    entry.intensity ?? '',
    JSON.stringify(entry.qualities),
    entry.note,
    entry.status,
    entry.createdAt,
    entry.updatedAt,
  ]
}

function mergeById(
  localEntries: readonly PainEntry[],
  remoteEntries: readonly PainEntry[],
): PainEntry[] {
  const merged = new Map<string, PainEntry>()

  for (const entry of [...remoteEntries, ...localEntries]) {
    const existing = merged.get(entry.id)
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      merged.set(entry.id, entry)
    }
  }

  return [...merged.values()]
}

async function pushPainEntries(): Promise<void> {
  const entries = await listPainEntries({ includeDeleted: true })
  await replaceTable(SHEET_TITLE, HEADERS, entries.map(toRow))
}

export async function syncPainEntries(): Promise<void> {
  const localEntries = await listPainEntries({ includeDeleted: true })
  const remoteRows = await loadTable(SHEET_TITLE, HEADERS)
  const remoteEntries = remoteRows.flatMap((row) => {
    const entry = fromRow(row)
    return entry ? [entry] : []
  })

  const merged = mergeById(localEntries, remoteEntries)
  await storePainEntriesFromSync(merged)
  await replaceTable(SHEET_TITLE, HEADERS, merged.map(toRow))
}

export function initializePainSync(): void {
  registerSyncFeature('painEntries', {
    push: pushPainEntries,
    full: syncPainEntries,
  })
}
