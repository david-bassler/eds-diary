import type { PreparedEnvelope } from '../../security/envelopes'

export const SINGLE_WRITER_PROFILE = 'google-sheets-single-writer-v1'
export type TransportErrorCode = 'auth_required' | 'permission_denied' | 'not_found' | 'conflict_or_unexpected_remote_change' | 'temporary_failure' | 'rate_limited' | 'unknown_outcome' | 'integrity_failure' | 'provider_incompatible'
export class TransportError extends Error { constructor(readonly code: TransportErrorCode, message: string) { super(message) } }
export interface IdentityBinding { providerId: string; subject: string }
export interface RemoteCandidate { remoteId: string; locator: string }
export interface RemoteSnapshot { manifest: readonly string[]; rows: ReadonlyArray<readonly string[]> }
export interface AuthProvider { authenticate(actionId: string): Promise<IdentityBinding>; getIdentityBinding(): IdentityBinding | null; disconnect(): Promise<void> }
export interface RemoteTransport {
  readonly profileId: string
  discover(locator: string): Promise<readonly RemoteCandidate[]>
  create(locator: string, manifest: readonly string[]): Promise<void>
  read(remoteId: string): Promise<RemoteSnapshot>
  append(remoteId: string, row: readonly [string, string, string]): Promise<void>
}
export interface TransportProfileCodec {
  readonly profileId: string
  validate(snapshot: RemoteSnapshot): void
  authenticateManifest(snapshot: RemoteSnapshot): Promise<string>
  row(envelope: PreparedEnvelope): readonly [string, string, string]
}
