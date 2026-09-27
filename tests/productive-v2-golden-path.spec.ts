import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('runs the productive v1→v2 lifecycle, unlock, durable writes and read-only join', async ({ browser }) => {
  test.setTimeout(180_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('productive-A')
  const deviceB = await harness.device('productive-B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'productive_v2_initial_auth_000001')

    const created = await harness.establishProductiveV2(deviceA)
    expect(created).toMatchObject({ writerStatus: 'writer_active', painCount: 2 })
    const firstCanonical = await harness.verifyProductiveV2Remote(deviceA)
    expect(firstCanonical).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(firstCanonical.coveredRowCount).toBe(created.coveredRowCount)

    const resumed = await harness.reloadUnlockAndContinueProductiveV2(deviceA, created)
    expect(resumed).toMatchObject({ writerStatus: 'writer_active', painCount: 3 })
    const secondCanonical = await harness.verifyProductiveV2Remote(deviceA)
    expect(secondCanonical).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(secondCanonical.coveredRowCount).toBeGreaterThan(firstCanonical.coveredRowCount)
    expect(await harness.scanBrowserPersistence(deviceA, [
      'productive-v2-before-upgrade',
      'productive-v2-after-upgrade',
      'productive-v2-after-reload',
      'multi-device-oauth-sentinel',
    ])).toEqual([])

    const originalRows = harness.snapshotRemoteProtocolRows(resumed.remoteId)
    const hostileRows: string[][][] = [
      originalRows.slice(0, -1),
      [originalRows[1]!, originalRows[0]!, ...originalRows.slice(2)],
      [...originalRows.slice(0, 1), ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', 'AAAA'], ...originalRows.slice(1)],
      originalRows.map((row, index) => index === originalRows.length - 1
        ? [row[0]!, row[1]!, `${row[2]!.slice(0, -1)}${row[2]!.endsWith('A') ? 'B' : 'A'}`]
        : row),
      [],
    ]
    for (const rows of hostileRows) {
      harness.replaceRemoteProtocolRows(resumed.remoteId, rows)
      await expect(harness.refreshProductiveV2(deviceA)).rejects.toThrow()
    }
    harness.replaceRemoteProtocolRows(resumed.remoteId, [...originalRows, originalRows.at(-1)!])
    await harness.refreshProductiveV2(deviceA)
    expect(await harness.verifyProductiveV2Remote(deviceA)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    harness.replaceRemoteProtocolRows(resumed.remoteId, originalRows)

    await harness.authenticate(deviceB, 'productive_v2_join_auth_00000001')
    const joined = await harness.joinAndUnlockProductiveV2(deviceB, resumed)
    expect(joined.writerStatus).toBe('read_only')
    expect(joined.painCount).toBe(3)
    expect(joined.notes).toEqual([
      'productive-v2-after-reload',
      'productive-v2-after-upgrade',
      'productive-v2-before-upgrade',
    ])
    expect(await harness.verifyProductiveV2Remote(deviceB)).toMatchObject({
      kind: 'canonical_full', writerStatus: 'read_only', coveredRowCount: secondCanonical.coveredRowCount,
    })
    expect(await harness.scanBrowserPersistence(deviceB, joined.notes)).toEqual([])
  } finally {
    await harness.close()
  }
})
