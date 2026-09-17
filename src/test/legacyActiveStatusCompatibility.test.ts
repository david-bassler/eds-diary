import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function removeDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('delete blocked'))
  })
}

async function seedLegacyActiveRecords(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('eds-diary', 5)
    request.onupgradeneeded = () => {
      for (const name of [
        'painEntries',
        'medicationEntries',
        'medicationPrescriptions',
        'activityEntries',
        'settings',
      ]) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, { keyPath: 'id' })
        }
      }

      const tx = request.transaction!
      tx.objectStore('painEntries').put({
        id: 'pain-active',
        startedAt: '2026-09-15T10:00:00.000Z',
        endedAt: '',
        locations: [],
        intensity: 4,
        qualities: [],
        cause: '',
        occursWhen: '',
        note: 'legacy pain',
        status: 'active',
        createdAt: '2026-09-15T10:00:00.000Z',
        updatedAt: '2026-09-15T10:00:00.000Z',
      })
      tx.objectStore('medicationEntries').put({
        id: 'med-active',
        medicationName: 'Testmedikament',
        dose: '1 Tablette',
        takenAt: '2026-09-15T11:00:00.000Z',
        status: 'active',
        createdAt: '2026-09-15T11:00:00.000Z',
        updatedAt: '2026-09-15T11:00:00.000Z',
      })
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

describe('legacy active status compatibility', () => {
  beforeEach(async () => {
    vi.resetModules()
    await removeDatabase('eds-diary')
    await seedLegacyActiveRecords()
  })

  it('prepares an active legacy pain record for secure migration', async () => {
    const { googleRemoteSessionStatus } = await import('../data/initializeDataLayer')
    await expect(googleRemoteSessionStatus()).resolves.toMatchObject({ mode: 'local_offline' })

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('eds-diary')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = database.transaction('painEntries', 'readonly')
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = tx.objectStore('painEntries').get('pain-active')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(value).not.toHaveProperty('status')
    database.close()
  })

  it('prepares an active legacy medication record for secure migration', async () => {
    const { googleRemoteSessionStatus } = await import('../data/initializeDataLayer')
    await expect(googleRemoteSessionStatus()).resolves.toMatchObject({ mode: 'local_offline' })

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('eds-diary')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = database.transaction('medicationEntries', 'readonly')
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = tx.objectStore('medicationEntries').get('med-active')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(value).not.toHaveProperty('status')
    database.close()
  })
})
