import {
  loadTables,
  replaceTables,
  type SheetCell,
  type SheetSpecs,
} from '../../data/googleSheets'
import { registerSyncFeature } from '../../data/syncManager'
import type { MedicationEntry } from './medicationEntry'
import type { MedicationPrescription } from './medicationPrescription'
import {
  listMedicationEntries,
  storeMedicationEntriesFromSync,
} from './medicationRepository'
import {
  listMedicationPrescriptions,
  storeMedicationPrescriptionsFromSync,
} from './medicationPrescriptionRepository'

const ENTRY_SHEET_TITLE = 'Medikamenteneinnahmen'
const PRESCRIPTION_SHEET_TITLE = 'Medikamentenverordnungen'

const ENTRY_HEADERS = [
  'ID',
  'Medikament',
  'Dosis',
  'Eingenommen_am',
  'Status',
  'Erstellt',
  'Aktualisiert',
] as const

const PRESCRIPTION_HEADERS = [
  'ID',
  'Medikament',
  'Verschrieben_am',
  'Verschrieben_von',
  'Grund',
  'Status',
  'Erstellt',
  'Aktualisiert',
] as const

export const medicationSheetSpecs: SheetSpecs = {
  [ENTRY_SHEET_TITLE]: ENTRY_HEADERS,
  [PRESCRIPTION_SHEET_TITLE]: PRESCRIPTION_HEADERS,
}

function text(cell: SheetCell | undefined): string {
  return cell === undefined ? '' : String(cell)
}

function entryFromRow(row: SheetCell[]): MedicationEntry | null {
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

function entryToRow(entry: MedicationEntry): readonly SheetCell[] {
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

function prescriptionFromRow(
  row: SheetCell[],
): MedicationPrescription | null {
  const id = text(row[0]).trim()
  const medicationName = text(row[1]).trim()
  const prescribedOn = text(row[2]).trim()
  if (!id || !medicationName || !prescribedOn) return null

  const createdAt = text(row[6]).trim() || new Date(0).toISOString()
  const updatedAt = text(row[7]).trim() || createdAt

  return {
    id,
    medicationName,
    prescribedOn,
    prescriber: text(row[3]).trim(),
    reason: text(row[4]).trim(),
    status: text(row[5]) === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function prescriptionToRow(
  prescription: MedicationPrescription,
): readonly SheetCell[] {
  return [
    prescription.id,
    prescription.medicationName,
    prescription.prescribedOn,
    prescription.prescriber,
    prescription.reason,
    prescription.status,
    prescription.createdAt,
    prescription.updatedAt,
  ]
}

function mergeById<T extends { id: string; updatedAt: string }>(
  localEntries: readonly T[],
  remoteEntries: readonly T[],
): T[] {
  const merged = new Map<string, T>()

  for (const entry of [...remoteEntries, ...localEntries]) {
    const existing = merged.get(entry.id)
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      merged.set(entry.id, entry)
    }
  }

  return [...merged.values()]
}

async function currentMedicationData(): Promise<{
  entries: MedicationEntry[]
  prescriptions: MedicationPrescription[]
}> {
  const [entries, prescriptions] = await Promise.all([
    listMedicationEntries({ includeDeleted: true }),
    listMedicationPrescriptions({ includeDeleted: true }),
  ])

  return { entries, prescriptions }
}

async function pushMedicationData(): Promise<void> {
  const { entries, prescriptions } = await currentMedicationData()

  await replaceTables({
    [ENTRY_SHEET_TITLE]: {
      headers: ENTRY_HEADERS,
      rows: entries.map(entryToRow),
    },
    [PRESCRIPTION_SHEET_TITLE]: {
      headers: PRESCRIPTION_HEADERS,
      rows: prescriptions.map(prescriptionToRow),
    },
  })
}

export async function syncMedicationEntries(): Promise<void> {
  const local = await currentMedicationData()
  const tables = await loadTables(medicationSheetSpecs)

  const remoteEntries = (tables[ENTRY_SHEET_TITLE] ?? []).flatMap((row) => {
    const entry = entryFromRow(row)
    return entry ? [entry] : []
  })

  const remotePrescriptions = (
    tables[PRESCRIPTION_SHEET_TITLE] ?? []
  ).flatMap((row) => {
    const prescription = prescriptionFromRow(row)
    return prescription ? [prescription] : []
  })

  const mergedEntries = mergeById(local.entries, remoteEntries)
  const mergedPrescriptions = mergeById(
    local.prescriptions,
    remotePrescriptions,
  )

  await Promise.all([
    storeMedicationEntriesFromSync(mergedEntries),
    storeMedicationPrescriptionsFromSync(mergedPrescriptions),
  ])

  await replaceTables({
    [ENTRY_SHEET_TITLE]: {
      headers: ENTRY_HEADERS,
      rows: mergedEntries.map(entryToRow),
    },
    [PRESCRIPTION_SHEET_TITLE]: {
      headers: PRESCRIPTION_HEADERS,
      rows: mergedPrescriptions.map(prescriptionToRow),
    },
  })
}

export function initializeMedicationSync(): void {
  registerSyncFeature('medicationEntries', {
    push: pushMedicationData,
    full: syncMedicationEntries,
  })
}
