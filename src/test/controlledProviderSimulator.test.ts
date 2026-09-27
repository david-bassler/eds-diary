import { describe, expect, it } from 'vitest'
import { ControlledProviderSimulator } from '../sync/testing/ControlledProviderSimulator'

const row = (value: string) => [value, `${value}-iv`, `${value}-ciphertext`] as const

describe('controlled provider simulator', () => {
  it('isolates accounts while supporting create, discover, metadata, rows, and concurrent appends', async () => {
    const provider = new ControlledProviderSimulator()
    const alice = provider.connect('alice')
    const bob = provider.connect('bob')
    await alice.create('locator', ['manifest'])
    const [{ remoteId }] = await alice.discover('locator')
    expect(await bob.discover('locator')).toEqual([])
    await alice.patchProperties!(remoteId!, { profile: 'v2' })
    await Promise.all([alice.append(remoteId!, row('a')), alice.append(remoteId!, row('b'))])
    expect(await alice.readProperties!(remoteId!)).toEqual({ profile: 'v2' })
    expect((await alice.read(remoteId!)).rows).toEqual([row('a'), row('b')])
    await expect(bob.read(remoteId!)).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it.each(['auth_required', 'permission_denied', 'rate_limited', 'temporary_failure'] as const)(
    'injects %s without mutating remote state',
    async (code) => {
      const provider = new ControlledProviderSimulator()
      const session = provider.connect('alice')
      const remoteId = provider.create('alice', 'locator', ['manifest'])
      provider.enqueue('append', { kind: 'error', code })
      await expect(session.append(remoteId, row('rejected'))).rejects.toMatchObject({ code })
      expect(provider.snapshot(remoteId).rows).toEqual([])
    },
  )

  it('distinguishes no-commit, committed-response-lost, duplicate, intervening, and revoked outcomes', async () => {
    const provider = new ControlledProviderSimulator()
    const session = provider.connect('alice')
    const remoteId = provider.create('alice', 'locator', ['manifest'])
    provider.enqueue('append', { kind: 'request_not_received' })
    await expect(session.append(remoteId, row('absent'))).rejects.toMatchObject({ code: 'unknown_outcome' })
    provider.enqueue('append', { kind: 'commit_then_response_lost' })
    await expect(session.append(remoteId, row('committed'))).rejects.toMatchObject({ code: 'unknown_outcome' })
    provider.enqueue('append', { kind: 'duplicate_commit' })
    await session.append(remoteId, row('duplicate'))
    provider.enqueue('append', { kind: 'external_append_before', row: row('external') })
    await session.append(remoteId, row('after-external'))
    expect(provider.snapshot(remoteId).rows).toEqual([
      row('committed'), row('duplicate'), row('duplicate'), row('external'), row('after-external'),
    ])
    provider.revoke(remoteId)
    await expect(session.read(remoteId)).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('exposes hostile remote mutations without interpreting their protocol meaning', async () => {
    const provider = new ControlledProviderSimulator()
    const remoteId = provider.create('alice', 'locator', ['manifest'])
    const session = provider.connect('alice')
    await session.append(remoteId, row('one'))
    await session.append(remoteId, row('two'))
    provider.mutate(remoteId, { kind: 'duplicate', index: 0 })
    provider.mutate(remoteId, { kind: 'reorder', from: 2, to: 0 })
    provider.mutate(remoteId, { kind: 'replace', index: 1, row: row('tampered') })
    provider.mutate(remoteId, { kind: 'insert', index: 2, row: row('foreign') })
    expect((await session.read(remoteId)).rows).toEqual([row('two'), row('tampered'), row('foreign'), row('one')])
    provider.mutate(remoteId, { kind: 'delete', index: 3 })
    provider.mutate(remoteId, { kind: 'truncate', length: 1 })
    provider.mutate(remoteId, { kind: 'replace_manifest', manifest: ['hostile'] })
    expect(await session.read(remoteId)).toEqual({ manifest: ['hostile'], rows: [row('two')] })
  })
})
