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
      tx.objectStore('settings').put({
        id: 'custom-pain-types',
        values: ['Brennend', 'Elektrisch'],
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

  it('prepares active legacy pain and medication records for secure migration', async () => {
    const { remoteSessionStatus } = await import('../data/initializeDataLayer')
    await expect(remoteSessionStatus()).resolves.toMatchObject({ mode: 'local_offline' })
    const { getAllRecords, getRecord, LOCAL_STORES, __localDatabaseTesting } = await import('../data/localDatabase')
    await expect(getRecord<{ id: string; values: string[] }>(LOCAL_STORES.settings, 'custom-pain-types')).resolves.toEqual({
      id: 'custom-pain-types',
      values: ['Brennend', 'Elektrisch'],
    })

    const pain = (await getAllRecords<Record<string, unknown>>(LOCAL_STORES.painEntries)).find(value=>value.note==='legacy pain')
    const medication = (await getAllRecords<Record<string, unknown>>(LOCAL_STORES.medicationEntries)).find(value=>value.medicationName==='Testmedikament')
    expect(pain).toBeTruthy()
    expect(medication).toBeTruthy()
    expect(pain).not.toHaveProperty('status')
    expect(medication).not.toHaveProperty('status')

    const database=await __localDatabaseTesting.openDatabase()
    expect(database.objectStoreNames.contains('painEntries')).toBe(false)
    expect(database.objectStoreNames.contains('medicationEntries')).toBe(false)
  })
})
