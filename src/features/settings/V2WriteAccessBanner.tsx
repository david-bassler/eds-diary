import { useEffect, useState } from 'react'
import { remoteSessionStatus, type RemoteSessionStatus } from '../../data/initializeDataLayer'
import { onSyncState } from '../../data/syncManager'

export function V2WriteAccessBanner(){
  const [status,setStatus]=useState<RemoteSessionStatus|null>(null)
  useEffect(()=>{
    let cancelled=false
    const refresh=()=>{void remoteSessionStatus().then(value=>{if(!cancelled)setStatus(value)}).catch(()=>undefined)}
    refresh()
    const remove=onSyncState(refresh)
    return()=>{cancelled=true;remove()}
  },[])
  if(!status||status.profile!=='v2')return null
  if(status.recoveryRekeyRequired)return <p role="status" className="app__write-access-status">
    Recovery-Key-Wechsel muss abgeschlossen werden. Normale Tagebucheinträge und Writer-Handoff sind bis dahin gesperrt.
  </p>
  if(status.writerStatus==='read_only')return <p role="status" className="app__write-access-status">
    Dieses Gerät ist read-only. Lesen ist möglich; neue oder geänderte Tagebucheinträge können hier nicht gespeichert werden.
  </p>
  return null
}
