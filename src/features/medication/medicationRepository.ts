import {
  getAllRecords,
  getRecord,
  LOCAL_STORES,
  putRecord,
  putRecords,
} from '../../data/localDatabase'
import { markDirty } from '../../data/syncManager'
import type {
  MedicationEntry,
  NewMedicationEntry,
} from './medicationEntry'

const SYNC_FEATURE = 'medicationEntries'
const MAX_NAME_LENGTH = 120
const MAX_DOSE_LENGTH = 80

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  if (crypto.randomUUID) return `medication-${crypto.randomUUID()}`
  return `medication-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizedTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

function normalizeStoredEntry(value: unknown): MedicationEntry | null {
  if (!isRecord(value)) return null

  const id = normalizedText(value.id, 180)
  const medicationName = normalizedText(value.medicationName, MAX_NAME_LENGTH)
  const dose = normalizedText(value.dose, MAX_DOSE_LENGTH)
  if (!id || !medicationName || !dose) return null

  const fallbackTimestamp = nowIso()
  const createdAt = normalizedTimestamp(
    value.createdAt,
    normalizedTimestamp(value.updatedAt, fallbackTimestamp),
  )
  const updatedAt = normalizedTimestamp(value.updatedAt, createdAt)

  return {
    id,
    medicationName,
    dose,
    takenAt: normalizedTimestamp(value.takenAt, createdAt),
    status: value.status === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function normalizeEntry(entry: MedicationEntry): MedicationEntry {
  return normalizeStoredEntry(entry) ?? {
    ...entry,
    medicationName: normalizedText(entry.medicationName, MAX_NAME_LENGTH),
    dose: normalizedText(entry.dose, MAX_DOSE_LENGTH),
  }
}

export async function createMedicationEntry(
  input: NewMedicationEntry,
): Promise<MedicationEntry> {
  const medicationName = normalizedText(input.medicationName, MAX_NAME_LENGTH)
  const dose = normalizedText(input.dose, MAX_DOSE_LENGTH)

  if (!medicationName) throw new Error('Medikamentenname fehlt.')
  if (!dose) throw new Error('Dosis fehlt.')

  const timestamp = nowIso()
  const takenAt = normalizedTimestamp(input.takenAt, timestamp)
  const entry: MedicationEntry = {
    id: createId(),
    medicationName,
    dose,
    takenAt,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await putRecord(LOCAL_STORES.medicationEntries, entry)
  markDirty(SYNC_FEATURE)
  return entry
}

export async function getMedicationEntry(
  id: string,
): Promise<MedicationEntry | undefined> {
  const stored = await getRecord<unknown>(LOCAL_STORES.medicationEntries, id)
  return normalizeStoredEntry(stored) ?? undefined
}

export async function listMedicationEntries(options?: {
  includeDeleted?: boolean
}): Promise<MedicationEntry[]> {
  const storedEntries = await getAllRecords<unknown>(
    LOCAL_STORES.medicationEntries,
  )
  const entries = storedEntries.flatMap((stored) => {
    const entry = normalizeStoredEntry(stored)
    return entry ? [entry] : []
  })

  return entries
    .filter((entry) => options?.includeDeleted || entry.status !== 'deleted')
    .sort(
      (left, right) =>
        right.takenAt.localeCompare(left.takenAt) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
}

export async function listMedicationNames(): Promise<string[]> {
  const entries = await listMedicationEntries()
  const seen = new Set<string>()
  const names: string[] = []

  for (const entry of entries) {
    const key = entry.medicationName.toLocaleLowerCase('de')
    if (seen.has(key)) continue
    seen.add(key)
    names.push(entry.medicationName)
  }

  return names.sort((left, right) => left.localeCompare(right, 'de'))
}

export async function storeMedicationEntriesFromSync(
  entries: readonly MedicationEntry[],
): Promise<void> {
  await putRecords(
    LOCAL_STORES.medicationEntries,
    entries
      .map(normalizeEntry)
      .filter((entry) => entry.medicationName && entry.dose),
  )
}
