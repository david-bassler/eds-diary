import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferableWriterV2RuntimeSession } from '../sync/core/provider'
import type { TransferableSingleWriterV2SyncService } from '../data/transferableSingleWriterV2SyncService'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'

const mocked=vi.hoisted(()=>({
  selected:vi.fn(),
  create:vi.fn(),
}))
vi.mock('../data/localDatabase',()=>({
  activeProtocolSelectionV2:mocked.selected,
}))
vi.mock('../data/transferableSingleWriterV2SyncService',()=>({
  TransferableSingleWriterV2SyncService:{createAuthenticated:mocked.create},
}))

import * as runtime from '../data/v2ApplicationRuntime'

function deferred<T>(){
  let resolve!: (value:T)=>void
  let reject!: (error:Error)=>void
  const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no})
  return{promise,resolve,reject}
}
function provider(label:string):TransferableWriterV2RuntimeSession{
  return{
    profileId:SINGLE_WRITER_V2_PROFILE,providerId:label,
    disconnect:vi.fn(async()=>undefined),
  } as unknown as TransferableWriterV2RuntimeSession
}
function fakeService(){
  return{
    close:vi.fn(async(_disconnectProvider=true)=>undefined),
    synchronize:vi.fn(async()=>undefined),
    refreshVerifiedReadModel:vi.fn(async()=>undefined),
  } as unknown as TransferableSingleWriterV2SyncService
}

describe('v2 authenticated application-session generation fencing',()=>{
  beforeEach(()=>{
    runtime.__v2ApplicationRuntimeTesting.reset()
    mocked.selected.mockReset()
    mocked.create.mockReset()
    mocked.selected.mockResolvedValue({sync_profile:SINGLE_WRITER_V2_PROFILE})
  })
  afterEach(async()=>{
    await runtime.disconnectAuthenticatedV2RemoteSession()
  })

  it('does not resurrect an unpublished provider session after disconnect',async()=>{
    const source=provider('old-session'),wait=deferred<TransferableSingleWriterV2SyncService>()
    const result=fakeService()
    mocked.create.mockReturnValueOnce(wait.promise)
    const installing=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    await runtime.disconnectAuthenticatedV2RemoteSession()
    wait.resolve(result)
    await expect(installing).rejects.toThrow('V2 provider session changed during installation.')
    expect(result.close).toHaveBeenCalledTimes(1)
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
  })

  it('cannot publish older A over the newer B provider after concurrent installs',async()=>{
    const first=deferred<TransferableSingleWriterV2SyncService>()
    const second=deferred<TransferableSingleWriterV2SyncService>()
    const sourceA=provider('A'),sourceB=provider('B'),serviceA=fakeService(),serviceB=fakeService()
    mocked.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const pendingA=runtime.installAuthenticatedV2RemoteSession(sourceA)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    const pendingB=runtime.installAuthenticatedV2RemoteSession(sourceB)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(2))
    second.resolve(serviceB)
    await expect(pendingB).resolves.toBe(serviceB)
    first.resolve(serviceA)
    await expect(pendingA).rejects.toThrow('V2 provider session changed during installation.')
    expect(serviceA.close).toHaveBeenCalledTimes(1)
    expect(serviceB.close).not.toHaveBeenCalled()
    expect(runtime.activeV2ProviderSession()).toBe(sourceB)
    expect(runtime.activeV2SyncService()).toBe(serviceB)
  })

  it('does not disconnect a newer installation that reuses the same provider',async()=>{
    const first=deferred<TransferableSingleWriterV2SyncService>()
    const second=deferred<TransferableSingleWriterV2SyncService>()
    const source=provider('shared'),serviceA=fakeService(),serviceB=fakeService()
    mocked.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const pendingA=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    const pendingB=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(2))
    second.resolve(serviceB)
    await pendingB
    first.resolve(serviceA)
    await expect(pendingA).rejects.toThrow('V2 provider session changed during installation.')
    expect(serviceA.close).toHaveBeenCalledWith(false)
    expect(serviceB.close).not.toHaveBeenCalled()
    expect(runtime.activeV2SyncService()).toBe(serviceB)
  })

  it('invalidates an initial data-layer V2 install before activeProviderSession is assigned',async()=>{
    const dataLayer=await import('../data/initializeDataLayer')
    const source=provider('early-logout'),wait=deferred<TransferableSingleWriterV2SyncService>()
    const result=fakeService()
    mocked.create.mockReturnValueOnce(wait.promise)
    const installing=dataLayer.installAuthenticatedRemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    await dataLayer.clearAuthenticatedRemoteSession()
    wait.resolve(result)
    await expect(installing).rejects.toThrow(/session changed during installation/i)
    expect(result.close).toHaveBeenCalled()
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
  })
})
