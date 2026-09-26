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

test('persists Writer state and RootWrap, then makes a canonically durable V2 domain write', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  try {
    await deviceA.page.goto('/')
    await harness.authenticate(deviceA, 'v2_domain_write_device_a_00000001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    const write = await harness.writeCanonicalPainV2(deviceA)
    expect(write).toMatchObject({
      coveredRowCount: 2,
      writerStatus: 'writer_active',
      outboxStatus: 'durable',
      rootWrapMode: 'best-effort',
      selected: true,
    })
    expect(write.recordId).toHaveLength(22)
    expect(write.revisionId).toHaveLength(43)
    await deviceA.page.reload()
    await harness.authenticate(deviceA, 'v2_reload_action_device_a_00000001')
    expect(await harness.resumeCanonicalV2(deviceA, bootstrap)).toEqual({
      writerStatus: 'writer_active', painRevisionCount: 1, rootWrapMode: 'best-effort',
    })
    const secondWrite = await harness.writeCanonicalPainV2(deviceA)
    expect(secondWrite).toMatchObject({ coveredRowCount: 3, writerStatus: 'writer_active', outboxStatus: 'durable' })
    expect(await harness.scanBrowserPersistence(deviceA, [
      'synthetic-v2-golden-path',
      'multi-device-oauth-sentinel',
    ])).toEqual([])
  } finally {
    await harness.close()
  }
})

test('joins the canonical V2 diary read-only on a fresh second device and materializes verified data', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'v2_join_source_device_a_00000001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    await harness.writeCanonicalPainV2(deviceA)
    await harness.authenticate(deviceB, 'v2_join_target_device_b_00000001')
    const joined = await harness.joinReadOnlyV2(deviceB, bootstrap)
    expect(joined).toMatchObject({
      joined: true, writerStatus: 'read_only', painRevisionCount: 1, repositoryPainCount: 1,
      rootWrapMode: 'best-effort', writeRejected: true,
    })
    expect(joined.writerDeviceId).not.toBe(bootstrap.writerDeviceId)
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(2)
  } finally {
    await harness.close()
  }
})

test('hands Writer authority from A to B and preserves the canonical roles across reload', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'v2_handoff_source_device_a_00001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    await harness.writeCanonicalPainV2(deviceA)
    await harness.installGoldenSession(deviceA, bootstrap)
    await harness.authenticate(deviceB, 'v2_handoff_target_device_b_00001')
    await harness.joinReadOnlyV2(deviceB, bootstrap)
    const descriptor = await harness.createTransferDescriptor(deviceB)
    expect(await harness.handoffWriter(deviceA, descriptor)).toMatchObject({ stage: 'durable', writerStatus: 'read_only', writerGeneration: null })
    expect(await harness.adoptWriter(deviceB)).toMatchObject({ stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2 })
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(3)

    await Promise.all([deviceA.page.reload(), deviceB.page.reload()])
    await harness.authenticate(deviceA, 'v2_handoff_reload_device_a_00001')
    await harness.authenticate(deviceB, 'v2_handoff_reload_device_b_00001')
    expect(await harness.resumeCanonicalV2(deviceA, bootstrap)).toMatchObject({ writerStatus: 'read_only', painRevisionCount: 1 })
    expect(await harness.resumeCanonicalV2(deviceB, bootstrap)).toMatchObject({ writerStatus: 'writer_active', painRevisionCount: 1 })
    await expect(harness.writeCanonicalPainV2(deviceA)).rejects.toThrow(/authority|writer|read-only|journal hash/i)
    expect(await harness.writeCanonicalPainV2(deviceB)).toMatchObject({ coveredRowCount: 4, writerStatus: 'writer_active', outboxStatus: 'durable' })
  } finally {
    await harness.close()
  }
})

test('rejects stale A after restored state, old tab delay, and offline reconnect without another append', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'v2_stale_source_device_a_00000001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    await harness.writeCanonicalPainV2(deviceA)
    await harness.installGoldenSession(deviceA, bootstrap)
    const staleBackup = await harness.snapshotAuthenticatedV2State(deviceA, bootstrap.epochId)
    await harness.authenticate(deviceB, 'v2_stale_target_device_b_00000001')
    await harness.joinReadOnlyV2(deviceB, bootstrap)
    const descriptor = await harness.createTransferDescriptor(deviceB)
    await harness.handoffWriter(deviceA, descriptor)
    await harness.adoptWriter(deviceB)
    const rowsAfterHandoff = harness.remoteProtocolRowCount(bootstrap.remoteId)

    await harness.restoreAuthenticatedV2State(deviceA, staleBackup)
    await deviceA.page.waitForTimeout(50)
    await expect(harness.writeCanonicalPainV2(deviceA)).rejects.toThrow(/authority|writer|read-only|journal hash/i)
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(rowsAfterHandoff)

    await harness.restoreAuthenticatedV2State(deviceA, staleBackup)
    await deviceA.context.setOffline(true)
    await expect(harness.writeCanonicalPainV2(deviceA)).rejects.toThrow()
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(rowsAfterHandoff)
    await deviceA.context.setOffline(false)
    await expect(harness.writeCanonicalPainV2(deviceA)).rejects.toThrow(/authority|writer|read-only|journal hash/i)
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(rowsAfterHandoff)
  } finally {
    await harness.close()
  }
})

test('recovers a lost writer through productive forced takeover and fences the old writer', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  const deviceB = await harness.device('B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'v2_takeover_lost_device_a_00000001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    await harness.writeCanonicalPainV2(deviceA)
    await harness.installGoldenSession(deviceA, bootstrap)
    await harness.authenticate(deviceB, 'v2_takeover_recovery_device_b_0001')
    await harness.joinReadOnlyV2(deviceB, bootstrap)

    expect(await harness.forceTakeover(deviceB, bootstrap.recoveryKey)).toMatchObject({
      stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2, maintenanceOnly: false,
    })
    const rowsAfterTakeover = harness.remoteProtocolRowCount(bootstrap.remoteId)
    await expect(harness.writeCanonicalPainV2(deviceA)).rejects.toThrow(/authority|writer|read-only|journal hash/i)
    expect(harness.remoteProtocolRowCount(bootstrap.remoteId)).toBe(rowsAfterTakeover)
    expect(await harness.resumeCanonicalV2(deviceB, bootstrap)).toMatchObject({ writerStatus: 'writer_active', painRevisionCount: 1 })
    expect(await harness.writeCanonicalPainV2(deviceB)).toMatchObject({
      coveredRowCount: rowsAfterTakeover + 1, writerStatus: 'writer_active', outboxStatus: 'durable',
    })
  } finally {
    await harness.close()
  }
})

test('fails closed on hostile remote row deletion, reordering, insertion, ciphertext mutation and replay', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('A')
  try {
    await deviceA.page.goto('/')
    await harness.authenticate(deviceA, 'v2_remote_tamper_device_a_00000001')
    const bootstrap = await harness.bootstrapCanonicalV2(deviceA)
    await harness.writeCanonicalPainV2(deviceA)
    const original = harness.snapshotRemoteProtocolRows(bootstrap.remoteId)
    expect(original).toHaveLength(2)

    const hostile: string[][][] = [
      original.slice(0, 1),
      [original[1]!, original[0]!],
      [original[0]!, ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', 'AAAA'], original[1]!],
      [original[0]!, [original[1]![0]!, original[1]![1]!, `${original[1]![2]!.slice(0, -1)}${original[1]![2]!.endsWith('A') ? 'B' : 'A'}`]],
      [],
    ]
    for (const rows of hostile) {
      harness.replaceRemoteProtocolRows(bootstrap.remoteId, rows)
      await expect(harness.installGoldenSession(deviceA, bootstrap)).rejects.toThrow()
    }

    // Exact physical retries are normatively allowed but must not duplicate
    // semantic materialization or change Writer authority.
    harness.replaceRemoteProtocolRows(bootstrap.remoteId, [...original, original[1]!])
    await harness.installGoldenSession(deviceA, bootstrap)
    expect(await harness.resumeCanonicalV2(deviceA, bootstrap)).toMatchObject({
      writerStatus: 'writer_active', painRevisionCount: 1,
    })
    harness.replaceRemoteProtocolRows(bootstrap.remoteId, original)
  } finally {
    await harness.close()
  }
})
