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

interface RangeDraft extends RangeDetails, TimeRange {}

const MINUTES_PER_DAY = 24 * 60
const TIME_STEP_MINUTES = 15

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

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (
    hours > 24 ||
    minutes > 59 ||
    (hours === 24 && minutes !== 0)
  ) {
    return null
  }

  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.min(MINUTES_PER_DAY, minutes))
  const hours = Math.floor(safeMinutes / 60)
  const remainder = safeMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function rangeError(draft: RangeDraft | null): string {
  if (!draft) return ''

  const start = parseTime(draft.start)
  const end = parseTime(draft.end)
  if (start === null || end === null) {
    return 'Bitte Beginn und Ende im Format HH:MM eintragen.'
  }
  if (end <= start) {
    return 'Das Ende muss nach dem Beginn liegen.'
  }

  return ''
}

function durationLabel(draft: RangeDraft | null): string {
  if (!draft || rangeError(draft)) return 'Dauer noch nicht verfügbar'

  const start = parseTime(draft.start)
  const end = parseTime(draft.end)
  if (start === null || end === null) return 'Dauer noch nicht verfügbar'

  const duration = end - start
  const hours = Math.floor(duration / 60)
  const minutes = duration % 60

  if (!hours) return `${minutes} min`
  if (!minutes) return `${hours} h`
  return `${hours} h ${minutes} min`
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
  const [activeDraft, setActiveDraft] = useState<RangeDraft | null>(null)
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
    setActiveDraft(null)
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

    if (activeRangeIndex === null || !activeDraft) {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.showModal()
  }, [activeRangeIndex, activeDraft])

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

  function openRangeDetails(index: number): void {
    const range = timeRanges[index]
    if (!range) return

    const details = rangeDetails[index] ?? emptyDetails()
    setActiveRangeIndex(index)
    setActiveDraft({
      start: range.start,
      end: range.end,
      activityName: details.activityName,
      note: details.note,
    })
    setStatus('')
  }

  function openCreatedRange(index: number, range: TimeRange): void {
    setActiveRangeIndex(index)
    setActiveDraft({
      start: range.start,
      end: range.end,
      ...emptyDetails(),
    })
    setStatus('')
  }

  function discardRangeDetails(): void {
    setActiveDraft(null)
    setActiveRangeIndex(null)
  }

  function updateDraft(patch: Partial<RangeDraft>): void {
    setActiveDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function adjustDraftTime(field: 'start' | 'end', delta: number): void {
    setActiveDraft((current) => {
      if (!current) return current

      const currentMinutes = parseTime(current[field])
      const otherMinutes = parseTime(field === 'start' ? current.end : current.start)
      if (currentMinutes === null) return current

      let nextMinutes = currentMinutes + delta
      if (field === 'start') {
        const maximum =
          otherMinutes === null ? MINUTES_PER_DAY - 1 : otherMinutes - 1
        nextMinutes = Math.max(0, Math.min(maximum, nextMinutes))
      } else {
        const minimum = otherMinutes === null ? 1 : otherMinutes + 1
        nextMinutes = Math.max(minimum, Math.min(MINUTES_PER_DAY, nextMinutes))
      }

      return {
        ...current,
        [field]: formatTime(nextMinutes),
      }
    })
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
    setActiveDraft(null)
    setActiveRangeIndex(null)
    setStatus(storedRecord ? 'Aktivität entfernt.' : '')
  }

  async function applyActiveDraft(): Promise<void> {
    if (activeRangeIndex === null || !activeDraft) return

    const validationMessage = rangeError(activeDraft)
    if (validationMessage) {
      setStatus(validationMessage)
      return
    }
    if (!activeDraft.activityName.trim()) {
      setStatus('Bitte eine Aktivität eintragen.')
      return
    }

    const storedRecord = rangeRecords[activeRangeIndex]

    if (!storedRecord) {
      setTimeRanges((current) =>
        current.map((range, index) =>
          index === activeRangeIndex
            ? { start: activeDraft.start, end: activeDraft.end }
            : range,
        ),
      )
      setRangeDetails((current) =>
        current.map((details, index) =>
          index === activeRangeIndex
            ? {
                activityName: activeDraft.activityName,
                note: activeDraft.note,
              }
            : details,
        ),
      )
      setActiveDraft(null)
      setActiveRangeIndex(null)
      setStatus('')
      return
    }

    setDetailsSaving(true)
    setStatus('')

    try {
      await saveActivityEntry({
        ...storedRecord,
        startTime: activeDraft.start,
        endTime: activeDraft.end,
        activityName: activeDraft.activityName,
        note: activeDraft.note,
      })

      const storedEntries = entriesForDate(await listActivityEntries(), date)
      setTimeRanges(
        storedEntries.map((entry) => ({
          start: entry.startTime,
          end: entry.endTime,
        })),
      )
      setRangeDetails(
        storedEntries.map((entry) => ({
          activityName: entry.activityName,
          note: entry.note,
        })),
      )
      setRangeRecords(storedEntries)
      setKnownActivityNames(await listActivityNames())
      setActiveDraft(null)
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

      const storedEntries = entriesForDate(
        await listActivityEntries(),
        date,
      )
      setTimeRanges(
        storedEntries.map((entry) => ({
          start: entry.startTime,
          end: entry.endTime,
        })),
      )
      setRangeDetails(
        storedEntries.map((entry) => ({
          activityName: entry.activityName,
          note: entry.note,
        })),
      )
      setRangeRecords(storedEntries)
      setKnownActivityNames(await listActivityNames())
      setActiveDraft(null)
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

  const draftValidationMessage = rangeError(activeDraft)
  const activeRecord =
    activeRangeIndex === null ? null : rangeRecords[activeRangeIndex] ?? null
  const previewRanges =
    activeRangeIndex !== null && activeDraft && !draftValidationMessage
      ? timeRanges.map((range, index) =>
          index === activeRangeIndex
            ? { start: activeDraft.start, end: activeDraft.end }
            : range,
        )
      : timeRanges
  const unsavedCount = rangeRecords.filter((record) => record === null).length
  const canApplyDraft =
    Boolean(activeDraft?.activityName.trim()) && !draftValidationMessage

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
            rechte Hälfte. Beginn und Ende bearbeitest du zuverlässig im Editor.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={previewRanges}
        onChange={changeRanges}
        onRangeActivate={openRangeDetails}
        onRangeCreated={openCreatedRange}
        activeRangeIndex={activeRangeIndex}
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
        onCancel={(event) => {
          event.preventDefault()
          discardRangeDetails()
        }}
        onClose={discardRangeDetails}
      >
        {activeDraft && activeRangeIndex !== null ? (
          <div className="activity-page__dialog-card">
            <header className="activity-page__dialog-header">
              <div>
                <span className="activity-page__dialog-eyebrow">
                  Zeitraum {activeRangeIndex + 1}
                </span>
                <h2 id="activity-details-title">Aktivität eintragen</h2>
              </div>
              <button
                type="button"
                className="activity-page__dialog-close"
                aria-label="Details schließen"
                disabled={detailsSaving}
                onClick={discardRangeDetails}
              >
                Schließen
              </button>
            </header>

            <div className="activity-page__dialog-body">
              <fieldset className="activity-page__time-editor">
                <legend>Zeitraum</legend>

                <div className="activity-page__time-grid">
                  <div className="activity-page__time-field">
                    <label htmlFor="activity-start-time">Beginn</label>
                    <input
                      id="activity-start-time"
                      type="text"
                      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                      value={activeDraft.start}
                      aria-invalid={Boolean(draftValidationMessage)}
                      aria-describedby="activity-time-help activity-time-error"
                      onChange={(event) =>
                        updateDraft({ start: event.target.value })
                      }
                    />
                    <div className="activity-page__time-buttons">
                      <button
                        type="button"
                        aria-label="Beginn 15 Minuten früher"
                        onClick={() =>
                          adjustDraftTime('start', -TIME_STEP_MINUTES)
                        }
                      >
                        −15 min
                      </button>
                      <button
                        type="button"
                        aria-label="Beginn 15 Minuten später"
                        onClick={() =>
                          adjustDraftTime('start', TIME_STEP_MINUTES)
                        }
                      >
                        +15 min
                      </button>
                    </div>
                  </div>

                  <div className="activity-page__time-field">
                    <label htmlFor="activity-end-time">Ende</label>
                    <input
                      id="activity-end-time"
                      type="text"
                      pattern="(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
                      value={activeDraft.end}
                      aria-invalid={Boolean(draftValidationMessage)}
                      aria-describedby="activity-time-help activity-time-error"
                      onChange={(event) =>
                        updateDraft({ end: event.target.value })
                      }
                    />
                    <div className="activity-page__time-buttons">
                      <button
                        type="button"
                        aria-label="Ende 15 Minuten früher"
                        onClick={() =>
                          adjustDraftTime('end', -TIME_STEP_MINUTES)
                        }
                      >
                        −15 min
                      </button>
                      <button
                        type="button"
                        aria-label="Ende 15 Minuten später"
                        onClick={() =>
                          adjustDraftTime('end', TIME_STEP_MINUTES)
                        }
                      >
                        +15 min
                      </button>
                    </div>
                  </div>
                </div>

                <div className="activity-page__duration">
                  <span>Dauer</span>
                  <output aria-live="polite">{durationLabel(activeDraft)}</output>
                </div>

                <p id="activity-time-help" className="activity-page__time-help">
                  Uhrzeiten als HH:MM eingeben. Für das Tagesende ist 24:00
                  möglich.
                </p>
                <p
                  id="activity-time-error"
                  className="activity-page__time-error"
                  aria-live="polite"
                >
                  {draftValidationMessage}
                </p>
              </fieldset>

              <label className="activity-page__field">
                <span>Aktivität</span>
                <input
                  type="text"
                  list="activity-name-options"
                  value={activeDraft.activityName}
                  maxLength={120}
                  autoComplete="off"
                  required
                  autoFocus
                  aria-label={`Aktivität für Zeitraum ${activeRangeIndex + 1}`}
                  placeholder="z. B. Spaziergang"
                  onChange={(event) =>
                    updateDraft({ activityName: event.target.value })
                  }
                />
              </label>

              <label className="activity-page__field">
                <span>
                  Notiz <small>(optional)</small>
                </span>
                <textarea
                  value={activeDraft.note}
                  maxLength={2000}
                  rows={5}
                  aria-label={`Notiz für Zeitraum ${activeRangeIndex + 1}`}
                  placeholder="Was möchtest du zu dieser Aktivität festhalten?"
                  onChange={(event) =>
                    updateDraft({ note: event.target.value })
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
                  disabled={detailsSaving || !canApplyDraft}
                  onClick={() => void applyActiveDraft()}
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
