import {
  getRecord,
  LOCAL_STORES,
  putRecord,
} from '../../data/localDatabase'
import { markDirty } from '../../data/syncManager'

interface PainTypeSettings {
  id: 'custom-pain-types'
  values: string[]
}

const SETTINGS_ID = 'custom-pain-types'
const SYNC_FEATURE = 'painEntries'

function normalize(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    const key = trimmed.toLocaleLowerCase('de')
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }

  return result
}

export async function listCustomPainTypes(): Promise<string[]> {
  const stored = await getRecord<unknown>(LOCAL_STORES.settings, SETTINGS_ID)
  if (!stored || typeof stored !== 'object') return []

  const record = stored as Partial<PainTypeSettings>
  return normalize(record.values)
}

export async function addCustomPainType(name: string): Promise<string[]> {
  const current = await listCustomPainTypes()
  const next = normalize([...current, name])

  await putRecord(LOCAL_STORES.settings, {
    id: SETTINGS_ID,
    values: next,
  })
  markDirty(SYNC_FEATURE)

  return next
}

export async function storeCustomPainTypesFromSync(
  values: readonly string[],
): Promise<void> {
  await putRecord(LOCAL_STORES.settings, {
    id: SETTINGS_ID,
    values: normalize(values),
  })
}
