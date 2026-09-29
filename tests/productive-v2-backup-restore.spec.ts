import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

const RESTORE_POINTS = [
  'after-verified',
  'after-local-bundle',
  'after-local-data',
  'after-selection',
] as const

test('imports a genuine productive BackupV6 through Recovery UI as local read-only without remote authority', async ({ browser }) => {
  test.setTimeout(420_000)
  const harness = new MultiDeviceHarness(browser)
  const source = await harness.device('backup-restore-ui-source')
  const restored = await harness.device('backup-restore-ui-target')
  try {
    await Promise.all([source.page.goto('/'), restored.page.goto('/?mode=recovery')])
    await harness.authenticate(source, 'backup_restore_ui_source_auth_000001')
    const lifecycle = await harness.establishProductiveV2(source)
    const backup = await harness.productiveActivatedBackup(source)
    const remoteBefore = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)

    await restored.page.getByLabel('Transferable Single Writer v2 Backup (lokal read-only)').check()
    await restored.page.getByLabel('Recovery-Schlüssel').fill(lifecycle.recoveryKey)
    await restored.page.getByLabel('V2-Backup-Datei').setInputFiles({
      name: 'synthetic-v2-backup.syncbackup',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    await restored.page.getByRole('button', { name: 'Strikt prüfen und wiederherstellen' }).click()
    await expect(restored.page.getByRole('status')).toContainText('lokal und read-only wiederhergestellt')
    await restored.page.waitForURL(/configuration/, { timeout: 15_000 })

    expect(await harness.productiveV2SessionStatus(restored)).toMatchObject({
      profile: 'v2', mode: 'local_offline', writerStatus: 'read_only', remoteResourceId: null,
    })
    expect(await harness.readProductivePain(restored)).toBe(1)
    await expect(harness.writeProductivePain(restored, 'offline-restore-must-not-write')).rejects.toThrow()
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(remoteBefore)
  } finally {
    await harness.close()
  }
})

for (const crashPoint of RESTORE_POINTS) {
  test(`resumes the exact local read-only BackupV6 restore after ${crashPoint}`, async ({ browser }) => {
    test.setTimeout(480_000)
    const harness = new MultiDeviceHarness(browser)
    const source = await harness.device(`backup-restore-${crashPoint}-source`)
    const target = await harness.device(`backup-restore-${crashPoint}-target`)
    const passphrase = `synthetic backup restore ${crashPoint} passphrase`
    try {
      await Promise.all([source.page.goto('/'), target.page.goto('/')])
      await harness.authenticate(source, `backup_restore_source_${crashPoint.replaceAll('-', '_')}_001`)
      const lifecycle = await harness.establishProductiveV2(source)
      const backup = await harness.productiveActivatedBackup(source)
      const remoteBefore = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)

      await target.page.evaluate(async (value) => {
        await (await import('/src/data/localDatabase.ts')).enrollActivePassphraseRootWrap(value)
      }, passphrase)

      await expect(harness.runProductiveBackupRestore(target, backup, lifecycle.recoveryKey, crashPoint))
        .rejects.toThrow(`persistent-crash:${crashPoint}`)
      const interrupted = await harness.productiveBackupRestoreCheckpointChain(target, backup, lifecycle.recoveryKey)
      const expectedLength = RESTORE_POINTS.indexOf(crashPoint) + 1
      expect(interrupted.stages).toEqual(['verified', 'local_bundle_persisted', 'local_data_applied', 'selected'].slice(0, expectedLength))

      await target.page.reload()
      await harness.unlockProductiveRootThroughUi(target, passphrase)
      const resumed = await harness.runProductiveBackupRestore(target, backup, lifecycle.recoveryKey)
      expect(resumed).toMatchObject({
        operationId: interrupted.operationId,
        stage: 'selected',
        access: 'read_only',
      })
      const finalChain = await harness.productiveBackupRestoreCheckpointChain(target, backup, lifecycle.recoveryKey)
      expect(finalChain.operationId).toBe(interrupted.operationId)
      expect(finalChain.stages).toEqual(['verified', 'local_bundle_persisted', 'local_data_applied', 'selected'])
      expect(await harness.productiveV2SessionStatus(target)).toMatchObject({
        profile: 'v2', mode: 'local_offline', writerStatus: 'read_only', remoteResourceId: null,
      })
      expect(await harness.readProductivePain(target)).toBe(1)
      await expect(harness.writeProductivePain(target, `restore-${crashPoint}-must-not-write`)).rejects.toThrow()
      expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(remoteBefore)

      await target.page.reload()
      await harness.unlockProductiveRootThroughUi(target, passphrase)
      expect(await harness.readProductivePain(target)).toBe(1)
      expect(await harness.productiveV2SessionStatus(target)).toMatchObject({
        mode: 'local_offline', writerStatus: 'read_only', remoteResourceId: null,
      })
    } finally {
      await harness.close()
    }
  })
}

test('rejects wrong-key, tampered and structurally truncated BackupV6 before local selection', async ({ browser }) => {
  test.setTimeout(300_000)
  const harness = new MultiDeviceHarness(browser)
  const source = await harness.device('backup-restore-adversarial-source')
  const target = await harness.device('backup-restore-adversarial-target')
  try {
    await Promise.all([source.page.goto('/'), target.page.goto('/')])
    await harness.authenticate(source, 'backup_restore_adversarial_source_auth_001')
    const lifecycle = await harness.establishProductiveV2(source)
    const backup = await harness.productiveActivatedBackup(source) as Record<string, unknown>
    const remoteBefore = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)

    const wrongKey = Buffer.alloc(32, 211).toString('base64url')
    await expect(harness.runProductiveBackupRestore(target, backup, wrongKey)).rejects.toThrow()

    const ciphertext = String(backup.backup_manifest_ciphertext)
    const tampered = {
      ...backup,
      backup_manifest_ciphertext: `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`,
    }
    await expect(harness.runProductiveBackupRestore(target, tampered, lifecycle.recoveryKey)).rejects.toThrow()

    const truncated = { ...backup }
    delete truncated.record_rows
    await expect(harness.runProductiveBackupRestore(target, truncated, lifecycle.recoveryKey)).rejects.toThrow()

    const selected = await target.page.evaluate(async () =>
      (await import('/src/data/localDatabase.ts')).activeProtocolSelectionV2())
    expect(selected).toBeNull()
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(remoteBefore)
  } finally {
    await harness.close()
  }
})


test('refuses a second valid same-epoch BackupV6 after the first restore owns the epoch', async ({ browser }) => {
  test.setTimeout(360_000)
  const harness = new MultiDeviceHarness(browser)
  const source = await harness.device('backup-restore-owner-source')
  const target = await harness.device('backup-restore-owner-target')
  try {
    await Promise.all([source.page.goto('/'), target.page.goto('/')])
    await harness.authenticate(source, 'backup_restore_owner_source_auth_000001')
    const lifecycle = await harness.establishProductiveV2(source)
    const activated = await harness.productiveActivatedBackup(source)
    const staged = await harness.productiveStagedBackup(source)

    await expect(harness.runProductiveBackupRestore(target, activated, lifecycle.recoveryKey, 'after-local-bundle'))
      .rejects.toThrow('persistent-crash:after-local-bundle')
    const owner = await harness.productiveBackupRestoreCheckpointChain(target, activated, lifecycle.recoveryKey)
    expect(owner.stages).toEqual(['verified', 'local_bundle_persisted'])

    await expect(harness.runProductiveBackupRestore(target, staged, lifecycle.recoveryKey))
      .rejects.toThrow(/different BackupV6 already owns/i)
    await expect(harness.productiveBackupRestoreCheckpointChain(target, staged, lifecycle.recoveryKey))
      .rejects.toThrow(/plan is missing/i)
    expect((await harness.productiveBackupRestoreCheckpointChain(target, activated, lifecycle.recoveryKey)).stages)
      .toEqual(['verified', 'local_bundle_persisted'])

    const resumed = await harness.runProductiveBackupRestore(target, activated, lifecycle.recoveryKey)
    expect(resumed.operationId).toBe(owner.operationId)
    expect(await harness.readProductivePain(target)).toBe(1)
    expect(await harness.productiveV2SessionStatus(target)).toMatchObject({
      mode: 'local_offline', writerStatus: 'read_only', remoteResourceId: null,
    })
  } finally {
    await harness.close()
  }
})


test('rejects a tampered MAC-bound restore owner before resuming local apply', async ({ browser }) => {
  test.setTimeout(300_000)
  const harness = new MultiDeviceHarness(browser)
  const source = await harness.device('backup-restore-owner-tamper-source')
  const target = await harness.device('backup-restore-owner-tamper-target')
  try {
    await Promise.all([source.page.goto('/'), target.page.goto('/')])
    await harness.authenticate(source, 'backup_restore_owner_tamper_source_001')
    const lifecycle = await harness.establishProductiveV2(source)
    const backup = await harness.productiveActivatedBackup(source)

    await expect(harness.runProductiveBackupRestore(target, backup, lifecycle.recoveryKey, 'after-verified'))
      .rejects.toThrow('persistent-crash:after-verified')
    await harness.tamperBackupRestoreOwnerArtifact(target)
    await expect(harness.runProductiveBackupRestore(target, backup, lifecycle.recoveryKey))
      .rejects.toThrow(/MAC-bound v2 operation artifact integrity failed/i)

    const selected = await target.page.evaluate(async () =>
      (await import('/src/data/localDatabase.ts')).activeProtocolSelectionV2())
    expect(selected).toBeNull()
  } finally {
    await harness.close()
  }
})
