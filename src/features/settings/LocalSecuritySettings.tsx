import { useEffect, useState } from 'react'
import {
  enrollActivePassphraseRootWrap,
  enrollActivePrfRootWrap,
  localRootWrapStatus,
  lockActiveRoot,
  unlockActiveRootWithPassphrase,
  unlockActiveRootWithPrf,
  type LocalRootWrapStatus,
} from '../../data/localDatabase'
import { clearAuthenticatedRemoteSession } from '../../data/initializeDataLayer'
import { ensurePersistentStorage, type StorageDurabilityStatus } from '../../data/storageDurability'
import { fromBase64Url } from '../../security/crypto/bytes'
import { assertWebAuthnPrf, enrollWebAuthnPrf } from '../../security/webauthnPrf'
import './LocalSecuritySettings.css'

export const LOCAL_SECURITY_CHANGED_EVENT = 'eds-diary-local-security-changed'

const MODE_NAMES:Record<LocalRootWrapStatus['mode'],string>={
  'best-effort':'Best Effort',passphrase:'Passphrase',prf:'WebAuthn PRF',
}

function publicError(cause:unknown):string{
  if(cause instanceof Error&&(cause.name==='NotAllowedError'||cause.name==='AbortError'))return 'Der Sicherheitsvorgang wurde abgebrochen.'
  return cause instanceof Error?cause.message:'Der lokale Sicherheitsvorgang ist fehlgeschlagen.'
}

export interface LocalSecuritySettingsProps { unlockOnly?:boolean }

export function LocalSecuritySettings({unlockOnly=false}:LocalSecuritySettingsProps){
  const [status,setStatus]=useState<LocalRootWrapStatus|null>(null)
  const [passphrase,setPassphrase]=useState('')
  const [confirmation,setConfirmation]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [durability,setDurability]=useState<StorageDurabilityStatus|null>(null)

  async function refresh():Promise<void>{setStatus(await localRootWrapStatus())}
  useEffect(()=>{void localRootWrapStatus().then(setStatus).catch(cause=>setMessage(publicError(cause)));void ensurePersistentStorage().then(setDurability).catch(()=>setDurability({supported:false,persisted:false}))},[])

  async function run(operation:()=>Promise<void>,success:string):Promise<void>{
    setBusy(true);setMessage('')
    try{await operation();await refresh();setPassphrase('');setConfirmation('');setMessage(success);window.dispatchEvent(new Event(LOCAL_SECURITY_CHANGED_EVENT))}
    catch(cause){setMessage(publicError(cause))}
    finally{setBusy(false)}
  }

  async function unlock():Promise<void>{
    if(status?.mode==='passphrase')return run(()=>unlockActiveRootWithPassphrase(passphrase),'Lokales Tagebuch entsperrt.')
    if(status?.mode==='prf')return run(async()=>{if(!status.credentialId||!status.prfEvalInput||!status.rpId)throw new Error('Gespeicherte PRF-Bindung ist unvollständig.');const assertion=await assertWebAuthnPrf(fromBase64Url(status.credentialId),fromBase64Url(status.prfEvalInput),status.rpId);await unlockActiveRootWithPrf(assertion.credentialId,assertion.prfOutput)},'Lokales Tagebuch entsperrt.')
  }

  async function activatePassphrase():Promise<void>{
    if(passphrase!==confirmation){setMessage('Passphrase und Bestätigung stimmen nicht überein.');return}
    await run(()=>enrollActivePassphraseRootWrap(passphrase),'Passphrase-Schutz wurde aktiviert und verifiziert.')
  }

  async function activatePrf():Promise<void>{await run(async()=>enrollActivePrfRootWrap(await enrollWebAuthnPrf()),'WebAuthn-PRF-Schutz wurde aktiviert und verifiziert.')}
  async function lock():Promise<void>{await run(async()=>{await clearAuthenticatedRemoteSession();await lockActiveRoot()},'Lokales Tagebuch wurde gesperrt; die Google-Sitzung ist getrennt.')}

  const content=(
    <div className="local-security-settings__content">
      {status?<p><strong>Modus:</strong> {MODE_NAMES[status.mode]} · <strong>Status:</strong> {status.locked?'gesperrt':'entsperrt'}</p>:<p>Sicherheitsstatus wird geprüft …</p>}
      <p className="local-security-settings__boundary">Best Effort schützt verschlüsselte Datensätze nicht stark gegen Kopie oder Manipulation des gesamten Browserprofils. Passphrase und WebAuthn PRF verlangen nach einem Neustart eine erfolgreiche Entsperrung, bevor Tagebuchdaten oder Synchronisierung zugänglich sind.</p>
      {durability?<p><strong>Browser-Speicher:</strong> {durability.supported?(durability.persisted?'dauerhafte Speicherung vom Browser bestätigt':'nur Best-Effort; der Browser kann lokale Daten unter Speicherdruck entfernen'):'Persistence-Status wird von diesem Browser nicht unterstützt'}</p>:null}
      {status?.locked?(<div className="local-security-settings__form">
        {status.mode==='passphrase'?<label>Passphrase<input type="password" autoComplete="current-password" value={passphrase} onChange={event=>setPassphrase(event.target.value)}/></label>:null}
        <button type="button" disabled={busy||(status.mode==='passphrase'&&!passphrase)} onClick={()=>void unlock()}>{status.mode==='prf'?'Mit WebAuthn entsperren':'Entsperren'}</button>
      </div>):null}
      {!unlockOnly&&!status?.locked?(<>
        <div className="local-security-settings__form">
          <label>Neue Passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={event=>setPassphrase(event.target.value)}/></label>
          <label>Passphrase bestätigen<input type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
          <button type="button" disabled={busy||!passphrase||!confirmation} onClick={()=>void activatePassphrase()}>Passphrase aktivieren</button>
          <button type="button" disabled={busy} onClick={()=>void activatePrf()}>WebAuthn PRF aktivieren</button>
          {status?.mode!=='best-effort'?<button type="button" disabled={busy} onClick={()=>void lock()}>Jetzt sperren</button>:null}
        </div>
      </>):null}
      {message?<p className="local-security-settings__message" aria-live="polite">{message}</p>:null}
    </div>
  )
  if(unlockOnly)return <section className="local-security-settings local-security-settings--gate" aria-labelledby="local-unlock-title"><h1 id="local-unlock-title">Lokales Tagebuch gesperrt</h1>{content}</section>
  return <details className="local-security-settings"><summary>Lokale Sicherheit</summary>{content}</details>
}
