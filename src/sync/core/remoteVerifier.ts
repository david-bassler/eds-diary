import { openEnvelope, type EnvelopeContext, type PreparedEnvelope } from '../../security/envelopes'
import { openManifest, manifestFingerprint, parseManifestCells, schemaRegistryHash, SINGLE_WRITER_V1_SCHEMA_ALLOWLIST, type ProtectedManifestV1 } from '../../security/manifest'
import { validateRevisionGraphV1, type RevisionV1 } from '../../security/revisions'
import { deriveEpochSalt, sha256 } from '../../security/crypto/core'
import { base64Url, fixedBase64Url } from '../../security/crypto/bytes'
import { canonicalBytes } from '../../security/crypto/canonical'
import type { SyncBackupV5 } from '../../security/backup'
import { assertExtendsAnchor, type RemoteAnchor } from './prefix'
import { SINGLE_WRITER_V1_PROFILE, type RemoteProfileVerifier, type RemoteSnapshot, type RemoteTransport, type VerifiedRemoteState } from './contracts'
import { validateDomainData } from '../../security/domainSchemaValidator'
import type { RecoveredRootCandidate } from '../../security/recovery'

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

function validateControl(revision: RevisionV1, currentEpochId: string): void {
  if (revision.record_status !== 'control') return
  if (!['rotation-announcement-sw-v1', 'epoch-migration-sw-v1'].includes(revision.record_schema)) throw new Error('Unknown control schema.')
  if (!revision.record_data || typeof revision.record_data !== 'object' || Array.isArray(revision.record_data)) throw new Error('Invalid control data.')
  const data = revision.record_data as Record<string, unknown>
  const exact = (keys: readonly string[]) => {
    if (Object.keys(data).sort().join('\0') !== [...keys].sort().join('\0')) throw new Error('Control data schema mismatch.')
  }
  const id = (value: unknown, length: number, name: string) => fixedBase64Url(String(value), length, name)
  if (revision.record_schema === 'rotation-announcement-sw-v1') {
    if (revision.record_type !== 'rotation_announcement') throw new Error('Rotation control type mismatch.')
    exact(['rotation_id','from_epoch_id','successor_epoch_id','successor_creation_locator','successor_manifest_fingerprint','rotation_kind'])
    id(data.rotation_id, 32, 'rotation_id'); id(data.from_epoch_id, 16, 'from_epoch_id'); if (data.from_epoch_id !== currentEpochId) throw new Error('Rotation announcement is not for the current epoch.'); id(data.successor_epoch_id, 16, 'successor_epoch_id')
    id(data.successor_creation_locator, 16, 'successor_creation_locator'); id(data.successor_manifest_fingerprint, 32, 'successor_manifest_fingerprint')
    if (data.rotation_kind !== 'normal') throw new Error('Invalid rotation kind.')
  } else {
    if (revision.record_type !== 'epoch_migration') throw new Error('Migration control type mismatch.')
    exact(['migration_id','migration_kind','source','result_semantic_snapshot_hash','active_head_count','tombstone_head_count'])
    id(data.migration_id, 32, 'migration_id'); id(data.result_semantic_snapshot_hash, 32, 'result_semantic_snapshot_hash')
    if (!['normal','local_rotation','remote_enablement','recovery_rekey','emergency'].includes(String(data.migration_kind))) throw new Error('Invalid migration kind.')
    if (!Number.isSafeInteger(data.active_head_count) || Number(data.active_head_count) < 0 || !Number.isSafeInteger(data.tombstone_head_count) || Number(data.tombstone_head_count) < 0) throw new Error('Invalid migration counts.')
    if (!data.source || typeof data.source !== 'object' || Array.isArray(data.source)) throw new Error('Invalid migration source.')
    const source = data.source as Record<string, unknown>
    const sourceKeys=['source_epoch_id','source_manifest_fingerprint','source_anchor','source_lineage_snapshot_hash','source_semantic_snapshot_hash']
    if (Object.keys(source).sort().join('\0') !== sourceKeys.sort().join('\0')) throw new Error('Migration source schema mismatch.')
    id(source.source_epoch_id,16,'source_epoch_id'); id(source.source_manifest_fingerprint,32,'source_manifest_fingerprint'); id(source.source_lineage_snapshot_hash,32,'source_lineage_snapshot_hash'); id(source.source_semantic_snapshot_hash,32,'source_semantic_snapshot_hash')
    const localOnly = data.migration_kind === 'local_rotation' || data.migration_kind === 'remote_enablement'
    if (localOnly ? source.source_anchor !== null : source.source_anchor === null) throw new Error('Migration anchor/kind mismatch.')
    if (source.source_anchor !== null) {
      const anchor = source.source_anchor as Record<string, unknown>
      if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) || Object.keys(anchor).sort().join('\0') !== 'anchor_profile\0covered_row_count\0prefix_hash' || anchor.anchor_profile !== 'google-sheets-single-writer-v1' || !Number.isSafeInteger(anchor.covered_row_count) || Number(anchor.covered_row_count) < 0) throw new Error('Migration source anchor schema mismatch.')
      id(anchor.prefix_hash, 32, 'source_anchor.prefix_hash')
    }
    if (['normal','recovery_rekey'].includes(String(data.migration_kind)) && data.result_semantic_snapshot_hash !== source.source_semantic_snapshot_hash) throw new Error('Unchanged remote migration changed the semantic snapshot.')
  }
}

function validateDataSchema(revision: RevisionV1, schema: unknown): void {
  if (revision.record_status === 'deleted' || revision.record_status === 'control') return
  validateDomainData(schema, revision.record_data)
}

function validateManifestBindings(manifest: ProtectedManifestV1, trusted: TrustedRemoteContext): void {
  if (manifest.key_id !== trusted.expectedKeyId || manifest.recovery_generation !== trusted.expectedRecoveryGeneration || manifest.recovery_urs_commitment !== trusted.expectedRecoveryCommitment || manifest.google_account_binding !== trusted.expectedGoogleAccountBinding) throw new Error('Protected manifest binding mismatch.')
}

/** The only production constructor of VerifiedRemoteState.  It authenticates the
 * manifest and every physical row before graph, control, anchor and local-state
 * reconciliation. */
export class SingleWriterV1RemoteVerifier implements RemoteProfileVerifier {
  readonly profileId = SINGLE_WRITER_V1_PROFILE
  constructor(private readonly trusted: TrustedRemoteContext) {}
  assertRecoveryBinding(binding: {diaryId:string;epochId:string;keyId:string;manifestFingerprint:string;recoveryGeneration:number;recoveryCommitment:string;accountBinding:string;anchor:RemoteAnchor|null}): void {
    if (binding.diaryId !== this.trusted.diaryId || binding.epochId !== this.trusted.epochId || binding.keyId !== this.trusted.expectedKeyId || binding.manifestFingerprint !== this.trusted.expectedManifestFingerprint || binding.recoveryGeneration !== this.trusted.expectedRecoveryGeneration || binding.recoveryCommitment !== this.trusted.expectedRecoveryCommitment || binding.accountBinding !== this.trusted.expectedGoogleAccountBinding || JSON.stringify(binding.anchor) !== JSON.stringify(this.trusted.oldAnchor)) throw new Error('Recovery candidate does not match the authenticated verifier context.')
  }
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
    const revisions: RevisionV1[] = []
    const envelopeRows = new Map<string, string>()
    const ivOwners = new Map<string, string>()
    for (const envelope of envelopes) {
      fixedBase64Url(envelope.envelopeId, 32, 'envelope_id'); fixedBase64Url(envelope.iv, 12, 'iv')
      const rowBytes = JSON.stringify([envelope.envelopeId, envelope.iv, envelope.ciphertext])
      const existing = envelopeRows.get(envelope.envelopeId)
      if (existing !== undefined) {
        if (existing !== rowBytes) throw new Error('Duplicate envelope_id has different bytes.')
        continue // byte-identical physical retry: counted by the anchor, semantic once
      }
      envelopeRows.set(envelope.envelopeId, rowBytes)
      const ivOwner = ivOwners.get(envelope.iv)
      if (ivOwner !== undefined && ivOwner !== envelope.envelopeId) throw new Error('IV reuse across envelope IDs is a security anomaly.')
      ivOwners.set(envelope.iv, envelope.envelopeId)
      const revision = await openEnvelope(this.trusted.rootKey, salt, this.trusted, envelope)
      if (TYPE_SCHEMA.get(revision.record_type) !== revision.record_schema || !SINGLE_WRITER_V1_SCHEMA_ALLOWLIST.includes(revision.record_schema as typeof SINGLE_WRITER_V1_SCHEMA_ALLOWLIST[number])) throw new Error('Record type/schema binding mismatch.')
      validateControl(revision, this.trusted.epochId); validateDataSchema(revision,this.trusted.schemas[revision.record_schema]); revisions.push(revision)
    }
    validateRevisionGraphV1(revisions)
    const announcements = revisions.filter((revision) => revision.record_schema === 'rotation-announcement-sw-v1')
    if (new Set(announcements.map((revision) => JSON.stringify(revision.record_data))).size > 1) throw new Error('Competing rotation announcements.')
    for (const local of this.trusted.localEnvelopes) {
      const sameId = snapshot.rows.filter((row) => row[0] === local.envelopeId)
      if (sameId.some((row) => !sameRow(row, local))) throw new Error('Local envelope ID has different remote bytes.')
    }
    // A local-only head is a valid pending offline mutation.  It must not be
    // collapsed into a remote head (and it is never selected by row time).
    // Same-ID byte conflicts were rejected above; byte-identical rows are
    // represented by verifiedEnvelopeIds and can be marked remote_seen.
    return { snapshot, manifestFingerprint: fingerprint, retired: announcements.length === 1, verifiedEnvelopeIds: new Set(envelopes.map((envelope) => envelope.envelopeId)) }
  }
}

/** Trust material that is deliberately unavailable in a RecoveryArtifact.
 * Remote authority is fixed by authenticated discovery. Backup authority is
 * fixed by an independently selected backup document whose exact bytes are
 * hashed at capability creation and rechecked before candidate verification. */
export type RecoveryRemoteBinding={provider_id:typeof SINGLE_WRITER_V1_PROFILE;remote_resource_id:string;remote_identity_binding:string}
export interface VerifiedRecoveryBootstrap {source:'authenticated-remote'|'verified-backup';verified:VerifiedRemoteState;remoteBinding:RecoveryRemoteBinding|null}
const TRUSTED_AUTHORITIES=new WeakSet<IndependentBootstrapAuthority>()
export class IndependentBootstrapAuthority {
  private constructor(readonly source:'authenticated-remote'|'verified-backup',readonly remoteResourceId:string|null,readonly authenticatedAccountBinding:string|null,private readonly transport:RemoteTransport|null,private readonly backup:SyncBackupV5|null,private readonly backupDigest:string|null){TRUSTED_AUTHORITIES.add(this)}
  static async fromAuthenticatedRemoteDiscovery(transport:RemoteTransport,locator:string,remoteResourceId:string,authenticatedIdentityBinding:string):Promise<IndependentBootstrapAuthority>{if(transport.profileId!==SINGLE_WRITER_V1_PROFILE||!authenticatedIdentityBinding)throw new Error('Recovery authority requires an authenticated single-writer provider session.');const candidates=await transport.discover(locator);if(!candidates.some(candidate=>candidate.remoteId===remoteResourceId))throw new Error('Recovery resource was not established by authenticated discovery.');return new IndependentBootstrapAuthority('authenticated-remote',remoteResourceId,authenticatedIdentityBinding,transport,null,null)}
  static async fromIndependentBackup(backup:SyncBackupV5):Promise<IndependentBootstrapAuthority>{if(!backup||typeof backup!=='object'||backup.format!=='sync-backup-v5'||backup.backup_format_version!==5)throw new Error('Recovery backup authority requires a sync-backup-v5 document.');const bytes=canonicalBytes(backup as never);if(bytes.byteLength>256*1024*1024)throw new Error('Recovery backup exceeds the supported bound.');return new IndependentBootstrapAuthority('verified-backup',null,null,null,backup,base64Url(await sha256(bytes)))}
  async loadRemote():Promise<RemoteSnapshot>{if(this.source!=='authenticated-remote'||!this.transport||!this.remoteResourceId)throw new Error('Bootstrap authority is not a remote authority.');return this.transport.read(this.remoteResourceId)}
  async loadBackup():Promise<SyncBackupV5>{if(this.source!=='verified-backup'||!this.backup||!this.backupDigest)throw new Error('Bootstrap authority is not a backup authority.');const digest=base64Url(await sha256(canonicalBytes(this.backup as never)));if(digest!==this.backupDigest)throw new Error('Independently selected recovery backup changed after authority creation.');return this.backup}
}

export interface RecoveryBootstrapOptions {
  authority:IndependentBootstrapAuthority
  schemas:Readonly<Record<string,unknown>>
}

/** A recovery-specific verifier. Unlike SingleWriterV1RemoteVerifier, it has no caller
 * supplied trusted manifest fields. Candidate fields become usable only after
 * they have been checked against an independently fixed remote or backup. */
export class RecoveryBootstrapVerifier {
  constructor(private readonly options:RecoveryBootstrapOptions){if(!TRUSTED_AUTHORITIES.has(options.authority))throw new Error('Independent bootstrap authority is incomplete or forged.');if(options.authority.source==='authenticated-remote'&&(!options.authority.remoteResourceId||!options.authority.authenticatedAccountBinding))throw new Error('Independent remote authority is incomplete.')}
  async verifyCandidate(candidate:RecoveredRootCandidate):Promise<VerifiedRecoveryBootstrap>{
    const p=candidate.payload,authority=this.options.authority
    if(authority.source==='authenticated-remote'){
      if(p.google_account_binding!==authority.authenticatedAccountBinding)throw new Error('Recovery account binding was not independently authenticated.')
      if(p.remote_anchor===null)throw new Error('Remote recovery requires a non-null independently checked anchor.')
      const verifier=new SingleWriterV1RemoteVerifier({rootKey:candidate.rootKey,diaryId:p.diary_id,epochId:p.epoch_id,expectedManifestFingerprint:p.manifest_fingerprint,expectedKeyId:p.key_id,expectedRecoveryGeneration:p.recovery_generation,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:authority.authenticatedAccountBinding!,schemas:this.options.schemas,oldAnchor:p.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()}),verified=await verifier.verify(await authority.loadRemote())
      if(verified.retired)throw new Error('Authenticated recovery candidate refers to a retired epoch.')
      return{source:'authenticated-remote',verified,remoteBinding:{provider_id:SINGLE_WRITER_V1_PROFILE,remote_resource_id:authority.remoteResourceId!,remote_identity_binding:authority.authenticatedAccountBinding!}}
    }
    const backup=await authority.loadBackup(),epochSalt=await deriveEpochSalt(fixedBase64Url(p.diary_id,16),fixedBase64Url(p.epoch_id,16)),verifier=new SingleWriterV1RemoteVerifier({rootKey:candidate.rootKey,diaryId:p.diary_id,epochId:p.epoch_id,expectedManifestFingerprint:p.manifest_fingerprint,expectedKeyId:p.key_id,expectedRecoveryGeneration:p.recovery_generation,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:p.google_account_binding,schemas:this.options.schemas,oldAnchor:p.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()}),backupModule=await import('../../security/backup'),rows=await backupModule.testRestoreBackup({rootKey:candidate.rootKey,epochSalt,diaryId:p.diary_id,epochId:p.epoch_id,keyId:p.key_id,manifestFingerprint:p.manifest_fingerprint},backup,verifier),verified=await verifier.verify({manifest:backup.epoch_manifest_public,rows})
    return{source:'verified-backup',verified,remoteBinding:null}
  }
}

/** Backwards-compatible alias for the existing v1 verifier. */
export { SingleWriterV1RemoteVerifier as FullRemoteVerifier }
