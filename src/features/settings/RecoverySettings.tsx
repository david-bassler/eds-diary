import { useRef, useState } from 'react'
import { fromBase64Url, base64Url, randomBytes } from '../../security/crypto/bytes'
import { parseCanonicalJson } from '../../security/crypto/canonical'
import { recoverRootKeyCandidate, activateRecoveredRoot, type RecoveryArtifact } from '../../security/recovery'
import type { SyncBackupV5 } from '../../security/backup'
import { DOMAIN_SCHEMA_REGISTRY } from '../../data/localDatabase'
import { persistRecoveredProfile } from '../../data/recoveryProfile'
import { IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../../sync/core/remoteVerifier'
import { GoogleAuthProvider } from '../../sync/google/GoogleAuthProvider'
import { GoogleSheetsSingleWriterTransport, epochLocator } from '../../sync/google/GoogleSheetsSingleWriterTransport'
import './RecoverySettings.css'

type Method = 'backup' | 'google'

async function readJson(file: File, maximum: number): Promise<unknown> {
  if (file.size <= 0 || file.size > maximum) throw new Error('Die Datei ist leer oder überschreitet die erlaubte Größe.')
  return parseCanonicalJson(new Uint8Array(await file.arrayBuffer()))
}

export function RecoverySettings() {
  const providerRef = useRef<GoogleAuthProvider | null>(null)
  const [method, setMethod] = useState<Method>('backup')
  const [urs, setUrs] = useState('')
  const [artifact, setArtifact] = useState<File | null>(null)
  const [backup, setBackup] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Die Wiederherstellung ist nur in einem frischen Browserprofil möglich.')

  async function restore(): Promise<void> {
    setBusy(true)
    try {
      if (!artifact) throw new Error('Wähle ein Recovery-Artefakt aus.')
      const secret = fromBase64Url(urs.trim())
      if (secret.byteLength !== 32 || base64Url(secret) !== urs.trim()) throw new Error('Der Recovery-Schlüssel muss kanonisch Base64URL-kodierte 32 Byte enthalten.')
      const artifactValue = await readJson(artifact, 65_536) as RecoveryArtifact
      const candidate = await recoverRootKeyCandidate(artifactValue, secret)
      let authority: IndependentBootstrapAuthority
      if (method === 'backup') {
        if (!backup) throw new Error('Wähle die unabhängig gespeicherte Backup-Datei aus.')
        authority = await IndependentBootstrapAuthority.fromIndependentBackup(await readJson(backup, 256 * 1024 * 1024) as SyncBackupV5)
      } else {
        const authOrigin = import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string | undefined
        if (!authOrigin) throw new Error('Der separate Google-Auth-Origin ist nicht konfiguriert.')
        const provider = providerRef.current ?? new GoogleAuthProvider(authOrigin)
        providerRef.current = provider
        await provider.authenticate(base64Url(randomBytes(32)))
        const transport = await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(provider.getApiClient(), candidate.payload.diary_id, candidate.payload.epoch_id)
        const locator = await epochLocator(candidate.payload.diary_id, candidate.payload.epoch_id)
        const discovered = await transport.discover(locator)
        if (discovered.length !== 1) throw new Error('Die authentifizierte Google-Suche ergab keine eindeutige Recovery-Ressource.')
        authority = await IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(transport, locator, discovered[0]!.remoteId)
      }
      const verifier = new RecoveryBootstrapVerifier({ authority, schemas: DOMAIN_SCHEMA_REGISTRY })
      await activateRecoveredRoot(candidate, verifier, (verifiedCandidate, bootstrap) => persistRecoveredProfile(verifiedCandidate, bootstrap, DOMAIN_SCHEMA_REGISTRY))
      setStatus('Wiederherstellung und vollständiger lokaler Readback waren erfolgreich. Die App wird neu geladen; richte danach einen neuen starken lokalen Schutz ein.')
      window.setTimeout(() => { location.href = '/configuration' }, 800)
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Wiederherstellung fehlgeschlagen.')
    } finally { setBusy(false) }
  }

  return <main className="recovery-settings">
    <h1>Tagebuch wiederherstellen</h1>
    <p>Recovery-Schlüssel und Recovery-Artefakt müssen getrennt aufbewahrt werden. Ein Backup enthält ausschließlich verschlüsselte Daten und ersetzt den Recovery-Schlüssel nicht.</p>
    <fieldset disabled={busy}>
      <legend>Vertrauenswürdige Datenquelle</legend>
      <label><input type="radio" name="recovery-method" checked={method === 'backup'} onChange={() => setMethod('backup')} /> Verifiziertes Backup</label>
      <label><input type="radio" name="recovery-method" checked={method === 'google'} onChange={() => setMethod('google')} /> Authentifiziertes Google-Konto</label>
    </fieldset>
    <label>Recovery-Schlüssel<input value={urs} onChange={(event) => setUrs(event.target.value)} autoComplete="off" spellCheck={false} /></label>
    <label>Recovery-Artefakt<input type="file" accept="application/json,.json" onChange={(event) => setArtifact(event.target.files?.[0] ?? null)} /></label>
    {method === 'backup' ? <label>Backup-Datei<input type="file" accept="application/json,.json,.syncbackup" onChange={(event) => setBackup(event.target.files?.[0] ?? null)} /></label> : null}
    <button type="button" disabled={busy || !urs || !artifact || (method === 'backup' && !backup)} onClick={() => void restore()}>Strikt prüfen und wiederherstellen</button>
    <p role="status" aria-live="polite">{status}</p>
  </main>
}
