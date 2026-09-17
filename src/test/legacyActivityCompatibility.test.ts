import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeLegacyActivityEntriesForSecureMigration } from '../data/legacyCompatibility'

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
      if (!database.objectStoreNames.contains('activityEntries')) {
        database.createObjectStore('activityEntries', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('migrationState')) {
        database.createObjectStore('migrationState', { keyPath: 'id' })
      }
      const transaction = request.transaction!
      transaction.objectStore('activityEntries').put({
        id: 'legacy-activity',
        date: '2026-09-08',
        startTime: '08:00',
        endTime: '09:00',
        activityName: 'Spaziergang',
        color: '#cccccc',
        note: '',
        status: 'active',
        createdAt: '2026-09-08T06:00:00.000Z',
        updatedAt: '2026-09-08T06:00:00.000Z',
      })
      transaction.objectStore('activityEntries').put({
        id: 'already-current',
        date: '2026-09-08',
        startTime: '10:00',
        endTime: '',
        isOngoing: true,
        activityName: 'Pause',
        color: '#cccccc',
        note: '',
        status: 'active',
        createdAt: '2026-09-08T08:00:00.000Z',
        updatedAt: '2026-09-08T08:00:00.000Z',
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

async function readActivity(id: string): Promise<Record<string, unknown>> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('eds-diary')
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const transaction = database.transaction('activityEntries', 'readonly')
      const request = transaction.objectStore('activityEntries').get(id)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
  } finally {
    database.close()
  }
}

describe('legacy activity compatibility', () => {
  beforeEach(deleteDatabase)

  it('maps a missing legacy isOngoing field to false and preserves current values', async () => {
    await seed()

    await normalizeLegacyActivityEntriesForSecureMigration()

    expect((await readActivity('legacy-activity')).isOngoing).toBe(false)
    expect((await readActivity('already-current')).isOngoing).toBe(true)
  })

  it('does not rewrite the legacy source after verified cutover', async () => {
    await seed({ completed: true })

    await normalizeLegacyActivityEntriesForSecureMigration()

    expect(await readActivity('legacy-activity')).not.toHaveProperty('isOngoing')
  })
})
