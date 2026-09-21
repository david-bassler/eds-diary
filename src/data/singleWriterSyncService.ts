import { DOMAIN_SCHEMA_REGISTRY, IndexedDbCoordinatorStore, activeEpochSyncContext, activeEpochVerifierMaterial } from './localDatabase'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import type { RemoteTransport, TransportProfileCodec, WriteAuthority } from '../sync/core/contracts'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import { SingleWriterV1RemoteVerifier } from '../sync/core/remoteVerifier'
import { singleWriterV1WriteAuthority } from '../sync/core/writeAuthority'

/** Product entry point for immutable-envelope synchronization. Construction is
 * intentionally impossible until a persisted remote binding is authenticated. */
export class SingleWriterSyncService {
  private constructor(private readonly coordinator:SingleWriterCoordinator){}

  static async create(transport:RemoteTransport,codec:TransportProfileCodec,remoteId:string,writeAuthority:WriteAuthority):Promise<SingleWriterSyncService>{
    const active=await activeEpochSyncContext()
    if(active.state.remote_binding?.remote_resource_id!==remoteId)throw new Error('Remote resource is not bound to the active authenticated epoch.')
    return new SingleWriterSyncService(new SingleWriterCoordinator(active.diaryId,active.epochId,remoteId,transport,codec,new IndexedDbCoordinatorStore(active.epochId),false,writeAuthority))
  }

  static async createAuthenticated(session:SingleWriterProviderSession):Promise<SingleWriterSyncService>{
    const active=await activeEpochSyncContext(),remote=active.state.remote_binding
    if(!remote||remote.provider_id!==session.profileId||remote.remote_resource_id==='')throw new Error('Authenticated provider binding does not match local state.')
    const transport=await session.transportForEpoch(active.diaryId,active.epochId)
    if(transport.providerId!==session.providerId||transport.profileId!==session.profileId)throw new Error('Authenticated transport provider/profile identity mismatch.')
    const identityBinding=await session.remoteIdentityBinding(transport)
    if(remote.remote_identity_binding!==identityBinding)throw new Error('Authenticated provider identity does not match local state.')
    const material=await activeEpochVerifierMaterial()
    const verifier=new SingleWriterV1RemoteVerifier({rootKey:active.rootKey,diaryId:active.diaryId,epochId:active.epochId,expectedManifestFingerprint:active.state.manifest_fingerprint,expectedKeyId:active.state.key_id,expectedRecoveryGeneration:active.state.recovery_generation,expectedRecoveryCommitment:active.state.recovery_urs_commitment,expectedGoogleAccountBinding:identityBinding,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:active.state.remote_anchor,...material})
    return SingleWriterSyncService.create(transport,session.codec(verifier),remote.remote_resource_id,singleWriterV1WriteAuthority())
  }

  async synchronize():Promise<void>{this.coordinator.connected();await this.coordinator.pullVerify();await this.coordinator.pushPending()}
}
