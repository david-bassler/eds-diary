import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWithDurableProgress } from '../../tests/support/durableProgressWatch'

afterEach(() => vi.useRealTimers())

function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('durable progress watchdog', () => {
  it('accepts a long ceremony only while persisted stages advance', async () => {
    vi.useFakeTimers()
    let stage = 'not-started'
    const ceremony = pending<string>()
    const result = runWithDurableProgress(() => ceremony.promise, {
      label: 'recovery-rekey',
      observeStages: async () => [stage],
      pollIntervalMs: 10,
      idleTimeoutMs: 25,
      totalTimeoutMs: 90,
    })
    await vi.advanceTimersByTimeAsync(10)
    stage = 'recovery_artifact_verified'
    await vi.advanceTimersByTimeAsync(20)
    stage = 'staged_backup_verified'
    await vi.advanceTimersByTimeAsync(20)
    ceremony.resolve('completed')
    await expect(result).resolves.toBe('completed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a truly stuck stage rather than blindly increasing a timeout', async () => {
    vi.useFakeTimers()
    const ceremony = pending<string>()
    const result = runWithDurableProgress(() => ceremony.promise, {
      label: 'recovery-rekey',
      observeStages: async () => ['announcement_unknown'],
      pollIntervalMs: 5,
      idleTimeoutMs: 15,
      totalTimeoutMs: 100,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(25)
    const error = await result as Error
    expect(error.message).toContain('Durable progress stalled: recovery-rekey stage=announcement_unknown')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces a hard total ceiling even if new stage names keep appearing', async () => {
    vi.useFakeTimers()
    let counter = 0
    const ceremony = pending<string>()
    const result = runWithDurableProgress(() => ceremony.promise, {
      label: 'recovery-rekey',
      observeStages: async () => [`stage-${counter}`],
      pollIntervalMs: 5,
      idleTimeoutMs: 20,
      totalTimeoutMs: 45,
    }).catch((error: unknown) => error)
    for (let step = 0; step < 9; step += 1) {
      counter += 1
      await vi.advanceTimersByTimeAsync(5)
    }
    const error = await result as Error
    expect(error.message).toContain('Durable progress total deadline exceeded')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates a productive ceremony failure and clears both timers', async () => {
    vi.useFakeTimers()
    const ceremony = pending<string>()
    const result = runWithDurableProgress(() => ceremony.promise, {
      label: 'recovery-rekey',
      observeStages: async () => ['successor_planned'],
      pollIntervalMs: 5,
      idleTimeoutMs: 20,
      totalTimeoutMs: 50,
    })
    ceremony.reject(new Error('fresh canonical authority changed'))
    await expect(result).rejects.toThrow('fresh canonical authority changed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
