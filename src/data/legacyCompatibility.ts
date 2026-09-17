const DATABASE_NAME = 'eds-diary'
const ACTIVITY_STORE = 'activityEntries'
const MIGRATION_STORE = 'migrationState'
const MIGRATION_ID = 'legacy-v1'

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

/**
 * Activity entries created before the ongoing-activity feature did not contain
 * `isOngoing`. The product semantics at that time were exactly equivalent to
 * `isOngoing: false`. Normalize only that missing legacy field before the
 * strict v5 schema migration runs; existing values are never rewritten.
 */
export async function normalizeLegacyActivityEntriesForSecureMigration(): Promise<void> {
  const database = await openDatabase()

  try {
    if (!database.objectStoreNames.contains(ACTIVITY_STORE)) return

    if (database.objectStoreNames.contains(MIGRATION_STORE)) {
      const read = database.transaction(MIGRATION_STORE, 'readonly')
      const readDone = complete(read)
      const state = await requestResult<LegacyMigrationState | undefined>(
        read.objectStore(MIGRATION_STORE).get(MIGRATION_ID),
      )
      await readDone
      if (state?.phase === 'cutover' && state.verified === true) return
    }

    const transaction = database.transaction(ACTIVITY_STORE, 'readwrite')
    const transactionDone = complete(transaction)
    const store = transaction.objectStore(ACTIVITY_STORE)
    const cursorRequest = store.openCursor()

    await new Promise<void>((resolve, reject) => {
      cursorRequest.addEventListener('success', () => {
        const cursor = cursorRequest.result
        if (!cursor) {
          resolve()
          return
        }

        const value = cursor.value
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !Object.prototype.hasOwnProperty.call(value, 'isOngoing')
        ) {
          cursor.update({ ...value, isOngoing: false })
        }
        cursor.continue()
      })
      cursorRequest.addEventListener(
        'error',
        () => reject(cursorRequest.error ?? new Error('Legacy activity normalization failed.')),
        { once: true },
      )
    })

    await transactionDone
  } finally {
    database.close()
  }
}
