import { describe, expect, it } from 'vitest'
import { createSingleFlight } from '../data/singleFlight'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

describe('single-flight status reads', () => {
  it('shares one concurrent read and releases it after success', async () => {
    const flight = createSingleFlight<string>()
    const first = deferred<string>()
    let calls = 0
    const left = flight.run(() => { calls += 1; return first.promise })
    const right = flight.run(() => { calls += 1; return Promise.resolve('duplicate') })
    expect(calls).toBe(1)
    expect(right).toBe(left)
    first.resolve('epoch-a')
    await expect(Promise.all([left, right])).resolves.toEqual(['epoch-a', 'epoch-a'])
    await expect(flight.run(async () => { calls += 1; return 'epoch-b' })).resolves.toBe('epoch-b')
    expect(calls).toBe(2)
  })

  it('releases a rejected read so a later retry can observe a new selection', async () => {
    const flight = createSingleFlight<string>()
    const failed = deferred<string>()
    const first = flight.run(() => failed.promise)
    failed.reject(new Error('selection changed'))
    await expect(first).rejects.toThrow('selection changed')
    await expect(flight.run(async () => 'successor-epoch')).resolves.toBe('successor-epoch')
  })
})
