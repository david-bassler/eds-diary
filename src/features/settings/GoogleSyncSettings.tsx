import { useEffect, useRef, useState } from 'react'
import { base64Url, fromBase64Url, randomBytes } from '../../security/crypto/bytes'
import { canonicalJson } from '../../security/crypto/canonical'
import type { SingleWriterProviderSession } from '../../sync/core/provider'
import { GoogleSingleWriterProvider } from '../../sync/google/GoogleSingleWriterProvider'
import {
  clearAuthenticatedRemoteSession,
  enableAuthenticatedRemoteSession,
  remoteSessionStatus,
  installAuthenticatedRemoteSession,
  replaceRecoverySecret,
} from '../../data/initializeDataLayer'
import {
  getSyncSnapshot,
  onSyncState,
  syncAll,
  type SyncSnapshot,
} from '../../data/syncManager'
import './GoogleSyncSettings.css'
import { createCurrentOriginMigrationBundle, createCurrentVerifiedBackup, currentRecoveryArtifact } from '../../data/artifactExports'
import { activeRemoteDurabilityStatus, type ActiveRemoteDurabilityStatus } from '../../data/localDatabase'

type StatusKind = 'neutral' | 'good' | 'bad'
interface StatusMessage { message: string; kind: StatusKind }
interface ExportArtifacts { recovery: unknown; backup: unknown }
interface StorageSetupState { requiresEnablement: boolean; recoveryArtifactAvailable: boolean }

function syncDescription(snapshot: SyncSnapshot): string {
  if (snapshot.state === 'syncing') return 'Synchronisierung läuft …'
  if (snapshot.state === 'synced') return 'Mit Google synchronisiert.'
  if (snapshot.state === 'pending') return snapshot.connected ? 'Änderungen warten auf Synchronisierung.' : 'Nur lokal gespeichert.'
  if (snapshot.state === 'error') return 'Synchronisierung benötigt Aufmerksamkeit.'
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

async function readStorageSetupState(): Promise<StorageSetupState> {
  const value = await remoteSessionStatus()
  const recoveryArtifactAvailable = await currentRecoveryArtifact().then(
    () => true,
    () => false,
  )
  return {
    requiresEnablement: value.mode === 'local_offline',
    recoveryArtifactAvailable,
  }
}

export function GoogleSyncSettings() {
  const sessionRef = useRef<SingleWriterProviderSession | null>(null)
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [connectStage, setConnectStage] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(true)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [requiresEnablement, setRequiresEnablement] = useState<boolean | null>(null)
  const [recoveryArtifactAvailable, setRecoveryArtifactAvailable] = useState(false)
  const [recoverySecret, setRecoverySecret] = useState('')
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [artifacts, setArtifacts] = useState<ExportArtifacts | null>(null)
  const [remoteDurability, setRemoteDurability] = useState<ActiveRemoteDurabilityStatus | null>(null)
  const [replacementSecret, setReplacementSecret] = useState('')
  const [replacementSaved, setReplacementSaved] = useState(false)

  useEffect(() => {
    const refreshDurability = () => { void activeRemoteDurabilityStatus().then((value) => { if (!cancelled) setRemoteDurability(value) }).catch(() => undefined) }
    const removeSyncListener = onSyncState((snapshot) => { setSyncSnapshot(snapshot); refreshDurability() })
    let cancelled = false
    refreshDurability()

    void readStorageSetupState().then(
      (value) => {
        if (cancelled) return
        setRequiresEnablement(value.requiresEnablement)
        setRecoveryArtifactAvailable(value.recoveryArtifactAvailable)
        setPreparationError(null)
        setPreparing(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setRequiresEnablement(null)
        setPreparationError(cause instanceof Error ? cause.message : 'Unbekannter interner Fehler.')
        setPreparing(false)
      },
    )

    return () => {
      cancelled = true
      removeSyncListener()
    }
  }, [])

  function retryPreparation(): void {
    setPreparing(true)
    setPreparationError(null)
    void readStorageSetupState().then(
      (value) => {
        setRequiresEnablement(value.requiresEnablement)
        setRecoveryArtifactAvailable(value.recoveryArtifactAvailable)
        setPreparationError(null)
        setPreparing(false)
      },
      (cause: unknown) => {
        setRequiresEnablement(null)
        setPreparationError(cause instanceof Error ? cause.message : 'Unbekannter interner Fehler.')
        setPreparing(false)
      },
    )
  }

  function generateRecoverySecret(): void {
    setRecoverySecret(base64Url(randomBytes(32)))
    setRecoverySaved(false)
    setArtifacts(null)
    setStatus({
      message: 'Recovery-Schlüssel erstellt. Speichere ihn außerhalb dieser App.',
      kind: 'neutral',
    })
  }

  async function copyRecoverySecret(): Promise<void> {
    if (!recoverySecret) return
    await navigator.clipboard.writeText(recoverySecret)
    setStatus({ message: 'Recovery-Schlüssel kopiert.', kind: 'good' })
  }

  async function connectAndSync(): Promise<void> {
    setBusy(true)
    setConnectStage('Google-Anmeldung wird abgeschlossen …')
    setStatus(null)
    try {
      const authOrigin = import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string | undefined
      if (!authOrigin) throw new Error('Google-Anmeldung ist für diese Installation noch nicht konfiguriert.')
      const session = sessionRef.current ?? await new GoogleSingleWriterProvider(authOrigin).authenticate(base64Url(randomBytes(32)))
      sessionRef.current = session
      setConnectStage('Google-Konto bestätigt. Lokaler Zustand wird geprüft …')
      const remote = await remoteSessionStatus()
      if (remote.mode === 'local_offline') {
        if (!recoverySecret || !recoverySaved) {
          throw new Error('Speichere zuerst den Recovery-Schlüssel und bestätige Schritt 1.')
        }
        const urs = fromBase64Url(recoverySecret)
        if (urs.byteLength !== 32) throw new Error('Recovery-Schlüssel ist ungültig.')
        setConnectStage('Verschlüsselter Google-Speicher wird eingerichtet und verifiziert …')
        const result = await enableAuthenticatedRemoteSession(session, urs)
        setArtifacts({ recovery: result.recovery, backup: result.backup })
        setRecoveryArtifactAvailable(true)
        setRequiresEnablement(false)
      } else {
        setConnectStage('Bestehender verschlüsselter Google-Speicher wird verifiziert …')
        await installAuthenticatedRemoteSession(session)
      }
      setConnectStage('Erste Synchronisierung läuft …')
      await syncAll()
      setStatus({ message: 'Google ist verbunden und die Daten sind synchronisiert.', kind: 'good' })
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Google-Verbindung fehlgeschlagen.', kind: 'bad' })
    } finally {
      setConnectStage(null)
      setBusy(false)
    }
  }

  async function synchronize(): Promise<void> {
    setBusy(true)
    try {
      await syncAll()
      setStatus({ message: 'Synchronisierung abgeschlossen.', kind: 'good' })
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Synchronisierung fehlgeschlagen.', kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    try {
      sessionRef.current = null
      await clearAuthenticatedRemoteSession()
      setStatus({ message: 'Google-Verbindung getrennt. Deine lokalen Daten bleiben erhalten.', kind: 'neutral' })
    } finally {
      setBusy(false)
    }
  }

  async function exportRecovery(): Promise<void> {
    setBusy(true)
    try {
      downloadJson('eds-diary-recovery.json', await currentRecoveryArtifact())
      setRecoveryArtifactAvailable(true)
      setStatus({ message: 'Recovery-Datei exportiert.', kind: 'good' })
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Export fehlgeschlagen.', kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  async function exportBackup(): Promise<void> {
    setBusy(true)
    try {
      const session = sessionRef.current
      if (!session) throw new Error('Verbinde zuerst dein Google-Konto.')
      downloadJson('eds-diary-backup.json', await createCurrentVerifiedBackup(session))
      setStatus({ message: 'Aktuelles verschlüsseltes Backup exportiert.', kind: 'good' })
    } catch (cause) {
      setStatus({ message: cause instanceof Error ? cause.message : 'Backup-Export fehlgeschlagen.', kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  function generateReplacementSecret(): void {
    setReplacementSecret(base64Url(randomBytes(32)))
    setReplacementSaved(false)
    setStatus({ message: 'Neuer Recovery-Schlüssel erstellt. Speichere ihn außerhalb dieser App, bevor du den alten ersetzt.', kind: 'neutral' })
  }

  async function copyReplacementSecret(): Promise<void> {
    if (!replacementSecret) return
    await navigator.clipboard.writeText(replacementSecret)
    setStatus({ message: 'Neuer Recovery-Schlüssel kopiert.', kind: 'good' })
  }

  async function replaceRecovery(): Promise<void> {
    setBusy(true)
    try {
      const session=sessionRef.current
      if(!session)throw new Error('Verbinde zuerst dein Google-Konto.')
      if(!replacementSecret||!replacementSaved)throw new Error('Speichere den neuen Recovery-Schlüssel zuerst außerhalb dieser App.')
      const secret=fromBase64Url(replacementSecret)
      if(secret.byteLength!==32||base64Url(secret)!==replacementSecret)throw new Error('Der neue Recovery-Schlüssel ist ungültig.')
      const result=await replaceRecoverySecret(session,secret)
      setArtifacts({recovery:result.recovery,backup:result.backup})
      setRecoveryArtifactAvailable(true)
      setStatus({message:'Recovery-Schlüssel wurde ersetzt. Der neue Schlüssel und das neue Recovery-Artefakt sind verifiziert; das Artefakt ist zusätzlich im gebundenen Google-Konto gespeichert.',kind:'good'})
      setRemoteDurability(await activeRemoteDurabilityStatus())
    }catch(cause){
      setStatus({message:cause instanceof Error?cause.message:'Recovery-Schlüssel konnte nicht ersetzt werden.',kind:'bad'})
    }finally{setBusy(false)}
  }

  async function exportOriginMigration():Promise<void>{
    setBusy(true)
    try{
      const session=sessionRef.current
      if(!session)throw new Error('Verbinde zuerst dein Google-Konto.')
      downloadJson('eds-diary-origin-migration.json',await createCurrentOriginMigrationBundle(session))
      setStatus({message:'Verschlüsseltes Origin-Umzugspaket exportiert. Bewahre den Recovery-Schlüssel weiterhin getrennt davon auf.',kind:'good'})
    }catch(cause){
      setStatus({message:cause instanceof Error?cause.message:'Origin-Umzugspaket konnte nicht erstellt werden.',kind:'bad'})
    }finally{setBusy(false)}
  }

  return (
    <section className="google-sync-settings" aria-labelledby="google-sync-settings-heading">
      <header className="google-sync-settings__header">
        <div>
          <h2 id="google-sync-settings-heading">Google-Synchronisierung</h2>
          <p className="google-sync-settings__state" data-state={syncSnapshot.state}>
            {syncDescription(syncSnapshot)}
          </p>
          {remoteDurability?.pendingEnvelopeCount ? <p className="google-sync-settings__state" role="status">{remoteDurability.pendingEnvelopeCount} verschlüsselte Änderung{remoteDurability.pendingEnvelopeCount===1?' existiert':'en existieren'} derzeit nur auf diesem Gerät.</p> : remoteDurability?.remoteBound ? <p className="google-sync-settings__state">Alle lokalen Änderungen sind remote bestätigt.</p> : null}
        </div>
        {syncSnapshot.connected ? <span className="google-sync-settings__badge">Verbunden</span> : null}
      </header>

      <div className="google-sync-settings__content">
        {preparing ? (
          <div className="google-sync-settings__preparing" role="status">
            <strong>Lokale Daten werden vorbereitet …</strong>
            <span>Beim ersten Einrichten kann das einen Moment dauern.</span>
          </div>
        ) : null}

        {!preparing && preparationError ? (
          <div className="google-sync-settings__problem" role="alert">
            <strong>Google-Synchronisierung konnte noch nicht vorbereitet werden.</strong>
            <p>Deine lokalen Tagebuchdaten bleiben erhalten. Versuche die Vorbereitung erneut.</p>
            <button type="button" className="google-sync-settings__primary" onClick={retryPreparation}>
              Erneut versuchen
            </button>
            <details className="google-sync-settings__technical-error">
              <summary>Technische Details</summary>
              <code>{preparationError}</code>
            </details>
          </div>
        ) : null}

        {!preparing && !preparationError && requiresEnablement ? (
          <div className="google-sync-settings__setup">
            <div className="google-sync-settings__intro">
              <h3>Google-Konto verbinden</h3>
              <p>
                Deine Tagebuchdaten werden verschlüsselt, bevor sie dein Gerät verlassen. Die App legt dafür ein eigenes Google Sheet in deinem Konto an.
              </p>
            </div>

            <ol className="google-sync-settings__steps">
              <li className="google-sync-settings__step" data-complete={recoverySaved || undefined}>
                <span className="google-sync-settings__step-number">1</span>
                <div>
                  <strong>Recovery-Schlüssel speichern</strong>
                  <p>Damit kannst du dein Tagebuch wiederherstellen, wenn dieses Browserprofil verloren geht. Der Schlüssel wird nicht in der App gespeichert.</p>
                  {!recoverySecret ? (
                    <button type="button" className="google-sync-settings__primary" onClick={generateRecoverySecret} disabled={busy}>
                      Recovery-Schlüssel erstellen
                    </button>
                  ) : (
                    <div className="google-sync-settings__recovery">
                      <label htmlFor="google-sync-recovery-key">Recovery-Schlüssel</label>
                      <input id="google-sync-recovery-key" type="text" readOnly value={recoverySecret} />
                      <button type="button" onClick={() => void copyRecoverySecret()} disabled={busy}>Kopieren</button>
                      <label className="google-sync-settings__confirmation">
                        <input
                          type="checkbox"
                          checked={recoverySaved}
                          disabled={busy}
                          onChange={(event) => setRecoverySaved(event.target.checked)}
                        />
                        Ich habe den Schlüssel außerhalb dieser App gespeichert.
                      </label>
                    </div>
                  )}
                </div>
              </li>

              <li className="google-sync-settings__step" data-disabled={!recoverySaved || undefined}>
                <span className="google-sync-settings__step-number">2</span>
                <div>
                  <strong>Mit Google verbinden</strong>
                  <p>Du meldest dich bei Google an. Danach erstellt die App den verschlüsselten Speicher und startet die erste Synchronisierung.</p>
                  {recoverySaved ? (
                    <button type="button" className="google-sync-settings__primary" onClick={() => void connectAndSync()} disabled={busy}>
                      {busy ? (connectStage ?? 'Verbindung wird hergestellt …') : 'Mit Google verbinden'}
                    </button>
                  ) : (
                    <p className="google-sync-settings__hint">Zuerst Schritt 1 abschließen.</p>
                  )}
                </div>
              </li>
            </ol>
          </div>
        ) : null}

        {!preparing && !preparationError && requiresEnablement === false && !syncSnapshot.connected ? (
          <div className="google-sync-settings__setup">
            <div className="google-sync-settings__intro">
              <h3>Google-Konto verbinden</h3>
              <p>Dieses Tagebuch ist bereits für Google eingerichtet. Melde dich mit dem gebundenen Google-Konto an, um zu synchronisieren.</p>
            </div>
            <button type="button" className="google-sync-settings__primary" onClick={() => void connectAndSync()} disabled={busy}>
              {busy ? (connectStage ?? 'Verbindung wird hergestellt …') : 'Mit Google verbinden'}
            </button>
          </div>
        ) : null}

        {!preparing && !preparationError && syncSnapshot.connected ? (
          <div className="google-sync-settings__connected">
            <div>
              <strong>Google ist verbunden.</strong>
              <p>{syncDescription(syncSnapshot)}</p>
            </div>
            <div className="google-sync-settings__actions">
              <button type="button" className="google-sync-settings__primary" onClick={() => void synchronize()} disabled={busy}>
                Jetzt synchronisieren
              </button>
              <button type="button" onClick={() => void disconnect()} disabled={busy}>Verbindung trennen</button>
            </div>
          </div>
        ) : null}

        {artifacts ? (
          <div className="google-sync-settings__important">
            <strong>Zusätzliche Wiederherstellungskopien speichern</strong>
            <p>Das Recovery-Artefakt wurde bereits verschlüsselt im gebundenen Google-Konto abgelegt. Diese Downloads sind zusätzliche unabhängige Kopien und sollten getrennt vom Recovery-Schlüssel aufbewahrt werden.</p>
            <div className="google-sync-settings__actions">
              <button type="button" onClick={() => downloadJson('eds-diary-recovery.json', artifacts.recovery)}>Recovery-Datei herunterladen</button>
              <button type="button" onClick={() => downloadJson('eds-diary-backup.json', artifacts.backup)}>Backup herunterladen</button>
            </div>
          </div>
        ) : null}

        {status ? (
          <p className="google-sync-settings__status" data-kind={status.kind} role="status" aria-live="polite">{status.message}</p>
        ) : null}

        {!preparing && !preparationError ? (
          <details className="google-sync-settings__advanced">
            <summary>Backup &amp; Wiederherstellung</summary>
            <div className="google-sync-settings__advanced-content">
              <div className="google-sync-settings__actions">
                {recoveryArtifactAvailable ? (
                  <button type="button" disabled={busy} onClick={() => void exportRecovery()}>Recovery-Datei erneut exportieren</button>
                ) : null}
                {syncSnapshot.connected ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => void exportBackup()}>Aktuelles Backup exportieren</button>
                    <button type="button" disabled={busy} onClick={() => void exportOriginMigration()}>Origin-Umzugspaket exportieren</button>
                  </>
                ) : null}
              </div>
              {syncSnapshot.connected ? <div className="google-sync-settings__recovery">
                <strong>Recovery-Schlüssel ersetzen</strong>
                <p>Falls der bisherige Recovery-Schlüssel verloren wurde, kannst du bei entsperrtem Tagebuch einen neuen setzen. Die App wechselt erst nach vollständiger Remote-, Recovery- und Backup-Verifikation auf die neue Epoche.</p>
                {!replacementSecret ? <button type="button" disabled={busy} onClick={generateReplacementSecret}>Neuen Recovery-Schlüssel erstellen</button> : <>
                  <label htmlFor="google-sync-replacement-key">Neuer Recovery-Schlüssel</label>
                  <input id="google-sync-replacement-key" type="text" readOnly value={replacementSecret}/>
                  <button type="button" disabled={busy} onClick={() => void copyReplacementSecret()}>Kopieren</button>
                  <label className="google-sync-settings__confirmation"><input type="checkbox" checked={replacementSaved} disabled={busy} onChange={(event)=>setReplacementSaved(event.target.checked)}/> Ich habe den neuen Schlüssel außerhalb dieser App gespeichert.</label>
                  <button type="button" className="google-sync-settings__primary" disabled={busy||!replacementSaved} onClick={() => void replaceRecovery()}>Recovery-Schlüssel sicher ersetzen</button>
                </>}
              </div> : null}
              <a href="?mode=recovery">Tagebuch wiederherstellen</a>
              <details className="google-sync-settings__technical-details">
                <summary>Technische Details zur Speicherung</summary>
                <p>Die Tagebuchdaten werden als verschlüsselte, unveränderliche Datensätze gespeichert. Tokens bleiben im Auth-Handoff und werden nicht an die Datenlogik weitergegeben. Für die Produktionsfreigabe bleibt ein tatsächlich getrennter Auth-Origin erforderlich.</p>
              </details>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  )
}
