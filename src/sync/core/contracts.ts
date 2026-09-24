import type { PreparedEnvelope } from '../../security/envelopes'

export const GOOGLE_DRIVE_SHEETS_PROVIDER = 'google-drive-sheets-v1' as const
export const SINGLE_WRITER_V1_PROFILE = 'google-sheets-single-writer-v1' as const
export const SINGLE_WRITER_V2_PROFILE = 'google-sheets-transferable-single-writer-v2' as const
/** Backwards-compatible alias for existing v1 callers. New code should use SINGLE_WRITER_V1_PROFILE. */
export const SINGLE_WRITER_PROFILE = SINGLE_WRITER_V1_PROFILE
export type TransportErrorCode = 'auth_required' | 'permission_denied' | 'not_found' | 'conflict_or_unexpected_remote_change' | 'temporary_failure' | 'rate_limited' | 'unknown_outcome' | 'integrity_failure' | 'provider_incompatible'
export class TransportError extends Error { constructor(readonly code: TransportErrorCode, message: string) { super(message) } }
export interface IdentityBinding { providerId: string; subject: string }
export interface RemoteCandidate { remoteId: string; locator: string }
export interface RemoteSnapshot { manifest: readonly string[]; rows: ReadonlyArray<readonly string[]> }
/** Profile-neutral in-memory anchor shape. Persisted profiles must use an exact versioned subtype. */
export interface RemoteAnchorState { anchor_profile: string; covered_row_count: number; prefix_hash: string }
/** Branded result that can only be produced after manifest, every envelope, graph,
 * controls, binding, anchor and local reconciliation have been verified. */
export interface VerifiedRemoteState { profileId:string; profileState:unknown; snapshot: RemoteSnapshot; manifestFingerprint: string; retired: boolean; verifiedEnvelopeIds: ReadonlySet<string>; acceptedEnvelopeIds: ReadonlySet<string>; staleWriterEnvelopeIds: ReadonlySet<string> }
export interface AuthProvider { authenticate(actionId: string): Promise<IdentityBinding>; getIdentityBinding(): IdentityBinding | null; disconnect(): Promise<void> }
export interface RemoteTransport {
  readonly providerId: string
  readonly profileId: string
  discover(locator: string): Promise<readonly RemoteCandidate[]>
  create(locator: string, manifest: readonly string[]): Promise<void>
  writeManifest?(remoteId:string,manifest:readonly string[]):Promise<void>
  replaceManifest?(remoteId:string,manifest:readonly string[]):Promise<void>
  readProperties?(remoteId:string):Promise<Readonly<Record<string,string>>>
  patchProperties?(remoteId:string,properties:Readonly<Record<string,string>>):Promise<void>
  orphanCandidates?(remoteIds:readonly string[]):Promise<void>
  /** Restricted pre-binding inspection. It must not confer writer authority. */
  inspectCandidate?(remoteId:string):Promise<RemoteSnapshot>
  read(remoteId: string): Promise<RemoteSnapshot>
  append(remoteId: string, row: readonly [string, string, string]): Promise<void>
}
/** Shared coordinator verifier: this entry point is canonical-full only.
 * Profile-specific crash/resume verification that intentionally yields a
 * non-canonical staged result (for example v2 rotation_resume) must use a
 * separate profile API and must never manufacture VerifiedRemoteState. */
export interface RemoteProfileVerifier {
  readonly profileId: string
  verify(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState>
}

export type WriteAccess = 'writer' | 'read_only'
export type WritePushPhase = 'initial' | 'unknown_outcome_retry'
export type WritePushDecision = 'push' | 'quarantine_stale_writer'
export interface WriteAuthority {
  readonly profileId: string
  accessAfterPull(verified: VerifiedRemoteState): Promise<WriteAccess> | WriteAccess
  /** Used by the domain-write preparation path before a new immutable envelope
   * is persisted. v2 requires this to be based on a fresh canonical verify. */
  canPrepareDomainWrite(verified: VerifiedRemoteState): Promise<WriteAccess> | WriteAccess
  /** Re-checks the exact prepared envelope against the latest verified state.
   * Unknown-outcome retries must pass phase='unknown_outcome_retry' after a new
   * full verification; a structural read alone is never sufficient. */
  verifyBeforePush(envelope: PreparedEnvelope, verified: VerifiedRemoteState, phase: WritePushPhase): Promise<WritePushDecision> | WritePushDecision
  accessAfterReadback(verified: VerifiedRemoteState): Promise<WriteAccess> | WriteAccess
}

export interface CreationCandidateVerification {manifestFingerprint:string}
export interface TransportProfileCodec {
  readonly profileId: string
  validate(snapshot: RemoteSnapshot): void
  verifyRemote(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState>
  /** Authority-free pre-binding verification used only by persistent resource
   * creation. It may validate an immutable manifest before mandatory genesis or
   * migration rows exist, but must never return a VerifiedRemoteState. */
  verifyCreationCandidate?(snapshot:RemoteSnapshot):Promise<CreationCandidateVerification>
  row(envelope: PreparedEnvelope): readonly [string, string, string]
  createAnchor(diaryId:string,epochId:string,rows:ReadonlyArray<readonly string[]>):Promise<RemoteAnchorState>
  assertExtendsAnchor(anchor:RemoteAnchorState|null,diaryId:string,epochId:string,rows:ReadonlyArray<readonly string[]>):Promise<void>
}
