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
function fakeService(refresh:()=>Promise<void>=async()=>undefined){
  return{
    close:vi.fn(async(disconnectProvider=true)=>{void disconnectProvider}),
    synchronize:vi.fn(async()=>undefined),
    refreshVerifiedReadModel:vi.fn(refresh),
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

  it('does not disconnect a newer in-flight install that reuses the same provider',async()=>{
    const first=deferred<TransferableSingleWriterV2SyncService>()
    const second=deferred<TransferableSingleWriterV2SyncService>()
    const source=provider('shared'),serviceA=fakeService(),serviceB=fakeService()
    mocked.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const pendingA=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    const pendingB=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(2))

    // Older A completes first *after* B has claimed desired ownership but
    // before B has published. A must not disconnect B's shared provider.
    first.resolve(serviceA)
    await expect(pendingA).rejects.toThrow('V2 provider session changed during installation.')
    expect(serviceA.close).toHaveBeenCalledWith(false)
    expect(runtime.activeV2SyncService()).toBeNull()

    second.resolve(serviceB)
    await expect(pendingB).resolves.toBe(serviceB)
    expect(serviceB.refreshVerifiedReadModel).toHaveBeenCalledTimes(1)
    expect(runtime.activeV2ProviderSession()).toBe(source)
    expect(runtime.activeV2SyncService()).toBe(serviceB)
  })

  it('disconnects an unowned provider when service construction fails before a candidate exists',async()=>{
    const source=provider('construction-failed')
    mocked.create.mockRejectedValueOnce(new Error('synthetic service construction failure'))
    await expect(runtime.installAuthenticatedV2RemoteSession(source)).rejects.toThrow('synthetic service construction failure')
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
  })

  it('does not disconnect a shared provider when an older construction fails after a newer same-session install starts',async()=>{
    const source=provider('shared-construction')
    const first=deferred<TransferableSingleWriterV2SyncService>()
    const second=deferred<TransferableSingleWriterV2SyncService>()
    const serviceB=fakeService()
    mocked.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const pendingA=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    const pendingB=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(2))
    first.reject(new Error('older construction failed'))
    await expect(pendingA).rejects.toThrow('older construction failed')
    expect(source.disconnect).not.toHaveBeenCalled()
    second.resolve(serviceB)
    await expect(pendingB).resolves.toBe(serviceB)
    expect(runtime.activeV2ProviderSession()).toBe(source)
  })

  it('eventually disconnects an unpublished provider when logout occurs during failed construction',async()=>{
    const source=provider('construction-logout')
    const creating=deferred<TransferableSingleWriterV2SyncService>()
    mocked.create.mockReturnValueOnce(creating.promise)
    const installing=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    await runtime.disconnectAuthenticatedV2RemoteSession()
    creating.reject(new Error('construction failed after logout'))
    await expect(installing).rejects.toThrow('construction failed after logout')
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(runtime.activeV2ProviderSession()).toBeNull()
  })

  it('does not publish a candidate until initial full remote verification succeeds',async()=>{
    const source=provider('verification-pending')
    const verify=deferred<void>(),candidate=fakeService(()=>verify.promise)
    mocked.create.mockResolvedValueOnce(candidate)
    const installing=runtime.installAuthenticatedV2RemoteSession(source)
    await vi.waitFor(()=>expect(candidate.refreshVerifiedReadModel).toHaveBeenCalledTimes(1))
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
    verify.resolve()
    await expect(installing).resolves.toBe(candidate)
    expect(runtime.activeV2ProviderSession()).toBe(source)
    expect(runtime.activeV2SyncService()).toBe(candidate)
  })

  it('rejects failed initial verification without publishing its provider capability',async()=>{
    const source=provider('verification-failed')
    const candidate=fakeService(async()=>{throw new Error('synthetic canonical verification failure')})
    mocked.create.mockResolvedValueOnce(candidate)
    await expect(runtime.installAuthenticatedV2RemoteSession(source)).rejects.toThrow('synthetic canonical verification failure')
    expect(candidate.close).toHaveBeenCalledWith(true)
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
  })

  it('preserves a prior verified runtime when a replacement fails verification',async()=>{
    const sourceA=provider('verified-A'),sourceB=provider('bad-B')
    const serviceA=fakeService(),serviceB=fakeService(async()=>{throw new Error('replacement verification failed')})
    mocked.create.mockResolvedValueOnce(serviceA).mockResolvedValueOnce(serviceB)
    await expect(runtime.installAuthenticatedV2RemoteSession(sourceA)).resolves.toBe(serviceA)
    await expect(runtime.installAuthenticatedV2RemoteSession(sourceB)).rejects.toThrow('replacement verification failed')
    expect(serviceA.close).not.toHaveBeenCalled()
    expect(serviceB.close).toHaveBeenCalledWith(true)
    expect(runtime.activeV2ProviderSession()).toBe(sourceA)
    expect(runtime.activeV2SyncService()).toBe(serviceA)
  })

  it('freshly verifies a same-session reinstallation before reporting success',async()=>{
    const source=provider('same-session'),candidate=fakeService()
    mocked.create.mockResolvedValueOnce(candidate)
    await runtime.installAuthenticatedV2RemoteSession(source)
    expect(candidate.refreshVerifiedReadModel).toHaveBeenCalledTimes(1)
    await runtime.installAuthenticatedV2RemoteSession(source)
    expect(candidate.refreshVerifiedReadModel).toHaveBeenCalledTimes(2)
    expect(mocked.create).toHaveBeenCalledTimes(1)
  })

  it('invalidates an initial data-layer V2 install before activeProviderSession is assigned',async()=>{
    const dataLayer=await import('../data/initializeDataLayer')
    const source=provider('early-logout'),wait=deferred<TransferableSingleWriterV2SyncService>()
    const result=fakeService()
    mocked.create.mockReturnValueOnce(wait.promise)
    const installing=dataLayer.installAuthenticatedRemoteSession(source as Parameters<typeof dataLayer.installAuthenticatedRemoteSession>[0])
    await vi.waitFor(()=>expect(mocked.create).toHaveBeenCalledTimes(1))
    await dataLayer.clearAuthenticatedRemoteSession()
    wait.resolve(result)
    await expect(installing).rejects.toThrow(/session changed during installation/i)
    expect(result.close).toHaveBeenCalled()
    expect(runtime.activeV2ProviderSession()).toBeNull()
    expect(runtime.activeV2SyncService()).toBeNull()
  })
})
