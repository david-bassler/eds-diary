import { SingleWriterCoordinator } from '../sync/core/coordinator'
import type { VerifiedRemoteState } from '../sync/core/contracts'
import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from '../sync/google/GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import { fixedBase64Url } from '../security/crypto/bytes'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { V2DomainWritePreparer, type PrepareDomainRevisionV2Input, type PreparedDomainWriteV2 } from '../security/v2/domainWrite'
import { IndexedDbV2CoordinatorStore } from '../security/v2/coordinatorStore'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import { TransferableSingleWriterV2WriteAuthority } from '../security/v2/writeAuthority'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import {
  activeProtocolSelectionV2,
  openActiveV2RootWrapV6WithActiveMode,
} from './localDatabase'

export interface ActiveV2AppContext {
  diaryId:string
  epochId:string
  rootKey:Uint8Array
  epochSalt:Uint8Array
  state:Awaited<ReturnType<IndexedDbV2LocalSecurityStore['loadState']>>
  store:IndexedDbV2LocalSecurityStore
}

function canonical(verified:VerifiedRemoteState):CanonicalFullResultV2{
  const result=verified.profileState as CanonicalFullResultV2
  if(!result||result.kind!=='canonical_full')throw new Error('Active v2 app data requires canonical_full verification.')
  return result
}

export async function activeV2AppContext(store=new IndexedDbV2LocalSecurityStore()):Promise<ActiveV2AppContext|null>{
  const selection=await activeProtocolSelectionV2()
  if(!selection)return null
  const prepared=await store.loadRootWrapV6(selection.epoch_id)
  const rootKey=await openActiveV2RootWrapV6WithActiveMode(prepared)
  const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
  const state=await store.loadState(rootKey,epochSalt,selection.epoch_id)
  if(state.diary_id!==selection.diary_id||state.epoch_id!==selection.epoch_id||state.manifest_fingerprint!==selection.manifest_fingerprint)throw new Error('Active v2 protocol selection does not match authenticated StateV6.')
  return{diaryId:selection.diary_id,epochId:selection.epoch_id,rootKey,epochSalt,state,store}
}

export async function loadActiveV2CanonicalFromCache(store=new IndexedDbV2LocalSecurityStore()):Promise<{
  context:ActiveV2AppContext
  verified:VerifiedRemoteState
  result:CanonicalFullResultV2
}|null>{
  const context=await activeV2AppContext(store)
  if(!context)return null
  const binding=context.state.remote_binding
  if(!binding)throw new Error('Active v2 StateV6 has no authenticated remote binding.')
  const snapshot=await store.loadVerifiedRemoteSnapshot(context.rootKey,context.epochSalt,context.epochId)
  const codec=new GoogleSheetsTransferableSingleWriterV2ProfileCodec(
    context.diaryId,
    context.epochId,
    context.rootKey,
    binding.remote_identity_binding,
  )
  const verified=await codec.verifyRemote(snapshot),result=canonical(verified)
  if(result.diary_id!==context.diaryId||result.epoch_id!==context.epochId||result.manifest_fingerprint!==context.state.manifest_fingerprint)throw new Error('Cached canonical v2 result does not match active StateV6 identity.')
  const anchor=context.state.remote_anchor
  if(!anchor||result.remote_anchor.anchor_profile!==anchor.anchor_profile
    ||result.remote_anchor.covered_row_count!==anchor.covered_row_count
    ||result.remote_anchor.prefix_hash!==anchor.prefix_hash)throw new Error('Cached canonical v2 result does not match authenticated StateV6 anchor.')
  return{context,verified,result}
}

export class TransferableSingleWriterV2SyncService {
  constructor(
    private readonly session:TransferableSingleWriterV2ProviderSession,
    private readonly store=new IndexedDbV2LocalSecurityStore(),
  ){}

  private async runtime():Promise<{
    context:ActiveV2AppContext
    coordinator:SingleWriterCoordinator
    authority:TransferableSingleWriterV2WriteAuthority
  }>{
    const context=await activeV2AppContext(this.store)
    if(!context)throw new Error('No active v2 epoch is selected.')
    const binding=context.state.remote_binding
    if(!binding||binding.sync_profile!==this.session.profileId||binding.storage_provider_id!==this.session.providerId)throw new Error('Authenticated v2 provider does not match StateV6 remote binding.')
    const transport=await this.session.transportForEpoch(context.diaryId,context.epochId)
    const identity=await this.session.remoteIdentityBinding(transport)
    if(identity!==binding.remote_identity_binding)throw new Error('Authenticated v2 provider identity does not match StateV6.')
    const codec=await this.session.codecForEpoch(context.diaryId,context.epochId,context.rootKey,transport)
    const authority=new TransferableSingleWriterV2WriteAuthority(
      ()=>this.store.loadState(context.rootKey,context.epochSalt,context.epochId),
      envelope=>this.store.envelopeAuthority(context.rootKey,context.epochSalt,context.epochId,envelope),
    )
    const coordinator=new SingleWriterCoordinator(
      context.diaryId,
      context.epochId,
      binding.remote_resource_id,
      transport,
      codec,
      new IndexedDbV2CoordinatorStore(context.epochId,context.rootKey,context.epochSalt,this.store),
      false,
      authority,
    )
    return{context,coordinator,authority}
  }

  async synchronize():Promise<void>{
    const {coordinator}=await this.runtime()
    coordinator.connected()
    await coordinator.pullVerify()
    await coordinator.pushPending()
  }

  async prepareDomainWrite<T>(input:PrepareDomainRevisionV2Input<T>):Promise<PreparedDomainWriteV2<T>>{
    const {context,authority}=await this.runtime()
    const binding=context.state.remote_binding
    if(!binding)throw new Error('Active v2 StateV6 has no authenticated remote binding.')
    const preparer=new V2DomainWritePreparer(
      this.store,
      authority,
      this.session.freshCanonicalSource(context.diaryId,context.epochId,context.rootKey,binding.remote_resource_id),
    )
    return preparer.prepareAndPersist(context.rootKey,context.epochSalt,input)
  }

  async disconnect():Promise<void>{await this.session.disconnect()}
}
