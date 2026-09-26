import { fixedBase64Url } from '../security/crypto/bytes'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { V2DomainWritePreparer, type PrepareDomainRevisionV2Input, type PreparedDomainWriteV2 } from '../security/v2/domainWrite'
import { IndexedDbV2CoordinatorStore } from '../security/v2/coordinatorStore'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import { TransferableSingleWriterV2WriteAuthority } from '../security/v2/writeAuthority'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import type { TransferableWriterV2RuntimeSession } from '../sync/core/provider'
import { activeProtocolSelectionV2, openSuccessorRootWrapV6WithActiveMode } from './localDatabase'

export interface ActiveV2RuntimeContext {
  diaryId:string
  epochId:string
  manifestFingerprint:string
  rootKey:Uint8Array
  epochSalt:Uint8Array
  remoteId:string
}

export class TransferableSingleWriterV2SyncService {
  private coordinator:SingleWriterCoordinator|null=null
  private context:ActiveV2RuntimeContext|null=null
  private readonly store:IndexedDbV2LocalSecurityStore

  private constructor(
    private readonly session:TransferableWriterV2RuntimeSession,
    store?:IndexedDbV2LocalSecurityStore,
  ){
    this.store=store??new IndexedDbV2LocalSecurityStore()
  }

  static async createAuthenticated(
    session:TransferableWriterV2RuntimeSession,
    store?:IndexedDbV2LocalSecurityStore,
  ):Promise<TransferableSingleWriterV2SyncService>{
    const service=new TransferableSingleWriterV2SyncService(session,store)
    await service.rebuildCoordinator()
    return service
  }

  private async activeContext():Promise<ActiveV2RuntimeContext>{
    const selection=await activeProtocolSelectionV2()
    if(!selection)throw new Error('No active transferable-single-writer v2 selection exists.')
    const preparedWrap=await this.store.loadRootWrapV6(selection.epoch_id)
    const rootKey=await openSuccessorRootWrapV6WithActiveMode(preparedWrap)
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
    const state=await this.store.loadState(rootKey,epochSalt,selection.epoch_id)
    if(state.diary_id!==selection.diary_id
      ||state.epoch_id!==selection.epoch_id
      ||state.manifest_fingerprint!==selection.manifest_fingerprint
      ||state.epoch_status!=='active'
      ||state.remote_binding===null)throw new Error('Active v2 selection does not match authenticated active StateV6.')
    const transport=await this.session.transportForEpoch(state.diary_id,state.epoch_id)
    const account=await this.session.remoteIdentityBinding(transport)
    if(account!==state.remote_binding.remote_identity_binding)throw new Error('Authenticated Google account does not match active v2 StateV6.')
    return{
      diaryId:state.diary_id,
      epochId:state.epoch_id,
      manifestFingerprint:state.manifest_fingerprint,
      rootKey,
      epochSalt,
      remoteId:state.remote_binding.remote_resource_id,
    }
  }

  private async rebuildCoordinator():Promise<void>{
    const context=await this.activeContext()
    const transport=await this.session.transportForEpoch(context.diaryId,context.epochId)
    const codec=await this.session.codecForEpoch(context.diaryId,context.epochId,context.rootKey,transport)
    const authority=new TransferableSingleWriterV2WriteAuthority(
      ()=>this.store.loadState(context.rootKey,context.epochSalt,context.epochId),
      envelope=>this.store.envelopeAuthority(context.rootKey,context.epochSalt,context.epochId,envelope),
    )
    const coordinator=new SingleWriterCoordinator(
      context.diaryId,
      context.epochId,
      context.remoteId,
      transport,
      codec,
      new IndexedDbV2CoordinatorStore(context.epochId,context.rootKey,context.epochSalt,this.store),
      false,
      authority,
    )
    coordinator.connected()
    this.context=context
    this.coordinator=coordinator
  }

  private async ensureCurrent():Promise<{context:ActiveV2RuntimeContext;coordinator:SingleWriterCoordinator}>{
    const selected=await activeProtocolSelectionV2()
    if(!selected)throw new Error('No active v2 selection exists.')
    if(!this.context||!this.coordinator
      ||this.context.diaryId!==selected.diary_id
      ||this.context.epochId!==selected.epoch_id
      ||this.context.manifestFingerprint!==selected.manifest_fingerprint){
      await this.rebuildCoordinator()
    }
    if(!this.context||!this.coordinator)throw new Error('V2 coordinator initialization failed.')
    return{context:this.context,coordinator:this.coordinator}
  }

  async synchronize():Promise<void>{
    const {coordinator}=await this.ensureCurrent()
    coordinator.online()
    await coordinator.pullVerify()
    await coordinator.pushPending()
  }

  async refreshVerifiedReadModel():Promise<void>{
    const {coordinator}=await this.ensureCurrent()
    coordinator.online()
    await coordinator.pullVerify()
  }

  async prepareAndSynchronizeDomainWrite<T>(input:PrepareDomainRevisionV2Input<T>):Promise<PreparedDomainWriteV2<T>>{
    // Reconcile every prior pending/unknown mutation first. This makes ordinary
    // UI writes linear on the currently verified remote graph and prevents a
    // rapid second edit from creating an unintended parallel head.
    await this.synchronize()
    const {context}=await this.ensureCurrent()
    const authority=new TransferableSingleWriterV2WriteAuthority(
      ()=>this.store.loadState(context.rootKey,context.epochSalt,context.epochId),
      envelope=>this.store.envelopeAuthority(context.rootKey,context.epochSalt,context.epochId,envelope),
    )
    const preparer=new V2DomainWritePreparer(
      this.store,
      authority,
      this.session.freshCanonicalSource(context.diaryId,context.epochId,context.rootKey,context.remoteId),
    )
    const prepared=await preparer.prepareAndPersist(context.rootKey,context.epochSalt,input)
    // A repository mutation reports success only after the exact prepared bytes
    // have been canonical-readback reconciled. Unknown Outcome remains pending
    // and propagates as an error instead of presenting an undurable UI success.
    await this.synchronize()
    return prepared
  }

  async close():Promise<void>{
    this.coordinator=null
    this.context=null
    await this.session.disconnect()
  }
}
