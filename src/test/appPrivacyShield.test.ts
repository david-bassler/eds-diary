import { describe, expect, it, vi } from 'vitest'
import { APP_PRIVACY_SHIELD_ACTIVE, APP_PRIVACY_SHIELD_ATTRIBUTE, installAppPrivacyShield } from '../data/appPrivacyShield'

function fixture(initialVisibility:'visible'|'hidden'='visible'){
  let visibilityState=initialVisibility
  const attributes=new Map<string,string>()
  const documentListeners=new Map<string,()=>void>()
  const windowListeners=new Map<string,()=>void>()
  const documentTarget={
    get visibilityState(){return visibilityState},
    documentElement:{
      setAttribute:(name:string,value:string)=>{attributes.set(name,value)},
      removeAttribute:(name:string)=>{attributes.delete(name)},
    },
    addEventListener:(type:string,listener:()=>void)=>{documentListeners.set(type,listener)},
    removeEventListener:(type:string)=>{documentListeners.delete(type)},
  }
  const windowTarget={
    addEventListener:(type:string,listener:()=>void)=>{windowListeners.set(type,listener)},
    removeEventListener:(type:string)=>{windowListeners.delete(type)},
  }
  return{
    documentTarget,
    windowTarget,
    attributes,
    setVisibility(value:'visible'|'hidden'){visibilityState=value},
    documentListeners,
    windowListeners,
  }
}

describe('app privacy shield',()=>{
  it('covers the app immediately when the document becomes hidden',()=>{
    const target=fixture()
    installAppPrivacyShield(target.documentTarget,target.windowTarget)
    target.setVisibility('hidden')
    target.documentListeners.get('visibilitychange')?.()
    expect(target.attributes.get(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(APP_PRIVACY_SHIELD_ACTIVE)
  })

  it('covers window blur before the page is necessarily hidden',()=>{
    const target=fixture()
    installAppPrivacyShield(target.documentTarget,target.windowTarget)
    target.windowListeners.get('blur')?.()
    expect(target.attributes.get(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(APP_PRIVACY_SHIELD_ACTIVE)
  })

  it('covers pagehide even if visibility state has not changed yet',()=>{
    const target=fixture()
    installAppPrivacyShield(target.documentTarget,target.windowTarget)
    target.windowListeners.get('pagehide')?.()
    expect(target.attributes.get(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(APP_PRIVACY_SHIELD_ACTIVE)
  })

  it('removes the cover only when pageshow returns to a visible document',()=>{
    const target=fixture('hidden')
    installAppPrivacyShield(target.documentTarget,target.windowTarget)
    expect(target.attributes.get(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(APP_PRIVACY_SHIELD_ACTIVE)

    target.windowListeners.get('pageshow')?.()
    expect(target.attributes.get(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(APP_PRIVACY_SHIELD_ACTIVE)

    target.setVisibility('visible')
    target.windowListeners.get('pageshow')?.()
    expect(target.attributes.has(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(false)
  })

  it('cleans up listeners and the cover',()=>{
    const target=fixture('hidden')
    const cleanup=installAppPrivacyShield(target.documentTarget,target.windowTarget)
    const removeDocument=vi.spyOn(target.documentTarget,'removeEventListener')
    const removeWindow=vi.spyOn(target.windowTarget,'removeEventListener')

    cleanup()

    expect(removeDocument).toHaveBeenCalledWith('visibilitychange',expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('blur',expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('focus',expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('pagehide',expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('pageshow',expect.any(Function))
    expect(target.attributes.has(APP_PRIVACY_SHIELD_ATTRIBUTE)).toBe(false)
  })
})
