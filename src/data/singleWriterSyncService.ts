import { IndexedDbCoordinatorStore, activeEpochSyncContext } from './localDatabase'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import type { RemoteTransport, TransportProfileCodec } from '../sync/core/contracts'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import { GoogleSheetsSingleWriterTransport, type GoogleApiClient, type GoogleTransportBinding } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { FullRemoteVerifier, type TrustedRemoteContext } from '../sync/core/remoteVerifier'

/** Product entry point for immutable-envelope synchronization.  Construction is
 * intentionally impossible until a persisted remote binding is authenticated. */
export class SingleWriterSyncService {
  private constructor(private readonly coordinator:SingleWriterCoordinator){}

  static async create(transport:RemoteTransport,codec:TransportProfileCodec,remoteId:string):Promise<SingleWriterSyncService>{
    const active=await activeEpochSyncContext()
    if(active.state.remote_binding?.remote_resource_id!==remoteId)throw new Error('Remote resource is not bound to the active authenticated epoch.')
    return new SingleWriterSyncService(new SingleWriterCoordinator(active.diaryId,active.epochId,remoteId,transport,codec,new IndexedDbCoordinatorStore(active.epochId)))
  }

  static async createGoogle(api:GoogleApiClient,binding:GoogleTransportBinding,trusted:Omit<TrustedRemoteContext,'rootKey'|'diaryId'|'epochId'|'oldAnchor'>):Promise<SingleWriterSyncService>{
    const active=await activeEpochSyncContext(),remote=active.state.remote_binding
    if(!remote||remote.provider_id!=='google-sheets-single-writer-v1'||remote.remote_resource_id===''||remote.remote_identity_binding!==binding.googleAccountBinding)throw new Error('Authenticated Google binding does not match local state.')
    const verifier=new FullRemoteVerifier({...trusted,rootKey:active.rootKey,diaryId:active.diaryId,epochId:active.epochId,oldAnchor:active.state.remote_anchor})
    return SingleWriterSyncService.create(new GoogleSheetsSingleWriterTransport(api,binding),new GoogleSheetsSingleWriterProfileCodec(verifier),remote.remote_resource_id)
  }

  async synchronize():Promise<void>{this.coordinator.connected();await this.coordinator.pullVerify();await this.coordinator.pushPending()}
}
