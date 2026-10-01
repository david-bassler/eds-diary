import { describe, expect, it, vi } from 'vitest'
import { APP_BACKGROUND_AUTO_LOCK_MS, createAppAutoLockController } from '../data/appAutoLock'

function strong(mode:'passphrase'|'prf'='prf'){
  return {initialized:true,mode,locked:false} as const
}

describe('app background auto-lock',()=>{
  it('keeps a strong session unlocked when foregrounded inside the grace period',()=>{
    let now=1_000
    const lock=vi.fn(async()=>undefined),gate=vi.fn()
    const controller=createAppAutoLockController({
      getStatus:()=>strong(),
      lock,
      gate,
      now:()=>now,
      schedule:()=>1,
      cancel:()=>undefined,
    })

    controller.enterBackground()
    now+=APP_BACKGROUND_AUTO_LOCK_MS-1
    controller.enterForeground()

    expect(gate).not.toHaveBeenCalled()
    expect(lock).not.toHaveBeenCalled()
  })

  it('gates and locks a strong session when the background timer expires',async()=>{
    let callback:(()=>void)|null=null
    const lock=vi.fn(async()=>undefined),gate=vi.fn()
    const controller=createAppAutoLockController({
      getStatus:()=>strong('passphrase'),
      lock,
      gate,
      schedule:scheduled=>{callback=scheduled;return 1},
      cancel:()=>undefined,
    })

    controller.enterBackground()
    expect(callback).not.toBeNull()
    callback!()
    await Promise.resolve()

    expect(gate).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('fails closed on foreground when timers were throttled past the grace period',async()=>{
    let now=10_000
    const lock=vi.fn(async()=>undefined),gate=vi.fn()
    const controller=createAppAutoLockController({
      getStatus:()=>strong(),
      lock,
      gate,
      now:()=>now,
      schedule:()=>1,
      cancel:()=>undefined,
    })

    controller.enterBackground()
    now+=APP_BACKGROUND_AUTO_LOCK_MS
    controller.enterForeground()
    await Promise.resolve()

    expect(gate).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the wall clock moves backwards while backgrounded',async()=>{
    let now=50_000
    const lock=vi.fn(async()=>undefined),gate=vi.fn()
    const controller=createAppAutoLockController({
      getStatus:()=>strong(),
      lock,
      gate,
      now:()=>now,
      schedule:()=>1,
      cancel:()=>undefined,
    })

    controller.enterBackground()
    now=49_000
    controller.enterForeground()
    await Promise.resolve()

    expect(gate).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-lock best-effort or already locked profiles',()=>{
    for(const status of [
      {initialized:true,mode:'best-effort' as const,locked:false},
      {initialized:true,mode:'prf' as const,locked:true},
      {initialized:false,mode:'best-effort' as const,locked:false},
    ]){
      let now=0
      const lock=vi.fn(async()=>undefined),gate=vi.fn()
      const controller=createAppAutoLockController({
        getStatus:()=>status,
        lock,
        gate,
        now:()=>now,
        schedule:()=>1,
        cancel:()=>undefined,
      })
      controller.enterBackground()
      now+=APP_BACKGROUND_AUTO_LOCK_MS+1
      controller.enterForeground()
      expect(gate).not.toHaveBeenCalled()
      expect(lock).not.toHaveBeenCalled()
    }
  })

  it('does not extend the grace period when duplicate background events arrive',async()=>{
    let now=1_000
    const lock=vi.fn(async()=>undefined),gate=vi.fn()
    const controller=createAppAutoLockController({
      getStatus:()=>strong(),
      lock,
      gate,
      now:()=>now,
      schedule:()=>1,
      cancel:()=>undefined,
    })

    controller.enterBackground()
    now+=20_000
    controller.enterBackground()
    now+=10_000
    controller.enterForeground()
    await Promise.resolve()

    expect(gate).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledTimes(1)
  })
})
