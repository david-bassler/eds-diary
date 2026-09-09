import {
  getAllRecords,
  getRecord,
  LOCAL_STORES,
  putRecord,
  putRecords,
} from '../../data/localDatabase'
import { markDirty } from '../../data/syncManager'
import type { ActivityEntry, NewActivityEntry } from './activityEntry'
import {
  normalizeActivityColor,
  sameActivityType,
} from './activityColors'

const SYNC_FEATURE = 'activityEntries'
const ACTIVITY_TYPES_KEY = 'eds-diary-activity-types-v1'
const MAX_NAME_LENGTH = 120
const MAX_NOTE_LENGTH = 2000

function nowIso(): string {
  return new Date().toISOString()
}

function createId(): string {
  if (crypto.randomUUID) return `activity-${crypto.randomUUID()}`
  return `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function loadStoredActivityTypes(): ActivityType[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_TYPES_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const seen = new Set<string>()
    const types: ActivityType[] = []

    for (const item of parsed) {
      if (!isRecord(item)) continue

      const name = normalizedText(item.name, MAX_NAME_LENGTH)
      if (!name) continue

      const key = name.toLocaleLowerCase('de')
      if (seen.has(key)) continue

      seen.add(key)
      types.push({
        name,
        color: normalizeActivityColor(item.color, name),
      })
    }

    return types
  } catch {
    return []
  }
}

function storeActivityTypes(types: readonly ActivityType[]): void {
  try {
    localStorage.setItem(ACTIVITY_TYPES_KEY, JSON.stringify(types))
  } catch {
    // Die Aktivitätseinträge selbst bleiben weiterhin über IndexedDB nutzbar.
  }
}

function upsertStoredActivityType(activityName: string, color: string): void {
  const name = normalizedText(activityName, MAX_NAME_LENGTH)
  if (!name) return

  const nextType: ActivityType = {
    name,
    color: normalizeActivityColor(color, name),
  }
  const existing = loadStoredActivityTypes().filter(
    (type) => !sameActivityType(type.name, name),
  )

  storeActivityTypes([...existing, nextType])
}


function normalizedDate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return ''

  const parsed = new Date(`${trimmed}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? '' : trimmed
}

function normalizedTime(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return ''

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (
    hours > 24 ||
    minutes > 59 ||
    (hours === 24 && minutes !== 0)
  ) {
    return ''
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function normalizedTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

function normalizeStoredEntry(value: unknown): ActivityEntry | null {
  if (!isRecord(value)) return null

  const id = normalizedText(value.id, 180)
  const date = normalizedDate(value.date)
  const startTime = normalizedTime(value.startTime)
  const isOngoing = value.isOngoing === true
  const endTime = normalizedTime(value.endTime)
  const activityName = normalizedText(value.activityName, MAX_NAME_LENGTH)

  if (
    !id ||
    !date ||
    !startTime ||
    !activityName ||
    (!isOngoing && (!endTime || timeMinutes(startTime) >= timeMinutes(endTime)))
  ) {
    return null
  }

  const fallbackTimestamp = nowIso()
  const createdAt = normalizedTimestamp(
    value.createdAt,
    normalizedTimestamp(value.updatedAt, fallbackTimestamp),
  )
  const updatedAt = normalizedTimestamp(value.updatedAt, createdAt)

  return {
    id,
    date,
    startTime,
    endTime: isOngoing ? '' : endTime,
    isOngoing,
    activityName,
    color: normalizeActivityColor(value.color, activityName),
    note: normalizedText(value.note, MAX_NOTE_LENGTH),
    status: value.status === 'deleted' ? 'deleted' : 'active',
    createdAt,
    updatedAt,
  }
}

export async function createActivityEntries(
  inputs: readonly NewActivityEntry[],
): Promise<ActivityEntry[]> {
  if (!inputs.length) return []

  const timestamp = nowIso()
  const entries = inputs.map((input) => {
    const date = normalizedDate(input.date)
    const startTime = normalizedTime(input.startTime)
    const isOngoing = input.isOngoing === true
    const endTime = normalizedTime(input.endTime)
    const activityName = normalizedText(input.activityName, MAX_NAME_LENGTH)

    if (!date) throw new Error('Datum fehlt.')
    if (
      !startTime ||
      (!isOngoing && (!endTime || timeMinutes(startTime) >= timeMinutes(endTime)))
    ) {
      throw new Error('Ungültiger Aktivitätszeitraum.')
    }
    if (!activityName) throw new Error('Aktivität fehlt.')

    return {
      id: createId(),
      date,
      startTime,
      endTime: isOngoing ? '' : endTime,
      isOngoing,
      activityName,
      color: normalizeActivityColor(input.color, activityName),
      note: normalizedText(input.note, MAX_NOTE_LENGTH),
      status: 'active' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })

  await putRecords(LOCAL_STORES.activityEntries, entries)
  markDirty(SYNC_FEATURE)
  return entries
}

export async function getActivityEntry(
  id: string,
): Promise<ActivityEntry | undefined> {
  const stored = await getRecord<unknown>(LOCAL_STORES.activityEntries, id)
  return normalizeStoredEntry(stored) ?? undefined
}

export async function saveActivityEntry(
  entry: ActivityEntry,
): Promise<ActivityEntry> {
  const normalized = normalizeStoredEntry({
    ...entry,
    updatedAt: nowIso(),
  })

  if (!normalized) throw new Error('Ungültige Aktivität.')

  await putRecord(LOCAL_STORES.activityEntries, normalized)
  markDirty(SYNC_FEATURE)
  return normalized
}

export async function deleteActivityEntry(id: string): Promise<void> {
  const existing = await getActivityEntry(id)
  if (!existing) return

  await putRecord(LOCAL_STORES.activityEntries, {
    ...existing,
    status: 'deleted',
    updatedAt: nowIso(),
  })
  markDirty(SYNC_FEATURE)
}

export async function listActivityEntries(options?: {
  includeDeleted?: boolean
}): Promise<ActivityEntry[]> {
  const stored = await getAllRecords<unknown>(LOCAL_STORES.activityEntries)
  const entries = stored.flatMap((value) => {
    const entry = normalizeStoredEntry(value)
    return entry ? [entry] : []
  })

  return entries
    .filter((entry) => options?.includeDeleted || entry.status !== 'deleted')
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.startTime.localeCompare(left.startTime) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
}

export interface ActivityType {
  name: string
  color: string
}

export async function listActivityTypes(): Promise<ActivityType[]> {
  const entries = await listActivityEntries()
  const storedTypes = loadStoredActivityTypes()
  const types = new Map<string, ActivityType>()

  for (const entry of entries) {
    const key = entry.activityName.trim().toLocaleLowerCase('de')
    if (!types.has(key)) {
      types.set(key, {
        name: entry.activityName,
        color: normalizeActivityColor(entry.color, entry.activityName),
      })
    }
  }

  for (const type of storedTypes) {
    types.set(type.name.trim().toLocaleLowerCase('de'), type)
  }

  return [...types.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'de'),
  )
}

export async function listActivityNames(): Promise<string[]> {
  return (await listActivityTypes()).map((type) => type.name)
}

export async function saveActivityTypeColor(
  activityName: string,
  color: string,
): Promise<void> {
  const normalizedName = normalizedText(activityName, MAX_NAME_LENGTH)
  if (!normalizedName) return

  const normalizedColor = normalizeActivityColor(color, normalizedName)
  upsertStoredActivityType(normalizedName, normalizedColor)

  const entries = await listActivityEntries({ includeDeleted: true })
  const matchingEntries = entries.filter((entry) =>
    sameActivityType(entry.activityName, normalizedName),
  )

  if (!matchingEntries.length) return

  const timestamp = nowIso()
  await putRecords(
    LOCAL_STORES.activityEntries,
    matchingEntries.map((entry) => ({
      ...entry,
      color: normalizedColor,
      updatedAt: timestamp,
    })),
  )
  markDirty(SYNC_FEATURE)
}

export async function replaceActivityEntries(
  entries: readonly ActivityEntry[],
): Promise<void> {
  const timestamp = nowIso()
  const targetEntries = entries.flatMap((entry) => {
    const normalized = normalizeStoredEntry({
      ...entry,
      status: 'active',
      updatedAt: timestamp,
    })
    return normalized ? [normalized] : []
  })
  const targetIds = new Set(targetEntries.map((entry) => entry.id))
  const currentEntries = await listActivityEntries({ includeDeleted: true })
  const deletedEntries = currentEntries
    .filter((entry) => entry.status === 'active' && !targetIds.has(entry.id))
    .map((entry) => ({
      ...entry,
      status: 'deleted' as const,
      updatedAt: timestamp,
    }))

  await putRecords(LOCAL_STORES.activityEntries, [
    ...deletedEntries,
    ...targetEntries,
  ])
  markDirty(SYNC_FEATURE)
}

export function replaceActivityTypes(types: readonly ActivityType[]): void {
  const normalizedTypes = types.flatMap((type) => {
    const name = normalizedText(type.name, MAX_NAME_LENGTH)
    if (!name) return []
    return [
      {
        name,
        color: normalizeActivityColor(type.color, name),
      },
    ]
  })

  storeActivityTypes(normalizedTypes)
}

export async function storeActivityEntriesFromSync(
  entries: readonly ActivityEntry[],
): Promise<void> {
  const normalized = entries.flatMap((entry) => {
    const value = normalizeStoredEntry(entry)
    return value ? [value] : []
  })

  await putRecords(LOCAL_STORES.activityEntries, normalized)
}
