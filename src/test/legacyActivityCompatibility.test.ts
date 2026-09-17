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
      if (!database.objectStoreNames.contains('activityEntries')) {
        database.createObjectStore('activityEntries', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('migrationState')) {
        database.createObjectStore('migrationState', { keyPath: 'id' })
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

  it('reconstructs added fields and removes only redundant active status metadata', async () => {
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
  })
})
