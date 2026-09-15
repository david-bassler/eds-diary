import { describe, expect, it } from 'vitest'
import { deriveEnvelopeKey, deriveEpochSalt, recoveryCommitment } from '../security/crypto/core'
import { utf8 } from '../security/crypto/bytes'
import { prepareEnvelope, openEnvelope, type PreparedEnvelope } from '../security/envelopes'

describe('crypto profile v5 golden vectors', () => {
  it('matches epoch salt and envelope key vectors', async () => {
    const root = Uint8Array.from({ length: 32 }, (_, index) => index)
    const id = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    const salt = await deriveEpochSalt(utf8('diary-vector-1'), utf8('epoch-vector-1'))
    expect(Buffer.from(salt).toString('hex')).toBe('22334ccabd7c939801f40754c98e2bb99cf77f2238c5425abb64ae873589dd9f')
    expect(Buffer.from(await deriveEnvelopeKey(root, salt, id)).toString('hex')).toBe('0c9a13c16aca881f65658657fd6f1f386b3b74518e5044db7a0ccc2a5cf23065')
  })
  it('matches the recovery commitment vector', async () => {
    const urs = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    expect(await recoveryCommitment(urs, utf8('diary-vector-1'), 7)).toBe('jRlMOAcvLQKewB-W7C1uBD0qTR3Cg6thnxa6eNfOXHU')
  })
})
describe('one-shot envelope', () => {
  it('reserves before encrypting, persists once, and decrypts', async () => {
    const calls: string[] = []; let result: PreparedEnvelope | undefined
    const journal = { reserve: async () => { calls.push('reserve') }, persist: async (value: PreparedEnvelope) => { calls.push('persist'); result = value } }
    const root = new Uint8Array(32).fill(3); const salt = new Uint8Array(32).fill(4)
    const revision = { revision_id: 'r1', record_id: 'x', record_type: 'pain', record_schema: 1, record_status: 'active' as const, parent_revision_ids: [], migration_origin: null, record_data: { value: 2 } }
    await prepareEnvelope(root, salt, { diaryId: 'd', epochId: 'e' }, revision, journal)
    expect(calls).toEqual(['reserve', 'persist']); expect(result).toBeDefined()
    expect(await openEnvelope(root, salt, { diaryId: 'd', epochId: 'e' }, result!)).toEqual(revision)
  })
})
