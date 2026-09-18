import { SINGLE_WRITER_PROFILE, type RemoteTransport, type TransportProfileCodec } from '../core/contracts'
import type { SingleWriterProvider, SingleWriterProviderSession } from '../core/provider'
import { IndependentBootstrapAuthority, type FullRemoteVerifier } from '../core/remoteVerifier'
import { GoogleAuthProvider, isAuthenticatedGoogleApiClient } from './GoogleAuthProvider'
import { GoogleSheetsSingleWriterProfileCodec } from './GoogleSheetsSingleWriterProfileCodec'
import {
  epochLocator,
  GoogleSheetsSingleWriterTransport,
  isAuthenticatedGoogleTransport,
  type GoogleApiClient,
} from './GoogleSheetsSingleWriterTransport'

class GoogleSingleWriterProviderSession implements SingleWriterProviderSession {
  readonly providerId = SINGLE_WRITER_PROFILE
  readonly profileId = SINGLE_WRITER_PROFILE

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

  codec(verifier:FullRemoteVerifier):TransportProfileCodec{
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
    return IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(transport,locator,remoteResourceId)
  }

  disconnect():Promise<void>{return this.closeSession()}
}

export function googleProviderSessionFromAuthenticatedClient(
  api:GoogleApiClient,
  disconnect:()=>Promise<void>=async()=>{},
):SingleWriterProviderSession{
  return new GoogleSingleWriterProviderSession(api,disconnect)
}

export class GoogleSingleWriterProvider implements SingleWriterProvider {
  readonly providerId = SINGLE_WRITER_PROFILE
  constructor(private readonly authUrl:string){}

  async authenticate(actionId:string):Promise<SingleWriterProviderSession>{
    const auth=new GoogleAuthProvider(this.authUrl)
    await auth.authenticate(actionId)
    return googleProviderSessionFromAuthenticatedClient(auth.getApiClient(),()=>auth.disconnect())
  }
}
