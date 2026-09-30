import { afterEach, describe, expect, it, vi } from 'vitest'

describe('background sync lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('publishes a timer-triggered rejection as error state without an unhandled promise', async () => {
    vi.useFakeTimers()
    const manager = await import('../data/syncManager')
    manager.installSecureSynchronizer(async () => { throw new Error('synthetic sync rejection') })
    manager.markDirty('security-state')

    await vi.advanceTimersByTimeAsync(1400)

    expect(manager.getSyncSnapshot()).toMatchObject({
      state: 'error',
      connected: true,
      error: expect.objectContaining({ message: 'synthetic sync rejection' }),
    })
  })

  it('preserves dirty work after disconnect during an in-flight successful pass', async () => {
    const manager = await import('../data/syncManager')
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    const first = vi.fn(() => pending)
    manager.installSecureSynchronizer(first)
    manager.markDirty('replacement-session')
    const running = manager.syncPending()
    expect(first).toHaveBeenCalledTimes(1)
    manager.clearSecureSynchronizer()
    complete()
    await running
    expect(manager.getSyncSnapshot()).toMatchObject({ state: 'pending', connected: false })
    const fresh = vi.fn(async () => undefined)
    manager.installSecureSynchronizer(fresh)
    await manager.syncPending()
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(manager.getSyncSnapshot()).toMatchObject({ state: 'synced', connected: true })
    manager.clearSecureSynchronizer()
  })

  it('ignores obsolete success and rejection when a replacement starts mid-pass', async () => {
    for(const rejects of [false,true]){
      vi.resetModules()
      const manager = await import('../data/syncManager')
      let complete!: () => void
      let fail!: (reason: Error) => void
      const pending = new Promise<void>((resolve,reject) => { complete=resolve;fail=reject })
      const old = vi.fn(() => pending)
      const fresh = vi.fn(async () => undefined)
      manager.installSecureSynchronizer(old)
      manager.markDirty('handoff')
      const running = manager.syncPending()
      expect(old).toHaveBeenCalledTimes(1)
      manager.clearSecureSynchronizer()
      manager.installSecureSynchronizer(fresh)
      if(rejects)fail(new Error('obsolete session failed after replacement'))
      else complete()
      await expect(running).resolves.toBeUndefined()
      expect(fresh).toHaveBeenCalledTimes(1)
      expect(manager.getSyncSnapshot()).toMatchObject({ state: 'synced', connected: true, error: null })
      manager.clearSecureSynchronizer()
    }
  })

  it('cancels a queued background pass when the authenticated session is cleared', async () => {
    vi.useFakeTimers()
    const manager = await import('../data/syncManager')
    const synchronize = vi.fn(async () => undefined)
    manager.installSecureSynchronizer(synchronize)
    manager.markDirty('security-state')
    manager.clearSecureSynchronizer()

    await vi.advanceTimersByTimeAsync(1400)

    expect(synchronize).not.toHaveBeenCalled()
    expect(manager.getSyncSnapshot()).toMatchObject({ state: 'pending', connected: false })
  })
})
