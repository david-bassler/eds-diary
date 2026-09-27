import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('reconciles the complete browser provider unknown-outcome matrix without semantic duplicates', async ({ browser }) => {
  test.setTimeout(300_000)
  const harness = new MultiDeviceHarness(browser)
  const device = await harness.device('productive-unknown-outcome')
  try {
    await device.page.goto('/')
    await harness.authenticate(device, 'productive_unknown_outcome_action_0001')
    const lifecycle = await harness.establishProductiveV2(device)
    const scenarios = [
      { kind: 'no_commit' as const, note: 'unknown-no-commit' },
      { kind: 'commit_response_lost' as const, note: 'unknown-response-lost' },
      { kind: 'duplicate' as const, note: 'unknown-duplicate' },
      { kind: 'delay' as const, milliseconds: 25, note: 'unknown-delay' },
      { kind: 'intervening_duplicate' as const, note: 'unknown-intervening' },
    ]
    let expectedPainCount = lifecycle.painCount
    for (const scenario of scenarios) {
      const before = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
      harness.enqueueProviderAppendFault(scenario)
      expect(await harness.writeProductivePain(device, scenario.note)).toMatchObject({ writerStatus: 'writer_active' })
      expectedPainCount += 1
      expect(await harness.readProductivePain(device)).toBe(expectedPainCount)
      expect(await harness.verifyProductiveV2Remote(device)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
      const after = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
      expect(after.length).toBeGreaterThan(before.length)
    }

    await harness.reloadLockedProductiveV2(device, 'productive_unknown_reload_action_00001')
    await harness.unlockProductiveRoot(device, lifecycle.passphrase)
    expect(await harness.readProductivePain(device)).toBe(expectedPainCount)
    expect(await harness.verifyProductiveV2Remote(device)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
  } finally {
    await harness.close()
  }
})
