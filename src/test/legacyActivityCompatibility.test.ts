import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeLegacyActivityEntriesForSecureMigration } from '../data/legacyCompatibility'
import { defaultActivityColor } from '../features/activity/activityColors'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('eds-diary')
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
    request.addEventListener('blocked', () => reject(new Error('delete blocked')), { once: true })
  })
}

async function seed(options?: { completed?: boolean }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('eds-diary', 8)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      for (const storeName of ['activityEntries', 'painEntries', 'migrationState']) {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'id' })
        }
      }
      const transaction = request.transaction!

      // Original ActivityEntry shape: before both color and isOngoing existed.
      transaction.objectStore('activityEntries').put({
        id: 'pre-color',
        date: '2026-09-07',
        startTime: '08:00',
        endTime: '09:00',
        activityName: 'Spaziergang',
        note: '',
        status: 'active',
        createdAt: '2026-09-07T06:00:00.000Z',
        updatedAt: '2026-09-07T06:00:00.000Z',
      })

      // Window after colors were introduced but before ongoing activities.
      transaction.objectStore('activityEntries').put({
        id: 'pre-ongoing',
        date: '2026-09-08',
        startTime: '09:00',
        endTime: '10:00',
        activityName: 'Arbeit',
        color: '#f6cbd0',
        note: '',
        status: 'active',
        createdAt: '2026-09-08T07:00:00.000Z',
        updatedAt: '2026-09-08T07:00:00.000Z',
      })

      transaction.objectStore('activityEntries').put({
        id: 'already-current',
        date: '2026-09-09',
        startTime: '10:00',
        endTime: '',
        isOngoing: true,
        activityName: 'Pause',
        color: '#c6e3ee',
        note: '',
        status: 'active',
        createdAt: '2026-09-09T08:00:00.000Z',
        updatedAt: '2026-09-09T08:00:00.000Z',
      })

      // Present malformed values are not silently repaired by compatibility code.
      transaction.objectStore('activityEntries').put({
        id: 'present-malformed-color',
        date: '2026-09-09',
        startTime: '11:00',
        endTime: '12:00',
        isOngoing: false,
        activityName: 'Test',
        color: '#cccccc',
        note: '',
        status: 'active',
        createdAt: '2026-09-09T09:00:00.000Z',
        updatedAt: '2026-09-09T09:00:00.000Z',
      })

      transaction.objectStore('activityEntries').put({
        id: 'legacy-deleted',
        status: 'deleted',
      })

      // Other legacy stores used the same redundant active/deleted metadata.
      transaction.objectStore('painEntries').put({
        id: 'legacy-pain-active',
        note: 'keep me',
        status: 'active',
      })
      transaction.objectStore('painEntries').put({
        id: 'legacy-pain-deleted',
        status: 'deleted',
      })

      if (options?.completed) {
        transaction.objectStore('migrationState').put({
          id: 'legacy-v1',
          phase: 'cutover',
          verified: true,
        })
      }
    })
    request.addEventListener('success', () => {
      request.result.close()
      resolve()
    }, { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
}

async function readRecord(storeName: string, id: string): Promise<Record<string, unknown>> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('eds-diary')
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(id)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
  } finally {
    database.close()
  }
}

const readActivity = (id: string) => readRecord('activityEntries', id)

describe('legacy activity compatibility', () => {
  beforeEach(deleteDatabase)

  it('reconstructs activity fields and removes redundant active status metadata across stores', async () => {
    await seed()

    await normalizeLegacyActivityEntriesForSecureMigration()

    expect(await readActivity('pre-color')).toMatchObject({
      color: defaultActivityColor('Spaziergang'),
      isOngoing: false,
    })
    expect(await readActivity('pre-color')).not.toHaveProperty('status')
    expect(await readActivity('pre-ongoing')).toMatchObject({
      color: '#f6cbd0',
      isOngoing: false,
    })
    expect(await readActivity('pre-ongoing')).not.toHaveProperty('status')
    expect(await readActivity('already-current')).toMatchObject({
      color: '#c6e3ee',
      isOngoing: true,
    })
    expect(await readActivity('already-current')).not.toHaveProperty('status')
    expect(await readActivity('legacy-deleted')).toEqual({ id: 'legacy-deleted', status: 'deleted' })

    expect(await readRecord('painEntries', 'legacy-pain-active')).toEqual({
      id: 'legacy-pain-active',
      note: 'keep me',
    })
    expect(await readRecord('painEntries', 'legacy-pain-deleted')).toEqual({
      id: 'legacy-pain-deleted',
      status: 'deleted',
    })
  })

  it('does not repair present malformed values', async () => {
    await seed()

    await normalizeLegacyActivityEntriesForSecureMigration()

    expect((await readActivity('present-malformed-color')).color).toBe('#cccccc')
  })

  it('does not rewrite the legacy source after verified cutover', async () => {
    await seed({ completed: true })

    await normalizeLegacyActivityEntriesForSecureMigration()

    const legacy = await readActivity('pre-color')
    expect(legacy).not.toHaveProperty('color')
    expect(legacy).not.toHaveProperty('isOngoing')
    expect(legacy.status).toBe('active')
    expect((await readRecord('painEntries', 'legacy-pain-active')).status).toBe('active')
  })
})
