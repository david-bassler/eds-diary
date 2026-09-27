import { expect, test } from '@playwright/test'
import { MultiDeviceHarness, type ProductiveRecoveryRekeySeed, type ProductiveV1CrashSeed, type VirtualDevice } from './support/multiDeviceHarness'
import { runPersistentCrashScenario } from './support/persistentCrashRunner'

const POINTS = [
  'after-source_frozen_verified',
  'after-staged_backup_verified',
  'after-confirmation_durable',
] as const

for (const crashPoint of POINTS) {
  test(`restarts, unlocks, resumes and canonically verifies productive Profile Upgrade at ${crashPoint}`, async ({ browser }) => {
  test.setTimeout(360_000)
  const harness = new MultiDeviceHarness(browser)
  let device: VirtualDevice | null = null
  let seed: ProductiveV1CrashSeed | null = null
  let index = 0
  try {
    await runPersistentCrashScenario({
      points: [crashPoint] as const,
      prepare: async () => {
        device = await harness.device(`profile-upgrade-crash-${index}`)
        index += 1
        await device.page.goto('/')
        await harness.authenticate(device, `productive_crash_prepare_${String(index).padStart(8, '0')}`)
        seed = await harness.establishProductiveRemoteV1(device)
      },
      crash: async (point) => {
        await expect(harness.runProductiveProfileUpgrade(device!, seed!, point)).rejects.toThrow(`persistent-crash:${point}`)
      },
      restart: async () => {
        await device!.page.reload()
        await harness.authenticate(device!, `productive_crash_restart_${String(index).padStart(8, '0')}`)
      },
      unlock: async () => harness.unlockProductiveRoot(device!, seed!.passphrase),
      resume: async () => {
        expect(await harness.runProductiveProfileUpgrade(device!, seed!)).toBe('switched')
      },
      verify: async () => {
        expect(await harness.verifyProductiveV2Remote(device!)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
        await device!.close()
      },
      finish: async () => {},
      verifyFinished: async () => {},
    })
  } finally {
    await harness.close()
  }
  })
}

const RECOVERY_REKEY_POINTS = ['after-transition-durable', 'before-phase-b'] as const
for (const crashPoint of RECOVERY_REKEY_POINTS) {
  test(`restarts, unlocks and resumes productive Recovery-Rekey at ${crashPoint}`, async ({ browser }) => {
  test.setTimeout(900_000)
  const harness = new MultiDeviceHarness(browser)
  let device: VirtualDevice | null = null
  let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
  let seed: ProductiveRecoveryRekeySeed | null = null
  let index = 0
  try {
    await runPersistentCrashScenario({
      points: [crashPoint] as const,
      prepare: async () => {
        device = await harness.device(`recovery-rekey-crash-${index}`)
        index += 1
        await device.page.goto('/')
        await harness.authenticate(device, `recovery_rekey_prepare_action_${String(index).padStart(8, '0')}`)
        lifecycle = await harness.establishProductiveV2(device)
        seed = { newRecoveryKey: Buffer.alloc(32, 40 + index).toString('base64url'), passphrase: lifecycle.passphrase }
      },
      crash: async (point) => {
        await expect(harness.runProductiveRecoveryRekey(device!, seed!, point)).rejects.toThrow(`persistent-crash:${point}`)
        await expect(harness.writeProductivePain(device!, 'pending-rekey-write-must-not-persist')).rejects.toThrow(/rekey|maintenance|authority|writer/i)
      },
      restart: async () => harness.reloadLockedProductiveV2(device!, `recovery_rekey_restart_action_${String(index).padStart(8, '0')}`),
      unlock: async () => harness.unlockProductiveRoot(device!, seed!.passphrase),
      resume: async () => {
        await device!.page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Konfiguration' }).click()
        await expect(device!.page.getByText('Recovery-Key-Wechsel ist noch nicht abgeschlossen. Normale Einträge bleiben gesperrt.')).toBeVisible()
        expect(await harness.runProductiveRecoveryRekey(device!, seed!)).toBe('completed')
        await harness.refreshProductiveV2(device!)
      },
      verify: async () => {
        expect(await harness.verifyProductiveV2Remote(device!)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
        expect(await harness.writeProductivePain(device!, 'post-rekey-write-is-durable')).toMatchObject({ writerStatus: 'writer_active' })
        await device!.close()
      },
      finish: async () => {},
      verifyFinished: async () => {},
    })
  } finally {
    await harness.close()
  }
  })
}

const HANDOFF_POINTS = ['after-prepared', 'after-append-attempt'] as const
for (const crashPoint of HANDOFF_POINTS) {
  test(`restarts, unlocks and resumes productive Writer Handoff at ${crashPoint}`, async ({ browser }) => {
  test.setTimeout(480_000)
  const harness = new MultiDeviceHarness(browser)
  let source: VirtualDevice | null = null
  let target: VirtualDevice | null = null
  let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
  let descriptor: unknown = null
  let index = 0
  try {
    await runPersistentCrashScenario({
      points: [crashPoint] as const,
      prepare: async () => {
        index += 1
        source = await harness.device(`handoff-crash-source-${index}`)
        target = await harness.device(`handoff-crash-target-${index}`)
        await Promise.all([source.page.goto('/'), target.page.goto('/')])
        await harness.authenticate(source, `handoff_crash_source_action_${String(index).padStart(8, '0')}`)
        lifecycle = await harness.establishProductiveV2(source)
        await harness.authenticate(target, `handoff_crash_target_action_${String(index).padStart(8, '0')}`)
        await harness.joinAndUnlockProductiveV2(target, lifecycle)
        descriptor = await harness.createTransferDescriptor(target)
      },
      crash: async (point) => { await expect(harness.handoffWriter(source!, descriptor, point)).rejects.toThrow(`persistent-crash:${point}`) },
      restart: async () => harness.reloadLockedProductiveV2(source!, `handoff_crash_restart_action_${String(index).padStart(8, '0')}`),
      unlock: async () => harness.unlockProductiveRoot(source!, lifecycle!.passphrase),
      resume: async () => { expect(await harness.handoffWriter(source!, descriptor)).toMatchObject({ stage: 'durable', writerStatus: 'read_only' }) },
      verify: async () => {
        expect(await harness.adoptWriter(target!)).toMatchObject({ stage: 'durable', writerStatus: 'writer_active' })
        await expect(harness.writeProductivePain(source!, 'crashed-handoff-source')).rejects.toThrow()
        expect(await harness.writeProductivePain(target!, 'crashed-handoff-target')).toMatchObject({ writerStatus: 'writer_active' })
        await Promise.all([source!.close(), target!.close()])
      },
      finish: async () => {}, verifyFinished: async () => {},
    })
  } finally { await harness.close() }
  })
}

const TAKEOVER_POINTS = ['after-prepared', 'after-append-attempt'] as const
for (const crashPoint of TAKEOVER_POINTS) {
  test(`restarts, unlocks and resumes productive Forced Takeover at ${crashPoint}`, async ({ browser }) => {
  test.setTimeout(480_000)
  const harness = new MultiDeviceHarness(browser)
  let lostWriter: VirtualDevice | null = null
  let replacement: VirtualDevice | null = null
  let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
  let index = 0
  try {
    await runPersistentCrashScenario({
      points: [crashPoint] as const,
      prepare: async () => {
        index += 1
        lostWriter = await harness.device(`takeover-crash-lost-${index}`)
        replacement = await harness.device(`takeover-crash-replacement-${index}`)
        await Promise.all([lostWriter.page.goto('/'), replacement.page.goto('/')])
        await harness.authenticate(lostWriter, `takeover_crash_lost_action_${String(index).padStart(8, '0')}`)
        lifecycle = await harness.establishProductiveV2(lostWriter)
        await harness.authenticate(replacement, `takeover_crash_replacement_action_${String(index).padStart(8, '0')}`)
        await harness.joinAndUnlockProductiveV2(replacement, lifecycle)
      },
      crash: async (point) => { await expect(harness.forceTakeover(replacement!, lifecycle!.recoveryKey, point)).rejects.toThrow(`persistent-crash:${point}`) },
      restart: async () => harness.reloadLockedProductiveV2(replacement!, `takeover_crash_restart_action_${String(index).padStart(8, '0')}`),
      unlock: async () => harness.unlockProductiveRoot(replacement!, lifecycle!.passphrase),
      resume: async () => {
        expect(await harness.forceTakeover(replacement!, lifecycle!.recoveryKey)).toMatchObject({ stage: 'durable', writerStatus: 'writer_active' })
        await harness.refreshProductiveV2(replacement!)
      },
      verify: async () => {
        await expect(harness.writeProductivePain(lostWriter!, 'crashed-takeover-old-writer')).rejects.toThrow()
        expect(await harness.writeProductivePain(replacement!, 'crashed-takeover-replacement')).toMatchObject({ writerStatus: 'writer_active' })
        await Promise.all([lostWriter!.close(), replacement!.close()])
      },
      finish: async () => {}, verifyFinished: async () => {},
    })
  } finally { await harness.close() }
  })
}

test('restarts, unlocks and resumes a productive read-only Join bundle', async ({ browser }) => {
  test.setTimeout(240_000)
  const harness = new MultiDeviceHarness(browser)
  let source: VirtualDevice | null = null
  let joining: VirtualDevice | null = null
  let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
  const joinPassphrase = 'synthetic productive join crash passphrase 2026'
  try {
    await runPersistentCrashScenario({
      points: ['after-join-bundle'] as const,
      prepare: async () => {
        source = await harness.device('join-crash-source')
        joining = await harness.device('join-crash-target')
        await Promise.all([source.page.goto('/'), joining.page.goto('/')])
        await harness.authenticate(source, 'join_crash_source_action_00000001')
        lifecycle = await harness.establishProductiveV2(source)
        await harness.authenticate(joining, 'join_crash_target_action_00000001')
        await harness.prepareProductiveJoinProtection(joining, joinPassphrase)
      },
      crash: async (point) => { await expect(harness.runProductiveJoin(joining!, lifecycle!.recoveryKey, point)).rejects.toThrow(`persistent-crash:${point}`) },
      restart: async () => harness.reloadLockedProductiveV2(joining!, 'join_crash_restart_action_0000001'),
      unlock: async () => harness.unlockProductiveRoot(joining!, joinPassphrase),
      resume: async () => {
        expect(await harness.runProductiveJoin(joining!, lifecycle!.recoveryKey)).toBe(lifecycle!.epochId)
        await harness.unlockProductiveRoot(joining!, joinPassphrase)
        await harness.refreshProductiveV2(joining!)
      },
      verify: async () => {
        expect(await harness.verifyProductiveV2Remote(joining!)).toMatchObject({ kind: 'canonical_full', writerStatus: 'read_only' })
        await expect(harness.writeProductivePain(joining!, 'joined-crash-device-write')).rejects.toThrow(/authority|writer|read.only/i)
      },
      finish: async () => {}, verifyFinished: async () => {},
    })
  } finally { await harness.close() }
})
