import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('hands productive Writer authority to B and fences every stale A variant', async ({ browser }) => {
  test.setTimeout(240_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('productive-handoff-A')
  const deviceB = await harness.device('productive-handoff-B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'productive_handoff_initial_a_0001')
    const lifecycle = await harness.establishProductiveV2(deviceA)
    await harness.authenticate(deviceB, 'productive_handoff_join_b_0000001')
    await harness.joinAndUnlockProductiveV2(deviceB, lifecycle)
    const staleBackup = await harness.snapshotAuthenticatedV2State(deviceA, lifecycle.epochId)

    const descriptor = await harness.createTransferDescriptor(deviceB)
    expect(await harness.handoffWriter(deviceA, descriptor)).toMatchObject({ stage: 'durable', writerStatus: 'read_only' })
    expect(await harness.adoptWriter(deviceB)).toMatchObject({ stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2 })
    const afterHandoff = await harness.verifyProductiveV2Remote(deviceB)

    await expect(harness.writeProductivePain(deviceA, 'stale-a-must-not-persist')).rejects.toThrow(/authority|writer|read.only/i)
    expect((await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount).toBe(afterHandoff.coveredRowCount)
    expect(await harness.writeProductivePain(deviceB, 'productive-writer-b')).toMatchObject({ writerStatus: 'writer_active' })

    await harness.restoreAuthenticatedV2State(deviceA, staleBackup)
    await deviceA.page.waitForTimeout(50)
    await expect(harness.writeProductivePain(deviceA, 'restored-stale-a')).rejects.toThrow()
    const afterRestoredAttempt = (await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount
    await harness.restoreAuthenticatedV2State(deviceA, staleBackup)
    await deviceA.context.setOffline(true)
    await expect(harness.writeProductivePain(deviceA, 'offline-stale-a')).rejects.toThrow()
    await deviceA.context.setOffline(false)
    await expect(harness.writeProductivePain(deviceA, 'reconnected-stale-a')).rejects.toThrow()
    expect((await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount).toBe(afterRestoredAttempt)

    expect(await harness.reloadUnlockProductiveV2(deviceA, lifecycle, 'productive_handoff_reload_a_0001')).toMatchObject({ writerStatus: 'read_only' })
    expect(await harness.reloadUnlockProductiveV2(deviceB, lifecycle, 'productive_handoff_reload_b_0001')).toMatchObject({ writerStatus: 'writer_active' })
    await expect(harness.writeProductivePain(deviceA, 'reloaded-stale-a')).rejects.toThrow(/authority|writer|read.only/i)
    expect(await harness.writeProductivePain(deviceB, 'productive-writer-b-after-reload')).toMatchObject({ writerStatus: 'writer_active' })
  } finally {
    await harness.close()
  }
})

test('performs productive Recovery-key forced takeover and fences lost A', async ({ browser }) => {
  test.setTimeout(180_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('productive-takeover-A')
  const deviceB = await harness.device('productive-takeover-B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'productive_takeover_initial_a_0001')
    const lifecycle = await harness.establishProductiveV2(deviceA)
    await harness.authenticate(deviceB, 'productive_takeover_join_b_0000001')
    await harness.joinAndUnlockProductiveV2(deviceB, lifecycle)

    expect(await harness.forceTakeover(deviceB, lifecycle.recoveryKey)).toMatchObject({
      stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2, maintenanceOnly: false,
    })
    const durable = await harness.verifyProductiveV2Remote(deviceB)
    await expect(harness.writeProductivePain(deviceA, 'lost-writer-a')).rejects.toThrow(/authority|writer|read.only/i)
    expect((await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount).toBe(durable.coveredRowCount)
    expect(await harness.writeProductivePain(deviceB, 'productive-takeover-b')).toMatchObject({ writerStatus: 'writer_active' })
  } finally {
    await harness.close()
  }
})

test('executes the continuous replacement-device takeover and mandatory recovery-rekey lifecycle', async ({ browser }) => {
  test.setTimeout(720_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('continuous-takeover-lost-writer')
  const deviceB = await harness.device('continuous-takeover-replacement')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'continuous_takeover_writer_auth_00000001')
    const lifecycle = await harness.establishProductiveV2(deviceA)
    await harness.authenticate(deviceB, 'continuous_takeover_join_auth_00000001')
    await harness.joinAndUnlockProductiveV2(deviceB, lifecycle)

    const takenOver = await harness.forceTakeover(deviceB, lifecycle.recoveryKey)
    expect(takenOver).toMatchObject({ stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2 })
    expect((await harness.verifyProductiveV2Remote(deviceB)).kind).toBe('canonical_full')
    const takeoverCanonical = await harness.verifyProductiveV2Remote(deviceB)
    await expect(harness.writeProductivePain(deviceA, 'lost-a-after-durable-takeover')).rejects.toThrow()
    expect((await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount).toBe(takeoverCanonical.coveredRowCount)

    // The transition is initiated by the replacement Writer itself, not by
    // constructing test-only authority or copying Source device state.
    const seed = {
      newRecoveryKey: Buffer.alloc(32, 93).toString('base64url'),
      passphrase: lifecycle.passphrase,
    }
    await expect(harness.runProductiveRecoveryRekey(deviceB, seed, 'after-transition-durable'))
      .rejects.toThrow('persistent-crash:after-transition-durable')
    const pending = await harness.verifyProductiveV2Remote(deviceB)
    expect(pending.kind).toBe('canonical_full')
    const pendingRows = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    await expect(harness.writeProductivePain(deviceB, 'maintenance-only-write-must-not-persist'))
      .rejects.toThrow(/rekey|maintenance|authority|writer/i)
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(pendingRows)

    await harness.reloadLockedProductiveV2(deviceB, 'continuous_takeover_pending_rekey_00001')
    await harness.unlockProductiveRootThroughUi(deviceB, lifecycle.passphrase)
    const painPrompt = deviceB.page.getByRole('dialog', { name: 'Sind diese Schmerzen noch aktuell?' })
    if (await painPrompt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
      await painPrompt.getByRole('button', { name: 'Ja, noch aktuell' }).click({ timeout: 10_000 })
      await expect(painPrompt).toBeHidden()
    }
    await deviceB.page.getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Konfiguration' }).click({ timeout: 10_000 })
    await expect(deviceB.page.getByRole('region', { name: 'Mehrgeräte-Schreibzugriff (v2)' }))
      .toBeVisible({ timeout: 60_000 })
    await expect(deviceB.page.getByText('Recovery-Key-Wechsel ist noch nicht abgeschlossen. Normale Einträge bleiben gesperrt.'))
      .toBeVisible({ timeout: 60_000 })

    expect(await harness.runProductiveRecoveryRekey(deviceB, seed)).toBe('completed')
    await harness.restoreProductiveRuntimeAfterCeremony(deviceB, lifecycle.passphrase)
    const active = await harness.verifyProductiveV2Remote(deviceB)
    expect(active).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(active.coveredRowCount).toBeGreaterThan(0)
    const writable = await harness.writeProductivePain(deviceB, 'replacement-after-rekey-is-durable')
    expect(writable).toMatchObject({ writerStatus: 'writer_active' })
    expect((await harness.verifyProductiveV2Remote(deviceB)).coveredRowCount)
      .toBeGreaterThan(active.coveredRowCount)
    await expect(harness.writeProductivePain(deviceA, 'lost-a-after-rekey')).rejects.toThrow()
  } finally {
    await harness.close()
  }
})

test('removes usable V2 keys while locked across read, write, Handoff and Recovery boundaries', async ({ browser }) => {
  test.setTimeout(180_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('productive-lock-A')
  const deviceB = await harness.device('productive-lock-B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'productive_lock_initial_a_000001')
    const lifecycle = await harness.establishProductiveV2(deviceA)
    await harness.authenticate(deviceB, 'productive_lock_join_b_000000001')
    await harness.joinAndUnlockProductiveV2(deviceB, lifecycle)
    const descriptor = await harness.createTransferDescriptor(deviceB)
    const before = await harness.verifyProductiveV2Remote(deviceA)
    const remoteRowsBeforeLock = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)

    await harness.lockProductiveRoot(deviceA)
    await harness.reloadLockedProductiveV2(deviceA, 'productive_lock_reload_a_0000001')
    await expect(harness.readProductivePain(deviceA)).rejects.toThrow(/unlock|locked|root/i)
    await expect(harness.writeProductivePain(deviceA, 'locked-write-must-not-persist')).rejects.toThrow(/unlock|locked|root/i)
    await expect(harness.handoffWriter(deviceA, descriptor)).rejects.toThrow(/unlock|locked|root/i)

    await harness.lockProductiveRoot(deviceB)
    await harness.reloadLockedProductiveV2(deviceB, 'productive_lock_reload_b_0000001')
    await expect(harness.forceTakeover(deviceB, lifecycle.recoveryKey)).rejects.toThrow(/unlock|locked|root/i)
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(remoteRowsBeforeLock)

    await harness.unlockProductiveRootThroughUi(deviceA, lifecycle.passphrase)
    await harness.refreshProductiveV2(deviceA)
    expect((await harness.verifyProductiveV2Remote(deviceA)).coveredRowCount).toBe(before.coveredRowCount)
    expect(await harness.readProductivePain(deviceA)).toBe(2)
    expect(await harness.writeProductivePain(deviceA, 'unlocked-write-is-durable')).toMatchObject({ writerStatus: 'writer_active' })
  } finally {
    await harness.close()
  }
})
