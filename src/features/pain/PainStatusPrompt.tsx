import { useEffect, useId, useRef, useState } from 'react'
import type { PainEntry } from './painEntry'
import {
  listPainEntries,
  savePainEntry,
} from './painRepository'
import './PainStatusPrompt.css'

const STALE_PAIN_THRESHOLD_MS = 60 * 60 * 1000

interface LocalDateTime {
  date: string
  time: string
}

function localDateTime(date: Date): LocalDateTime {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  }
}

function toIso(value: LocalDateTime): string | null {
  const date = new Date(`${value.date}T${value.time}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formatStartedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function latestStaleOpenEntry(
  entries: readonly PainEntry[],
  now: number,
): PainEntry | null {
  return (
    entries.find((entry) => {
      if (entry.endedAt) return false
      const startedAt = Date.parse(entry.startedAt)
      return (
        Number.isFinite(startedAt) &&
        now - startedAt > STALE_PAIN_THRESHOLD_MS
      )
    }) ?? null
  )
}

export function PainStatusPrompt() {
  const [entry, setEntry] = useState<PainEntry | null>(null)
  const [ending, setEnding] = useState(false)
  const [notingChange, setNotingChange] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [endWhen, setEndWhen] = useState<LocalDateTime>(() =>
    localDateTime(new Date()),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    let active = true

    void listPainEntries()
      .then((entries) => {
        if (!active) return
        const latest = latestStaleOpenEntry(entries, Date.now())
        if (latest) setEntry(latest)
      })
      .catch(() => {
        // Die reguläre Schmerzerfassung bleibt auch bei einem Lesefehler nutzbar.
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (entry && !dialog.open) {
      dialog.showModal()
    } else if (!entry && dialog.open) {
      dialog.close()
    }
  }, [entry])

  function keepCurrent(): void {
    setEntry(null)
    setEnding(false)
    setNotingChange(false)
    setChangeNote('')
    setError('')
  }

  function startChangeNote(): void {
    setNotingChange(true)
    setEnding(false)
    setChangeNote('')
    setError('')
  }

  function startEnding(): void {
    setEndWhen(localDateTime(new Date()))
    setEnding(true)
    setNotingChange(false)
    setError('')
  }

  async function saveChangeNote(): Promise<void> {
    if (!entry) return

    const trimmed = changeNote.trim()
    if (!trimmed) {
      setError('Bitte die Veränderung kurz beschreiben.')
      return
    }

    const timestamp = new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date())
    const addition = `Veränderung am ${timestamp}: ${trimmed}`
    const note = entry.note.trim()
      ? `${entry.note.trim()}\n\n${addition}`
      : addition

    setSaving(true)
    setError('')

    try {
      await savePainEntry({ ...entry, note })
      setEntry(null)
      setNotingChange(false)
      setChangeNote('')
    } catch {
      setError('Die Veränderung konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  async function saveEnd(): Promise<void> {
    if (!entry) return

    const endedAt = toIso(endWhen)
    if (!endedAt) {
      setError('Bitte einen gültigen Endzeitpunkt eintragen.')
      return
    }
    if (Date.parse(endedAt) <= Date.parse(entry.startedAt)) {
      setError('Der Endzeitpunkt muss nach dem Beginn liegen.')
      return
    }

    setSaving(true)
    setError('')

    try {
      await savePainEntry({ ...entry, endedAt })
      setEntry(null)
      setEnding(false)
      setNotingChange(false)
      setChangeNote('')
    } catch {
      setError('Der Endzeitpunkt konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  const qualities = entry?.qualities.join(', ') ?? ''

  return (
    <dialog
      ref={dialogRef}
      className="pain-status-prompt"
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
    >
      {entry ? (
        <div className="pain-status-prompt__card">
          <header className="pain-status-prompt__header">
            <h2 id={titleId}>Sind diese Schmerzen noch aktuell?</h2>
            <p>
              Der letzte offene Schmerzeintrag begann am{' '}
              <strong>{formatStartedAt(entry.startedAt)}</strong>.
            </p>
            {qualities ? (
              <p className="pain-status-prompt__summary">{qualities}</p>
            ) : null}
          </header>

          {ending ? (
            <div className="pain-status-prompt__body">
              <p>
                Trage ein, wann die Schmerzen geendet haben. Als Vorschlag ist
                der aktuelle Zeitpunkt eingetragen.
              </p>
              <div className="pain-status-prompt__datetime">
                <label>
                  <span>Enddatum</span>
                  <input
                    type="date"
                    value={endWhen.date}
                    disabled={saving}
                    onChange={(event) =>
                      setEndWhen((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Endzeit</span>
                  <input
                    type="time"
                    value={endWhen.time}
                    disabled={saving}
                    onChange={(event) =>
                      setEndWhen((current) => ({
                        ...current,
                        time: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <p
                className="pain-status-prompt__error"
                aria-live="polite"
              >
                {error}
              </p>

              <div className="pain-status-prompt__actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEnding(false)
                    setError('')
                  }}
                >
                  Zurück
                </button>
                <button
                  type="button"
                  className="pain-status-prompt__primary"
                  disabled={saving}
                  onClick={() => void saveEnd()}
                >
                  {saving ? 'Speichert …' : 'Ende speichern'}
                </button>
              </div>
            </div>
          ) : notingChange ? (
            <div className="pain-status-prompt__body">
              <p>
                Beschreibe kurz, was sich verändert hat. Der Text wird mit
                Zeitstempel an die vorhandenen Notizen angehängt.
              </p>

              <label className="pain-status-prompt__change">
                <span>Veränderung der Schmerzen</span>
                <textarea
                  value={changeNote}
                  maxLength={1000}
                  rows={4}
                  disabled={saving}
                  placeholder="z. B. stärker geworden, andere Region, Schmerzart verändert …"
                  onChange={(event) => setChangeNote(event.target.value)}
                />
              </label>

              <p
                className="pain-status-prompt__error"
                aria-live="polite"
              >
                {error}
              </p>

              <div className="pain-status-prompt__actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setNotingChange(false)
                    setChangeNote('')
                    setError('')
                  }}
                >
                  Zurück
                </button>
                <button
                  type="button"
                  className="pain-status-prompt__primary"
                  disabled={saving || !changeNote.trim()}
                  onClick={() => void saveChangeNote()}
                >
                  {saving ? 'Speichert …' : 'Veränderung speichern'}
                </button>
              </div>
            </div>
          ) : (
            <div className="pain-status-prompt__body">
              <p>
                Ohne Endzeitpunkt gilt der Eintrag weiterhin als andauernd.
              </p>
              <div className="pain-status-prompt__actions">
                <button
                  type="button"
                  onClick={startEnding}
                >
                  Nein, beendet
                </button>
                <button
                  type="button"
                  onClick={startChangeNote}
                >
                  Verändert
                </button>
                <button
                  type="button"
                  className="pain-status-prompt__primary"
                  onClick={keepCurrent}
                >
                  Ja, noch aktuell
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </dialog>
  )
}
