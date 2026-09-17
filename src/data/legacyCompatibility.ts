const DATABASE_NAME = 'eds-diary'
const ACTIVITY_STORE = 'activityEntries'
const LEGACY_RECORD_STORES = [
  'painEntries',
  'medicationEntries',
  'medicationPrescriptions',
  ACTIVITY_STORE,
] as const
const MIGRATION_STORE = 'migrationState'
const MIGRATION_ID = 'legacy-v1'

// Frozen copy of the palette/default algorithm introduced with activity colors.
// This belongs to the historical migration contract: changing the product palette
// later must not change how pre-color records are reconstructed.
const LEGACY_ACTIVITY_PASTEL_COLORS = [
  '#f6cbd0',
  '#f6d7bd',
  '#f3e2b8',
  '#dfe8bc',
  '#cbe7ca',
  '#c7e8dc',
  '#c6e3ee',
  '#cddbf2',
  '#d8d0ef',
  '#e5cdec',
  '#efcde1',
  '#ead5c7',
] as const

interface LegacyMigrationState {
  phase?: string
  verified?: boolean
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Legacy compatibility transaction aborted.')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Legacy compatibility transaction failed.')),
      { once: true },
    )
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME)
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Legacy database could not be opened.')),
      { once: true },
    )
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Legacy compatibility read failed.')),
      { once: true },
    )
  })
}

function legacyDefaultActivityColor(activityName: unknown): string {
  const name = typeof activityName === 'string' ? activityName : ''
  const key = name.trim().toLocaleLowerCase('de')
  if (!key) return LEGACY_ACTIVITY_PASTEL_COLORS[6]

  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return LEGACY_ACTIVITY_PASTEL_COLORS[(hash >>> 0) % LEGACY_ACTIVITY_PASTEL_COLORS.length]
}

/**
 * Before secure migration, normalize only historical representation differences
 * that have an exact semantic equivalent in the revision protocol:
 * - `status: "active"` lived inside legacy app records, while the revision
 *   protocol stores active/deleted as `record_status`; remove only the exact
 *   redundant active marker from all legacy record stores;
 * - ActivityEntry gained color and isOngoing later, so reconstruct only those
 *   genuinely absent fields for non-deleted activity records.
 *
 * Tombstones and malformed present values remain untouched and therefore still
 * fail closed where appropriate.
 */
export async function normalizeLegacyActivityEntriesForSecureMigration(): Promise<void> {
  const database = await openDatabase()

  try {
    if (database.objectStoreNames.contains(MIGRATION_STORE)) {
      const read = database.transaction(MIGRATION_STORE, 'readonly')
      const readDone = complete(read)
      const state = await requestResult<LegacyMigrationState | undefined>(
        read.objectStore(MIGRATION_STORE).get(MIGRATION_ID),
      )
      await readDone
      if (state?.phase === 'cutover' && state.verified === true) return
    }

    const stores = LEGACY_RECORD_STORES.filter((name) => database.objectStoreNames.contains(name))
    if (stores.length === 0) return

    const transaction = database.transaction(stores, 'readwrite')
    const transactionDone = complete(transaction)

    await Promise.all(
      stores.map(
        (storeName) =>
          new Promise<void>((resolve, reject) => {
            const cursorRequest = transaction.objectStore(storeName).openCursor()
            cursorRequest.addEventListener('success', () => {
              const cursor = cursorRequest.result
              if (!cursor) {
                resolve()
                return
              }

              const value = cursor.value
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                const record = value as Record<string, unknown>
                const isDeleted = record.status === 'deleted'
                const hasRedundantActiveStatus = record.status === 'active'
                const isActivity = storeName === ACTIVITY_STORE
                const missingColor =
                  isActivity && !isDeleted && !Object.prototype.hasOwnProperty.call(record, 'color')
                const missingIsOngoing =
                  isActivity && !isDeleted && !Object.prototype.hasOwnProperty.call(record, 'isOngoing')

                if (missingColor || missingIsOngoing || hasRedundantActiveStatus) {
                  const normalized: Record<string, unknown> = {
                    ...record,
                    ...(missingColor
                      ? { color: legacyDefaultActivityColor(record.activityName) }
                      : {}),
                    ...(missingIsOngoing ? { isOngoing: false } : {}),
                  }
                  if (hasRedundantActiveStatus) delete normalized.status
                  cursor.update(normalized)
                }
              }
              cursor.continue()
            })
            cursorRequest.addEventListener(
              'error',
              () => reject(cursorRequest.error ?? new Error('Legacy record normalization failed.')),
              { once: true },
            )
          }),
      ),
    )

    await transactionDone
  } finally {
    database.close()
  }
}
