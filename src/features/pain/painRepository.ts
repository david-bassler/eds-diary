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

function normalizeLocations(
  locations: readonly PainLocation[] | undefined,
): PainLocation[] {
  if (!locations) return []

  const seen = new Set<string>()
  const result: PainLocation[] = []

  for (const location of locations) {
    const regionId = location.regionId.trim()
    if (!regionId || !['front', 'back'].includes(location.view)) continue

    const key = `${location.view}:${regionId}`
    if (seen.has(key)) continue

    seen.add(key)
    result.push({ view: location.view, regionId })
  }

  return result
}

function normalizeQualities(qualities: readonly string[] | undefined): string[] {
  if (!qualities) return []

  return [...new Set(qualities.map((quality) => quality.trim()).filter(Boolean))]
}

function normalizeIntensity(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.min(10, Math.max(0, value))
}

function normalizeEntry(entry: PainEntry): PainEntry {
  return {
    ...entry,
    startedAt: entry.startedAt || entry.createdAt || nowIso(),
    endedAt: entry.endedAt || '',
    locations: normalizeLocations(entry.locations),
    intensity: normalizeIntensity(entry.intensity),
    qualities: normalizeQualities(entry.qualities),
    note: entry.note.trim(),
    status: entry.status === 'deleted' ? 'deleted' : 'active',
    createdAt: entry.createdAt || entry.updatedAt || nowIso(),
    updatedAt: entry.updatedAt || entry.createdAt || nowIso(),
  }
}

export async function createPainEntry(input: NewPainEntry): Promise<PainEntry> {
  const timestamp = nowIso()
  const entry: PainEntry = {
    id: createId(),
    startedAt: input.startedAt || timestamp,
    endedAt: input.endedAt || '',
    locations: normalizeLocations(input.locations),
    intensity: normalizeIntensity(input.intensity),
    qualities: normalizeQualities(input.qualities),
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
  const entry = await getRecord<PainEntry>(LOCAL_STORES.painEntries, id)
  return entry ? normalizeEntry(entry) : undefined
}

export async function listPainEntries(options?: {
  includeDeleted?: boolean
}): Promise<PainEntry[]> {
  const entries = await getAllRecords<PainEntry>(LOCAL_STORES.painEntries)
  const normalized = entries.map(normalizeEntry)

  return normalized
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
