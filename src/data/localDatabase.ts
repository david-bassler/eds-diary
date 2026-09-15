import { arrayBuffer, decodeUtf8, fromBase64Url, base64Url, randomBytes, utf8 } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'

const DATABASE_NAME = 'eds-diary'
const DATABASE_VERSION = 6

export const LOCAL_STORES = {
  painEntries: 'painEntries',
  medicationEntries: 'medicationEntries',
  medicationPrescriptions: 'medicationPrescriptions',
  activityEntries: 'activityEntries',
  settings: 'settings',
} as const

export type LocalStoreName = (typeof LOCAL_STORES)[keyof typeof LOCAL_STORES]
const LEGACY_STORES = Object.values(LOCAL_STORES)
const SECURE_RECORDS = 'secureRecords'
const KEY_STORE = 'secureKeys'
const MIGRATION_STORE = 'migrationState'
interface CipherRecord { id: string; store: LocalStoreName; recordId: string; iv: string; ciphertext: string }

let databasePromise: Promise<IDBDatabase> | null = null
let readyPromise: Promise<void> | null = null
let mutationTail: Promise<void> = Promise.resolve()

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB-Anfrage fehlgeschlagen.')), { once: true })
  })
}
function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen.')), { once: true })
  })
}
function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('Dieser Browser unterstützt IndexedDB nicht.'))
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      for (const name of LEGACY_STORES) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(SECURE_RECORDS)) {
        const store = database.createObjectStore(SECURE_RECORDS, { keyPath: 'id' })
        store.createIndex('byStore', 'store')
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(MIGRATION_STORE)) database.createObjectStore(MIGRATION_STORE, { keyPath: 'id' })
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => { databasePromise = null; reject(request.error ?? new Error('Lokale Datenbank konnte nicht geöffnet werden.')) }, { once: true })
  })
  return databasePromise
}
async function deviceKey(database: IDBDatabase): Promise<CryptoKey> {
  const read = database.transaction(KEY_STORE, 'readonly')
  const existing = await requestResult<{ id: string; key: CryptoKey } | undefined>(read.objectStore(KEY_STORE).get('best-effort-v1'))
  await transactionComplete(read)
  if (existing?.key) return existing.key
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const write = database.transaction(KEY_STORE, 'readwrite'); write.objectStore(KEY_STORE).add({ id: 'best-effort-v1', key }); await transactionComplete(write)
  return key
}
function secureId(store: LocalStoreName, id: string): string { return `${store}\u0000${id}` }
async function encryptRecord(key: CryptoKey, store: LocalStoreName, value: { id: string }): Promise<CipherRecord> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(canonicalBytes(['eds-diary/local-record/v1', store, value.id])), tagLength: 128 }, key, arrayBuffer(utf8(JSON.stringify(value))))
  return { id: secureId(store, value.id), store, recordId: value.id, iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) }
}
async function decryptRecord<T>(key: CryptoKey, value: CipherRecord): Promise<T> {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(fromBase64Url(value.iv)), additionalData: arrayBuffer(canonicalBytes(['eds-diary/local-record/v1', value.store, value.recordId])), tagLength: 128 }, key, arrayBuffer(fromBase64Url(value.ciphertext)))
  return JSON.parse(decodeUtf8(new Uint8Array(plaintext))) as T
}
async function migrateLegacy(): Promise<void> {
  const database = await openDatabase(); const key = await deviceKey(database)
  const statusTx = database.transaction(MIGRATION_STORE, 'readonly')
  const status = await requestResult<{ id: string; verified: boolean } | undefined>(statusTx.objectStore(MIGRATION_STORE).get('legacy-v1')); await transactionComplete(statusTx)
  if (status?.verified) return
  for (const storeName of LEGACY_STORES) {
    const read = database.transaction(storeName, 'readonly'); const values = await requestResult<Array<{ id: string }>>(read.objectStore(storeName).getAll()); await transactionComplete(read)
    for (const value of values) {
      if (!value?.id) continue
      const encrypted = await encryptRecord(key, storeName, value)
      const write = database.transaction(SECURE_RECORDS, 'readwrite'); write.objectStore(SECURE_RECORDS).put(encrypted); await transactionComplete(write)
    }
  }
  // Verify every legacy identifier exists before the non-destructive cutover marker.
  for (const storeName of LEGACY_STORES) {
    const tx = database.transaction([storeName, SECURE_RECORDS], 'readonly')
    const legacy = await requestResult<Array<{ id: string }>>(tx.objectStore(storeName).getAll())
    const secure = await requestResult<CipherRecord[]>(tx.objectStore(SECURE_RECORDS).index('byStore').getAll(storeName)); await transactionComplete(tx)
    const ids = new Set(secure.map((record) => record.recordId)); if (legacy.some((record) => !ids.has(record.id))) throw new Error('Legacy migration verification failed.')
  }
  const done = database.transaction(MIGRATION_STORE, 'readwrite'); done.objectStore(MIGRATION_STORE).put({ id: 'legacy-v1', verified: true, generation: 1 }); await transactionComplete(done)
}
async function ready(): Promise<void> { readyPromise ??= migrateLegacy(); return readyPromise }
function serializeMutation(operation: () => Promise<void>): Promise<void> {
  const run = mutationTail.then(operation, operation); mutationTail = run.catch(() => undefined); return run
}
export async function getAllRecords<T>(storeName: LocalStoreName): Promise<T[]> {
  await ready(); const database = await openDatabase(); const key = await deviceKey(database)
  const tx = database.transaction(SECURE_RECORDS, 'readonly'); const values = await requestResult<CipherRecord[]>(tx.objectStore(SECURE_RECORDS).index('byStore').getAll(storeName)); await transactionComplete(tx)
  return Promise.all(values.map((value) => decryptRecord<T>(key, value)))
}
export async function getRecord<T>(storeName: LocalStoreName, id: string): Promise<T | undefined> {
  await ready(); const database = await openDatabase(); const key = await deviceKey(database)
  const tx = database.transaction(SECURE_RECORDS, 'readonly'); const value = await requestResult<CipherRecord | undefined>(tx.objectStore(SECURE_RECORDS).get(secureId(storeName, id))); await transactionComplete(tx)
  return value ? decryptRecord<T>(key, value) : undefined
}
export function putRecord<T extends { id: string }>(storeName: LocalStoreName, value: T): Promise<void> { return putRecords(storeName, [value]) }
export function putRecords<T extends { id: string }>(storeName: LocalStoreName, values: readonly T[]): Promise<void> {
  if (!values.length) return Promise.resolve()
  return serializeMutation(async () => {
    await ready(); const database = await openDatabase(); const key = await deviceKey(database); const encrypted = await Promise.all(values.map((value) => encryptRecord(key, storeName, value)))
    const tx = database.transaction(SECURE_RECORDS, 'readwrite'); for (const value of encrypted) tx.objectStore(SECURE_RECORDS).put(value); await transactionComplete(tx)
  })
}
