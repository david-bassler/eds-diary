import { useEffect, useState } from 'react'
import {
  connectGoogle,
  createSpreadsheet,
  getGoogleConfig,
  googleSheetUrl,
  isGoogleConnected,
  onGoogleConnection,
  onGoogleStatus,
  setGoogleConfig,
  type GoogleStatusKind,
} from '../../data/googleSheets'
import {
  getSyncSnapshot,
  onSyncState,
  syncAll,
  type SyncSnapshot,
} from '../../data/syncManager'
import { painSheetSpecs } from '../pain/painSync'
import './GoogleSyncSettings.css'

interface StatusMessage {
  message: string
  kind: GoogleStatusKind
}

function syncDescription(snapshot: SyncSnapshot): string {
  if (snapshot.state === 'syncing') return 'Synchronisierung läuft …'
  if (snapshot.state === 'synced') return 'Lokal und mit Google Sheets synchronisiert.'
  if (snapshot.state === 'pending') {
    return snapshot.connected
      ? 'Lokal gespeichert · Synchronisierung steht aus.'
      : 'Lokal gespeichert · wartet auf Google.'
  }
  if (snapshot.state === 'error') {
    return snapshot.error?.message ?? 'Synchronisierung fehlgeschlagen.'
  }
  return 'Nur lokal in diesem Browser gespeichert.'
}

export function GoogleSyncSettings() {
  const [form, setForm] = useState(getGoogleConfig)
  const [connected, setConnected] = useState(isGoogleConnected)
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot)
  const [status, setStatus] = useState<StatusMessage>({
    message: 'Nicht verbunden. Lokale Speicherung ist aktiv.',
    kind: 'neutral',
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const removeConnectionListener = onGoogleConnection(setConnected)
    const removeStatusListener = onGoogleStatus((message, kind) => {
      setStatus({ message, kind })
    })
    const removeSyncListener = onSyncState(setSyncSnapshot)

    return () => {
      removeConnectionListener()
      removeStatusListener()
      removeSyncListener()
    }
  }, [])

  function saveConfig(): void {
    const saved = setGoogleConfig(form)
    setForm(saved)
    setStatus({
      message: 'Spreadsheet-ID wurde lokal gespeichert.',
      kind: 'good',
    })
  }

  function connect(): void {
    try {
      const saved = setGoogleConfig(form)
      setForm(saved)
      connectGoogle()
    } catch (cause) {
      setStatus({
        message: cause instanceof Error ? cause.message : 'Google-Verbindung fehlgeschlagen.',
        kind: 'bad',
      })
    }
  }

  async function createSheet(): Promise<void> {
    setBusy(true)
    try {
      const saved = setGoogleConfig(form)
      setForm(saved)

      if (
        saved.sheetId &&
        !window.confirm(
          'Es ist bereits eine Spreadsheet-ID eingetragen. Wirklich ein neues EDS-Schmerztagebuch anlegen?',
        )
      ) {
        return
      }

      const created = await createSpreadsheet(painSheetSpecs)
      setForm(created)
      await syncAll()
      setStatus({
        message: 'Privates EDS-Schmerztagebuch wurde angelegt und synchronisiert.',
        kind: 'good',
      })
    } catch (cause) {
      setStatus({
        message: cause instanceof Error ? cause.message : 'Spreadsheet konnte nicht angelegt werden.',
        kind: 'bad',
      })
    } finally {
      setBusy(false)
    }
  }

  async function synchronize(): Promise<void> {
    setBusy(true)
    try {
      setGoogleConfig(form)
      await syncAll()
    } catch (cause) {
      setStatus({
        message: cause instanceof Error ? cause.message : 'Synchronisierung fehlgeschlagen.',
        kind: 'bad',
      })
    } finally {
      setBusy(false)
    }
  }

  const sheetLink = googleSheetUrl()

  return (
    <details className="google-sync-settings">
      <summary className="google-sync-settings__summary">
        Datenspeicherung
        <span
          className="google-sync-settings__state"
          data-state={syncSnapshot.state}
        >
          {syncDescription(syncSnapshot)}
        </span>
      </summary>

      <div className="google-sync-settings__content">
        <p className="google-sync-settings__privacy">
          Tagebuchdaten werden zuerst lokal in IndexedDB gespeichert. Google Sheets
          ist eine optionale Synchronisierung; der Google Access Token bleibt nur
          im Arbeitsspeicher.
        </p>

        <label className="google-sync-settings__field">
          <span>Spreadsheet-ID</span>
          <input
            type="text"
            autoComplete="off"
            value={form.sheetId}
            placeholder="ID oder vollständige Google-Sheets-URL"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sheetId: event.target.value,
              }))
            }
          />
        </label>

        <div className="google-sync-settings__actions">
          <button type="button" onClick={saveConfig} disabled={busy}>
            Einstellungen speichern
          </button>
          <button type="button" onClick={connect} disabled={busy}>
            Mit Google verbinden
          </button>
          <button type="button" onClick={() => void createSheet()} disabled={busy || !connected}>
            Neues Sheet anlegen
          </button>
          <button
            type="button"
            onClick={() => void synchronize()}
            disabled={busy || !connected || !form.sheetId.trim()}
          >
            Jetzt synchronisieren
          </button>
        </div>

        <p
          className="google-sync-settings__status"
          data-kind={status.kind}
          aria-live="polite"
        >
          {status.message}
        </p>

        {sheetLink ? (
          <a
            className="google-sync-settings__link"
            href={sheetLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Sheet öffnen
          </a>
        ) : null}
      </div>
    </details>
  )
}
