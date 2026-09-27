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
