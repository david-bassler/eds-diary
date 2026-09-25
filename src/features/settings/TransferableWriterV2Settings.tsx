import { useEffect, useState } from 'react'
import { base64Url, fromBase64Url, randomBytes } from '../../security/crypto/bytes'
import { canonicalJson } from '../../security/crypto/canonical'
import { GoogleSingleWriterProvider } from '../../sync/google/GoogleSingleWriterProvider'
import { GoogleTransferableSingleWriterV2Provider, type TransferableSingleWriterV2ProviderSession } from '../../sync/google/GoogleTransferableSingleWriterV2Provider'
import {
  adoptGrantedWriterV2,
  continuePendingRecoveryRekeyV2,
  createWriterTransferDescriptorV2,
  forceTakeoverV2,
  handoffWriterV2,
  installAuthenticatedRemoteSession,
  joinExistingV2Diary,
  remoteSessionStatus,
  synchronizeDataLayer,
  upgradeAuthenticatedRemoteSessionToV2,
  type RemoteSessionStatus,
} from '../../data/initializeDataLayer'

function parseRecoveryKey(value:string):Uint8Array{
  const bytes=fromBase64Url(value.trim())
  if(bytes.byteLength!==32||base64Url(bytes)!==value.trim())throw new Error('Recovery-Schlüssel ist ungültig.')
  return bytes
}
function authOrigin():string{
  const value=import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string|undefined
  if(!value)throw new Error('Google-Anmeldung ist für diese Installation noch nicht konfiguriert.')
  return value
}
function actionId():string{return base64Url(randomBytes(32))}

export function TransferableWriterV2Settings(){
  const [remote,setRemote]=useState<RemoteSessionStatus|null>(null)
  const [recoveryKey,setRecoveryKey]=useState('')
  const [descriptor,setDescriptor]=useState('')
  const [incomingDescriptor,setIncomingDescriptor]=useState('')
  const [status,setStatus]=useState('')
  const [busy,setBusy]=useState(false)
  const [v2Session,setV2Session]=useState<TransferableSingleWriterV2ProviderSession|null>(null)

  const refresh=()=>void remoteSessionStatus().then(setRemote).catch(error=>setStatus(error instanceof Error?error.message:'Status konnte nicht gelesen werden.'))
  useEffect(refresh,[])

  async function withBusy(work:()=>Promise<void>):Promise<void>{
    setBusy(true);setStatus('')
    try{await work();refresh()}catch(error){setStatus(error instanceof Error?error.message:'V2-Aktion fehlgeschlagen.')}
    finally{setBusy(false)}
  }
  async function connectedV2():Promise<TransferableSingleWriterV2ProviderSession>{
    if(v2Session)return v2Session
    const session=await new GoogleTransferableSingleWriterV2Provider(authOrigin()).authenticate(actionId())
    await installAuthenticatedRemoteSession(session)
    setV2Session(session)
    return session
  }

  async function join():Promise<void>{
    const urs=parseRecoveryKey(recoveryKey)
    const session=await new GoogleTransferableSingleWriterV2Provider(authOrigin()).authenticate(actionId())
    let installed=false
    try{
      const result=await joinExistingV2Diary(session,urs)
      installed=true
      setV2Session(session)
      setStatus(`Tagebuch read-only verbunden (Epoche ${result.epochId}).`)
    }finally{
      if(!installed)await session.disconnect().catch(()=>undefined)
    }
  }
  async function upgrade():Promise<void>{
    const urs=parseRecoveryKey(recoveryKey),origin=authOrigin()
    const source=await new GoogleSingleWriterProvider(origin).authenticate(actionId())
    let successor:TransferableSingleWriterV2ProviderSession|null=null,installed=false
    try{
      successor=await new GoogleTransferableSingleWriterV2Provider(origin).authenticate(actionId())
      const result=await upgradeAuthenticatedRemoteSessionToV2(source,successor,urs)
      if(result.stage==='switched'){
        installed=true
        setV2Session(successor)
        setStatus('Tagebuch wurde vollständig auf Transferable Single Writer v2 umgestellt.')
      }else setStatus(`V2-Upgrade steht bei ${result.stage}; der Vorgang bleibt crash-resumierbar.`)
    }finally{
      await source.disconnect().catch(()=>undefined)
      if(successor&&!installed)await successor.disconnect().catch(()=>undefined)
    }
  }
  async function connect():Promise<void>{
    const session=await connectedV2()
    await installAuthenticatedRemoteSession(session)
    await synchronizeDataLayer()
    setStatus('V2-Remote vollständig verifiziert und synchronisiert.')
  }
  async function takeover():Promise<void>{
    const result=await forceTakeoverV2(await connectedV2(),parseRecoveryKey(recoveryKey))
    setStatus(result.maintenanceOnly
      ?'Writer-Authority übernommen. Recovery-Key-Wechsel muss vor normalen Einträgen abgeschlossen werden.'
      :'Writer-Authority wurde kanonisch auf dieses Gerät übertragen.')
  }
  async function continueRekey():Promise<void>{
    const result=await continuePendingRecoveryRekeyV2(await connectedV2(),parseRecoveryKey(recoveryKey))
    setStatus(result.stage==='completed'?'Recovery-Key-Wechsel und Phase-B-Rotation sind abgeschlossen.':`Recovery-Key-Wechsel steht bei ${result.stage}.`)
  }
  async function createDescriptor():Promise<void>{
    const value=await createWriterTransferDescriptorV2(await connectedV2())
    setDescriptor(canonicalJson(value as never))
    setStatus('Transfer-Descriptor erstellt. Übertrage ihn zum aktuellen Writer.')
  }
  async function handoff():Promise<void>{
    const parsed=JSON.parse(incomingDescriptor) as unknown
    const result=await handoffWriterV2(await connectedV2(),parsed)
    setStatus(result.stage==='durable'?'Schreibzugriff wurde kanonisch übertragen.':`Writer-Transfer steht bei ${result.stage}.`)
  }
  async function adopt():Promise<void>{
    await adoptGrantedWriterV2(await connectedV2())
    setStatus('Dieses Gerät hat den kanonisch erteilten Schreibzugriff übernommen.')
  }

  if(!remote)return <section><h2>Mehrgeräte-Schreibzugriff (v2)</h2><p>{status||'Status wird geprüft …'}</p></section>

  return <section className="google-sync-settings" aria-labelledby="transferable-writer-v2-heading">
    <header className="google-sync-settings__header">
      <div>
        <h2 id="transferable-writer-v2-heading">Mehrgeräte-Schreibzugriff (v2)</h2>
        <p className="google-sync-settings__state">
          {remote.profile==='v2'
            ? remote.recoveryRekeyRequired
              ?'Recovery-Key-Wechsel ist noch nicht abgeschlossen. Normale Einträge bleiben gesperrt.'
              : remote.writerStatus==='writer_active'
                ?'Dieses Gerät besitzt aktuell die Writer-Authority.'
                :'Dieses Gerät ist read-only.'
            :'Dieses Tagebuch verwendet noch Single Writer v1.'}
        </p>
      </div>
      {remote.profile==='v2'?<span className="google-sync-settings__badge">{remote.writerStatus==='writer_active'?'Writer':'Read-only'}</span>:null}
    </header>

    <div className="google-sync-settings__content">
      <label>
        Recovery-Schlüssel
        <input type="text" value={recoveryKey} onChange={event=>setRecoveryKey(event.target.value.trim())} autoComplete="off"/>
      </label>

      {remote.profile==='v1'&&remote.mode==='remote_bound'?<div className="google-sync-settings__setup">
        <h3>Auf v2 umstellen</h3>
        <p>Während des einmaligen v1→v2-Cutovers dürfen keine anderen alten v1-Geräte schreiben.</p>
        <button type="button" disabled={busy||!recoveryKey} onClick={()=>void withBusy(upgrade)}>Tagebuch auf v2 umstellen</button>
      </div>:null}

      {remote.profile==='v1'&&remote.mode==='local_offline'?<div className="google-sync-settings__setup">
        <h3>Bestehendes v2-Tagebuch auf diesem Gerät öffnen</h3>
        <p>Der Join erzeugt eine neue Geräteidentität und startet immer read-only.</p>
        <button type="button" disabled={busy||!recoveryKey} onClick={()=>void withBusy(join)}>Mit Recovery-Schlüssel read-only beitreten</button>
      </div>:null}

      {remote.profile==='v2'?<>
        <div className="google-sync-settings__actions">
          <button type="button" disabled={busy} onClick={()=>void withBusy(connect)}>Google verifizieren &amp; synchronisieren</button>
          {remote.recoveryRekeyRequired
            ?<button type="button" disabled={busy||!recoveryKey} onClick={()=>void withBusy(continueRekey)}>Recovery-Key-Wechsel abschließen</button>
            :null}
        </div>

        {remote.writerStatus==='read_only'&&!remote.recoveryRekeyRequired?<div className="google-sync-settings__setup">
          <h3>Schreibzugriff übernehmen</h3>
          <p>Forced Takeover ist eine Recovery-Ceremony. Nutze ihn nur, wenn ein kooperativer Transfer vom aktuellen Writer nicht möglich ist.</p>
          <button type="button" disabled={busy||!recoveryKey} onClick={()=>void withBusy(takeover)}>Forced Takeover mit Recovery-Schlüssel</button>
          <button type="button" disabled={busy} onClick={()=>void withBusy(createDescriptor)}>Descriptor für kooperativen Transfer erstellen</button>
          {descriptor?<textarea readOnly rows={6} value={descriptor} aria-label="Transfer-Descriptor"/>:null}
          <button type="button" disabled={busy} onClick={()=>void withBusy(adopt)}>Bereits erteilten Schreibzugriff übernehmen</button>
        </div>:null}

        {remote.writerStatus==='writer_active'&&!remote.recoveryRekeyRequired?<div className="google-sync-settings__setup">
          <h3>Schreibzugriff übertragen</h3>
          <p>Füge den vom read-only Zielgerät erzeugten Transfer-Descriptor ein.</p>
          <textarea rows={6} value={incomingDescriptor} onChange={event=>setIncomingDescriptor(event.target.value)} aria-label="Transfer-Descriptor des Zielgeräts"/>
          <button type="button" disabled={busy||!incomingDescriptor.trim()} onClick={()=>void withBusy(handoff)}>Schreibzugriff sicher übertragen</button>
        </div>:null}
      </>:null}

      {status?<p role="status" aria-live="polite">{status}</p>:null}
    </div>
  </section>
}
