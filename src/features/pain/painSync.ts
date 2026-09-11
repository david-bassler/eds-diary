import {
  loadTables,
  replaceTables,
  type SheetCell,
  type SheetSpecs,
} from '../../data/googleSheets'
import { registerSyncFeature } from '../../data/syncManager'
import type { PainEntry, PainLocation } from './painEntry'
import {
  listPainEntries,
  storePainEntriesFromSync,
} from './painRepository'
import {
  listCustomPainTypes,
  storeCustomPainTypesFromSync,
} from './painTypeOptions'

const ENTRY_SHEET_TITLE = 'Schmerzeintraege'
const PAIN_TYPES_SHEET_TITLE = 'Schmerzarten'

const ENTRY_HEADERS = [
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
  'Moegliche_Ursache',
  'Tritt_auf_wenn',
] as const

const PAIN_TYPE_HEADERS = ['Name'] as const

export const painSheetSpecs: SheetSpecs = {
  [ENTRY_SHEET_TITLE]: ENTRY_HEADERS,
  [PAIN_TYPES_SHEET_TITLE]: PAIN_TYPE_HEADERS,
}

function text(cell: SheetCell | undefined): string {
  return cell === undefined ? '' : String(cell)
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
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

      const detailRegionIds = parseStringArray(record.detailRegionIds)
      return [
        detailRegionIds.length
          ? { view, regionId: regionId.trim(), detailRegionIds }
          : { view, regionId: regionId.trim() },
      ]
    })
  } catch {
    return []
  }
}

function parseStrings(value: SheetCell | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    return parseStringArray(parsed)
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
    cause: text(row[10]).trim(),
    occursWhen: text(row[11]).trim(),
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
    entry.cause,
    entry.occursWhen,
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

function mergePainTypes(
  localTypes: readonly string[],
  remoteRows: readonly SheetCell[][],
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const value of [
    ...localTypes,
    ...remoteRows.map((row) => text(row[0]).trim()),
  ]) {
    const key = value.toLocaleLowerCase('de')
    if (!value || seen.has(key)) continue
    seen.add(key)
    merged.push(value)
  }

  return merged
}

async function currentTables(): Promise<{
  entries: PainEntry[]
  painTypes: string[]
}> {
  const [entries, painTypes] = await Promise.all([
    listPainEntries({ includeDeleted: true }),
    listCustomPainTypes(),
  ])
  return { entries, painTypes }
}

async function pushPainData(): Promise<void> {
  const { entries, painTypes } = await currentTables()

  await replaceTables({
    [ENTRY_SHEET_TITLE]: {
      headers: ENTRY_HEADERS,
      rows: entries.map(toRow),
    },
    [PAIN_TYPES_SHEET_TITLE]: {
      headers: PAIN_TYPE_HEADERS,
      rows: painTypes.map((name) => [name]),
    },
  })
}

export async function syncPainEntries(): Promise<void> {
  const local = await currentTables()
  const tables = await loadTables(painSheetSpecs)

  const remoteEntries = (tables[ENTRY_SHEET_TITLE] ?? []).flatMap((row) => {
    const entry = fromRow(row)
    return entry ? [entry] : []
  })

  const mergedEntries = mergeById(local.entries, remoteEntries)
  const mergedPainTypes = mergePainTypes(
    local.painTypes,
    tables[PAIN_TYPES_SHEET_TITLE] ?? [],
  )

  await Promise.all([
    storePainEntriesFromSync(mergedEntries),
    storeCustomPainTypesFromSync(mergedPainTypes),
  ])

  await replaceTables({
    [ENTRY_SHEET_TITLE]: {
      headers: ENTRY_HEADERS,
      rows: mergedEntries.map(toRow),
    },
    [PAIN_TYPES_SHEET_TITLE]: {
      headers: PAIN_TYPE_HEADERS,
      rows: mergedPainTypes.map((name) => [name]),
    },
  })
}

export function initializePainSync(): void {
  registerSyncFeature('painEntries', {
    push: pushPainData,
    full: syncPainEntries,
  })
}
