import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('isolates local device state while sharing only simulated remote state', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'multi_device_action_device_a_000001')
    await harness.authenticate(deviceB, 'multi_device_action_device_b_000001')
    const [writerA, writerB] = await Promise.all([
      harness.enrollWriterDeviceKey(deviceA),
      harness.enrollWriterDeviceKey(deviceB),
    ])
    expect(writerA).not.toBe(writerB)
    await deviceA.page.evaluate(async () => {
      localStorage.setItem('device-marker', 'device-a')
      sessionStorage.setItem('session-marker', 'session-a')
    })
    await harness.append(deviceA, 'diary', 'remote-a')

    const isolated = await deviceB.page.evaluate(async () => {
      const databases = await indexedDB.databases()
      return {
        local: localStorage.getItem('device-marker'),
        session: sessionStorage.getItem('session-marker'),
        hasDeviceDatabase: databases.some((database) => database.name === 'virtual-device-state'),
      }
    })
    expect(isolated).toEqual({ local: null, session: null, hasDeviceDatabase: true })
    expect(await harness.read(deviceB, 'diary')).toEqual(['remote-a'])
    expect(harness.remoteRows('diary')).toEqual(['remote-a'])

    await deviceB.page.evaluate(async () => {
      localStorage.setItem('device-marker', 'device-b')
    })
    await harness.append(deviceB, 'diary', 'remote-b')
    await expect.poll(() => harness.remoteRows('diary')).toEqual(['remote-a', 'remote-b'])
    expect(await deviceA.page.evaluate(() => localStorage.getItem('device-marker'))).toBe('device-a')
  } finally {
    await harness.close()
  }
})

test('creates and discovers one V2 candidate through productive authenticated transports on both devices', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'v2_create_action_device_a_00000001')
    await harness.authenticate(deviceB, 'v2_discover_action_device_b_0000001')
    const diaryId = Buffer.alloc(16, 1).toString('base64url')
    const epochId = Buffer.alloc(16, 2).toString('base64url')
    const locator = Buffer.alloc(16, 3).toString('base64url')
    const remoteId = await harness.createAndDiscoverV2(deviceA, diaryId, epochId, locator)
    expect(await harness.discoverV2(deviceB, diaryId, epochId, locator)).toEqual([remoteId])
  } finally {
    await harness.close()
  }
})

test('bootstraps and canonically verifies a ManifestV6 epoch with its genesis WriterGrant', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  try {
    await deviceA.page.goto('/')
    await harness.authenticate(deviceA, 'v2_bootstrap_action_device_a_00001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    expect(bootstrap.coveredRowCount).toBe(1)
    expect(bootstrap.writerGeneration).toBe(1)
    expect(bootstrap.writerKeyId).toHaveLength(43)
    expect(bootstrap.manifestFingerprint).toHaveLength(43)
  } finally {
    await harness.close()
  }
})
