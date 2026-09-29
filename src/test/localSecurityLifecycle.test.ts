import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps=vi.hoisted(()=>({
  lock:vi.fn<()=>Promise<void>>(),
  disconnect:vi.fn<()=>Promise<void>>(),
}))
vi.mock('../data/localDatabase',()=>({lockActiveRoot:deps.lock}))
vi.mock('../data/initializeDataLayer',()=>({clearAuthenticatedRemoteSession:deps.disconnect}))

import { lockLocalRootAndDisconnectSession } from '../data/localSecurityLifecycle'

function deferred(){
  let resolve!:()=>void
  let reject!:(error:Error)=>void
  const promise=new Promise<void>((ok,no)=>{resolve=ok;reject=no})
  return {promise,resolve,reject}
}

describe('local lock and authenticated provider teardown',()=>{
  beforeEach(()=>{
    deps.lock.mockReset()
    deps.disconnect.mockReset()
  })

  it('starts local factor revocation before delayed provider disconnect settles',async()=>{
    const provider=deferred()
    const sequence:string[]=[]
    deps.disconnect.mockImplementation(()=>{sequence.push('provider-started');return provider.promise})
    deps.lock.mockImplementation(async()=>{sequence.push('local-lock-started')})
    const action=lockLocalRootAndDisconnectSession()
    expect(sequence).toEqual(['provider-started','local-lock-started'])
    expect(deps.lock).toHaveBeenCalledTimes(1)
    provider.resolve()
    await expect(action).resolves.toBeUndefined()
  })

  it('keeps local lock effective and reports an unconfirmed provider disconnect',async()=>{
    const provider=deferred()
    deps.disconnect.mockReturnValue(provider.promise)
    deps.lock.mockResolvedValue()
    const action=lockLocalRootAndDisconnectSession()
    expect(deps.lock).toHaveBeenCalledTimes(1)
    provider.reject(new Error('synthetic provider disconnect failure'))
    await expect(action).rejects.toThrow(/lokale Tagebuch ist gesperrt.*Google-Verbindung/i)
  })

  it('does not hide a local-lock error behind provider success',async()=>{
    deps.disconnect.mockResolvedValue()
    deps.lock.mockRejectedValue(new Error('synthetic local lock failure'))
    await expect(lockLocalRootAndDisconnectSession()).rejects.toThrow('synthetic local lock failure')
    expect(deps.disconnect).toHaveBeenCalledTimes(1)
  })
})
