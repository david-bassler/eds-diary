import { SINGLE_WRITER_V1_PROFILE, type RemoteProfileVerifier, type RemoteTransport, type TransportProfileCodec } from '../core/contracts'
import type { SingleWriterProvider, SingleWriterProviderSession } from '../core/provider'
import { IndependentBootstrapAuthority } from '../core/remoteVerifier'
import { GoogleAuthProvider, isAuthenticatedGoogleApiClient } from './GoogleAuthProvider'
import { GoogleSheetsSingleWriterProfileCodec } from './GoogleSheetsSingleWriterProfileCodec'
import { GoogleRecoveryArtifactStore } from './GoogleRecoveryArtifactStore'
import type { RecoveryArtifact } from '../../security/recovery'
import {
  epochLocator,
  GoogleSheetsSingleWriterTransport,
  isAuthenticatedGoogleTransport,
  type GoogleApiClient,
} from './GoogleSheetsSingleWriterTransport'

class GoogleSingleWriterProviderSession implements SingleWriterProviderSession {
  readonly providerId = SINGLE_WRITER_V1_PROFILE
  readonly profileId = SINGLE_WRITER_V1_PROFILE

  constructor(
    private readonly api:GoogleApiClient,
    private readonly closeSession:()=>Promise<void>,
  ) {
    if(!isAuthenticatedGoogleApiClient(api))throw new Error('Google provider session requires an authenticated API capability.')
  }

  transportForEpoch(diaryId:string,epochId:string):Promise<RemoteTransport>{
    return GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(this.api,diaryId,epochId)
  }

  async remoteIdentityBinding(transport:RemoteTransport):Promise<string>{
    if(!isAuthenticatedGoogleTransport(transport))throw new Error('Google identity binding requires the authenticated Google transport.')
    return transport.authenticatedAccountBinding()
  }

  codec(verifier:RemoteProfileVerifier):TransportProfileCodec{
    return new GoogleSheetsSingleWriterProfileCodec(verifier)
  }

  async creationProperties(diaryId:string,epochId:string):Promise<Readonly<Record<string,string>>>{
    return{app_format:'sync-v5',epoch_locator:await epochLocator(diaryId,epochId)}
  }

  recoveryLocator(diaryId:string,epochId:string):Promise<string>{
    return epochLocator(diaryId,epochId)
  }

  async recoveryAuthority(transport:RemoteTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>{
    if(!isAuthenticatedGoogleTransport(transport))throw new Error('Google recovery requires the authenticated Google transport.')
    return IndependentBootstrapAuthority.fromAuthenticatedRemoteDiscovery(transport,locator,remoteResourceId,await transport.authenticatedAccountBinding())
  }

  publishRecoveryArtifact(secret:Uint8Array,artifact:RecoveryArtifact):Promise<void>{return new GoogleRecoveryArtifactStore(this.api).publish(secret,artifact)}
  loadRecoveryArtifact(secret:Uint8Array):Promise<RecoveryArtifact>{return new GoogleRecoveryArtifactStore(this.api).load(secret)}

  disconnect():Promise<void>{return this.closeSession()}
}

export function googleProviderSessionFromAuthenticatedClient(
  api:GoogleApiClient,
  disconnect:()=>Promise<void>=async()=>{},
):SingleWriterProviderSession{
  return new GoogleSingleWriterProviderSession(api,disconnect)
}

export class GoogleSingleWriterProvider implements SingleWriterProvider {
  readonly providerId = SINGLE_WRITER_V1_PROFILE
  constructor(private readonly authUrl:string){}

  async authenticate(actionId:string):Promise<SingleWriterProviderSession>{
    const auth=new GoogleAuthProvider(this.authUrl)
    await auth.authenticate(actionId)
    return googleProviderSessionFromAuthenticatedClient(auth.getApiClient(),()=>auth.disconnect())
  }
}
