import {
  getAllRecords,
  LOCAL_STORES,
  putRecord,
  putRecords,
} from '../../data/localDatabase'
import { markDirty } from '../../data/syncManager'
import type {
  MedicationPrescription,
  NewMedicationPrescription,
} from './medicationPrescription'

const SYNC_FEATURE = 'medicationEntries'
const MAX_NAME_LENGTH = 120
const MAX_PRESCRIBER_LENGTH = 160
const MAX_REASON_LENGTH = 500

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  if (crypto.randomUUID) return `prescription-${crypto.randomUUID()}`
  return `prescription-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizedDate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return ''

  const parsed = new Date(`${trimmed}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? '' : trimmed
}

function normalizedTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

function normalizeStoredPrescription(
  value: unknown,
): MedicationPrescription | null {
  if (!isRecord(value)) return null

  const id = normalizedText(value.id, 180)
  const medicationName = normalizedText(value.medicationName, MAX_NAME_LENGTH)
  const prescribedOn = normalizedDate(value.prescribedOn)
  if (!id || !medicationName || !prescribedOn) return null

  const fallbackTimestamp = nowIso()
  const createdAt = normalizedTimestamp(
    value.createdAt,
    normalizedTimestamp(value.updatedAt, fallbackTimestamp),
  )
  const updatedAt = normalizedTimestamp(value.updatedAt, createdAt)

  return {
    id,
    medicationName,
    prescribedOn,
    prescriber: normalizedText(value.prescriber, MAX_PRESCRIBER_LENGTH),
    reason: normalizedText(value.reason, MAX_REASON_LENGTH),
    status: value.status === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

export async function createMedicationPrescription(
  input: NewMedicationPrescription,
): Promise<MedicationPrescription> {
  const medicationName = normalizedText(input.medicationName, MAX_NAME_LENGTH)
  const prescribedOn = normalizedDate(input.prescribedOn)

  if (!medicationName) throw new Error('Medikamentenname fehlt.')
  if (!prescribedOn) throw new Error('Verordnungsdatum fehlt.')

  const timestamp = nowIso()
  const prescription: MedicationPrescription = {
    id: createId(),
    medicationName,
    prescribedOn,
    prescriber: normalizedText(input.prescriber, MAX_PRESCRIBER_LENGTH),
    reason: normalizedText(input.reason, MAX_REASON_LENGTH),
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await putRecord(LOCAL_STORES.medicationPrescriptions, prescription)
  markDirty(SYNC_FEATURE)
  return prescription
}

export async function listMedicationPrescriptions(options?: {
  includeDeleted?: boolean
}): Promise<MedicationPrescription[]> {
  const stored = await getAllRecords<unknown>(
    LOCAL_STORES.medicationPrescriptions,
  )
  const prescriptions = stored.flatMap((value) => {
    const prescription = normalizeStoredPrescription(value)
    return prescription ? [prescription] : []
  })

  return prescriptions
    .filter(
      (prescription) =>
        options?.includeDeleted || prescription.status !== 'deleted',
    )
    .sort(
      (left, right) =>
        right.prescribedOn.localeCompare(left.prescribedOn) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
}

export async function storeMedicationPrescriptionsFromSync(
  prescriptions: readonly MedicationPrescription[],
): Promise<void> {
  const normalized = prescriptions.flatMap((prescription) => {
    const value = normalizeStoredPrescription(prescription)
    return value ? [value] : []
  })

  await putRecords(LOCAL_STORES.medicationPrescriptions, normalized)
}
