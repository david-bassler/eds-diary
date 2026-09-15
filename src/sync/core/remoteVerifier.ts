import { openEnvelope, type EnvelopeContext, type PreparedEnvelope } from '../../security/envelopes'
import { openManifest, manifestFingerprint, parseManifestCells, schemaRegistryHash, SCHEMA_ALLOWLIST, type ProtectedManifest } from '../../security/manifest'
import { validateRevisionGraph, type Revision } from '../../security/revisions'
import { deriveEpochSalt } from '../../security/crypto/core'
import { fixedBase64Url } from '../../security/crypto/bytes'
import { assertExtendsAnchor, type RemoteAnchor } from './prefix'
import type { RemoteSnapshot, VerifiedRemoteState } from './contracts'

export interface TrustedRemoteContext extends EnvelopeContext {
  rootKey: Uint8Array
  expectedManifestFingerprint: string
  expectedKeyId: string
  expectedRecoveryGeneration: number
  expectedRecoveryCommitment: string
  expectedGoogleAccountBinding: string
  schemas: Readonly<Record<string, unknown>>
  oldAnchor: RemoteAnchor | null
  localEnvelopes: readonly PreparedEnvelope[]
  localHeadRevisionIds: ReadonlySet<string>
}

const TYPE_SCHEMA = new Map([
  ['activity_entry', 'activity-entry/v1'], ['activity_type_settings', 'activity-type-settings/v1'],
  ['medication_entry', 'medication-entry/v1'], ['medication_prescription', 'medication-prescription/v1'],
  ['pain_entry', 'pain-entry/v1'], ['pain_type_settings', 'pain-type-settings/v1'],
  ['rotation_announcement', 'rotation-announcement-sw-v1'], ['epoch_migration', 'epoch-migration-sw-v1'],
])

function sameRow(left: readonly string[], right: PreparedEnvelope): boolean {
  return left.length === 3 && left[0] === right.envelopeId && left[1] === right.iv && left[2] === right.ciphertext
}

function validateControl(revision: Revision): void {
  if (revision.record_status !== 'control') return
  if (!['rotation-announcement-sw-v1', 'epoch-migration-sw-v1'].includes(revision.record_schema)) throw new Error('Unknown control schema.')
  if (!revision.record_data || typeof revision.record_data !== 'object' || Array.isArray(revision.record_data)) throw new Error('Invalid control data.')
}

function validateManifestBindings(manifest: ProtectedManifest, trusted: TrustedRemoteContext): void {
  if (manifest.key_id !== trusted.expectedKeyId || manifest.recovery_generation !== trusted.expectedRecoveryGeneration || manifest.recovery_urs_commitment !== trusted.expectedRecoveryCommitment || manifest.google_account_binding !== trusted.expectedGoogleAccountBinding) throw new Error('Protected manifest binding mismatch.')
}

/** The only production constructor of VerifiedRemoteState.  It authenticates the
 * manifest and every physical row before graph, control, anchor and local-state
 * reconciliation. */
export class FullRemoteVerifier {
  constructor(private readonly trusted: TrustedRemoteContext) {}
  async verify(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState> {
    const cells = parseManifestCells(snapshot.manifest)
    const fingerprint = await manifestFingerprint(cells)
    if (fingerprint !== this.trusted.expectedManifestFingerprint) throw new Error('Manifest fingerprint mismatch.')
    const diary = fixedBase64Url(this.trusted.diaryId, 16, 'diary_id')
    const epoch = fixedBase64Url(this.trusted.epochId, 16, 'epoch_id')
    const salt = await deriveEpochSalt(diary, epoch)
    const manifest = await openManifest(this.trusted.rootKey, salt, this.trusted, cells)
    validateManifestBindings(manifest, this.trusted)
    if (manifest.record_schema_registry_hash !== await schemaRegistryHash(this.trusted.schemas)) throw new Error('Schema registry hash mismatch.')
    await assertExtendsAnchor(this.trusted.oldAnchor, this.trusted.diaryId, this.trusted.epochId, snapshot.rows)

    const envelopes: PreparedEnvelope[] = snapshot.rows.map((row) => {
      if (row.length !== 3) throw new Error('Invalid physical row.')
      return { envelopeId: row[0], iv: row[1], ciphertext: row[2], bytesHash: '' }
    })
    const revisions: Revision[] = []
    for (const envelope of envelopes) {
      fixedBase64Url(envelope.envelopeId, 32, 'envelope_id'); fixedBase64Url(envelope.iv, 12, 'iv')
      const revision = await openEnvelope(this.trusted.rootKey, salt, this.trusted, envelope)
      if (TYPE_SCHEMA.get(revision.record_type) !== revision.record_schema || !SCHEMA_ALLOWLIST.includes(revision.record_schema as typeof SCHEMA_ALLOWLIST[number])) throw new Error('Record type/schema binding mismatch.')
      validateControl(revision); revisions.push(revision)
    }
    const graph = validateRevisionGraph(revisions)
    const announcements = revisions.filter((revision) => revision.record_schema === 'rotation-announcement-sw-v1')
    if (new Set(announcements.map((revision) => JSON.stringify(revision.record_data))).size > 1) throw new Error('Competing rotation announcements.')
    for (const local of this.trusted.localEnvelopes) {
      const sameId = snapshot.rows.filter((row) => row[0] === local.envelopeId)
      if (sameId.some((row) => !sameRow(row, local))) throw new Error('Local envelope ID has different remote bytes.')
    }
    for (const head of this.trusted.localHeadRevisionIds) if (!graph.revisions.has(head)) throw new Error('A local head disappeared from remote state.')
    return { snapshot, manifestFingerprint: fingerprint, retired: announcements.length === 1, verifiedEnvelopeIds: new Set(envelopes.map((envelope) => envelope.envelopeId)) }
  }
}
