import { SINGLE_WRITER_PROFILE, type RemoteTransport, type TransportProfileCodec } from './contracts'
import type { FullRemoteVerifier, IndependentBootstrapAuthority } from './remoteVerifier'

/** Provider-neutral authenticated session used by sync, rotation, backup and recovery.
 * Provider implementations own credentials and concrete wire adapters; callers only
 * receive the protocol capabilities required by the single-writer product path. */
export interface SingleWriterProviderSession {
  readonly providerId: string
  readonly profileId: typeof SINGLE_WRITER_PROFILE
  transportForEpoch(diaryId:string,epochId:string):Promise<RemoteTransport>
  remoteIdentityBinding(transport:RemoteTransport):Promise<string>
  codec(verifier:FullRemoteVerifier):TransportProfileCodec
  creationProperties(diaryId:string,epochId:string):Promise<Readonly<Record<string,string>>>
  recoveryLocator(diaryId:string,epochId:string):Promise<string>
  recoveryAuthority(transport:RemoteTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>
  disconnect():Promise<void>
}

export interface SingleWriterProvider {
  readonly providerId: string
  authenticate(actionId:string):Promise<SingleWriterProviderSession>
}
