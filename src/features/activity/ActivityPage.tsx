import { type FormEvent, useEffect, useState } from 'react'
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
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    void listActivityNames().then((names) => {
      if (active) setKnownActivityNames(names)
    })

    return () => {
      active = false
    }
  }, [])

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

  function removeRange(index: number): void {
    setTimeRanges((current) =>
      current.filter((_, rangeIndex) => rangeIndex !== index),
    )
    setRangeDetails((current) =>
      current.filter((_, detailsIndex) => detailsIndex !== index),
    )
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
        `Bitte für Zeitraum ${missingActivityIndex + 1} eine Aktivität eintragen.`,
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
            Wähle einen oder mehrere Zeiträume aus. Für jeden Zeitraum kannst
            du anschließend eine eigene Aktivität und Notiz eintragen.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={timeRanges}
        onChange={changeRanges}
        label="Aktivitätszeiträume"
      />

      <datalist id="activity-name-options">
        {knownActivityNames.map((name) => (
          <option key={name.toLocaleLowerCase('de')} value={name} />
        ))}
      </datalist>

      {timeRanges.length ? (
        <section
          className="activity-page__details"
          aria-labelledby="activity-details-title"
        >
          <div className="activity-page__details-intro">
            <h2 id="activity-details-title">Aktivitäten eintragen</h2>
            <p>
              Jede ausgewählte Zeitspanne bekommt ihre eigene Aktivität und
              optionale Notiz.
            </p>
          </div>

          {timeRanges.map((range, index) => {
            const details = rangeDetails[index] ?? emptyDetails()

            return (
              <fieldset className="activity-page__range" key={index}>
                <legend>
                  Zeitraum {index + 1} · {range.start}–{range.end}
                </legend>

                <label className="activity-page__field">
                  <span>Aktivität</span>
                  <input
                    type="text"
                    list="activity-name-options"
                    value={details.activityName}
                    maxLength={120}
                    autoComplete="off"
                    required
                    aria-label={`Aktivität für Zeitraum ${index + 1}`}
                    placeholder="z. B. Spaziergang"
                    onChange={(event) =>
                      updateDetails(index, {
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
                    value={details.note}
                    maxLength={2000}
                    rows={3}
                    aria-label={`Notiz für Zeitraum ${index + 1}`}
                    placeholder="Was möchtest du zu dieser Aktivität festhalten?"
                    onChange={(event) =>
                      updateDetails(index, { note: event.target.value })
                    }
                  />
                </label>

                <div className="activity-page__range-actions">
                  <button
                    type="button"
                    onClick={() => removeRange(index)}
                  >
                    Zeitraum entfernen
                  </button>
                </div>
              </fieldset>
            )
          })}

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
        </section>
      ) : null}

      <p className="activity-page__status" aria-live="polite">
        {status}
      </p>
    </form>
  )
}
