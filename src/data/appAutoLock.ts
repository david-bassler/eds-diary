export const APP_BACKGROUND_AUTO_LOCK_MS=30_000

export interface AutoLockSecurityStatus {
  initialized:boolean
  mode:'best-effort'|'passphrase'|'prf'
  locked:boolean
}

interface AutoLockControllerOptions {
  getStatus:()=>AutoLockSecurityStatus|null
  lock:()=>Promise<void>
  gate:()=>void
  now?:()=>number
  schedule?:(callback:()=>void,delayMs:number)=>unknown
  cancel?:(handle:unknown)=>void
  delayMs?:number
  onError?:(error:unknown)=>void
}

export interface AppAutoLockController {
  enterBackground:()=>void
  enterForeground:()=>void
  dispose:()=>void
}

function needsAutoLock(status:AutoLockSecurityStatus|null):boolean{
  return Boolean(status?.initialized&&!status.locked&&status.mode!=='best-effort')
}

export function createAppAutoLockController(options:AutoLockControllerOptions):AppAutoLockController{
  const now=options.now??(()=>Date.now())
  const schedule=options.schedule??((callback,delayMs)=>window.setTimeout(callback,delayMs))
  const cancel=options.cancel??(handle=>window.clearTimeout(handle as number))
  const delayMs=options.delayMs??APP_BACKGROUND_AUTO_LOCK_MS

  let backgrounded=false
  let hiddenSince:number|null=null
  let timer:unknown=null
  let lockInFlight=false

  const clearTimer=()=>{
    if(timer===null)return
    cancel(timer)
    timer=null
  }

  const triggerLock=()=>{
    if(lockInFlight||!needsAutoLock(options.getStatus()))return
    lockInFlight=true
    options.gate()
    void options.lock()
      .catch(error=>options.onError?.(error))
      .finally(()=>{lockInFlight=false})
  }

  const enterBackground=()=>{
    if(backgrounded)return
    backgrounded=true
    hiddenSince=now()
    clearTimer()
    if(needsAutoLock(options.getStatus())){
      timer=schedule(()=>{
        timer=null
        if(backgrounded)triggerLock()
      },delayMs)
    }
  }

  const enterForeground=()=>{
    const started=hiddenSince
    backgrounded=false
    hiddenSince=null
    clearTimer()
    if(started===null||!needsAutoLock(options.getStatus())||lockInFlight)return
    const current=now()
    if(current<started||current-started>=delayMs)triggerLock()
  }

  return{
    enterBackground,
    enterForeground,
    dispose(){
      backgrounded=false
      hiddenSince=null
      clearTimer()
    },
  }
}

export function installAppAutoLock(
  controller:AppAutoLockController,
  documentTarget:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>=document,
  windowTarget:Pick<Window,'addEventListener'|'removeEventListener'>=window,
):()=>void{
  const onVisibilityChange=()=>{
    if(documentTarget.visibilityState==='hidden')controller.enterBackground()
    else if(documentTarget.visibilityState==='visible')controller.enterForeground()
  }
  const onPageHide=()=>controller.enterBackground()
  const onPageShow=()=>controller.enterForeground()

  documentTarget.addEventListener('visibilitychange',onVisibilityChange)
  windowTarget.addEventListener('pagehide',onPageHide)
  windowTarget.addEventListener('pageshow',onPageShow)

  return()=>{
    documentTarget.removeEventListener('visibilitychange',onVisibilityChange)
    windowTarget.removeEventListener('pagehide',onPageHide)
    windowTarget.removeEventListener('pageshow',onPageShow)
    controller.dispose()
  }
}
