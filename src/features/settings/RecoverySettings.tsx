import { useRef, useState } from 'react'
import { fromBase64Url, base64Url, randomBytes } from '../../security/crypto/bytes'
import { parseStrictJson } from '../../security/crypto/canonical'
import { recoverRootKeyCandidate, activateRecoveredRoot, type RecoveryArtifact } from '../../security/recovery'
import type { SyncBackupV5 } from '../../security/backup'
import type { SyncBackupV6 } from '../../security/v2/backup'
import { restoreV2BackupLocally } from '../../data/initializeDataLayer'
import { assertOriginMigrationBundle, type OriginMigrationBundleV1 } from '../../security/originMigration'
import { DOMAIN_SCHEMA_REGISTRY } from '../../data/localDatabase'
import { persistRecoveredProfile } from '../../data/recoveryProfile'
import { IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../../sync/core/remoteVerifier'
import type { SingleWriterProviderSession } from '../../sync/core/provider'
import { GoogleSingleWriterProvider } from '../../sync/google/GoogleSingleWriterProvider'
import './RecoverySettings.css'

type Method = 'backup' | 'backup-v2' | 'google' | 'migration'

async function readJson(file: File, maximum: number): Promise<unknown> {
  if (file.size <= 0 || file.size > maximum) throw new Error('Die Datei ist leer oder überschreitet die erlaubte Größe.')
  return parseStrictJson(new Uint8Array(await file.arrayBuffer()))
}

export function RecoverySettings() {
  const sessionRef = useRef<SingleWriterProviderSession | null>(null)
  const [method, setMethod] = useState<Method>('backup')
  const [urs, setUrs] = useState('')
  const [artifact, setArtifact] = useState<File | null>(null)
  const [backup, setBackup] = useState<File | null>(null)
  const [migrationBundle, setMigrationBundle] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Die Wiederherstellung ist nur in einem frischen Browserprofil möglich.')

  async function restore(): Promise<void> {
    setBusy(true)
    try {
      const secret = fromBase64Url(urs.trim())
      if (secret.byteLength !== 32 || base64Url(secret) !== urs.trim()) throw new Error('Der Recovery-Schlüssel muss kanonisch Base64URL-kodierte 32 Byte enthalten.')
      if(method==='backup-v2'){
        if(!backup)throw new Error('Wähle die V2-Backup-Datei aus.')
        const value=await readJson(backup,256*1024*1024) as SyncBackupV6
        const restored=await restoreV2BackupLocally(value,secret)
        setStatus(`V2-Backup lokal und read-only wiederhergestellt (Epoche ${restored.epochId}). Es wurde keine Writer-Authority und keine Google-Verbindung aktiviert.`)
        window.setTimeout(() => { location.href = '/configuration' }, 800)
        return
      }
      let artifactValue:RecoveryArtifact
      let authority:IndependentBootstrapAuthority
      if(method==='google'){
        const authOrigin = import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string | undefined
        if (!authOrigin) throw new Error('Der Google-Auth-Handoff ist nicht konfiguriert.')
        const session = sessionRef.current ?? await new GoogleSingleWriterProvider(authOrigin).authenticate(base64Url(randomBytes(32)))
        sessionRef.current = session
        artifactValue=await session.loadRecoveryArtifact(secret)
        const candidate=await recoverRootKeyCandidate(artifactValue,secret)
        const transport = await session.transportForEpoch(candidate.payload.diary_id, candidate.payload.epoch_id)
        const locator = await session.recoveryLocator(candidate.payload.diary_id, candidate.payload.epoch_id)
        const discovered = await transport.discover(locator)
        if (discovered.length !== 1) throw new Error('Die authentifizierte Google-Suche ergab keine eindeutige Recovery-Ressource.')
        authority = await session.recoveryAuthority(transport, locator, discovered[0]!.remoteId)
      }else if(method==='migration'){
        if(!migrationBundle)throw new Error('Wähle das Origin-Umzugspaket aus.')
        const value=await readJson(migrationBundle,257*1024*1024) as unknown
        assertOriginMigrationBundle(value)
        const bundle=value as OriginMigrationBundleV1
        artifactValue=bundle.recovery
        authority=await IndependentBootstrapAuthority.fromIndependentBackup(bundle.backup)
      }else{
        if (!artifact) throw new Error('Wähle ein Recovery-Artefakt aus.')
        if (!backup) throw new Error('Wähle die unabhängig gespeicherte Backup-Datei aus.')
        artifactValue=await readJson(artifact,65_536) as RecoveryArtifact
        authority=await IndependentBootstrapAuthority.fromIndependentBackup(await readJson(backup,256*1024*1024) as SyncBackupV5)
      }
      const candidate = await recoverRootKeyCandidate(artifactValue, secret)
      const verifier = new RecoveryBootstrapVerifier({ authority, schemas: DOMAIN_SCHEMA_REGISTRY })
      await activateRecoveredRoot(candidate, verifier, (verifiedCandidate, bootstrap) => persistRecoveredProfile(verifiedCandidate, bootstrap, DOMAIN_SCHEMA_REGISTRY, { recoveryArtifact: artifactValue }))
      setStatus('Wiederherstellung und vollständiger lokaler Readback waren erfolgreich. Die App wird neu geladen; richte danach einen neuen starken lokalen Schutz ein.')
      window.setTimeout(() => { location.href = '/configuration' }, 800)
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Wiederherstellung fehlgeschlagen.')
    } finally { setBusy(false) }
  }

  return <main className="recovery-settings">
    <h1>Tagebuch wiederherstellen</h1>
    <p>Der Recovery-Schlüssel bleibt außerhalb der App. Bei Google-Recovery wird das dazugehörige verschlüsselte Recovery-Artefakt automatisch im gebundenen Konto gefunden; für unabhängige Backups oder einen Origin-Umzug kann es weiterhin als Datei mitgeführt werden.</p>
    <fieldset disabled={busy}>
      <legend>Vertrauenswürdige Datenquelle</legend>
      <label><input type="radio" name="recovery-method" checked={method === 'backup'} onChange={() => setMethod('backup')} /> Verifiziertes Backup (v1)</label>
      <label><input type="radio" name="recovery-method" checked={method === 'backup-v2'} onChange={() => setMethod('backup-v2')} /> Transferable Single Writer v2 Backup (lokal read-only)</label>
      <label><input type="radio" name="recovery-method" checked={method === 'google'} onChange={() => setMethod('google')} /> Authentifiziertes Google-Konto (Artefakt automatisch finden)</label>
      <label><input type="radio" name="recovery-method" checked={method === 'migration'} onChange={() => setMethod('migration')} /> Origin-Umzugspaket verwenden</label>
    </fieldset>
    <label>Recovery-Schlüssel<input value={urs} onChange={(event) => setUrs(event.target.value)} autoComplete="off" spellCheck={false} /></label>
    {method === 'backup' ? <>
      <label>Recovery-Artefakt<input type="file" accept="application/json,.json" onChange={(event) => setArtifact(event.target.files?.[0] ?? null)} /></label>
      <label>Backup-Datei<input type="file" accept="application/json,.json,.syncbackup" onChange={(event) => setBackup(event.target.files?.[0] ?? null)} /></label>
    </> : null}
    {method === 'backup-v2' ? <label>V2-Backup-Datei<input type="file" accept="application/json,.json,.syncbackup" onChange={(event) => setBackup(event.target.files?.[0] ?? null)} /></label> : null}
    {method === 'migration' ? <label>Origin-Umzugspaket-Datei<input type="file" accept="application/json,.json" onChange={(event) => setMigrationBundle(event.target.files?.[0] ?? null)} /></label> : null}
    <button type="button" disabled={busy || !urs || (method === 'backup' && (!artifact || !backup)) || (method === 'backup-v2' && !backup) || (method === 'migration' && !migrationBundle)} onClick={() => void restore()}>Strikt prüfen und wiederherstellen</button>
    <p role="status" aria-live="polite">{status}</p>
  </main>
}
