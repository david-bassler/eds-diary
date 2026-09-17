import { useEffect, useRef, useState } from 'react'
import { base64Url, fromBase64Url, randomBytes } from '../../security/crypto/bytes'
import { canonicalJson } from '../../security/crypto/canonical'
import { GoogleAuthProvider } from '../../sync/google/GoogleAuthProvider'
import {
  clearAuthenticatedRemoteSession,
  enableAuthenticatedGoogleSession,
  googleRemoteSessionStatus,
  installAuthenticatedGoogleSession,
} from '../../data/initializeDataLayer'
import {
  getSyncSnapshot,
  onSyncState,
  syncAll,
  type SyncSnapshot,
} from '../../data/syncManager'
import './GoogleSyncSettings.css'
import { createCurrentVerifiedBackup, currentRecoveryArtifact } from '../../data/artifactExports'

type StatusKind = 'neutral' | 'good' | 'bad'
interface StatusMessage { message: string; kind: StatusKind }
interface ExportArtifacts { recovery: unknown; backup: unknown }

function syncDescription(snapshot: SyncSnapshot): string {
  if (snapshot.state === 'syncing') return 'Synchronisierung läuft …'
  if (snapshot.state === 'synced') return 'Lokal und verschlüsselt mit Google synchronisiert.'
  if (snapshot.state === 'pending') return snapshot.connected ? 'Lokal gespeichert · Synchronisierung steht aus.' : 'Lokal gespeichert · Google ist nicht authentifiziert.'
  if (snapshot.state === 'error') return snapshot.error?.message ?? 'Synchronisierung fehlgeschlagen.'
  return 'Nur lokal in diesem Browser gespeichert.'
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([canonicalJson(value as never)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function GoogleSyncSettings() {
  const providerRef = useRef<GoogleAuthProvider | null>(null)
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot)
  const [status, setStatus] = useState<StatusMessage>({ message: 'Nicht mit Google authentifiziert.', kind: 'neutral' })
  const [busy, setBusy] = useState(false)
  const [requiresEnablement, setRequiresEnablement] = useState<boolean | null>(null)
  const [recoverySecret, setRecoverySecret] = useState('')
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [artifacts, setArtifacts] = useState<ExportArtifacts | null>(null)

  useEffect(() => {
    const removeSyncListener = onSyncState(setSyncSnapshot)
    void googleRemoteSessionStatus().then((value) => setRequiresEnablement(value.mode === 'local_offline')).catch((cause) => {
      setStatus({ message: cause instanceof Error ? cause.message : 'Lokaler Sicherheitsstatus konnte nicht gelesen werden.', kind: 'bad' })
    })
    return removeSyncListener
  }, [])

  function generateRecoverySecret(): void {
    setRecoverySecret(base64Url(randomBytes(32)))
    setRecoverySaved(false)
    setArtifacts(null)
    setStatus({ message: 'Recovery-Schlüssel erzeugt. Speichere ihn getrennt und bestätige das, bevor Google aktiviert wird.', kind: 'neutral' })
  }

  async function copyRecoverySecret(): Promise<void> {
    if (!recoverySecret) return
    await navigator.clipboard.writeText(recoverySecret)
    setStatus({ message: 'Recovery-Schlüssel in die Zwischenablage kopiert.', kind: 'good' })
  }

  async function connectAndSync(): Promise<void> {
    setBusy(true)
    try {
      const authOrigin = import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string | undefined
      if (!authOrigin) throw new Error('Der separate Google-Auth-Origin ist für diese Installation nicht konfiguriert.')
      const provider = providerRef.current ?? new GoogleAuthProvider(authOrigin)
      providerRef.current = provider
      const actionId = base64Url(randomBytes(32))
      await provider.authenticate(actionId)
      const api = provider.getApiClient()
      const remote = await googleRemoteSessionStatus()
      if (remote.mode === 'local_offline') {
        if (!recoverySecret || !recoverySaved) throw new Error('Vor der ersten Google-Aktivierung muss der Recovery-Schlüssel separat gespeichert und bestätigt werden.')
        const urs = fromBase64Url(recoverySecret)
        if (urs.byteLength !== 32) throw new Error('Recovery-Schlüssel ist ungültig.')
        const result = await enableAuthenticatedGoogleSession(api, urs)
        setArtifacts({ recovery: result.recovery, backup: result.backup })
        setRequiresEnablement(false)
        setStatus({ message: 'Neue verschlüsselte Remote-Epoche wurde erstellt und vollständig verifiziert. Recovery-Artefakt und Backup jetzt herunterladen.', kind: 'good' })
      } else {
        await installAuthenticatedGoogleSession(api)
        setStatus({ message: 'Google-Identität und gespeicherte Remote-Bindung wurden authentifiziert.', kind: 'good' })
      }
      await syncAll()
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Google-Verbindung fehlgeschlagen.', kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  async function synchronize(): Promise<void> {
    setBusy(true)
    try {
      await syncAll()
      setStatus({ message: 'Vollständig verifiziert und synchronisiert.', kind: 'good' })
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Synchronisierung fehlgeschlagen.', kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    try {
      await providerRef.current?.disconnect()
      providerRef.current = null
      clearAuthenticatedRemoteSession()
      setStatus({ message: 'Google-Sitzung getrennt. Die verschlüsselten lokalen Daten bleiben erhalten.', kind: 'neutral' })
    } finally {
      setBusy(false)
    }
  }

  async function exportRecovery():Promise<void>{setBusy(true);try{downloadJson('eds-diary-recovery.json',await currentRecoveryArtifact());setStatus({message:'Verifiziertes Recovery-Artefakt exportiert. Bewahre den Recovery-Schlüssel weiterhin getrennt auf.',kind:'good'})}catch(cause){setStatus({message:cause instanceof Error?cause.message:'Export fehlgeschlagen.',kind:'bad'})}finally{setBusy(false)}}
  async function exportBackup():Promise<void>{setBusy(true);try{const provider=providerRef.current;if(!provider)throw new Error('Verbinde zuerst das gebundene Google-Konto, damit Remote-Daten vollständig verifiziert werden.');downloadJson('eds-diary-backup.json',await createCurrentVerifiedBackup(provider.getApiClient()));setStatus({message:'Aktuelles verschlüsseltes Backup einschließlich lokaler ausstehender Änderungen wurde verifiziert und exportiert.',kind:'good'})}catch(cause){setStatus({message:cause instanceof Error?cause.message:'Backup-Export fehlgeschlagen.',kind:'bad'})}finally{setBusy(false)}}

  return (
    <details className="google-sync-settings">
      <summary className="google-sync-settings__summary">
        Datenspeicherung
        <span className="google-sync-settings__state" data-state={syncSnapshot.state}>{syncDescription(syncSnapshot)}</span>
      </summary>

      <div className="google-sync-settings__content">
        <p className="google-sync-settings__privacy">
          Fachliche Tagebuchdaten werden als verschlüsselte immutable Envelopes gespeichert. Google-Anmeldung und Tokens laufen auf einem getrennten Auth-Origin; dieser App-Origin erhält nur einen gebundenen API-Kanal.
        </p>

        {requiresEnablement ? (
          <div className="google-sync-settings__field">
            <span>Recovery-Schlüssel für die erste Remote-Epoche</span>
            <input type="text" readOnly value={recoverySecret} placeholder="Noch nicht erzeugt" aria-label="Recovery-Schlüssel" />
            <div className="google-sync-settings__actions">
              <button type="button" onClick={generateRecoverySecret} disabled={busy}>Recovery-Schlüssel erzeugen</button>
              <button type="button" onClick={() => void copyRecoverySecret()} disabled={busy || !recoverySecret}>Kopieren</button>
            </div>
            <label>
              <input type="checkbox" checked={recoverySaved} disabled={!recoverySecret || busy} onChange={(event) => setRecoverySaved(event.target.checked)} />
              Ich habe den Recovery-Schlüssel getrennt gespeichert.
            </label>
          </div>
        ) : null}

        <div className="google-sync-settings__actions">
          <button type="button" onClick={() => void connectAndSync()} disabled={busy || requiresEnablement === null || Boolean(requiresEnablement && (!recoverySecret || !recoverySaved))}>
            {requiresEnablement ? 'Google sicher aktivieren' : 'Mit Google verbinden'}
          </button>
          <button type="button" onClick={() => void synchronize()} disabled={busy || !syncSnapshot.connected}>Jetzt synchronisieren</button>
          <button type="button" onClick={() => void disconnect()} disabled={busy || !syncSnapshot.connected}>Google-Sitzung trennen</button>
        </div>

        {artifacts ? (
          <div className="google-sync-settings__actions">
            <button type="button" onClick={() => downloadJson('eds-diary-recovery.json', artifacts.recovery)}>Recovery-Artefakt herunterladen</button>
            <button type="button" onClick={() => downloadJson('eds-diary-backup.json', artifacts.backup)}>Verifiziertes Backup herunterladen</button>
          </div>
        ) : null}

        {!requiresEnablement ? <div className="google-sync-settings__actions"><button type="button" disabled={busy} onClick={()=>void exportRecovery()}>Recovery-Artefakt erneut exportieren</button><button type="button" disabled={busy||!syncSnapshot.connected} onClick={()=>void exportBackup()}>Aktuelles verifiziertes Backup exportieren</button></div> : null}
        <p><a href="?mode=recovery">Wiederherstellung in einem frischen Browserprofil öffnen</a></p>

        <p className="google-sync-settings__status" data-kind={status.kind} aria-live="polite">{status.message}</p>
      </div>
    </details>
  )
}
