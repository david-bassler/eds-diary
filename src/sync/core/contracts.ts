import type { PreparedEnvelope } from '../../security/envelopes'

export const SINGLE_WRITER_PROFILE = 'google-sheets-single-writer-v1'
export type TransportErrorCode = 'auth_required' | 'permission_denied' | 'not_found' | 'conflict_or_unexpected_remote_change' | 'temporary_failure' | 'rate_limited' | 'unknown_outcome' | 'integrity_failure' | 'provider_incompatible'
export class TransportError extends Error { constructor(readonly code: TransportErrorCode, message: string) { super(message) } }
export interface IdentityBinding { providerId: string; subject: string }
export interface RemoteCandidate { remoteId: string; locator: string }
export interface RemoteSnapshot { manifest: readonly string[]; rows: ReadonlyArray<readonly string[]> }
/** Branded result that can only be produced after manifest, every envelope, graph,
 * controls, binding, anchor and local reconciliation have been verified. */
export interface VerifiedRemoteState { snapshot: RemoteSnapshot; manifestFingerprint: string; retired: boolean; verifiedEnvelopeIds: ReadonlySet<string> }
export interface AuthProvider { authenticate(actionId: string): Promise<IdentityBinding>; getIdentityBinding(): IdentityBinding | null; disconnect(): Promise<void> }
export interface RemoteTransport {
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
/** Nominal base for transports whose discovery/read path owns the provider
 * identity boundary. The runtime brand prevents structurally forged loaders. */
export abstract class ProviderBoundRemoteTransport implements RemoteTransport {
  abstract readonly profileId:string
  abstract discover(locator:string):Promise<readonly RemoteCandidate[]>
  abstract create(locator:string,manifest:readonly string[]):Promise<void>
  abstract read(remoteId:string):Promise<RemoteSnapshot>
  abstract append(remoteId:string,row:readonly [string,string,string]):Promise<void>
}
export interface TransportProfileCodec {
  readonly profileId: string
  validate(snapshot: RemoteSnapshot): void
  verifyRemote(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState>
  row(envelope: PreparedEnvelope): readonly [string, string, string]
}
