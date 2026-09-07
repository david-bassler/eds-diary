import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  TimeRangeColumn,
  type TimeRange,
} from '../../components/TimeRangeColumn/TimeRangeColumn'
import {
  createActivityEntries,
  listActivityNames,
} from './activityRepository'
import './ActivityPage.css'

interface RangeDetails {
  activityName: string
  note: string
}

function emptyDetails(): RangeDetails {
  return {
    activityName: '',
    note: '',
  }
}

function localToday(): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function ActivityPage() {
  const [date, setDate] = useState(localToday)
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([])
  const [rangeDetails, setRangeDetails] = useState<RangeDetails[]>([])
  const [knownActivityNames, setKnownActivityNames] = useState<string[]>([])
  const [activeRangeIndex, setActiveRangeIndex] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const detailsDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true

    void listActivityNames().then((names) => {
      if (active) setKnownActivityNames(names)
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const dialog = detailsDialogRef.current
    if (!dialog) return

    if (activeRangeIndex === null) {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.showModal()
  }, [activeRangeIndex])

  function changeRanges(nextRanges: TimeRange[]): void {
    setTimeRanges(nextRanges)
    setRangeDetails((current) =>
      nextRanges.map((_, index) => current[index] ?? emptyDetails()),
    )
    setStatus('')
  }

  function updateDetails(
    index: number,
    patch: Partial<RangeDetails>,
  ): void {
    setRangeDetails((current) =>
      current.map((details, detailsIndex) =>
        detailsIndex === index ? { ...details, ...patch } : details,
      ),
    )
  }

  function openRangeDetails(index: number): void {
    setActiveRangeIndex(index)
    setStatus('')
  }

  function closeRangeDetails(): void {
    setActiveRangeIndex(null)
  }

  function removeRange(index: number): void {
    setTimeRanges((current) =>
      current.filter((_, rangeIndex) => rangeIndex !== index),
    )
    setRangeDetails((current) =>
      current.filter((_, detailsIndex) => detailsIndex !== index),
    )
    setActiveRangeIndex(null)
    setStatus('')
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!date) {
      setStatus('Bitte ein Datum wählen.')
      return
    }

    if (!timeRanges.length) {
      setStatus('Bitte mindestens einen Zeitraum auswählen.')
      return
    }

    const missingActivityIndex = rangeDetails.findIndex(
      (details) => !details.activityName.trim(),
    )
    if (missingActivityIndex >= 0) {
      setStatus(
        `Bitte für Zeitraum ${missingActivityIndex + 1} eine Aktivität eintragen. Öffne dazu die rechte Hälfte des Zeitraums.`,
      )
      return
    }

    setSaving(true)
    setStatus('')

    try {
      await createActivityEntries(
        timeRanges.map((range, index) => ({
          date,
          startTime: range.start,
          endTime: range.end,
          activityName: rangeDetails[index]?.activityName ?? '',
          note: rangeDetails[index]?.note ?? '',
        })),
      )

      setKnownActivityNames(await listActivityNames())
      setTimeRanges([])
      setRangeDetails([])
      setActiveRangeIndex(null)
      setStatus(
        timeRanges.length === 1
          ? 'Aktivität gespeichert.'
          : 'Aktivitäten gespeichert.',
      )
    } catch {
      setStatus('Die Aktivitäten konnten lokal nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  const activeRange =
    activeRangeIndex === null ? null : timeRanges[activeRangeIndex] ?? null
  const activeDetails =
    activeRangeIndex === null
      ? null
      : rangeDetails[activeRangeIndex] ?? emptyDetails()

  return (
    <form className="activity-page" onSubmit={(event) => void submit(event)}>
      <label className="activity-page__date">
        <span>Datum</span>
        <input
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>

      <section
        className="activity-page__intro"
        aria-labelledby="activity-time-title"
      >
        <div>
          <h2 id="activity-time-title">Zeiträume der Aktivität</h2>
          <p>
            Wähle einen oder mehrere Zeiträume aus. Nach dem Erstellen öffnet
            sich die Aktivität. Später kannst du sie über die rechte Hälfte des
            Zeitraums wieder öffnen.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={timeRanges}
        onChange={changeRanges}
        onRangeActivate={openRangeDetails}
        onRangeCreated={openRangeDetails}
        label="Aktivitätszeiträume"
      />

      <datalist id="activity-name-options">
        {knownActivityNames.map((name) => (
          <option key={name.toLocaleLowerCase('de')} value={name} />
        ))}
      </datalist>

      {timeRanges.length ? (
        <div className="activity-page__footer">
          <button
            className="activity-page__primary"
            type="submit"
            disabled={saving}
          >
            {saving
              ? 'Speichert …'
              : timeRanges.length === 1
                ? 'Aktivität speichern'
                : 'Aktivitäten speichern'}
          </button>
        </div>
      ) : null}

      <p className="activity-page__status" aria-live="polite">
        {status}
      </p>

      <dialog
        ref={detailsDialogRef}
        className="activity-page__dialog"
        aria-labelledby="activity-details-title"
        onClose={closeRangeDetails}
      >
        {activeRange && activeDetails && activeRangeIndex !== null ? (
          <div className="activity-page__dialog-card">
            <header className="activity-page__dialog-header">
              <div>
                <span className="activity-page__dialog-eyebrow">
                  Zeitraum {activeRangeIndex + 1} · {activeRange.start}–
                  {activeRange.end}
                </span>
                <h2 id="activity-details-title">Aktivität eintragen</h2>
              </div>
              <button
                type="button"
                className="activity-page__dialog-close"
                aria-label="Details schließen"
                onClick={closeRangeDetails}
              >
                Schließen
              </button>
            </header>

            <div className="activity-page__dialog-body">
              <label className="activity-page__field">
                <span>Aktivität</span>
                <input
                  type="text"
                  list="activity-name-options"
                  value={activeDetails.activityName}
                  maxLength={120}
                  autoComplete="off"
                  required
                  autoFocus
                  aria-label={`Aktivität für Zeitraum ${activeRangeIndex + 1}`}
                  placeholder="z. B. Spaziergang"
                  onChange={(event) =>
                    updateDetails(activeRangeIndex, {
                      activityName: event.target.value,
                    })
                  }
                />
              </label>

              <label className="activity-page__field">
                <span>
                  Notiz <small>(optional)</small>
                </span>
                <textarea
                  value={activeDetails.note}
                  maxLength={2000}
                  rows={5}
                  aria-label={`Notiz für Zeitraum ${activeRangeIndex + 1}`}
                  placeholder="Was möchtest du zu dieser Aktivität festhalten?"
                  onChange={(event) =>
                    updateDetails(activeRangeIndex, {
                      note: event.target.value,
                    })
                  }
                />
              </label>

              <div className="activity-page__dialog-actions">
                <button
                  type="button"
                  className="activity-page__remove"
                  onClick={() => removeRange(activeRangeIndex)}
                >
                  Zeitraum entfernen
                </button>
                <button
                  type="button"
                  className="activity-page__primary"
                  onClick={closeRangeDetails}
                >
                  Fertig
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </form>
  )
}
