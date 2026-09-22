import { describe, expect, it } from 'vitest'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import {
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  importRecoveryTakeoverSigningKeyV2,
  revisionSigningBytesV2,
  signEd25519V2,
  writerGrantSigningBytesV2,
} from '../security/v2/crypto'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { envelopeRowV2, sealRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { createAnchorV2, prefixHashesV2 } from '../security/v2/prefix'
import type { RecoveryAuthorityTransitionV2, RevisionV2, WriterGrantV2 } from '../security/v2/types'
import {
  TransferableSingleWriterV2Verifier,
  type VerifiedManifestTrustRootV2,
} from '../security/v2/verifier'

const id = (fill: number, length: number) => base64Url(new Uint8Array(length).fill(fill))
const bytes = (fill: number, length: number) => new Uint8Array(length).fill(fill)
const createdAt = '2026-09-22T12:00:00.000Z'

async function trustRoot(predecessor = false) {
  const writer = await generateWriterDeviceKeyV2()
  const recovery = await generateRecoveryTakeoverKeyMaterialV2()
  const root: VerifiedManifestTrustRootV2 = {
    diary_id: id(1, 16),
    epoch_id: id(2, 16),
    manifest_fingerprint: id(3, 32),
    predecessor_epochs: predecessor ? [{ epoch_id: id(4, 16), manifest_fingerprint: id(5, 32) }] : [],
    epoch_start_authority_mode: predecessor ? 'carried_from_predecessor' : 'genesis_grant_required',
    epoch_start_writer_generation: 1,
    epoch_start_writer_grant_id: id(6, 32),
    epoch_start_writer_device_id: id(7, 16),
    epoch_start_writer_key_id: writer.writerKeyId,
    epoch_start_writer_public_key: base64Url(writer.publicKeyRaw),
    recovery_generation: 0,
    recovery_urs_commitment: id(8, 32),
    recovery_urs_id: id(9, 32),
    recovery_credential_history: [{ recovery_generation: 0, recovery_urs_id: id(9, 32), recovery_takeover_key_id: recovery.recoveryTakeoverKeyId }],
    recovery_takeover_key_id: recovery.recoveryTakeoverKeyId,
    recovery_takeover_public_key: base64Url(recovery.publicKeyRaw),
  }
  return { root, writer, recovery }
}

function grantRevision(grant: WriterGrantV2, marker: number): RevisionV2<WriterGrantV2> {
  return {
    record_type: 'writer_grant',
    record_schema: 'writer-grant-sw-v2',
    record_id: id(marker, 16),
    revision_id: id(marker + 1, 32),
    parent_revision_ids: [],
    record_status: 'control',
    record_data: grant,
    migration_origin: null,
    protocol_created_at: createdAt,
    writer_context: null,
    writer_signature: null,
  }
}

async function signedRevision<T>(
  root: VerifiedManifestTrustRootV2,
  revision: Omit<RevisionV2<T>, 'writer_signature'> & { writer_signature: string | null },
  privateKey: CryptoKey,
): Promise<RevisionV2<T>> {
  const unsigned = revision as RevisionV2<T>
  return { ...revision, writer_signature: await signEd25519V2(privateKey, revisionSigningBytesV2(root.diary_id, root.epoch_id, unsigned)) }
}

async function seal(
  root: VerifiedManifestTrustRootV2,
  rootKey: Uint8Array,
  revision: RevisionV2,
  marker: number,
) {
  const salt = await deriveEpochSaltV2(bytes(1, 16), bytes(2, 16))
  return sealRevisionEnvelopeV2(rootKey, salt, { diaryId: root.diary_id, epochId: root.epoch_id }, revision, bytes(marker, 32), bytes(marker + 80, 12))
}

describe('TransferableSingleWriterV2Verifier', () => {
  it('pins the exact H0/H1/Hn RemoteAnchorV2 prefix vectors', async () => {
    const diary = base64Url(Uint8Array.from({ length: 16 }, (_, index) => index))
    const epoch = base64Url(Uint8Array.from({ length: 16 }, (_, index) => index + 16))
    const rows = [
      [
        'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
        'QEFCQ0RFRkdISUpL',
        'TE1OT1BRUlNUVVZXWFlaWw',
      ],
      [
        'ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4CBgoM',
        'hIWGh4iJiouMjY6P',
        'kJGSk5SVlpeYmZqbnJ2enw',
      ],
    ] as const
    const hashes = await prefixHashesV2(diary, epoch, rows)
    expect(hashes.map(base64Url)).toEqual([
      'qk2_NKrOJkJImKys79h2QTg8BTVyyE-Evc4EjaYfS_M',
      'fLdh57RNuYLt1D-dAAgG4JP_1yqGekfO8LFxfcxFHMs',
      'd9eUeyNh-uWnyuPATnED4E-F_l-LUNeqxE264YJGgVY',
    ])
  })

  it('accepts the manifest genesis grant and deterministically rejects a concurrent stale g+1 claim', async () => {
    const { root, writer } = await trustRoot()
    const rootKey = bytes(10, 32)
    const genesis: WriterGrantV2 = {
      grant_id: root.epoch_start_writer_grant_id,
      writer_generation: 1,
      writer_device_id: root.epoch_start_writer_device_id,
      writer_key_id: root.epoch_start_writer_key_id,
      writer_public_key: root.epoch_start_writer_public_key,
      previous_grant_id: null,
      previous_writer_generation: 0,
      recovery_generation: 0,
      reason: 'initial',
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, []),
      authorization: { kind: 'manifest_genesis', signer_key_id: null, signature: null },
    }
    const first = await seal(root, rootKey, grantRevision(genesis, 20), 30)
    const row1 = envelopeRowV2(first)
    const decisionAnchor = await createAnchorV2(root.diary_id, root.epoch_id, [row1])

    const targetB = await generateWriterDeviceKeyV2()
    const grantB: WriterGrantV2 = {
      grant_id: id(31, 32),
      writer_generation: 2,
      writer_device_id: id(32, 16),
      writer_key_id: targetB.writerKeyId,
      writer_public_key: base64Url(targetB.publicKeyRaw),
      previous_grant_id: genesis.grant_id,
      previous_writer_generation: 1,
      recovery_generation: 0,
      reason: 'handoff',
      authority_anchor: decisionAnchor,
      authorization: { kind: 'writer_handoff', signer_key_id: writer.writerKeyId, signature: null },
    }
    grantB.authorization.signature = await signEd25519V2(writer.privateKey, writerGrantSigningBytesV2(root.diary_id, root.epoch_id, grantB))
    const second = await seal(root, rootKey, grantRevision(grantB, 33), 40)

    const targetC = await generateWriterDeviceKeyV2()
    const grantC: WriterGrantV2 = {
      ...grantB,
      grant_id: id(41, 32),
      writer_device_id: id(42, 16),
      writer_key_id: targetC.writerKeyId,
      writer_public_key: base64Url(targetC.publicKeyRaw),
      authorization: { kind: 'writer_handoff', signer_key_id: writer.writerKeyId, signature: null },
    }
    grantC.authorization.signature = await signEd25519V2(writer.privateKey, writerGrantSigningBytesV2(root.diary_id, root.epoch_id, grantC))
    const third = await seal(root, rootKey, grantRevision(grantC, 43), 50)

    const result = await new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, rootKey, [row1, envelopeRowV2(second), envelopeRowV2(third)])
    expect(result.current_writer.writer_grant_id).toBe(grantB.grant_id)
    expect(result.current_writer.writer_key_id).toBe(targetB.writerKeyId)
    expect(result.dispositions.map(({ disposition }) => disposition)).toEqual(['accepted', 'accepted', 'stale_grant_rejected'])
    expect(result.remote_anchor.covered_row_count).toBe(3)
  })

  it('counts byte-identical retry rows physically but applies their semantics only once', async () => {
    const { root } = await trustRoot()
    const rootKey = bytes(15, 32)
    const genesis: WriterGrantV2 = {
      grant_id: root.epoch_start_writer_grant_id,
      writer_generation: 1,
      writer_device_id: root.epoch_start_writer_device_id,
      writer_key_id: root.epoch_start_writer_key_id,
      writer_public_key: root.epoch_start_writer_public_key,
      previous_grant_id: null,
      previous_writer_generation: 0,
      recovery_generation: 0,
      reason: 'initial',
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, []),
      authorization: { kind: 'manifest_genesis', signer_key_id: null, signature: null },
    }
    const row = envelopeRowV2(await seal(root, rootKey, grantRevision(genesis, 90), 91))
    const result = await new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, rootKey, [row, row])
    expect(result.dispositions.map(({ disposition }) => disposition)).toEqual(['accepted', 'duplicate_retry'])
    expect(result.remote_anchor.covered_row_count).toBe(2)
    expect(result.verified_envelope_ids.size).toBe(1)
    expect(result.accepted_envelope_ids.size).toBe(1)
  })

  it('fails closed when one IV is reused by two different envelope IDs', async () => {
    const { root } = await trustRoot()
    const rootKey = bytes(16, 32)
    const genesis: WriterGrantV2 = {
      grant_id: root.epoch_start_writer_grant_id,
      writer_generation: 1,
      writer_device_id: root.epoch_start_writer_device_id,
      writer_key_id: root.epoch_start_writer_key_id,
      writer_public_key: root.epoch_start_writer_public_key,
      previous_grant_id: null,
      previous_writer_generation: 0,
      recovery_generation: 0,
      reason: 'initial',
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, []),
      authorization: { kind: 'manifest_genesis', signer_key_id: null, signature: null },
    }
    const revision = grantRevision(genesis, 92)
    const first = await seal(root, rootKey, revision, 93)
    const salt = await deriveEpochSaltV2(bytes(1, 16), bytes(2, 16))
    const second = await sealRevisionEnvelopeV2(
      rootKey,
      salt,
      { diaryId: root.diary_id, epochId: root.epoch_id },
      revision,
      bytes(94, 32),
      fromBase64Url(first.iv),
    )
    await expect(new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, rootKey, [envelopeRowV2(first), envelopeRowV2(second)]))
      .rejects.toMatchObject({ code: 'iv_reuse_across_envelope_ids' })
  })

  it('enforces the pending-rekey fence but still allows a recovery-authorized forced takeover', async () => {
    const { root, writer } = await trustRoot()
    const rootKey = bytes(11, 32)
    const genesis: WriterGrantV2 = {
      grant_id: root.epoch_start_writer_grant_id,
      writer_generation: 1,
      writer_device_id: root.epoch_start_writer_device_id,
      writer_key_id: root.epoch_start_writer_key_id,
      writer_public_key: root.epoch_start_writer_public_key,
      previous_grant_id: null,
      previous_writer_generation: 0,
      recovery_generation: 0,
      reason: 'initial',
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, []),
      authorization: { kind: 'manifest_genesis', signer_key_id: null, signature: null },
    }
    const row1 = envelopeRowV2(await seal(root, rootKey, grantRevision(genesis, 60), 61))
    const newRecovery = await generateRecoveryTakeoverKeyMaterialV2()
    const transition: RecoveryAuthorityTransitionV2 = {
      transition_id: id(62, 32),
      transition_kind: 'recovery_rekey',
      from_recovery_generation: 0,
      from_recovery_urs_id: root.recovery_urs_id,
      from_recovery_takeover_key_id: root.recovery_takeover_key_id,
      to_recovery_generation: 1,
      to_recovery_urs_commitment: id(63, 32),
      to_recovery_urs_id: id(64, 32),
      to_recovery_takeover_key_id: newRecovery.recoveryTakeoverKeyId,
      to_recovery_takeover_public_key: base64Url(newRecovery.publicKeyRaw),
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, [row1]),
    }
    const transitionUnsigned: RevisionV2<RecoveryAuthorityTransitionV2> = {
      record_type: 'recovery_authority_transition',
      record_schema: 'recovery-authority-transition-sw-v2',
      record_id: id(65, 16),
      revision_id: id(66, 32),
      parent_revision_ids: [],
      record_status: 'control',
      record_data: transition,
      migration_origin: null,
      protocol_created_at: createdAt,
      writer_context: {
        writer_generation: 1,
        writer_grant_id: genesis.grant_id,
        writer_device_id: genesis.writer_device_id,
        writer_key_id: genesis.writer_key_id,
      },
      writer_signature: null,
    }
    const transitionRevision = await signedRevision(root, transitionUnsigned, writer.privateKey)
    const row2 = envelopeRowV2(await seal(root, rootKey, transitionRevision, 67))
    const anchor2 = await createAnchorV2(root.diary_id, root.epoch_id, [row1, row2])

    const target = await generateWriterDeviceKeyV2()
    const handoff: WriterGrantV2 = {
      grant_id: id(68, 32),
      writer_generation: 2,
      writer_device_id: id(69, 16),
      writer_key_id: target.writerKeyId,
      writer_public_key: base64Url(target.publicKeyRaw),
      previous_grant_id: genesis.grant_id,
      previous_writer_generation: 1,
      recovery_generation: 1,
      reason: 'handoff',
      authority_anchor: anchor2,
      authorization: { kind: 'writer_handoff', signer_key_id: writer.writerKeyId, signature: null },
    }
    handoff.authorization.signature = await signEd25519V2(writer.privateKey, writerGrantSigningBytesV2(root.diary_id, root.epoch_id, handoff))
    const row3 = envelopeRowV2(await seal(root, rootKey, grantRevision(handoff, 70), 71))
    const anchor3 = await createAnchorV2(root.diary_id, root.epoch_id, [row1, row2, row3])

    const forced: WriterGrantV2 = {
      ...handoff,
      grant_id: id(72, 32),
      reason: 'forced_takeover',
      authority_anchor: anchor3,
      authorization: { kind: 'recovery_takeover', signer_key_id: newRecovery.recoveryTakeoverKeyId, signature: null },
    }
    const recoveryPrivate = await importRecoveryTakeoverSigningKeyV2(newRecovery.privateKeyPkcs8)
    forced.authorization.signature = await signEd25519V2(recoveryPrivate, writerGrantSigningBytesV2(root.diary_id, root.epoch_id, forced))
    const row4 = envelopeRowV2(await seal(root, rootKey, grantRevision(forced, 73), 74))

    const result = await new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, rootKey, [row1, row2, row3, row4])
    expect(result.dispositions.map(({ disposition }) => disposition)).toEqual([
      'accepted',
      'accepted',
      'rekey_rotation_required_rejected',
      'accepted',
    ])
    expect(result.current_recovery.recovery_rekey_rotation_required).toBe(true)
    expect(result.current_recovery.recovery_rekey_transition_id).toBe(transition.transition_id)
    expect(result.current_writer.writer_grant_id).toBe(forced.grant_id)
  })

  it('rejects cross-type reuse of the manifest-reserved grant id before semantic state mutation', async () => {
    const { root, writer } = await trustRoot()
    const rootKey = bytes(12, 32)
    const genesis: WriterGrantV2 = {
      grant_id: root.epoch_start_writer_grant_id,
      writer_generation: 1,
      writer_device_id: root.epoch_start_writer_device_id,
      writer_key_id: root.epoch_start_writer_key_id,
      writer_public_key: root.epoch_start_writer_public_key,
      previous_grant_id: null,
      previous_writer_generation: 0,
      recovery_generation: 0,
      reason: 'initial',
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, []),
      authorization: { kind: 'manifest_genesis', signer_key_id: null, signature: null },
    }
    const row1 = envelopeRowV2(await seal(root, rootKey, grantRevision(genesis, 80), 81))
    const newRecovery = await generateRecoveryTakeoverKeyMaterialV2()
    const transition: RecoveryAuthorityTransitionV2 = {
      transition_id: genesis.grant_id,
      transition_kind: 'recovery_rekey',
      from_recovery_generation: 0,
      from_recovery_urs_id: root.recovery_urs_id,
      from_recovery_takeover_key_id: root.recovery_takeover_key_id,
      to_recovery_generation: 1,
      to_recovery_urs_commitment: id(82, 32),
      to_recovery_urs_id: id(83, 32),
      to_recovery_takeover_key_id: newRecovery.recoveryTakeoverKeyId,
      to_recovery_takeover_public_key: base64Url(newRecovery.publicKeyRaw),
      authority_anchor: await createAnchorV2(root.diary_id, root.epoch_id, [row1]),
    }
    const unsigned: RevisionV2<RecoveryAuthorityTransitionV2> = {
      record_type: 'recovery_authority_transition',
      record_schema: 'recovery-authority-transition-sw-v2',
      record_id: id(84, 16),
      revision_id: id(85, 32),
      parent_revision_ids: [],
      record_status: 'control',
      record_data: transition,
      migration_origin: null,
      protocol_created_at: createdAt,
      writer_context: { writer_generation: 1, writer_grant_id: genesis.grant_id, writer_device_id: genesis.writer_device_id, writer_key_id: genesis.writer_key_id },
      writer_signature: null,
    }
    const row2 = envelopeRowV2(await seal(root, rootKey, await signedRevision(root, unsigned, writer.privateKey), 86))
    await expect(new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, rootKey, [row1, row2])).rejects.toMatchObject({ code: 'protocol_id_collision' })
  })

  it('keeps rotation_resume separate from canonical_full and never upgrades a missing migration to authority', async () => {
    const { root } = await trustRoot(true)
    const rootKey = bytes(13, 32)
    const verifier = new TransferableSingleWriterV2Verifier()
    await expect(verifier.verifyCanonicalFull(root, rootKey, [])).rejects.toMatchObject({ code: 'migration_control_missing' })
    const resume = await verifier.verifyRotationResume(root, rootKey, [], {
      successor_epoch_id: root.epoch_id,
      successor_manifest_fingerprint: root.manifest_fingerprint,
      stage: 'copying',
      mac_authenticated: true,
    })
    expect(resume).toMatchObject({ kind: 'rotation_resume', status: 'staged_incomplete' })
    expect('current_writer' in resume).toBe(false)
  })

  it('fails closed on a missing manifest-genesis confirmation', async () => {
    const { root } = await trustRoot()
    await expect(new TransferableSingleWriterV2Verifier().verifyCanonicalFull(root, bytes(14, 32), [])).rejects.toMatchObject({ code: 'manifest_genesis_missing' })
  })
})
