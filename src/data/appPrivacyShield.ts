export const APP_PRIVACY_SHIELD_ATTRIBUTE='data-app-privacy-shield'
export const APP_PRIVACY_SHIELD_ACTIVE='active'

interface PrivacyDocumentTarget {
  visibilityState:string
  documentElement:{
    setAttribute:(name:string,value:string)=>void
    removeAttribute:(name:string)=>void
  }
  addEventListener:(type:string,listener:()=>void)=>void
  removeEventListener:(type:string,listener:()=>void)=>void
}

interface PrivacyWindowTarget {
  addEventListener:(type:string,listener:()=>void)=>void
  removeEventListener:(type:string,listener:()=>void)=>void
}

export function installAppPrivacyShield(
  documentTarget:PrivacyDocumentTarget=document,
  windowTarget:PrivacyWindowTarget=window,
):()=>void{
  const hide=()=>documentTarget.documentElement.setAttribute(APP_PRIVACY_SHIELD_ATTRIBUTE,APP_PRIVACY_SHIELD_ACTIVE)
  const show=()=>documentTarget.documentElement.removeAttribute(APP_PRIVACY_SHIELD_ATTRIBUTE)
  const sync=()=>documentTarget.visibilityState==='hidden'?hide():show()

  documentTarget.addEventListener('visibilitychange',sync)
  windowTarget.addEventListener('pagehide',hide)
  windowTarget.addEventListener('pageshow',sync)
  sync()

  return()=>{
    documentTarget.removeEventListener('visibilitychange',sync)
    windowTarget.removeEventListener('pagehide',hide)
    windowTarget.removeEventListener('pageshow',sync)
    show()
  }
}
