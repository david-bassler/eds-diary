const DATABASE_NAME = 'eds-diary'
const DATABASE_VERSION = 5

export const LOCAL_STORES = {
  painEntries: 'painEntries',
  medicationEntries: 'medicationEntries',
  medicationPrescriptions: 'medicationPrescriptions',
  activityEntries: 'activityEntries',
  settings: 'settings',
} as const

export type LocalStoreName = (typeof LOCAL_STORES)[keyof typeof LOCAL_STORES]

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.')),
      { once: true },
    )
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen.')),
      { once: true },
    )
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('Dieser Browser unterstützt IndexedDB nicht.'))
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains(LOCAL_STORES.painEntries)) {
        database.createObjectStore(LOCAL_STORES.painEntries, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(LOCAL_STORES.medicationEntries)) {
        database.createObjectStore(LOCAL_STORES.medicationEntries, {
          keyPath: 'id',
        })
      }
      if (
        !database.objectStoreNames.contains(LOCAL_STORES.medicationPrescriptions)
      ) {
        database.createObjectStore(LOCAL_STORES.medicationPrescriptions, {
          keyPath: 'id',
        })
      }
      if (!database.objectStoreNames.contains(LOCAL_STORES.activityEntries)) {
        database.createObjectStore(LOCAL_STORES.activityEntries, {
          keyPath: 'id',
        })
      }
      if (!database.objectStoreNames.contains(LOCAL_STORES.settings)) {
        database.createObjectStore(LOCAL_STORES.settings, { keyPath: 'id' })
      }
    })

    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => {
        databasePromise = null
        reject(request.error ?? new Error('Lokale Datenbank konnte nicht geöffnet werden.'))
      },
      { once: true },
    )
  })

  return databasePromise
}

export async function getAllRecords<T>(storeName: LocalStoreName): Promise<T[]> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  const request = transaction.objectStore(storeName).getAll()
  const [result] = await Promise.all([
    requestResult(request),
    transactionComplete(transaction),
  ])
  return result as T[]
}

export async function getRecord<T>(
  storeName: LocalStoreName,
  id: string,
): Promise<T | undefined> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  const request = transaction.objectStore(storeName).get(id)
  const [result] = await Promise.all([
    requestResult(request),
    transactionComplete(transaction),
  ])
  return result as T | undefined
}

export async function putRecord<T extends { id: string }>(
  storeName: LocalStoreName,
  value: T,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  const completion = transactionComplete(transaction)
  transaction.objectStore(storeName).put(value)
  await completion
}

export async function putRecords<T extends { id: string }>(
  storeName: LocalStoreName,
  values: readonly T[],
): Promise<void> {
  if (!values.length) return

  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  const completion = transactionComplete(transaction)

  for (const value of values) store.put(value)

  await completion
}
