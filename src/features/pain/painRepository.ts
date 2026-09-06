import {
  getAllRecords,
  getRecord,
  LOCAL_STORES,
  putRecord,
  putRecords,
} from '../../data/localDatabase'
import { markDirty } from '../../data/syncManager'
import type {
  NewPainEntry,
  PainEntry,
  PainLocation,
} from './painEntry'

const SYNC_FEATURE = 'painEntries'

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  if (crypto.randomUUID) return `pain-${crypto.randomUUID()}`
  return `pain-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeLocations(value: unknown): PainLocation[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: PainLocation[] = []

  for (const item of value) {
    if (!isRecord(item)) continue

    const view = item.view
    const regionId = stringValue(item.regionId).trim()

    if ((view !== 'front' && view !== 'back') || !regionId) continue

    const key = `${view}:${regionId}`
    if (seen.has(key)) continue

    seen.add(key)
    result.push({ view, regionId })
  }

  return result
}

function normalizeQualities(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [
    ...new Set(
      value
        .filter((quality): quality is string => typeof quality === 'string')
        .map((quality) => quality.trim())
        .filter(Boolean),
    ),
  ]
}

function normalizeIntensity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value !== 'number' && typeof value !== 'string') return null

  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return null

  return Math.min(10, Math.max(0, number))
}

function normalizeStoredEntry(value: unknown): PainEntry | null {
  if (!isRecord(value)) return null

  const id = stringValue(value.id).trim()
  if (!id) return null

  const fallbackTimestamp = nowIso()
  const createdAt =
    stringValue(value.createdAt).trim() ||
    stringValue(value.updatedAt).trim() ||
    fallbackTimestamp
  const updatedAt =
    stringValue(value.updatedAt).trim() ||
    stringValue(value.createdAt).trim() ||
    fallbackTimestamp

  return {
    id,
    startedAt: stringValue(value.startedAt).trim() || createdAt,
    endedAt: stringValue(value.endedAt).trim(),
    locations: normalizeLocations(value.locations),
    intensity: normalizeIntensity(value.intensity),
    qualities: normalizeQualities(value.qualities),
    cause: stringValue(value.cause).trim(),
    note: stringValue(value.note).trim(),
    status: value.status === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

function normalizeEntry(entry: PainEntry): PainEntry {
  return (
    normalizeStoredEntry(entry) ?? {
      ...entry,
      locations: [],
      intensity: null,
      qualities: [],
      cause: '',
      note: '',
      status: 'active',
    }
  )
}

export async function createPainEntry(input: NewPainEntry): Promise<PainEntry> {
  const timestamp = nowIso()
  const entry: PainEntry = {
    id: createId(),
    startedAt: input.startedAt?.trim() || timestamp,
    endedAt: input.endedAt?.trim() || '',
    locations: normalizeLocations(input.locations),
    intensity: normalizeIntensity(input.intensity),
    qualities: normalizeQualities(input.qualities),
    cause: input.cause?.trim() ?? '',
    note: input.note?.trim() ?? '',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await putRecord(LOCAL_STORES.painEntries, entry)
  markDirty(SYNC_FEATURE)
  return entry
}

export async function savePainEntry(entry: PainEntry): Promise<PainEntry> {
  const normalized = normalizeEntry({
    ...entry,
    updatedAt: nowIso(),
  })

  await putRecord(LOCAL_STORES.painEntries, normalized)
  markDirty(SYNC_FEATURE)
  return normalized
}

export async function deletePainEntry(id: string): Promise<void> {
  const existing = await getPainEntry(id)
  if (!existing) return

  await putRecord(LOCAL_STORES.painEntries, {
    ...existing,
    status: 'deleted',
    updatedAt: nowIso(),
  })
  markDirty(SYNC_FEATURE)
}

export async function getPainEntry(id: string): Promise<PainEntry | undefined> {
  const stored = await getRecord<unknown>(LOCAL_STORES.painEntries, id)
  return normalizeStoredEntry(stored) ?? undefined
}

export async function listPainEntries(options?: {
  includeDeleted?: boolean
}): Promise<PainEntry[]> {
  const storedEntries = await getAllRecords<unknown>(LOCAL_STORES.painEntries)
  const entries = storedEntries.flatMap((stored) => {
    const entry = normalizeStoredEntry(stored)
    return entry ? [entry] : []
  })

  return entries
    .filter((entry) => options?.includeDeleted || entry.status !== 'deleted')
    .sort(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
}

export async function storePainEntriesFromSync(
  entries: readonly PainEntry[],
): Promise<void> {
  await putRecords(
    LOCAL_STORES.painEntries,
    entries.map(normalizeEntry),
  )
}
