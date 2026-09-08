import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  TimeRangeColumn,
  type TimeRange,
} from '../../components/TimeRangeColumn/TimeRangeColumn'
import type { ActivityEntry } from './activityEntry'
import {
  createActivityEntries,
  deleteActivityEntry,
  listActivityEntries,
  listActivityNames,
  saveActivityEntry,
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

function entriesForDate(
  entries: readonly ActivityEntry[],
  date: string,
): ActivityEntry[] {
  return entries
    .filter((entry) => entry.date === date)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.endTime.localeCompare(right.endTime) ||
        left.updatedAt.localeCompare(right.updatedAt),
    )
}

export function ActivityPage() {
  const [date, setDate] = useState(localToday)
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([])
  const [rangeDetails, setRangeDetails] = useState<RangeDetails[]>([])
  const [rangeRecords, setRangeRecords] = useState<Array<ActivityEntry | null>>(
    [],
  )
  const [knownActivityNames, setKnownActivityNames] = useState<string[]>([])
  const [activeRangeIndex, setActiveRangeIndex] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailsSaving, setDetailsSaving] = useState(false)
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
    let active = true

    setActiveRangeIndex(null)
    setTimeRanges([])
    setRangeDetails([])
    setRangeRecords([])

    void listActivityEntries()
      .then((entries) => {
        if (!active) return

        const selectedEntries = entriesForDate(entries, date)
        setTimeRanges(
          selectedEntries.map((entry) => ({
            start: entry.startTime,
            end: entry.endTime,
          })),
        )
        setRangeDetails(
          selectedEntries.map((entry) => ({
            activityName: entry.activityName,
            note: entry.note,
          })),
        )
        setRangeRecords(selectedEntries)
      })
      .catch(() => {
        if (active) {
          setStatus('Die gespeicherten Aktivitäten konnten nicht geladen werden.')
        }
      })

    return () => {
      active = false
    }
  }, [date])

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
    setRangeRecords((current) =>
      nextRanges.map((_, index) => current[index] ?? null),
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
    if (activeRangeIndex !== null) {
      const storedRecord = rangeRecords[activeRangeIndex]
      if (storedRecord) {
        setRangeDetails((current) =>
          current.map((details, index) =>
            index === activeRangeIndex
              ? {
                  activityName: storedRecord.activityName,
                  note: storedRecord.note,
                }
              : details,
          ),
        )
      }
    }

    setActiveRangeIndex(null)
  }

  async function removeRange(index: number): Promise<void> {
    const storedRecord = rangeRecords[index]

    if (storedRecord) {
      setDetailsSaving(true)

      try {
        await deleteActivityEntry(storedRecord.id)
      } catch {
        setStatus('Die Aktivität konnte nicht entfernt werden.')
        setDetailsSaving(false)
        return
      }

      setDetailsSaving(false)
    }

    setTimeRanges((current) =>
      current.filter((_, rangeIndex) => rangeIndex !== index),
    )
    setRangeDetails((current) =>
      current.filter((_, detailsIndex) => detailsIndex !== index),
    )
    setRangeRecords((current) =>
      current.filter((_, recordIndex) => recordIndex !== index),
    )
    setActiveRangeIndex(null)
    setStatus(storedRecord ? 'Aktivität entfernt.' : '')
  }

  async function saveActiveDetails(): Promise<void> {
    if (activeRangeIndex === null) return

    const storedRecord = rangeRecords[activeRangeIndex]
    if (!storedRecord) {
      setActiveRangeIndex(null)
      return
    }

    const details = rangeDetails[activeRangeIndex] ?? emptyDetails()
    if (!details.activityName.trim()) {
      setStatus('Bitte eine Aktivität eintragen.')
      return
    }

    setDetailsSaving(true)
    setStatus('')

    try {
      const saved = await saveActivityEntry({
        ...storedRecord,
        activityName: details.activityName,
        note: details.note,
      })

      setRangeRecords((current) =>
        current.map((record, index) =>
          index === activeRangeIndex ? saved : record,
        ),
      )
      setRangeDetails((current) =>
        current.map((entryDetails, index) =>
          index === activeRangeIndex
            ? {
                activityName: saved.activityName,
                note: saved.note,
              }
            : entryDetails,
        ),
      )
      setKnownActivityNames(await listActivityNames())
      setActiveRangeIndex(null)
      setStatus('Aktivität aktualisiert.')
    } catch {
      setStatus('Die Aktivität konnte nicht aktualisiert werden.')
    } finally {
      setDetailsSaving(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!date) {
      setStatus('Bitte ein Datum wählen.')
      return
    }

    const unsavedIndexes = rangeRecords.flatMap((record, index) =>
      record ? [] : [index],
    )

    if (!unsavedIndexes.length) {
      setStatus('Alle Aktivitäten für dieses Datum sind bereits gespeichert.')
      return
    }

    const missingActivityIndex = unsavedIndexes.find(
      (index) => !rangeDetails[index]?.activityName.trim(),
    )
    if (missingActivityIndex !== undefined) {
      setStatus(
        `Bitte für Zeitraum ${missingActivityIndex + 1} eine Aktivität eintragen. Öffne dazu die rechte Hälfte des Zeitraums.`,
      )
      return
    }

    setSaving(true)
    setStatus('')

    try {
      const createdEntries = await createActivityEntries(
        unsavedIndexes.map((index) => ({
          date,
          startTime: timeRanges[index]?.start ?? '',
          endTime: timeRanges[index]?.end ?? '',
          activityName: rangeDetails[index]?.activityName ?? '',
          note: rangeDetails[index]?.note ?? '',
        })),
      )

      const createdByIndex = new Map(
        unsavedIndexes.map((index, createdIndex) => [
          index,
          createdEntries[createdIndex],
        ]),
      )

      setRangeRecords((current) =>
        current.map(
          (record, index) => record ?? createdByIndex.get(index) ?? null,
        ),
      )
      setKnownActivityNames(await listActivityNames())
      setActiveRangeIndex(null)
      setStatus(
        createdEntries.length === 1
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
  const activeRecord =
    activeRangeIndex === null ? null : rangeRecords[activeRangeIndex] ?? null
  const unsavedCount = rangeRecords.filter((record) => record === null).length

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
            Gespeicherte Aktivitäten bleiben für das gewählte Datum sichtbar.
            Neue Zeiträume öffnen sich direkt; bestehende öffnest du über ihre
            rechte Hälfte.
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

      {unsavedCount ? (
        <div className="activity-page__footer">
          <button
            className="activity-page__primary"
            type="submit"
            disabled={saving}
          >
            {saving
              ? 'Speichert …'
              : unsavedCount === 1
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
                disabled={detailsSaving}
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
                  disabled={detailsSaving}
                  onClick={() => void removeRange(activeRangeIndex)}
                >
                  Zeitraum entfernen
                </button>
                <button
                  type="button"
                  className="activity-page__primary"
                  disabled={detailsSaving}
                  onClick={() =>
                    activeRecord
                      ? void saveActiveDetails()
                      : setActiveRangeIndex(null)
                  }
                >
                  {detailsSaving
                    ? 'Speichert …'
                    : activeRecord
                      ? 'Änderungen speichern'
                      : 'Fertig'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </form>
  )
}
