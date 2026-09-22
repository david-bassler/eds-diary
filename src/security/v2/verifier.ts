import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { validateDomainData } from '../domainSchemaValidator'
import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { openRevisionEnvelopeV2, V2_PADDING_BUCKETS } from './envelopes'
import {
  deriveEpochSaltV2,
  recoveryTakeoverKeyIdV2,
  revisionSigningBytesV2,
  verifyEd25519V2,
  writerGrantSigningBytesV2,
  writerKeyIdV2,
} from './crypto'
import { V2_SCHEMA_REGISTRY } from './schemaRegistry'
import { advancePrefixHashV2, initialPrefixHashV2 } from './prefix'
import type {
  EpochMigrationV2,
  RecoveryAuthorityTransitionV2,
  RemoteAnchorV2,
  RevisionV2,
  RotationAnnouncementV2,
  SuccessorActivationConfirmationV2,
  WriterGrantV2,
} from './types'
import { validateRevisionV2 } from './validators'

const MAX_SAFE = Number.MAX_SAFE_INTEGER
const MAX_PER_RECORD = 4096
const MAX_ROWS = 100_000
const MAX_CANONICAL_BYTES = 134_217_728
const MAX_ROW_BYTES = 21_936
const MAX_HISTORY = 128

export type V2NonFatalDisposition =
  | 'accepted'
  | 'duplicate_retry'
  | 'stale_writer_rejected'
  | 'stale_grant_rejected'
  | 'stale_recovery_transition_rejected'
  | 'stale_rotation_announcement_rejected'
  | 'rekey_rotation_required_rejected'
  | 'stale_after_seal_rejected'

export type V2FatalCode =
  | 'invalid_signature'
  | 'wrong_same_generation_authority'
  | 'future_generation_without_grant'
  | 'wrong_predecessor_on_candidate_current_transition'
  | 'wrong_authority_anchor'
  | 'manifest_genesis_mismatch'
  | 'manifest_genesis_missing'
  | 'migration_control_missing'
  | 'migration_snapshot_mismatch'
  | 'migration_head_count_mismatch'
  | 'activation_confirmation_mismatch'
  | 'staged_pre_migration_control_forbidden'
  | 'recovery_credential_history_mismatch'
  | 'protocol_id_collision'
  | 'recovery_credential_reuse'
  | 'recovery_generation_mismatch'
  | 'recovery_key_mismatch'
  | 'recovery_transition_state_mismatch'
  | 'duplicate_envelope_id_with_different_bytes'
  | 'iv_reuse_across_envelope_ids'
  | 'schema_or_canonicalization_failure'

export class V2VerifierError extends Error {
  constructor(readonly code: V2FatalCode, message: string = code) {
    super(message)
    this.name = 'V2VerifierError'
  }
}

export interface RecoveryCredentialHistoryEntryV2 {
  recovery_generation: number
  recovery_urs_id: string
  recovery_takeover_key_id: string
}

export interface VerifiedManifestTrustRootV2 {
  diary_id: string
  epoch_id: string
  manifest_fingerprint: string
  predecessor_epochs: readonly { epoch_id: string; manifest_fingerprint: string }[]
  epoch_start_authority_mode: 'genesis_grant_required' | 'carried_from_predecessor'
  epoch_start_writer_generation: number
  epoch_start_writer_grant_id: string
  epoch_start_writer_device_id: string
  epoch_start_writer_key_id: string
  epoch_start_writer_public_key: string
  recovery_generation: number
  recovery_urs_commitment: string
  recovery_urs_id: string
  recovery_credential_history: readonly RecoveryCredentialHistoryEntryV2[]
  recovery_takeover_key_id: string
  recovery_takeover_public_key: string
}

export interface WriterAuthoritySnapshotV2 {
  writer_generation: number
  writer_grant_id: string
  writer_device_id: string
  writer_key_id: string
  writer_public_key: string
  source_epoch_sealed: boolean
}

export interface RecoveryStateSnapshotV2 {
  recovery_generation: number
  recovery_urs_commitment: string
  recovery_urs_id: string
  recovery_takeover_key_id: string
  recovery_takeover_public_key: string
  recovery_rekey_rotation_required: boolean
  recovery_rekey_transition_id: string | null
}

export interface EnvelopeDispositionV2 {
  row_index: number
  envelope_id: string
  revision_id: string | null
  disposition: V2NonFatalDisposition
}

export interface AcceptedRevisionGraphV2 {
  revisions: ReadonlyMap<string, RevisionV2>
  heads_by_record: ReadonlyMap<string, ReadonlySet<string>>
}

export interface CanonicalFullResultV2 {
  kind: 'canonical_full'
  profile_id: typeof SINGLE_WRITER_V2_PROFILE
  diary_id: string
  epoch_id: string
  manifest_fingerprint: string
  remote_anchor: RemoteAnchorV2
  current_writer: WriterAuthoritySnapshotV2
  current_recovery: RecoveryStateSnapshotV2
  recovery_credential_history: readonly RecoveryCredentialHistoryEntryV2[]
  source_epoch_sealed: boolean
  accepted_revision_graph: AcceptedRevisionGraphV2
  accepted_epoch_migration: EpochMigrationV2 | null
  accepted_activation_confirmation: SuccessorActivationConfirmationV2 | null
  activation_state: 'native_active' | 'cross_epoch_evidence_present' | 'staged_confirmation_missing'
  dispositions: readonly EnvelopeDispositionV2[]
  verified_envelope_ids: ReadonlySet<string>
  accepted_envelope_ids: ReadonlySet<string>
  stale_writer_envelope_ids: ReadonlySet<string>
  authority_history_by_prefix: ReadonlyMap<number, WriterAuthoritySnapshotV2>
  recovery_history_by_prefix: ReadonlyMap<number, RecoveryStateSnapshotV2>
}

export interface RotationResumeContextV2 {
  successor_epoch_id: string
  successor_manifest_fingerprint: string
  stage: 'successor_bound' | 'copying'
  mac_authenticated: true
}

export type RotationResumeResultV2 =
  | {
      kind: 'rotation_resume'
      status: 'staged_incomplete'
      profile_id: typeof SINGLE_WRITER_V2_PROFILE
      diary_id: string
      epoch_id: string
      manifest_fingerprint: string
      remote_anchor: RemoteAnchorV2
      dispositions: readonly EnvelopeDispositionV2[]
    }
  | {
      kind: 'rotation_resume'
      status: 'staged_migration_present'
      profile_id: typeof SINGLE_WRITER_V2_PROFILE
      diary_id: string
      epoch_id: string
      manifest_fingerprint: string
      remote_anchor: RemoteAnchorV2
      migration: EpochMigrationV2
      dispositions: readonly EnvelopeDispositionV2[]
    }

interface MutableGraph {
  revisions: Map<string, RevisionV2>
  children: Set<string>
  counts: Map<string, number>
  depths: Map<string, number>
}

interface ReplayState {
  currentWriter: WriterAuthoritySnapshotV2
  currentRecovery: RecoveryStateSnapshotV2
  recoveryHistory: RecoveryCredentialHistoryEntryV2[]
  sealed: boolean
  genesisRequired: boolean
  genesisRealized: boolean
  migrationRequired: boolean
  acceptedMigration: EpochMigrationV2 | null
  acceptedConfirmation: SuccessorActivationConfirmationV2 | null
  graph: MutableGraph
  authorityHistory: Map<number, WriterAuthoritySnapshotV2>
  recoveryStateHistory: Map<number, RecoveryStateSnapshotV2>
  seenProtocolIds: Map<string, string>
  seenRecoveryUrsIds: Set<string>
  seenRecoveryTakeoverKeyIds: Set<string>
  seenEnvelopeRows: Map<string, string>
  seenIvOwner: Map<string, string>
  dispositions: EnvelopeDispositionV2[]
  verifiedEnvelopeIds: Set<string>
  acceptedEnvelopeIds: Set<string>
  staleWriterEnvelopeIds: Set<string>
}

function fail(code: V2FatalCode, message?: string): never {
  throw new V2VerifierError(code, message)
}

function sameAuthority(a: WriterAuthoritySnapshotV2, b: Pick<WriterAuthoritySnapshotV2, 'writer_generation' | 'writer_grant_id' | 'writer_device_id' | 'writer_key_id'>): boolean {
  return a.writer_generation === b.writer_generation
    && a.writer_grant_id === b.writer_grant_id
    && a.writer_device_id === b.writer_device_id
    && a.writer_key_id === b.writer_key_id
}

function sameRecoveryFrom(state: RecoveryStateSnapshotV2, transition: RecoveryAuthorityTransitionV2): boolean {
  return state.recovery_generation === transition.from_recovery_generation
    && state.recovery_urs_id === transition.from_recovery_urs_id
    && state.recovery_takeover_key_id === transition.from_recovery_takeover_key_id
}

function copyWriter(value: WriterAuthoritySnapshotV2): WriterAuthoritySnapshotV2 {
  return { ...value }
}

function copyRecovery(value: RecoveryStateSnapshotV2): RecoveryStateSnapshotV2 {
  return { ...value }
}

function assertSafeInteger(value: number, min: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > MAX_SAFE) fail('schema_or_canonicalization_failure', `${label} is invalid.`)
}

function anchorAt(prefixHashes: readonly Uint8Array[], count: number): RemoteAnchorV2 {
  const hash = prefixHashes[count]
  if (!hash) fail('wrong_authority_anchor')
  return { anchor_profile: SINGLE_WRITER_V2_PROFILE, covered_row_count: count, prefix_hash: base64Url(hash) }
}

function anchorEquals(left: RemoteAnchorV2, right: RemoteAnchorV2): boolean {
  return left.anchor_profile === right.anchor_profile
    && left.covered_row_count === right.covered_row_count
    && left.prefix_hash === right.prefix_hash
}

function controlId(revision: RevisionV2): { type: string; id: string } | null {
  const data = revision.record_data as Record<string, unknown> | null
  if (!data) return null
  switch (revision.record_schema) {
    case 'writer-grant-sw-v2': return { type: 'grant_id', id: String(data.grant_id) }
    case 'rotation-announcement-sw-v2': return { type: 'rotation_id', id: String(data.rotation_id) }
    case 'epoch-migration-sw-v2': return { type: 'migration_id', id: String(data.migration_id) }
    case 'recovery-authority-transition-sw-v2': return { type: 'transition_id', id: String(data.transition_id) }
    case 'successor-activation-confirmation-sw-v2': return { type: 'confirmation_id', id: String(data.confirmation_id) }
    default: return null
  }
}

async function validateTrustRoot(root: VerifiedManifestTrustRootV2): Promise<void> {
  try {
    fixedBase64Url(root.diary_id, 16, 'diary_id')
    fixedBase64Url(root.epoch_id, 16, 'epoch_id')
    fixedBase64Url(root.manifest_fingerprint, 32, 'manifest_fingerprint')
    fixedBase64Url(root.epoch_start_writer_grant_id, 32, 'epoch_start_writer_grant_id')
    fixedBase64Url(root.epoch_start_writer_device_id, 16, 'epoch_start_writer_device_id')
    const writerKeyId = fixedBase64Url(root.epoch_start_writer_key_id, 32, 'epoch_start_writer_key_id')
    const writerPublic = fixedBase64Url(root.epoch_start_writer_public_key, 32, 'epoch_start_writer_public_key')
    if (base64Url(writerKeyId) !== root.epoch_start_writer_key_id || await writerKeyIdV2(writerPublic) !== root.epoch_start_writer_key_id) fail('manifest_genesis_mismatch', 'Manifest writer key binding is invalid.')
    fixedBase64Url(root.recovery_urs_commitment, 32, 'recovery_urs_commitment')
    fixedBase64Url(root.recovery_urs_id, 32, 'recovery_urs_id')
    const takeoverPublic = fixedBase64Url(root.recovery_takeover_public_key, 32, 'recovery_takeover_public_key')
    fixedBase64Url(root.recovery_takeover_key_id, 32, 'recovery_takeover_key_id')
    if (await recoveryTakeoverKeyIdV2(takeoverPublic) !== root.recovery_takeover_key_id) fail('recovery_key_mismatch')
    assertSafeInteger(root.epoch_start_writer_generation, 1, 'epoch_start_writer_generation')
    assertSafeInteger(root.recovery_generation, 0, 'recovery_generation')
    if (root.predecessor_epochs.length > 1) fail('schema_or_canonicalization_failure')
    for (const predecessor of root.predecessor_epochs) {
      fixedBase64Url(predecessor.epoch_id, 16, 'predecessor_epoch_id')
      fixedBase64Url(predecessor.manifest_fingerprint, 32, 'predecessor_manifest_fingerprint')
    }
    if (!root.recovery_credential_history.length || root.recovery_credential_history.length > MAX_HISTORY) fail('recovery_credential_history_mismatch')
    let previousGeneration = -1
    const urs = new Set<string>()
    const takeover = new Set<string>()
    for (const entry of root.recovery_credential_history) {
      assertSafeInteger(entry.recovery_generation, 0, 'recovery_credential_history.recovery_generation')
      fixedBase64Url(entry.recovery_urs_id, 32, 'recovery_credential_history.recovery_urs_id')
      fixedBase64Url(entry.recovery_takeover_key_id, 32, 'recovery_credential_history.recovery_takeover_key_id')
      if (entry.recovery_generation <= previousGeneration || urs.has(entry.recovery_urs_id) || takeover.has(entry.recovery_takeover_key_id)) fail('recovery_credential_history_mismatch')
      previousGeneration = entry.recovery_generation
      urs.add(entry.recovery_urs_id)
      takeover.add(entry.recovery_takeover_key_id)
    }
    const last = root.recovery_credential_history[root.recovery_credential_history.length - 1]!
    if (last.recovery_generation !== root.recovery_generation || last.recovery_urs_id !== root.recovery_urs_id || last.recovery_takeover_key_id !== root.recovery_takeover_key_id) fail('recovery_credential_history_mismatch')
    if (root.epoch_start_authority_mode === 'carried_from_predecessor') {
      if (root.predecessor_epochs.length !== 1) fail('schema_or_canonicalization_failure')
    } else if (root.epoch_start_authority_mode === 'genesis_grant_required') {
      if (root.epoch_start_writer_generation !== 1) fail('manifest_genesis_mismatch')
    } else fail('schema_or_canonicalization_failure')
  } catch (error) {
    if (error instanceof V2VerifierError) throw error
    fail('schema_or_canonicalization_failure', error instanceof Error ? error.message : undefined)
  }
}

function addDisposition(state: ReplayState, rowIndex: number, envelopeId: string, revisionId: string | null, disposition: V2NonFatalDisposition): void {
  state.dispositions.push({ row_index: rowIndex, envelope_id: envelopeId, revision_id: revisionId, disposition })
  if (disposition === 'accepted') state.acceptedEnvelopeIds.add(envelopeId)
  if (disposition === 'stale_writer_rejected' || disposition === 'stale_after_seal_rejected' || disposition === 'rekey_rotation_required_rejected') state.staleWriterEnvelopeIds.add(envelopeId)
}

function reserveControlId(state: ReplayState, root: VerifiedManifestTrustRootV2, revision: RevisionV2): void {
  const claim = controlId(revision)
  if (!claim) return
  const existing = state.seenProtocolIds.get(claim.id)
  const isGenesisRealization = revision.record_schema === 'writer-grant-sw-v2'
    && claim.id === root.epoch_start_writer_grant_id
    && state.genesisRequired
    && !state.genesisRealized
  if (existing !== undefined && !isGenesisRealization) fail('protocol_id_collision')
  if (existing === undefined) state.seenProtocolIds.set(claim.id, claim.type)
}

function addDomainRevision(graph: MutableGraph, revision: RevisionV2): void {
  if (graph.revisions.has(revision.revision_id)) fail('schema_or_canonicalization_failure', 'Duplicate accepted revision_id.')
  const count = (graph.counts.get(revision.record_id) ?? 0) + 1
  if (count > MAX_PER_RECORD) fail('schema_or_canonicalization_failure', 'Revision count bound exceeded.')
  graph.counts.set(revision.record_id, count)
  for (const parentId of revision.parent_revision_ids) {
    const parent = graph.revisions.get(parentId)
    if (!parent) fail('schema_or_canonicalization_failure', 'Parent must physically precede child.')
    if (parent.record_id !== revision.record_id || parent.record_type !== revision.record_type || parent.record_schema !== revision.record_schema) fail('schema_or_canonicalization_failure', 'Cross-record parent.')
    graph.children.add(parentId)
  }
  const depth = 1 + revision.parent_revision_ids.reduce((maximum, id) => Math.max(maximum, graph.depths.get(id) ?? 0), 0)
  if (depth > MAX_PER_RECORD) fail('schema_or_canonicalization_failure', 'Revision graph depth bound exceeded.')
  graph.depths.set(revision.revision_id, depth)
  graph.revisions.set(revision.revision_id, revision)
}

function graphHeads(graph: MutableGraph): RevisionV2[] {
  return [...graph.revisions.values()].filter((revision) => !graph.children.has(revision.revision_id))
}

async function semanticSnapshot(graph: MutableGraph): Promise<{ hash: string; active: number; tombstone: number }> {
  const heads = graphHeads(graph)
  const entries = heads.map((head) => ({
    record_type: head.record_type,
    record_schema: head.record_schema,
    record_id: head.record_id,
    record_status: head.record_status,
    record_data: head.record_data,
  }))
  entries.sort((a, b) => {
    const aa = canonicalBytes(a as never)
    const bb = canonicalBytes(b as never)
    const length = Math.min(aa.length, bb.length)
    for (let i = 0; i < length; i += 1) if (aa[i] !== bb[i]) return aa[i]! - bb[i]!
    return aa.length - bb.length
  })
  return {
    hash: base64Url(await sha256(canonicalBytes(entries as never))),
    active: heads.filter((head) => head.record_status === 'active').length,
    tombstone: heads.filter((head) => head.record_status === 'deleted').length,
  }
}

function readonlyGraph(graph: MutableGraph): AcceptedRevisionGraphV2 {
  const headsByRecord = new Map<string, ReadonlySet<string>>()
  for (const head of graphHeads(graph)) {
    const existing = new Set(headsByRecord.get(head.record_id) ?? [])
    existing.add(head.revision_id)
    headsByRecord.set(head.record_id, existing)
  }
  return { revisions: new Map(graph.revisions), heads_by_record: headsByRecord }
}

function findHistoricalAuthority(state: ReplayState, context: NonNullable<RevisionV2['writer_context']>): WriterAuthoritySnapshotV2 | null {
  for (const authority of state.authorityHistory.values()) if (sameAuthority(authority, context)) return authority
  return null
}

async function verifyRevisionAuthority(state: ReplayState, root: VerifiedManifestTrustRootV2, revision: RevisionV2): Promise<'current' | 'historical'> {
  const context = revision.writer_context
  if (!context || !revision.writer_signature) fail('invalid_signature')
  let authority: WriterAuthoritySnapshotV2 | null
  let classification: 'current' | 'historical'
  if (sameAuthority(state.currentWriter, context)) {
    authority = state.currentWriter
    classification = 'current'
  } else {
    if (context.writer_generation === state.currentWriter.writer_generation) fail('wrong_same_generation_authority')
    if (context.writer_generation > state.currentWriter.writer_generation) fail('future_generation_without_grant')
    authority = findHistoricalAuthority(state, context)
    if (!authority) fail('wrong_predecessor_on_candidate_current_transition')
    classification = 'historical'
  }
  const publicKey = fixedBase64Url(authority.writer_public_key, 32, 'writer_public_key')
  if (!await verifyEd25519V2(publicKey, revision.writer_signature, revisionSigningBytesV2(root.diary_id, root.epoch_id, revision))) fail('invalid_signature')
  return classification
}

function historicalAnchorState<T>(history: ReadonlyMap<number, T>, anchor: RemoteAnchorV2, prefixHashes: readonly Uint8Array[], beforeCount: number): T {
  if (anchor.covered_row_count > beforeCount) fail('wrong_authority_anchor')
  const expected = anchorAt(prefixHashes, anchor.covered_row_count)
  if (!anchorEquals(anchor, expected)) fail('wrong_authority_anchor')
  const state = history.get(anchor.covered_row_count)
  if (!state) fail('wrong_authority_anchor')
  return state
}

async function verifyGrant(
  state: ReplayState,
  root: VerifiedManifestTrustRootV2,
  grant: WriterGrantV2,
  prefixHashes: readonly Uint8Array[],
  beforeCount: number,
): Promise<V2NonFatalDisposition> {
  const anchorAuthority = historicalAnchorState(state.authorityHistory, grant.authority_anchor, prefixHashes, beforeCount)
  const anchorRecovery = historicalAnchorState(state.recoveryStateHistory, grant.authority_anchor, prefixHashes, beforeCount)
  if (grant.reason === 'initial') {
    if (!state.genesisRequired || state.genesisRealized
      || grant.grant_id !== root.epoch_start_writer_grant_id
      || grant.writer_generation !== root.epoch_start_writer_generation
      || grant.writer_device_id !== root.epoch_start_writer_device_id
      || grant.writer_key_id !== root.epoch_start_writer_key_id
      || grant.writer_public_key !== root.epoch_start_writer_public_key
      || grant.recovery_generation !== root.recovery_generation
      || !anchorEquals(grant.authority_anchor, anchorAt(prefixHashes, 0))) fail('manifest_genesis_mismatch')
    state.genesisRealized = true
    state.genesisRequired = false
    return 'accepted'
  }

  if (grant.previous_grant_id !== anchorAuthority.writer_grant_id
    || grant.previous_writer_generation !== anchorAuthority.writer_generation
    || grant.writer_generation !== anchorAuthority.writer_generation + 1) fail('wrong_predecessor_on_candidate_current_transition')
  if (grant.recovery_generation !== anchorRecovery.recovery_generation) fail('recovery_generation_mismatch')

  const signingBytes = writerGrantSigningBytesV2(root.diary_id, root.epoch_id, grant)
  if (grant.reason === 'handoff') {
    if (grant.authorization.kind !== 'writer_handoff'
      || grant.authorization.signer_key_id !== anchorAuthority.writer_key_id
      || !grant.authorization.signature) fail('invalid_signature')
    if (!await verifyEd25519V2(fixedBase64Url(anchorAuthority.writer_public_key, 32), grant.authorization.signature, signingBytes)) fail('invalid_signature')
  } else {
    if (grant.authorization.kind !== 'recovery_takeover'
      || grant.authorization.signer_key_id !== anchorRecovery.recovery_takeover_key_id
      || !grant.authorization.signature) fail('invalid_signature')
    if (!await verifyEd25519V2(fixedBase64Url(anchorRecovery.recovery_takeover_public_key, 32), grant.authorization.signature, signingBytes)) fail('invalid_signature')
  }

  if (state.sealed) return 'stale_after_seal_rejected'

  const immediate = grant.authority_anchor.covered_row_count === beforeCount
    && sameAuthority(state.currentWriter, anchorAuthority)
    && !state.currentWriter.source_epoch_sealed
  if (!immediate) return 'stale_grant_rejected'
  if (state.currentRecovery.recovery_rekey_rotation_required && grant.reason !== 'forced_takeover') return 'rekey_rotation_required_rejected'

  state.currentWriter = {
    writer_generation: grant.writer_generation,
    writer_grant_id: grant.grant_id,
    writer_device_id: grant.writer_device_id,
    writer_key_id: grant.writer_key_id,
    writer_public_key: grant.writer_public_key,
    source_epoch_sealed: false,
  }
  return 'accepted'
}

async function handleRecoveryTransition(
  state: ReplayState,
  transition: RecoveryAuthorityTransitionV2,
  prefixHashes: readonly Uint8Array[],
  beforeCount: number,
): Promise<V2NonFatalDisposition> {
  const anchorRecovery = historicalAnchorState(state.recoveryStateHistory, transition.authority_anchor, prefixHashes, beforeCount)
  if (!sameRecoveryFrom(anchorRecovery, transition)) {
    if (transition.from_recovery_generation !== anchorRecovery.recovery_generation) fail('recovery_generation_mismatch')
    fail('recovery_transition_state_mismatch')
  }
  if (transition.to_recovery_generation !== transition.from_recovery_generation + 1) fail('recovery_generation_mismatch')
  if (state.seenRecoveryUrsIds.has(transition.to_recovery_urs_id) || state.seenRecoveryTakeoverKeyIds.has(transition.to_recovery_takeover_key_id)) fail('recovery_credential_reuse')
  if (transition.authority_anchor.covered_row_count !== beforeCount) return 'stale_recovery_transition_rejected'
  if (!sameRecoveryFrom(state.currentRecovery, transition)) return 'stale_recovery_transition_rejected'
  if (state.recoveryHistory.length >= MAX_HISTORY) fail('recovery_credential_history_mismatch')

  state.currentRecovery = {
    recovery_generation: transition.to_recovery_generation,
    recovery_urs_commitment: transition.to_recovery_urs_commitment,
    recovery_urs_id: transition.to_recovery_urs_id,
    recovery_takeover_key_id: transition.to_recovery_takeover_key_id,
    recovery_takeover_public_key: transition.to_recovery_takeover_public_key,
    recovery_rekey_rotation_required: true,
    recovery_rekey_transition_id: transition.transition_id,
  }
  state.recoveryHistory.push({
    recovery_generation: transition.to_recovery_generation,
    recovery_urs_id: transition.to_recovery_urs_id,
    recovery_takeover_key_id: transition.to_recovery_takeover_key_id,
  })
  state.seenRecoveryUrsIds.add(transition.to_recovery_urs_id)
  state.seenRecoveryTakeoverKeyIds.add(transition.to_recovery_takeover_key_id)
  return 'accepted'
}

function handleRotation(
  state: ReplayState,
  root: VerifiedManifestTrustRootV2,
  rotation: RotationAnnouncementV2,
  prefixHashes: readonly Uint8Array[],
  beforeCount: number,
): V2NonFatalDisposition {
  const anchorRecovery = historicalAnchorState(state.recoveryStateHistory, rotation.source_anchor_before_announcement, prefixHashes, beforeCount)
  if (rotation.from_epoch_id !== root.epoch_id) fail('schema_or_canonicalization_failure')
  if (rotation.successor_recovery_generation !== anchorRecovery.recovery_generation) fail('recovery_generation_mismatch')
  if (rotation.source_anchor_before_announcement.covered_row_count !== beforeCount) return 'stale_rotation_announcement_rejected'
  if (state.currentRecovery.recovery_rekey_rotation_required) {
    if (rotation.rotation_kind === 'normal') return 'rekey_rotation_required_rejected'
    if (rotation.recovery_transition_id !== state.currentRecovery.recovery_rekey_transition_id) fail('recovery_transition_state_mismatch')
  } else if (rotation.rotation_kind !== 'normal' || rotation.recovery_transition_id !== null) {
    fail('recovery_transition_state_mismatch')
  }
  state.sealed = true
  state.currentWriter = { ...state.currentWriter, source_epoch_sealed: true }
  return 'accepted'
}

async function handleMigration(state: ReplayState, migration: EpochMigrationV2): Promise<V2NonFatalDisposition> {
  if (!state.migrationRequired) fail('schema_or_canonicalization_failure', 'A native epoch must not contain EpochMigrationV2.')
  if (state.acceptedMigration) fail('schema_or_canonicalization_failure', 'A second migration control is not allowed.')
  const snapshot = await semanticSnapshot(state.graph)
  if (snapshot.hash !== migration.result_semantic_snapshot_hash) fail('migration_snapshot_mismatch')
  if (snapshot.active !== migration.active_head_count || snapshot.tombstone !== migration.tombstone_head_count) fail('migration_head_count_mismatch')
  state.acceptedMigration = migration
  return 'accepted'
}

function handleConfirmation(
  state: ReplayState,
  root: VerifiedManifestTrustRootV2,
  confirmation: SuccessorActivationConfirmationV2,
  prefixHashes: readonly Uint8Array[],
  beforeCount: number,
): V2NonFatalDisposition {
  if (state.acceptedConfirmation) fail('activation_confirmation_mismatch', 'A second activation confirmation is not allowed.')
  if (!state.acceptedMigration) fail('staged_pre_migration_control_forbidden')
  if (confirmation.successor_epoch_id !== root.epoch_id
    || confirmation.successor_manifest_fingerprint !== root.manifest_fingerprint
    || !anchorEquals(confirmation.successor_staging_anchor, anchorAt(prefixHashes, beforeCount))) fail('activation_confirmation_mismatch')
  state.acceptedConfirmation = confirmation
  return 'accepted'
}

function assertPreMigrationControlFreeze(state: ReplayState, revision: RevisionV2): void {
  if (!state.migrationRequired || state.acceptedMigration) return
  if (revision.record_schema === 'epoch-migration-sw-v2') return
  if (state.genesisRequired && revision.record_schema === 'writer-grant-sw-v2') return
  if (revision.record_status === 'control') fail('staged_pre_migration_control_forbidden')
}

function assertGenesisGate(state: ReplayState, root: VerifiedManifestTrustRootV2, revision: RevisionV2): void {
  if (!state.genesisRequired) return
  if (revision.record_schema !== 'writer-grant-sw-v2') fail('manifest_genesis_mismatch')
  const grant = revision.record_data as WriterGrantV2
  if (grant.grant_id !== root.epoch_start_writer_grant_id || grant.reason !== 'initial') fail('manifest_genesis_mismatch')
}

function validateDomainRecord(revision: RevisionV2): void {
  if (revision.record_status === 'control') return
  const schema = V2_SCHEMA_REGISTRY[revision.record_schema]
  if (!schema) fail('schema_or_canonicalization_failure', 'Unregistered v2 domain schema.')
  if (revision.record_status === 'active') {
    try { validateDomainData(schema, revision.record_data) } catch (error) {
      fail('schema_or_canonicalization_failure', error instanceof Error ? error.message : undefined)
    }
  }
}

async function replay(
  trustRoot: VerifiedManifestTrustRootV2,
  rootKey: Uint8Array,
  rows: ReadonlyArray<readonly string[]>,
): Promise<{ state: ReplayState; prefixHashes: Uint8Array[] }> {
  await validateTrustRoot(trustRoot)
  if (rootKey.byteLength !== 32) fail('schema_or_canonicalization_failure', 'RK_epoch must contain 32 bytes.')
  if (rows.length > MAX_ROWS) fail('schema_or_canonicalization_failure', 'Remote row bound exceeded.')

  const currentWriter: WriterAuthoritySnapshotV2 = {
    writer_generation: trustRoot.epoch_start_writer_generation,
    writer_grant_id: trustRoot.epoch_start_writer_grant_id,
    writer_device_id: trustRoot.epoch_start_writer_device_id,
    writer_key_id: trustRoot.epoch_start_writer_key_id,
    writer_public_key: trustRoot.epoch_start_writer_public_key,
    source_epoch_sealed: false,
  }
  const currentRecovery: RecoveryStateSnapshotV2 = {
    recovery_generation: trustRoot.recovery_generation,
    recovery_urs_commitment: trustRoot.recovery_urs_commitment,
    recovery_urs_id: trustRoot.recovery_urs_id,
    recovery_takeover_key_id: trustRoot.recovery_takeover_key_id,
    recovery_takeover_public_key: trustRoot.recovery_takeover_public_key,
    recovery_rekey_rotation_required: false,
    recovery_rekey_transition_id: null,
  }
  const state: ReplayState = {
    currentWriter,
    currentRecovery,
    recoveryHistory: trustRoot.recovery_credential_history.map((entry) => ({ ...entry })),
    sealed: false,
    genesisRequired: trustRoot.epoch_start_authority_mode === 'genesis_grant_required',
    genesisRealized: false,
    migrationRequired: trustRoot.predecessor_epochs.length === 1,
    acceptedMigration: null,
    acceptedConfirmation: null,
    graph: { revisions: new Map(), children: new Set(), counts: new Map(), depths: new Map() },
    authorityHistory: new Map([[0, copyWriter(currentWriter)]]),
    recoveryStateHistory: new Map([[0, copyRecovery(currentRecovery)]]),
    seenProtocolIds: new Map([[trustRoot.epoch_start_writer_grant_id, 'grant_id']]),
    seenRecoveryUrsIds: new Set(trustRoot.recovery_credential_history.map((entry) => entry.recovery_urs_id)),
    seenRecoveryTakeoverKeyIds: new Set(trustRoot.recovery_credential_history.map((entry) => entry.recovery_takeover_key_id)),
    seenEnvelopeRows: new Map(),
    seenIvOwner: new Map(),
    dispositions: [],
    verifiedEnvelopeIds: new Set(),
    acceptedEnvelopeIds: new Set(),
    staleWriterEnvelopeIds: new Set(),
  }

  const epochSalt = await deriveEpochSaltV2(fixedBase64Url(trustRoot.diary_id, 16), fixedBase64Url(trustRoot.epoch_id, 16))
  const prefixHashes: Uint8Array[] = [await initialPrefixHashV2(trustRoot.diary_id, trustRoot.epoch_id)]
  let physicalCanonicalBytes = 0
  let uniqueCanonicalBytes = 0

  for (let index = 0; index < rows.length; index += 1) {
    const rowIndex = index + 1
    const row = rows[index]!
    try {
      if (row.length !== 3 || row.some((cell) => typeof cell !== 'string' || cell.length === 0)) fail('schema_or_canonicalization_failure', 'Invalid _r row.')
      const envelopeId = row[0]!
      // Base64URL cells are ASCII and need no JCS escaping. The exact JCS row
      // overhead for three strings is 10 bytes, so reject oversized input
      // before Base64 decoding can allocate attacker-controlled buffers.
      if (row[0]!.length + row[1]!.length + row[2]!.length + 10 > MAX_ROW_BYTES) fail('schema_or_canonicalization_failure', 'Canonical row bound exceeded.')
      fixedBase64Url(envelopeId, 32, 'envelope_id')
      fixedBase64Url(row[1]!, 12, 'iv')
      const ciphertext = fromBase64Url(row[2]!)
      if (!V2_PADDING_BUCKETS.includes((ciphertext.byteLength - 16) as (typeof V2_PADDING_BUCKETS)[number])) fail('schema_or_canonicalization_failure', 'Invalid EnvelopeV6 ciphertext bucket.')
      const rowBytes = canonicalBytes(row as string[])
      if (rowBytes.byteLength > MAX_ROW_BYTES) fail('schema_or_canonicalization_failure', 'Canonical row bound exceeded.')
      physicalCanonicalBytes += rowBytes.byteLength
      if (physicalCanonicalBytes > MAX_CANONICAL_BYTES) fail('schema_or_canonicalization_failure', 'Physical canonical byte bound exceeded.')

      const rowIdentity = base64Url(await sha256(rowBytes))
      const previous = state.seenEnvelopeRows.get(envelopeId)
      const ivOwner = state.seenIvOwner.get(row[1]!)
      if (ivOwner && ivOwner !== envelopeId) fail('iv_reuse_across_envelope_ids')
      state.seenIvOwner.set(row[1]!, envelopeId)
      if (previous !== undefined) {
        if (previous !== rowIdentity) fail('duplicate_envelope_id_with_different_bytes')
        const nextHash = await advancePrefixHashV2(prefixHashes[index]!, rowIndex, row)
        prefixHashes.push(nextHash)
        addDisposition(state, rowIndex, envelopeId, null, 'duplicate_retry')
        state.authorityHistory.set(rowIndex, copyWriter(state.currentWriter))
        state.recoveryStateHistory.set(rowIndex, copyRecovery(state.currentRecovery))
        continue
      }
      if (state.seenEnvelopeRows.size >= MAX_ROWS) fail('schema_or_canonicalization_failure', 'Unique envelope bound exceeded.')
      state.seenEnvelopeRows.set(envelopeId, rowIdentity)
      uniqueCanonicalBytes += rowBytes.byteLength
      if (uniqueCanonicalBytes > MAX_CANONICAL_BYTES) fail('schema_or_canonicalization_failure', 'Unique canonical byte bound exceeded.')
      state.verifiedEnvelopeIds.add(envelopeId)

      const revision = await openRevisionEnvelopeV2(
        rootKey,
        epochSalt,
        { diaryId: trustRoot.diary_id, epochId: trustRoot.epoch_id },
        { envelopeId, iv: row[1]!, ciphertext: row[2]! },
      )
      await validateRevisionV2(revision)
      reserveControlId(state, trustRoot, revision)
      validateDomainRecord(revision)
      assertGenesisGate(state, trustRoot, revision)
      assertPreMigrationControlFreeze(state, revision)

      let disposition: V2NonFatalDisposition
      if (revision.record_schema === 'writer-grant-sw-v2') {
        disposition = await verifyGrant(state, trustRoot, revision.record_data as WriterGrantV2, prefixHashes, index)
      } else {
        const authorityClass = await verifyRevisionAuthority(state, trustRoot, revision)
        if (state.sealed) {
          disposition = 'stale_after_seal_rejected'
        } else if (authorityClass === 'historical') {
          disposition = 'stale_writer_rejected'
        } else if (state.currentRecovery.recovery_rekey_rotation_required
          && revision.record_schema !== 'recovery-authority-transition-sw-v2'
          && revision.record_schema !== 'rotation-announcement-sw-v2') {
          disposition = 'rekey_rotation_required_rejected'
        } else {
          switch (revision.record_schema) {
            case 'recovery-authority-transition-sw-v2':
              disposition = await handleRecoveryTransition(state, revision.record_data as RecoveryAuthorityTransitionV2, prefixHashes, index)
              break
            case 'rotation-announcement-sw-v2':
              disposition = handleRotation(state, trustRoot, revision.record_data as RotationAnnouncementV2, prefixHashes, index)
              break
            case 'epoch-migration-sw-v2':
              disposition = await handleMigration(state, revision.record_data as EpochMigrationV2)
              break
            case 'successor-activation-confirmation-sw-v2':
              disposition = handleConfirmation(state, trustRoot, revision.record_data as SuccessorActivationConfirmationV2, prefixHashes, index)
              break
            default:
              addDomainRevision(state.graph, revision)
              disposition = 'accepted'
          }
        }
      }

      addDisposition(state, rowIndex, envelopeId, revision.revision_id, disposition)
    } catch (error) {
      if (error instanceof V2VerifierError) throw error
      fail('schema_or_canonicalization_failure', error instanceof Error ? error.message : undefined)
    }

    const nextHash = await advancePrefixHashV2(prefixHashes[index]!, rowIndex, row)
    prefixHashes.push(nextHash)
    state.authorityHistory.set(rowIndex, copyWriter(state.currentWriter))
    state.recoveryStateHistory.set(rowIndex, copyRecovery(state.currentRecovery))
  }

  return { state, prefixHashes }
}

export class TransferableSingleWriterV2Verifier {
  readonly profileId = SINGLE_WRITER_V2_PROFILE

  async verifyCanonicalFull(
    trustRoot: VerifiedManifestTrustRootV2,
    rootKey: Uint8Array,
    rows: ReadonlyArray<readonly string[]>,
  ): Promise<CanonicalFullResultV2> {
    const { state, prefixHashes } = await replay(trustRoot, rootKey, rows)
    if (state.genesisRequired) fail('manifest_genesis_missing')
    if (state.migrationRequired && !state.acceptedMigration) fail('migration_control_missing')
    const activationState = !state.migrationRequired
      ? 'native_active'
      : state.acceptedConfirmation
        ? 'cross_epoch_evidence_present'
        : 'staged_confirmation_missing'

    return {
      kind: 'canonical_full',
      profile_id: SINGLE_WRITER_V2_PROFILE,
      diary_id: trustRoot.diary_id,
      epoch_id: trustRoot.epoch_id,
      manifest_fingerprint: trustRoot.manifest_fingerprint,
      remote_anchor: anchorAt(prefixHashes, rows.length),
      current_writer: copyWriter(state.currentWriter),
      current_recovery: copyRecovery(state.currentRecovery),
      recovery_credential_history: state.recoveryHistory.map((entry) => ({ ...entry })),
      source_epoch_sealed: state.sealed,
      accepted_revision_graph: readonlyGraph(state.graph),
      accepted_epoch_migration: state.acceptedMigration,
      accepted_activation_confirmation: state.acceptedConfirmation,
      activation_state: activationState,
      dispositions: [...state.dispositions],
      verified_envelope_ids: new Set(state.verifiedEnvelopeIds),
      accepted_envelope_ids: new Set(state.acceptedEnvelopeIds),
      stale_writer_envelope_ids: new Set(state.staleWriterEnvelopeIds),
      authority_history_by_prefix: new Map(state.authorityHistory),
      recovery_history_by_prefix: new Map(state.recoveryStateHistory),
    }
  }

  async verifyRotationResume(
    trustRoot: VerifiedManifestTrustRootV2,
    rootKey: Uint8Array,
    rows: ReadonlyArray<readonly string[]>,
    context: RotationResumeContextV2,
  ): Promise<RotationResumeResultV2> {
    if (context.mac_authenticated !== true
      || context.successor_epoch_id !== trustRoot.epoch_id
      || context.successor_manifest_fingerprint !== trustRoot.manifest_fingerprint
      || (context.stage !== 'successor_bound' && context.stage !== 'copying')) fail('schema_or_canonicalization_failure', 'rotation_resume context mismatch.')

    const { state, prefixHashes } = await replay(trustRoot, rootKey, rows)
    if (state.genesisRequired) fail('manifest_genesis_missing')
    if (!state.migrationRequired) fail('schema_or_canonicalization_failure', 'rotation_resume is only valid for a non-native successor.')
    const base = {
      kind: 'rotation_resume' as const,
      profile_id: SINGLE_WRITER_V2_PROFILE,
      diary_id: trustRoot.diary_id,
      epoch_id: trustRoot.epoch_id,
      manifest_fingerprint: trustRoot.manifest_fingerprint,
      remote_anchor: anchorAt(prefixHashes, rows.length),
      dispositions: [...state.dispositions],
    }
    if (!state.acceptedMigration) return { ...base, status: 'staged_incomplete' }
    return { ...base, status: 'staged_migration_present', migration: state.acceptedMigration }
  }
}
