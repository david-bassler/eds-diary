import { describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { recoveryCommitment, randomBytes } from '../security/crypto/core'
import { createRecovery, recoverRootKeyCandidate } from '../security/recovery'
import { advanceRotation, maySwitchRotation, oldEpochWritable, type RotationState } from '../security/rotation'

const b = (n: number, length: number) => base64Url(new Uint8Array(length).fill(n))

describe('recovery continuity', () => {
  it('returns an untrusted candidate whose commitment still requires authenticated bootstrap verification', async () => {
    const urs = randomBytes(32)
    const root = randomBytes(32)
    const payload = {
      diary_id: b(1, 16), epoch_id: b(2, 16), key_id: b(3, 16), RK_epoch: base64Url(root),
      manifest_fingerprint: b(4, 32), remote_anchor: { anchor_profile: 'google-sheets-single-writer-v1' as const, covered_row_count: 0, prefix_hash: b(0, 32) },
      google_account_binding: b(5, 32), recovery_generation: 1, created_at: '2026-09-15T12:00:00.000Z',
    }
    const artifact = await createRecovery(payload, urs)
    const candidate = await recoverRootKeyCandidate(artifact, urs)
    expect(candidate.rootKey).toEqual(root)
    expect(candidate.recoveryCommitment).toBe(await recoveryCommitment(urs, new Uint8Array(16).fill(1), 1))
    await expect(recoverRootKeyCandidate(artifact, randomBytes(32))).rejects.toThrow()
  })
})

describe('rotation gates', () => {
  it('freezes before source snapshot and switches only after durable announcement', () => {
    let state: RotationState = { rotationId: 'r', oldEpochId: 'o', newEpochId: 'n', step: 'prepared', copiedEnvelopeIds: [] }
    for (const step of ['root_wrap_verified', 'source_frozen_verified', 'recovery_secret_verified', 'successor_planned', 'successor_bound', 'copying', 'successor_verified', 'recovery_verified', 'backup_verified', 'announcement_pending', 'announcement_durable'] as const) {
      state = advanceRotation(state, step)
      if (step === 'source_frozen_verified') expect(oldEpochWritable(state)).toBe(false)
    }
    expect(maySwitchRotation(state)).toBe(true)
    expect(oldEpochWritable(state)).toBe(false)
  })
})
