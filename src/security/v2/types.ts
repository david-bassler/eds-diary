import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE, type RemoteAnchorState } from '../../sync/core/contracts'
import type { MigrationOrigin, RevisionStatus } from '../revisions'

export interface RemoteAnchorV2 extends RemoteAnchorState {
  anchor_profile: typeof SINGLE_WRITER_V2_PROFILE
  covered_row_count: number
  prefix_hash: string
}

export interface WriterContextV2 {
  writer_generation: number
  writer_grant_id: string
  writer_device_id: string
  writer_key_id: string
}

export interface RevisionV2<T = unknown> {
  record_type: string
  record_schema: string
  record_id: string
  revision_id: string
  parent_revision_ids: string[]
  record_status: RevisionStatus
  record_data: T | null
  migration_origin: MigrationOrigin | null
  protocol_created_at: string
  writer_context: WriterContextV2 | null
  writer_signature: string | null
}

export interface TransferDescriptorV2 {
  format: 'eds-writer-transfer-v2'
  version: 2
  sync_profile: typeof SINGLE_WRITER_V2_PROFILE
  diary_id: string
  epoch_id: string
  writer_device_id: string
  writer_key_id: string
  writer_public_key: string
  nonce: string
  possession_signature: string
}

export interface WriterGrantAuthorizationV2 {
  kind: 'manifest_genesis' | 'writer_handoff' | 'recovery_takeover'
  signer_key_id: string | null
  signature: string | null
}

export interface WriterGrantV2 {
  grant_id: string
  writer_generation: number
  writer_device_id: string
  writer_key_id: string
  writer_public_key: string
  previous_grant_id: string | null
  previous_writer_generation: number
  recovery_generation: number
  reason: 'initial' | 'handoff' | 'forced_takeover'
  authority_anchor: RemoteAnchorV2
  authorization: WriterGrantAuthorizationV2
}

export interface RecoveryAuthorityTransitionV2 {
  transition_id: string
  transition_kind: 'recovery_rekey'
  from_recovery_generation: number
  from_recovery_urs_id: string
  from_recovery_takeover_key_id: string
  to_recovery_generation: number
  to_recovery_urs_commitment: string
  to_recovery_urs_id: string
  to_recovery_takeover_key_id: string
  to_recovery_takeover_public_key: string
  authority_anchor: RemoteAnchorV2
}

export interface RotationAnnouncementV2 {
  rotation_id: string
  from_epoch_id: string
  successor_epoch_id: string
  successor_creation_locator: string
  successor_manifest_fingerprint: string
  rotation_kind: 'normal' | 'recovery_rekey'
  source_writer_generation: number
  source_writer_grant_id: string
  successor_recovery_generation: number
  source_anchor_before_announcement: RemoteAnchorV2
  successor_staging_anchor: RemoteAnchorV2
  recovery_transition_id: string | null
}

export interface SuccessorActivationConfirmationV2 {
  confirmation_id: string
  activation_kind: 'profile_upgrade' | 'v2_rotation'
  source_profile: typeof SINGLE_WRITER_V1_PROFILE | typeof SINGLE_WRITER_V2_PROFILE
  source_epoch_id: string
  source_manifest_fingerprint: string
  source_anchor_before_announcement: RemoteAnchorState
  successor_epoch_id: string
  successor_manifest_fingerprint: string
  successor_staging_anchor: RemoteAnchorV2
  source_announcement_envelope_sha256: string
}

export interface EpochMigrationSourceV2 {
  source_epoch_id: string
  source_manifest_fingerprint: string
  source_anchor: RemoteAnchorState | null
  source_lineage_snapshot_hash: string
  source_semantic_snapshot_hash: string
}

export interface SourceWriterAuthorityV2 {
  writer_generation: number
  writer_grant_id: string
  writer_device_id: string
  writer_key_id: string
}

export interface EpochMigrationV2 {
  migration_id: string
  migration_kind: 'profile_upgrade' | 'normal' | 'recovery_rekey'
  source: EpochMigrationSourceV2
  result_semantic_snapshot_hash: string
  active_head_count: number
  tombstone_head_count: number
  source_writer_authority: SourceWriterAuthorityV2 | null
  source_recovery_transition_id: string | null
}

export const V2_RECORD_SCHEMA_BY_TYPE = {
  pain_entry: 'pain-entry/v1',
  activity_entry: 'activity-entry/v1',
  medication_entry: 'medication-entry/v1',
  medication_prescription: 'medication-prescription/v1',
  pain_type_settings: 'pain-type-settings/v1',
  activity_type_settings: 'activity-type-settings/v1',
  writer_grant: 'writer-grant-sw-v2',
  rotation_announcement: 'rotation-announcement-sw-v2',
  epoch_migration: 'epoch-migration-sw-v2',
  recovery_authority_transition: 'recovery-authority-transition-sw-v2',
  successor_activation_confirmation: 'successor-activation-confirmation-sw-v2',
} as const

export const SINGLE_WRITER_V2_SCHEMA_ALLOWLIST = Object.values(V2_RECORD_SCHEMA_BY_TYPE)

export type V2RecordType = keyof typeof V2_RECORD_SCHEMA_BY_TYPE
export type V2RecordSchema = (typeof V2_RECORD_SCHEMA_BY_TYPE)[V2RecordType]
