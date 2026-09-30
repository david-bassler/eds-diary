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
    await harness.unlockProductiveRootThroughUi(device, lifecycle.passphrase)
    expect(await harness.readProductivePain(device)).toBe(expectedPainCount)
    expect(await harness.verifyProductiveV2Remote(device)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
  } finally {
    await harness.close()
  }
})

test('retries the exact persisted envelope after repeated unresolved timeout and browser reload',async({browser})=>{
  test.setTimeout(300_000)
  const harness=new MultiDeviceHarness(browser),device=await harness.device('unknown-crash-reload')
  try{
    await device.page.goto('/')
    await harness.authenticate(device,'unknown_crash_reload_initial_auth_001')
    const lifecycle=await harness.establishProductiveV2(device),before=harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    for(let attempt=0;attempt<8;attempt+=1)harness.enqueueProviderAppendFault({kind:'no_commit',note:`repeated-unresolved-${attempt}`})
    await expect(harness.writeProductivePain(device,'unknown-crash-exact-envelope')).rejects.toThrow()
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(before)
    const pending=await harness.pendingProductiveEnvelopeRow(device)
    harness.clearProviderAppendFaults()

    await harness.reloadAuthenticateUnlockAndRestoreProductiveRuntime(
      device,lifecycle.passphrase,'unknown_crash_reload_resume_auth_0001',
    )
    await harness.synchronizeProductiveV2(device)
    const after=harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    expect(after.filter(row=>JSON.stringify(row)===JSON.stringify(pending.row))).toHaveLength(1)
    expect(await harness.readProductivePain(device)).toBe(lifecycle.painCount+1)
    expect(await harness.verifyProductiveV2Remote(device)).toMatchObject({kind:'canonical_full',writerStatus:'writer_active'})
    expect(await harness.writeProductivePain(device,'unknown-after-exact-resume')).toMatchObject({writerStatus:'writer_active'})
  }finally{await harness.close()}
})


test('rejects a stale exact-envelope retry after a competing new Writer\'s valid remote write', async ({ browser }) => {
  test.setTimeout(480_000)
  const harness = new MultiDeviceHarness(browser)
  const staleWriter = await harness.device('unknown-competing-stale-writer')
  const replacement = await harness.device('unknown-competing-valid-writer')
  try {
    await Promise.all([staleWriter.page.goto('/'), replacement.page.goto('/')])
    await harness.authenticate(staleWriter, 'unknown_competing_original_auth_00001')
    const lifecycle = await harness.establishProductiveV2(staleWriter)
    await harness.authenticate(replacement, 'unknown_competing_replacement_auth_001')
    expect((await harness.joinAndUnlockProductiveV2(replacement, lifecycle)).writerStatus).toBe('read_only')

    // A's exact encrypted envelope is persisted locally, but none of the
    // initial attempts reaches the provider. The outcome remains unresolved.
    const startingRows = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      harness.enqueueProviderAppendFault({ kind: 'no_commit', note: `competing-unresolved-${attempt}` })
    }
    await expect(harness.writeProductivePain(staleWriter, 'must-not-materialize-after-takeover'))
      .rejects.toThrow()
    const unresolved = await harness.pendingProductiveEnvelopeRow(staleWriter)
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(startingRows)
    harness.clearProviderAppendFaults()

    // B takes over using productive Recovery authorization, then commits an
    // independent *valid* Writer-generation-2 domain revision. This is not a
    // duplicate of A's physical row and is a real competing semantic write.
    expect(await harness.forceTakeover(replacement, lifecycle.recoveryKey))
      .toMatchObject({ stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2 })
    const takenOver = await harness.verifyProductiveV2Remote(replacement)
    expect(takenOver).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(await harness.writeProductivePain(replacement, 'competing-valid-generation-2-write'))
      .toMatchObject({ writerStatus: 'writer_active', painCount: lifecycle.painCount + 1 })
    const competingRows = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    expect(competingRows.length).toBeGreaterThan(startingRows.length)
    expect(competingRows.filter(row => JSON.stringify(row) === JSON.stringify(unresolved.row))).toHaveLength(0)

    // Retry the original exact outbox item after the competing canonical write.
    // Failure is permitted; a stale A append or optimistic materialization is not.
    try {
      await harness.synchronizeProductiveV2(staleWriter)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(competingRows)
    expect(competingRows.filter(row => JSON.stringify(row) === JSON.stringify(unresolved.row))).toHaveLength(0)
    expect(await harness.verifyProductiveV2Remote(replacement))
      .toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(await harness.readProductivePain(replacement)).toBe(lifecycle.painCount + 1)
    await expect(harness.writeProductivePain(staleWriter, 'stale-a-after-competing-remote-write'))
      .rejects.toThrow()
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(competingRows)
  } finally {
    await harness.close()
  }
})


test('reconciles a committed-response-loss after an intervening valid Writer write', async ({ browser }) => {
  test.setTimeout(600_000)
  const harness = new MultiDeviceHarness(browser)
  const original = await harness.device('committed-race-original-writer')
  const replacement = await harness.device('committed-race-successor-writer')
  try {
    await Promise.all([original.page.goto('/'), replacement.page.goto('/')])
    await harness.authenticate(original, 'committed_race_original_auth_00000001')
    const lifecycle = await harness.establishProductiveV2(original)
    await harness.authenticate(replacement, 'committed_race_replacement_auth_000001')
    expect((await harness.joinAndUnlockProductiveV2(replacement, lifecycle)).writerStatus).toBe('read_only')

    const startingRows = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    let afterCompetitor: string[][] | null = null
    let originalCommitted: string[] | null = null
    let competitorRan = false
    harness.enqueueProviderAppendFault({
      kind: 'commit_response_lost_then_competing_write',
      note: 'original-A-committed-response-lost',
      afterCommit: async () => {
        // The shared provider already holds A's original, genuinely committed
        // envelope, but A has not received its append response.
        const afterA = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
        expect(afterA).toHaveLength(startingRows.length + 1)
        originalCommitted = [...afterA.at(-1)!]
        const takeover = await harness.forceTakeover(replacement, lifecycle.recoveryKey)
        expect(takeover).toMatchObject({
          stage: 'durable', writerStatus: 'writer_active', writerGeneration: 2,
        })
        expect(await harness.writeProductivePain(replacement, 'valid-B-write-after-A-commit'))
          .toMatchObject({ writerStatus: 'writer_active', painCount: lifecycle.painCount + 2 })
        afterCompetitor = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
        competitorRan = true
      },
    })

    // The initial A call may report an unknown outcome or recognize its
    // original committed envelope. Neither path may append it a second time
    // or silently ignore B's now-current generation-2 Writer authority.
    try {
      const attempted = await harness.writeProductivePain(original, 'A-original-committed-before-B-takeover')
      expect(attempted.writerStatus).not.toBe('writer_active')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
    expect(competitorRan).toBe(true)
    expect(originalCommitted).not.toBeNull()
    expect(afterCompetitor).not.toBeNull()
    const currentRows = harness.snapshotRemoteProtocolRows(lifecycle.remoteId)
    expect(currentRows).toEqual(afterCompetitor)
    expect(currentRows.filter(row => JSON.stringify(row) === JSON.stringify(originalCommitted))).toHaveLength(1)
    expect(await harness.verifyProductiveV2Remote(replacement))
      .toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(await harness.readProductivePain(replacement)).toBe(lifecycle.painCount + 2)
    await expect(harness.writeProductivePain(original, 'A-stale-after-B-competing-valid-write'))
      .rejects.toThrow()
    expect(harness.snapshotRemoteProtocolRows(lifecycle.remoteId)).toEqual(currentRows)
  } finally {
    await harness.close()
  }
})
