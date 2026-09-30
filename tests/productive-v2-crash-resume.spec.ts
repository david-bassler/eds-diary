import { expect, test } from '@playwright/test'
import { MultiDeviceHarness, type ProductiveRecoveryRekeySeed, type ProductiveV1CrashSeed, type VirtualDevice } from './support/multiDeviceHarness'
import { runPersistentCrashScenario } from './support/persistentCrashRunner'
import { runWithDurableProgress } from './support/durableProgressWatch'

async function runResumeStep<T>(point: string, step: string, work: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Ceremony resume step timed out: ceremony=recovery-rekey point=${point} stage=resume/${step}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

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
  let sourceRootKeySentinel: string | null = null
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
        sourceRootKeySentinel = await harness.activeV1RootKeySentinel(device)
      },
      crash: async (point) => {
        await expect(harness.runProductiveProfileUpgrade(device!, seed!, point)).rejects.toThrow(`persistent-crash:${point}`)
        expect(await harness.scanBrowserPersistence(device!, [sourceRootKeySentinel!])).toEqual([])
      },
      restart: async () => {
        await device!.page.reload()
        await harness.authenticate(device!, `productive_crash_restart_${String(index).padStart(8, '0')}`)
      },
      unlock: async () => harness.unlockProductiveRootThroughUi(device!, seed!.passphrase),
      resume: async () => {
        expect(await harness.runProductiveProfileUpgrade(device!, seed!)).toBe('switched')
      },
      verify: async () => {
        expect(await harness.verifyProductiveV2Remote(device!)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
        expect(await harness.scanBrowserPersistence(device!, [sourceRootKeySentinel!])).toEqual([])
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

const RECOVERY_REKEY_POINTS = [
  'after-prepared-bundle',
  'after-publish-attempt-fence',
  'after-artifact-publish',
  'after-transition-append',
  'after-transition-durable',
  'after-source-backup',
  'before-phase-b',
] as const
for (const crashPoint of RECOVERY_REKEY_POINTS) {
  test(`restarts, unlocks and resumes productive Recovery-Rekey at ${crashPoint}`, async ({ browser }) => {
  test.setTimeout(900_000)
  const harness = new MultiDeviceHarness(browser)
  let device: VirtualDevice | null = null
  let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
  let seed: ProductiveRecoveryRekeySeed | null = null
  let sourceRootKeySentinels: readonly string[] = []
  let persistedRecoveryOperationId: string | null = null
  let index = 0
  try {
    await runPersistentCrashScenario({
      points: [crashPoint] as const,
      stageTimeoutMs: { resume: 540_000 },
      prepare: async () => {
        device = await harness.device(`recovery-rekey-crash-${index}`)
        index += 1
        await device.page.goto('/')
        await harness.authenticate(device, `recovery_rekey_prepare_action_${String(index).padStart(8, '0')}`)
        lifecycle = await harness.establishProductiveV2(device)
        sourceRootKeySentinels = await harness.activeV2RootKeySentinels(device)
        expect(sourceRootKeySentinels.length).toBeGreaterThan(1)
        seed = { newRecoveryKey: Buffer.alloc(32, 40 + index).toString('base64url'), passphrase: lifecycle.passphrase }
      },
      crash: async (point) => {
        await expect(harness.runProductiveRecoveryRekey(device!, seed!, point)).rejects.toThrow(`persistent-crash:${point}`)
        const ids = await harness.productiveRecoveryRekeyOperationIds(device!)
        expect(ids).toHaveLength(1)
        persistedRecoveryOperationId = ids[0]!
        expect(await harness.scanBrowserPersistence(device!, sourceRootKeySentinels)).toEqual([])
        await expect(harness.writeProductivePain(device!, 'pending-rekey-write-must-not-persist')).rejects.toThrow(/rekey|maintenance|authority|writer/i)
        expect(await harness.readProductivePain(device!)).toBe(lifecycle!.painCount)
      },
      restart: async () => harness.reloadLockedProductiveV2(device!, `recovery_rekey_restart_action_${String(index).padStart(8, '0')}`),
      unlock: async () => harness.unlockProductiveRootThroughUi(device!, seed!.passphrase),
      resume: async () => {
        const transitionMayBeCanonical = ![
          'after-prepared-bundle', 'after-publish-attempt-fence', 'after-artifact-publish',
        ].includes(crashPoint)
        if(transitionMayBeCanonical){
          const painPrompt = device!.page.getByRole('dialog', { name: 'Sind diese Schmerzen noch aktuell?' })
          const painPromptVisible = await painPrompt.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)
          if (painPromptVisible) {
            await runResumeStep(crashPoint, 'dismiss-pain-prompt', () => painPrompt.getByRole('button', { name: 'Ja, noch aktuell' }).click({ timeout: 10_000 }))
            await expect(painPrompt).toBeHidden({ timeout: 10_000 })
          }
          await runResumeStep(crashPoint, 'open-settings', () => device!.page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Konfiguration' }).click({ timeout: 10_000 }))
          await runResumeStep(crashPoint, 'wait-v2-settings', () => expect(device!.page.getByRole('region', { name: 'Mehrgeräte-Schreibzugriff (v2)' })).toBeVisible({ timeout: 60_000 }), 75_000)
          await runResumeStep(crashPoint, 'verify-maintenance-ui', () => expect(device!.page.getByText('Recovery-Key-Wechsel ist noch nicht abgeschlossen. Normale Einträge bleiben gesperrt.')).toBeVisible({ timeout: 60_000 }), 75_000)
        }
        let stage: string
        try {
          stage = await runResumeStep(crashPoint, 'resume-phase-b', () => runWithDurableProgress(
            () => harness.runProductiveRecoveryRekey(device!, seed!),
            {
              label: `recovery-rekey point=${crashPoint} phase-b`,
              observeStages: async () => {
                const stages = await harness.productiveRotationStages(device!)
                // This fixture starts from one completed profile upgrade. A second
                // fresh native rotation during the same resume is a regression,
                // not progress that may extend the deadline.
                if (stages.length > 2) throw new Error('Recovery-Rekey generated multiple native rotation operations.')
                return stages
              },
              pollIntervalMs: 5_000,
              idleTimeoutMs: 120_000,
              totalTimeoutMs: 420_000,
            },
          ), 450_000)
        } catch (error) {
          const rotationStages = await harness.productiveRotationStages(device!)
          throw new Error(`${error instanceof Error ? error.message : String(error)} rotationStages=${rotationStages.join(',')}`, { cause: error })
        }
        expect(stage).toBe('completed')
        await runResumeStep(crashPoint, 'restore-application-runtime', () => harness.restoreProductiveRuntimeAfterCeremony(device!, seed!.passphrase))
      },
      verify: async () => {
        // A resumed ceremony must retain the exact originally prepared
        // operation and preserve all domain data until the next normal write.
        expect(await harness.productiveRecoveryRekeyOperationIds(device!)).toEqual([persistedRecoveryOperationId])
        const verified = await harness.verifyProductiveV2Remote(device!)
        expect(verified).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
        expect(await harness.readProductivePain(device!)).toBe(lifecycle!.painCount)
        expect(await harness.writeProductivePain(device!, 'post-rekey-write-is-durable'))
          .toMatchObject({ writerStatus: 'writer_active', painCount: lifecycle!.painCount + 1 })
        expect((await harness.verifyProductiveV2Remote(device!)).coveredRowCount)
          .toBeGreaterThan(verified.coveredRowCount)
        expect(await harness.scanBrowserPersistence(device!, sourceRootKeySentinels)).toEqual([])
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

const NORMAL_ROTATION_POINTS = [
  // Six rotation-specific fault boundaries.
  'after-source-freeze',
  'after-successor-plan',
  'after-source-append',
  'after-confirmation-append',
  'after-local-state-switch',
  'after-active-selection-switch',
  // Every normally reachable additional persisted operation-stage boundary.
  // Unknown-outcome and terminal-error stages require separate faulted
  // provider/canonical candidates and are not simulated by a stage label.
  'after-successor_planned',
  'after-successor_bound',
  'after-copying',
  'after-successor_verified',
  'after-announcement_prepared',
  'after-recovery_artifact_verified',
  'after-staged_backup_verified',
  'after-announcement_durable',
  'after-confirmation_durable',
  'after-activated_backup_verified',
  'after-switched',
] as const
for (const crashPoint of NORMAL_ROTATION_POINTS) {
  test(`restarts, unlocks and resumes productive normal native V2 Rotation at ${crashPoint}`, async ({ browser }) => {
    test.setTimeout(900_000)
    const harness = new MultiDeviceHarness(browser)
    const device = await harness.device(`normal-native-rotation-${crashPoint}`)
    let lifecycle: Awaited<ReturnType<MultiDeviceHarness['establishProductiveV2']>> | null = null
    let sourceRootKeySentinels: readonly string[] = []
    let persistedOperationId: string | null = null
    let successorEpochId: string | null = null
    try {
      await runPersistentCrashScenario({
        points: [crashPoint] as const,
        stageTimeoutMs: { resume: 540_000 },
        prepare: async () => {
          await device.page.goto('/')
          await harness.authenticate(device, `native_rotation_prepare_${crashPoint.replaceAll('-', '_')}_0001`)
          lifecycle = await harness.establishProductiveV2(device)
          sourceRootKeySentinels = await harness.activeV2RootKeySentinels(device)
        expect(sourceRootKeySentinels.length).toBeGreaterThan(1)
          expect(await harness.productiveNormalRotationIds(device)).toEqual([])
          expect(await harness.readProductivePain(device)).toBe(lifecycle.painCount)
        },
        crash: async (point) => {
          await expect(harness.runProductiveNormalV2Rotation(device, lifecycle!.recoveryKey, point))
            .rejects.toThrow(`persistent-crash:${point}`)
          const operations = await harness.productiveNormalRotationIds(device)
          expect(operations).toHaveLength(1)
          persistedOperationId = operations[0]!
          expect(await harness.scanBrowserPersistence(device, sourceRootKeySentinels)).toEqual([])
        },
        restart: async () => harness.reloadLockedProductiveV2(
          device, `native_rotation_restart_${crashPoint.replaceAll('-', '_')}_0001`,
        ),
        unlock: async () => harness.unlockProductiveRootThroughUi(device, lifecycle!.passphrase),
        resume: async () => {
          const result = await runWithDurableProgress(
            () => harness.runProductiveNormalV2Rotation(device, lifecycle!.recoveryKey),
            {
              label: `normal-rotation point=${crashPoint}`,
              observeStages: async () => {
                const stages = await harness.productiveRotationStages(device)
                if (stages.length > 2) throw new Error('Normal native Rotation generated duplicate persisted operations.')
                return stages
              },
              pollIntervalMs: 5_000,
              idleTimeoutMs: 120_000,
              totalTimeoutMs: 420_000,
            },
          )
          expect(result.stage).toBe('switched')
          successorEpochId = result.successorEpochId
          await harness.restoreProductiveRuntimeAfterCeremony(device, lifecycle!.passphrase)
        },
        verify: async () => {
          // The resumed ceremony must keep the exact original operation ID,
          // preserve existing encrypted domain data and select a fresh epoch.
          expect(await harness.productiveNormalRotationIds(device)).toEqual([persistedOperationId])
          const selection = await device.page.evaluate(async () =>
            (await import('/src/data/localDatabase.ts')).activeProtocolSelectionV2())
          expect(selection?.epoch_id).toBe(successorEpochId)
          expect(selection?.epoch_id).not.toBe(lifecycle!.epochId)
          expect(await harness.verifyProductiveV2Remote(device))
            .toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
          expect(await harness.readProductivePain(device)).toBe(lifecycle!.painCount)
          const before = await harness.verifyProductiveV2Remote(device)
          expect(await harness.writeProductivePain(device, 'normal-native-rotation-after-resume'))
            .toMatchObject({ writerStatus: 'writer_active', painCount: lifecycle!.painCount + 1 })
          expect((await harness.verifyProductiveV2Remote(device)).coveredRowCount)
            .toBeGreaterThan(before.coveredRowCount)
          expect(await harness.scanBrowserPersistence(device, sourceRootKeySentinels)).toEqual([])
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
      unlock: async () => harness.unlockProductiveRootThroughUi(source!, lifecycle!.passphrase),
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
      unlock: async () => harness.unlockProductiveRootThroughUi(replacement!, lifecycle!.passphrase),
      resume: async () => {
        expect(await harness.forceTakeover(replacement!, lifecycle!.recoveryKey)).toMatchObject({ stage: 'durable', writerStatus: 'writer_active' })
        await harness.restoreProductiveRuntimeAfterCeremony(replacement!, lifecycle!.passphrase)
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
      unlock: async () => harness.unlockProductiveRootWithService(joining!, joinPassphrase),
      resume: async () => {
        expect(await harness.runProductiveJoin(joining!, lifecycle!.recoveryKey)).toBe(lifecycle!.epochId)
        await harness.reloadAuthenticateUnlockAndRestoreProductiveRuntime(joining!, joinPassphrase, 'join_crash_post_resume_action_0001')
      },
      verify: async () => {
        expect(await harness.verifyProductiveV2Remote(joining!)).toMatchObject({ kind: 'canonical_full', writerStatus: 'read_only' })
        await expect(harness.writeProductivePain(joining!, 'joined-crash-device-write')).rejects.toThrow(/authority|writer|read.only/i)
      },
      finish: async () => {}, verifyFinished: async () => {},
    })
  } finally { await harness.close() }
})
