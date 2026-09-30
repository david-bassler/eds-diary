import type { RemoteProfileVerifier, RemoteTransport, TransportProfileCodec } from './contracts'
import type { IndependentBootstrapAuthority } from './remoteVerifier'
import type { RecoveryArtifact } from '../../security/recovery'
import type { FreshCanonicalV2Source } from '../../security/v2/domainWrite'

/** Provider-neutral authenticated session used by sync, rotation, backup and recovery.
 * Provider implementations own credentials and concrete wire adapters; callers only
 * receive the protocol capabilities required by the single-writer product path. */
export interface SingleWriterProviderSession {
  readonly providerId: string
  readonly profileId: string
  transportForEpoch(diaryId:string,epochId:string):Promise<RemoteTransport>
  remoteIdentityBinding(transport:RemoteTransport):Promise<string>
  codec(verifier:RemoteProfileVerifier):TransportProfileCodec
  creationProperties(diaryId:string,epochId:string):Promise<Readonly<Record<string,string>>>
  recoveryLocator(diaryId:string,epochId:string):Promise<string>
  recoveryAuthority(transport:RemoteTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>
  prepareRecoveryArtifactSlot(secret:Uint8Array,artifact:RecoveryArtifact):Promise<void>
  publishRecoveryArtifact(secret:Uint8Array,artifact:RecoveryArtifact):Promise<void>
  findRecoveryArtifact(secret:Uint8Array):Promise<RecoveryArtifact|null>
  loadRecoveryArtifact(secret:Uint8Array):Promise<RecoveryArtifact>
  disconnect():Promise<void>
}

export interface SingleWriterProvider {
  readonly providerId: string
  authenticate(actionId:string):Promise<SingleWriterProviderSession>
}

/** Provider-neutral capability subset used by the normal transferable-writer v2 app runtime.
 * Creation, recovery-resource discovery and ceremony-specific capabilities deliberately stay
 * outside this interface. */
export interface TransferableWriterV2RuntimeSession {
  readonly providerId:string
  readonly profileId:string
  transportForEpoch(diaryId:string,epochId:string):Promise<RemoteTransport>
  remoteIdentityBinding(transport:RemoteTransport):Promise<string>
  codecForEpoch(diaryId:string,epochId:string,rootKey:Uint8Array,transport:RemoteTransport):Promise<TransportProfileCodec>
  freshCanonicalSource(diaryId:string,epochId:string,rootKey:Uint8Array,remoteId:string):FreshCanonicalV2Source
  disconnect():Promise<void>
}
