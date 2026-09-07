import {
  loadTables,
  replaceTable,
  type SheetCell,
  type SheetSpecs,
} from '../../data/googleSheets'
import { registerSyncFeature } from '../../data/syncManager'
import type { MedicationEntry } from './medicationEntry'
import {
  listMedicationEntries,
  storeMedicationEntriesFromSync,
} from './medicationRepository'

const ENTRY_SHEET_TITLE = 'Medikamenteneinnahmen'

const ENTRY_HEADERS = [
  'ID',
  'Medikament',
  'Dosis',
  'Eingenommen_am',
  'Status',
  'Erstellt',
  'Aktualisiert',
] as const

export const medicationSheetSpecs: SheetSpecs = {
  [ENTRY_SHEET_TITLE]: ENTRY_HEADERS,
}

function text(cell: SheetCell | undefined): string {
  return cell === undefined ? '' : String(cell)
}

function fromRow(row: SheetCell[]): MedicationEntry | null {
  const id = text(row[0]).trim()
  const medicationName = text(row[1]).trim()
  const dose = text(row[2]).trim()
  if (!id || !medicationName || !dose) return null

  const createdAt = text(row[5]).trim() || new Date(0).toISOString()
  const updatedAt = text(row[6]).trim() || createdAt

  return {
    id,
    medicationName,
    dose,
    takenAt: text(row[3]).trim() || createdAt,
    status: text(row[4]) === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function toRow(entry: MedicationEntry): readonly SheetCell[] {
  return [
    entry.id,
    entry.medicationName,
    entry.dose,
    entry.takenAt,
    entry.status,
    entry.createdAt,
    entry.updatedAt,
  ]
}

function mergeById(
  localEntries: readonly MedicationEntry[],
  remoteEntries: readonly MedicationEntry[],
): MedicationEntry[] {
  const merged = new Map<string, MedicationEntry>()

  for (const entry of [...remoteEntries, ...localEntries]) {
    const existing = merged.get(entry.id)
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      merged.set(entry.id, entry)
    }
  }

  return [...merged.values()]
}

async function pushMedicationData(): Promise<void> {
  const entries = await listMedicationEntries({ includeDeleted: true })

  await replaceTable(
    ENTRY_SHEET_TITLE,
    ENTRY_HEADERS,
    entries.map(toRow),
  )
}

export async function syncMedicationEntries(): Promise<void> {
  const localEntries = await listMedicationEntries({ includeDeleted: true })
  const tables = await loadTables(medicationSheetSpecs)

  const remoteEntries = (tables[ENTRY_SHEET_TITLE] ?? []).flatMap((row) => {
    const entry = fromRow(row)
    return entry ? [entry] : []
  })

  const mergedEntries = mergeById(localEntries, remoteEntries)
  await storeMedicationEntriesFromSync(mergedEntries)

  await replaceTable(
    ENTRY_SHEET_TITLE,
    ENTRY_HEADERS,
    mergedEntries.map(toRow),
  )
}

export function initializeMedicationSync(): void {
  registerSyncFeature('medicationEntries', {
    push: pushMedicationData,
    full: syncMedicationEntries,
  })
}
