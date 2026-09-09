import { useEffect, useRef, useState } from 'react'
import {
  CopyDayDialog,
  type CopyDayItem,
} from '../../components/CopyDayDialog/CopyDayDialog'
import {
  TimeRangeColumn,
  type TimeRange,
} from '../../components/TimeRangeColumn/TimeRangeColumn'
import type { ActivityEntry } from './activityEntry'
import {
  ACTIVITY_PASTEL_COLORS,
  defaultActivityColor,
  normalizeActivityColor,
  sameActivityType,
} from './activityColors'
import {
  createActivityEntries,
  deleteActivityEntry,
  listActivityEntries,
  listActivityTypes,
  replaceActivityEntries,
  replaceActivityTypes,
  saveActivityEntry,
  saveActivityTypeColor,
  type ActivityType,
} from './activityRepository'
import './ActivityPage.css'

interface RangeDetails {
  activityName: string
  color: string
  note: string
  isOngoing: boolean
}

interface RangeDraft extends RangeDetails, TimeRange {}

interface ActivityHistorySnapshot {
  entries: ActivityEntry[]
  types: ActivityType[]
}

const HISTORY_LIMIT = 40
const ACTIVITY_SCROLL_SNAP_DISTANCE = 120
const ACTIVITY_SCROLL_SNAP_DELAY_MS = 100
const MINUTES_PER_DAY = 24 * 60
const TIME_STEP_MINUTES = 15
const ACTIVITY_DAY_START_ANCHOR = 'activity-day-start'

function emptyDetails(): RangeDetails {
  return {
    activityName: '',
    color: defaultActivityColor(''),
    note: '',
    isOngoing: false,
  }
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localToday(): string {
  return formatLocalDate(new Date())
}

function localNowTime(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
}

function ongoingDisplayEnd(startTime: string, entryDate: string, nowTime: string): string {
  const start = parseTime(startTime) ?? 0
  let end = MINUTES_PER_DAY

  if (entryDate === localToday()) {
    end = parseTime(nowTime) ?? start + 1
  } else if (entryDate > localToday()) {
    end = start + TIME_STEP_MINUTES
  }

  return formatTime(Math.max(start + 1, Math.min(MINUTES_PER_DAY, end)))
}

function endNowAfter(startTime: string): string {
  const start = parseTime(startTime) ?? 0
  const now = parseTime(localNowTime()) ?? start + 1
  return formatTime(Math.max(start + 1, Math.min(MINUTES_PER_DAY, now)))
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  parsed.setDate(parsed.getDate() - 1)
  return formatLocalDate(parsed)
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
  if (start === null) {
    return 'Bitte den Beginn im Format HH:MM eintragen.'
  }
  if (draft.isOngoing) return ''

  const end = parseTime(draft.end)
  if (end === null) {
    return 'Bitte das Ende im Format HH:MM eintragen.'
  }
  if (end <= start) {
    return 'Das Ende muss nach dem Beginn liegen.'
  }

  return ''
}

function durationLabel(draft: RangeDraft | null): string {
  if (!draft || rangeError(draft)) return 'Dauer noch nicht verfügbar'
  if (draft.isOngoing) return `Läuft seit ${draft.start}`

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
  const [nowTime, setNowTime] = useState(localNowTime)
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([])
  const [rangeDetails, setRangeDetails] = useState<RangeDetails[]>([])
  const [rangeRecords, setRangeRecords] = useState<Array<ActivityEntry | null>>(
    [],
  )
  const [knownActivityTypes, setKnownActivityTypes] = useState<ActivityType[]>([])
  const [activitySuggestionsOpen, setActivitySuggestionsOpen] = useState(false)
  const [activeRangeIndex, setActiveRangeIndex] = useState<number | null>(null)
  const [activeDraft, setActiveDraft] = useState<RangeDraft | null>(null)
  const [status, setStatus] = useState('')
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<ActivityHistorySnapshot[]>([])
  const [redoStack, setRedoStack] = useState<ActivityHistorySnapshot[]>([])
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySourceDate, setCopySourceDate] = useState(() =>
    previousDate(localToday()),
  )
  const [copyEntries, setCopyEntries] = useState<ActivityEntry[]>([])
  const [copySelectedIds, setCopySelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState('')
  const detailsDialogRef = useRef<HTMLDialogElement>(null)
  const scrollSnapTimerRef = useRef<number | null>(null)

  function applyStoredEntries(storedEntries: readonly ActivityEntry[]): void {
    setTimeRanges(
      storedEntries.map((entry) => ({
        start: entry.startTime,
        end: entry.isOngoing
          ? ongoingDisplayEnd(entry.startTime, entry.date, nowTime)
          : entry.endTime,
      })),
    )
    setRangeDetails(
      storedEntries.map((entry) => ({
        activityName: entry.activityName,
        color: entry.color,
        note: entry.note,
        isOngoing: entry.isOngoing,
      })),
    )
    setRangeRecords([...storedEntries])
  }

  async function refreshCurrentDate(): Promise<void> {
    const [entries, types] = await Promise.all([
      listActivityEntries(),
      listActivityTypes(),
    ])
    applyStoredEntries(entriesForDate(entries, date))
    setKnownActivityTypes(types)
  }

  async function captureActivityState(): Promise<ActivityHistorySnapshot> {
    const [entries, types] = await Promise.all([
      listActivityEntries(),
      listActivityTypes(),
    ])
    return {
      entries: entries.map((entry) => ({ ...entry })),
      types: types.map((type) => ({ ...type })),
    }
  }

  async function restoreActivityState(
    snapshot: ActivityHistorySnapshot,
  ): Promise<void> {
    replaceActivityTypes(snapshot.types)
    await replaceActivityEntries(snapshot.entries)
    await refreshCurrentDate()
  }

  function rememberUndo(snapshot: ActivityHistorySnapshot): void {
    setUndoStack((current) => [
      ...current.slice(-(HISTORY_LIMIT - 1)),
      snapshot,
    ])
    setRedoStack([])
  }

  async function undoLastChange(): Promise<void> {
    const snapshot = undoStack.at(-1)
    if (!snapshot || historyBusy) return

    setHistoryBusy(true)
    setStatus('')
    try {
      const current = await captureActivityState()
      await restoreActivityState(snapshot)
      setUndoStack((items) => items.slice(0, -1))
      setRedoStack((items) => [
        ...items.slice(-(HISTORY_LIMIT - 1)),
        current,
      ])
      setActiveDraft(null)
      setActiveRangeIndex(null)
      setStatus('Letzte Änderung rückgängig gemacht.')
    } catch {
      setStatus('Die letzte Änderung konnte nicht rückgängig gemacht werden.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function redoLastChange(): Promise<void> {
    const snapshot = redoStack.at(-1)
    if (!snapshot || historyBusy) return

    setHistoryBusy(true)
    setStatus('')
    try {
      const current = await captureActivityState()
      await restoreActivityState(snapshot)
      setRedoStack((items) => items.slice(0, -1))
      setUndoStack((items) => [
        ...items.slice(-(HISTORY_LIMIT - 1)),
        current,
      ])
      setActiveDraft(null)
      setActiveRangeIndex(null)
      setStatus('Änderung wiederhergestellt.')
    } catch {
      setStatus('Die Änderung konnte nicht wiederhergestellt werden.')
    } finally {
      setHistoryBusy(false)
    }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(ACTIVITY_DAY_START_ANCHOR)?.scrollIntoView({
        block: 'start',
        behavior: 'auto',
      })
    })

    function handleScroll(): void {
      if (scrollSnapTimerRef.current !== null) {
        window.clearTimeout(scrollSnapTimerRef.current)
      }

      scrollSnapTimerRef.current = window.setTimeout(() => {
        scrollSnapTimerRef.current = null
        const anchor = document.getElementById(ACTIVITY_DAY_START_ANCHOR)
        if (!anchor) return

        const distance = anchor.getBoundingClientRect().top
        if (Math.abs(distance) > ACTIVITY_SCROLL_SNAP_DISTANCE) return

        window.scrollTo({
          top: window.scrollY + distance,
          behavior: 'smooth',
        })
      }, ACTIVITY_SCROLL_SNAP_DELAY_MS)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', handleScroll)
      if (scrollSnapTimerRef.current !== null) {
        window.clearTimeout(scrollSnapTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTime(localNowTime())
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    void listActivityTypes().then((types) => {
      if (active) setKnownActivityTypes(types)
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    setActiveRangeIndex(null)
    setActiveDraft(null)
    setUndoStack([])
    setRedoStack([])
    setTimeRanges([])
    setRangeDetails([])
    setRangeRecords([])

    void listActivityEntries()
      .then((entries) => {
        if (!active) return

        const selectedEntries = entriesForDate(entries, date)
        applyStoredEntries(selectedEntries)
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

  useEffect(() => {
    if (!copyOpen || !copySourceDate) return

    let active = true
    setCopyLoading(true)
    setCopyError('')

    void listActivityEntries()
      .then((entries) => {
        if (!active) return
        const sourceEntries = entriesForDate(entries, copySourceDate)
        setCopyEntries(sourceEntries)
        setCopySelectedIds(new Set(sourceEntries.map((entry) => entry.id)))
      })
      .catch(() => {
        if (!active) return
        setCopyEntries([])
        setCopySelectedIds(new Set())
        setCopyError('Die Aktivitäten dieses Tages konnten nicht geladen werden.')
      })
      .finally(() => {
        if (active) setCopyLoading(false)
      })

    return () => {
      active = false
    }
  }, [copyOpen, copySourceDate])

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
      color: details.color,
      note: details.note,
      isOngoing: details.isOngoing,
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

  function startOngoingActivity(): void {
    if (date !== localToday()) {
      setStatus('Eine laufende Aktivität kann nur für heute gestartet werden.')
      return
    }

    const start = localNowTime()
    const startMinutes = parseTime(start) ?? 0
    const end = formatTime(Math.min(MINUTES_PER_DAY, startMinutes + TIME_STEP_MINUTES))
    const index = timeRanges.length

    setNowTime(start)
    setTimeRanges((current) => [...current, { start, end }])
    setRangeDetails((current) => [
      ...current,
      { ...emptyDetails(), isOngoing: true },
    ])
    setRangeRecords((current) => [...current, null])
    setActiveRangeIndex(index)
    setActiveDraft({
      start,
      end,
      ...emptyDetails(),
      isOngoing: true,
    })
    setStatus('')
  }

  function discardRangeDetails(): void {
    setActivitySuggestionsOpen(false)
    setActiveDraft(null)
    setActiveRangeIndex(null)
  }

  function updateDraft(patch: Partial<RangeDraft>): void {
    setActiveDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function colorForActivityName(activityName: string): string {
    if (!activityName.trim()) return defaultActivityColor(activityName)

    const localType = rangeDetails.find(
      (details) =>
        details.activityName.trim() &&
        sameActivityType(details.activityName, activityName),
    )
    if (localType) return localType.color

    const knownType = knownActivityTypes.find((type) =>
      sameActivityType(type.name, activityName),
    )
    return knownType?.color ?? defaultActivityColor(activityName)
  }

  function updateDraftActivityName(activityName: string): void {
    updateDraft({
      activityName,
      color: colorForActivityName(activityName),
    })
    setActivitySuggestionsOpen(true)
  }

  function selectActivityType(type: ActivityType): void {
    updateDraft({
      activityName: type.name,
      color: type.color,
    })
    setActivitySuggestionsOpen(false)
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

    if (!storedRecord) {
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
      setStatus('')
      return
    }

    setDetailsSaving(true)
    setStatus('')

    try {
      const before = await captureActivityState()
      await deleteActivityEntry(storedRecord.id)
      await refreshCurrentDate()
      rememberUndo(before)
      setActiveDraft(null)
      setActiveRangeIndex(null)
      setStatus('Aktivität entfernt.')
    } catch {
      setStatus('Die Aktivität konnte nicht entfernt werden.')
    } finally {
      setDetailsSaving(false)
    }
  }

  async function applyActiveDraft(draftOverride?: RangeDraft): Promise<void> {
    const draft = draftOverride ?? activeDraft
    if (activeRangeIndex === null || !draft) return

    const validationMessage = rangeError(draft)
    if (validationMessage) {
      setStatus(validationMessage)
      return
    }
    if (!draft.activityName.trim()) {
      setStatus('Bitte eine Aktivität eintragen.')
      return
    }

    const storedRecord = rangeRecords[activeRangeIndex]
    const activityName = draft.activityName.trim()
    const activityColor = normalizeActivityColor(draft.color, activityName)

    setDetailsSaving(true)
    setStatus('')

    let before: ActivityHistorySnapshot | null = null

    try {
      before = await captureActivityState()

      if (storedRecord) {
        await saveActivityEntry({
          ...storedRecord,
          startTime: draft.start,
          endTime: draft.isOngoing ? '' : draft.end,
          isOngoing: draft.isOngoing,
          activityName,
          color: activityColor,
          note: draft.note,
        })
      } else {
        await createActivityEntries([
          {
            date,
            startTime: draft.start,
            endTime: draft.isOngoing ? '' : draft.end,
            isOngoing: draft.isOngoing,
            activityName,
            color: activityColor,
            note: draft.note,
          },
        ])
      }

      await saveActivityTypeColor(activityName, activityColor)
      await refreshCurrentDate()
      rememberUndo(before)
      setActiveDraft(null)
      setActiveRangeIndex(null)
      setStatus(storedRecord ? 'Aktivität aktualisiert.' : 'Aktivität gespeichert.')
    } catch {
      if (before) {
        try {
          await restoreActivityState(before)
        } catch {
          // Der ursprüngliche Fehlerstatus bleibt aussagekräftiger.
        }
      }
      setStatus(
        storedRecord
          ? 'Die Aktivität konnte nicht aktualisiert werden.'
          : 'Die Aktivität konnte nicht gespeichert werden.',
      )
    } finally {
      setDetailsSaving(false)
    }
  }

  function finishOngoingNow(): void {
    if (!activeDraft || date !== localToday()) return

    void applyActiveDraft({
      ...activeDraft,
      isOngoing: false,
      end: endNowAfter(activeDraft.start),
    })
  }

  function openCopyDay(): void {
    setCopySourceDate(previousDate(date))
    setCopyEntries([])
    setCopySelectedIds(new Set())
    setCopyError('')
    setStatus('')
    setCopyOpen(true)
  }

  function toggleCopyEntry(id: string, selected: boolean): void {
    setCopySelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function confirmCopyDay(): Promise<void> {
    const selectedEntries = copyEntries.filter((entry) =>
      copySelectedIds.has(entry.id),
    )
    if (!selectedEntries.length || copySourceDate === date) return

    setCopyBusy(true)
    setCopyError('')

    let before: ActivityHistorySnapshot | null = null

    try {
      before = await captureActivityState()
      await createActivityEntries(
        selectedEntries.map((entry) => ({
          date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          isOngoing: entry.isOngoing,
          activityName: entry.activityName,
          color: entry.color,
          note: entry.note,
        })),
      )

      await refreshCurrentDate()
      rememberUndo(before)
      setCopyOpen(false)
      setStatus(
        selectedEntries.length === 1
          ? '1 Aktivität wurde auf den aktuellen Tag übernommen.'
          : `${selectedEntries.length} Aktivitäten wurden auf den aktuellen Tag übernommen.`,
      )
    } catch {
      if (before) {
        try {
          await restoreActivityState(before)
        } catch {
          // Der Kopierfehler bleibt die relevante Meldung.
        }
      }
      setCopyError('Die ausgewählten Aktivitäten konnten nicht übernommen werden.')
    } finally {
      setCopyBusy(false)
    }
  }

  const draftValidationMessage = rangeError(activeDraft)
  const previewRanges = timeRanges.map((range, index) => {
    if (activeRangeIndex === index && activeDraft && !draftValidationMessage) {
      return {
        start: activeDraft.start,
        end: activeDraft.isOngoing
          ? ongoingDisplayEnd(activeDraft.start, date, nowTime)
          : activeDraft.end,
      }
    }

    return rangeDetails[index]?.isOngoing
      ? {
          start: range.start,
          end: ongoingDisplayEnd(range.start, date, nowTime),
        }
      : range
  })
  const previewColors = previewRanges.map((_, index) =>
    activeRangeIndex === index && activeDraft
      ? activeDraft.color
      : rangeDetails[index]?.color ?? defaultActivityColor(''),
  )
  const previewLabels = previewRanges.map((_, index) =>
    activeRangeIndex === index && activeDraft
      ? activeDraft.activityName
      : rangeDetails[index]?.activityName ?? '',
  )
  const previewOngoing = previewRanges.map((_, index) =>
    activeRangeIndex === index && activeDraft
      ? activeDraft.isOngoing
      : rangeDetails[index]?.isOngoing ?? false,
  )
  const historyLocked =
    historyBusy || detailsSaving || copyBusy || activeRangeIndex !== null || copyOpen
  const canUndo = undoStack.length > 0 && !historyLocked
  const canRedo = redoStack.length > 0 && !historyLocked
  const activitySearch =
    activeDraft?.activityName.trim().toLocaleLowerCase('de') ?? ''
  const activitySuggestions = knownActivityTypes
    .filter(
      (type) =>
        !activitySearch ||
        type.name.toLocaleLowerCase('de').includes(activitySearch),
    )
    .slice(0, 12)
  const canApplyDraft =
    Boolean(activeDraft?.activityName.trim()) && !draftValidationMessage

  const copyItems: CopyDayItem[] = copyEntries.map((entry) => ({
    id: entry.id,
    primary: `${entry.startTime}–${entry.isOngoing ? 'läuft' : entry.endTime} · ${entry.activityName}`,
    secondary: entry.note || undefined,
  }))

  return (
    <form className="activity-page" onSubmit={(event) => event.preventDefault()}>
      <div className="activity-page__day-controls">
        <label className="activity-page__date">
          <span>Datum</span>
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <div className="activity-page__day-actions">
          <button
            className="activity-page__start-running"
            type="button"
            disabled={date !== localToday()}
            title={
              date === localToday()
                ? 'Neue laufende Aktivität ab jetzt erfassen'
                : 'Laufende Aktivitäten können nur für heute gestartet werden'
            }
            onClick={startOngoingActivity}
          >
            Aktivität starten
          </button>
          <button
            className="activity-page__copy-day"
            type="button"
            onClick={openCopyDay}
          >
            Tag kopieren
          </button>
        </div>
      </div>

      <section
        className="activity-page__intro"
        aria-labelledby="activity-time-title"
      >
        <div>
          <h2 id="activity-time-title">Zeiträume der Aktivität</h2>
          <p>
            Aktivitäten werden beim Abschluss des Editors automatisch gespeichert.
            Neue Zeiträume öffnen sich direkt; bestehende öffnest du über ihre
            rechte Hälfte. Änderungen kannst du anschließend mit Undo und Redo
            zurücknehmen oder wiederherstellen.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={previewRanges}
        rangeColors={previewColors}
        rangeLabels={previewLabels}
        rangeOngoing={previewOngoing}
        onChange={changeRanges}
        onRangeActivate={openRangeDetails}
        onRangeCreated={openCreatedRange}
        activeRangeIndex={activeRangeIndex}
        label="Aktivitätszeiträume"
        workspaceAnchorId={ACTIVITY_DAY_START_ANCHOR}
      />

      <div className="activity-page__history" aria-label="Änderungsverlauf">
        <button
          type="button"
          className="activity-page__history-button"
          disabled={!canUndo}
          onClick={() => void undoLastChange()}
        >
          <span aria-hidden="true">↶</span>
          Undo
        </button>
        <button
          type="button"
          className="activity-page__history-button"
          disabled={!canRedo}
          onClick={() => void redoLastChange()}
        >
          <span aria-hidden="true">↷</span>
          Redo
        </button>
        <span className="activity-page__autosave-note">
          Änderungen werden automatisch gespeichert.
        </span>
      </div>

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
              <div
                className="activity-page__field activity-page__activity-combobox"
                onBlur={(event) => {
                  const nextFocus = event.relatedTarget
                  if (
                    !(nextFocus instanceof Node) ||
                    !event.currentTarget.contains(nextFocus)
                  ) {
                    setActivitySuggestionsOpen(false)
                  }
                }}
              >
                <label htmlFor="activity-name-input">Aktivität</label>
                <div className="activity-page__combobox-control">
                  <input
                    id="activity-name-input"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={activitySuggestionsOpen}
                    aria-controls="activity-name-options"
                    value={activeDraft.activityName}
                    maxLength={120}
                    autoComplete="off"
                    required
                    autoFocus
                    aria-label={`Aktivität für Zeitraum ${activeRangeIndex + 1}`}
                    placeholder="z. B. Spaziergang"
                    onFocus={() => setActivitySuggestionsOpen(true)}
                    onChange={(event) =>
                      updateDraftActivityName(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setActivitySuggestionsOpen(false)
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="activity-page__combobox-toggle"
                    aria-label="Gespeicherte Aktivitäten anzeigen"
                    aria-expanded={activitySuggestionsOpen}
                    aria-controls="activity-name-options"
                    onClick={() =>
                      setActivitySuggestionsOpen((current) => !current)
                    }
                  >
                    <span aria-hidden="true">▾</span>
                  </button>
                </div>

                {activitySuggestionsOpen ? (
                  <div
                    id="activity-name-options"
                    className="activity-page__combobox-options"
                    role="listbox"
                    aria-label="Gespeicherte Aktivitäten"
                  >
                    {activitySuggestions.length ? (
                      activitySuggestions.map((type) => (
                        <button
                          key={type.name.toLocaleLowerCase('de')}
                          type="button"
                          role="option"
                          aria-selected={sameActivityType(
                            type.name,
                            activeDraft.activityName,
                          )}
                          className="activity-page__combobox-option"
                          onClick={() => selectActivityType(type)}
                        >
                          <span
                            className="activity-page__combobox-option-color"
                            style={{ backgroundColor: type.color }}
                            aria-hidden="true"
                          />
                          <span>{type.name}</span>
                        </button>
                      ))
                    ) : (
                      <p className="activity-page__combobox-empty">
                        Keine gespeicherte Aktivität gefunden. Der eingegebene
                        Name wird als neue Aktivität gespeichert.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              <fieldset className="activity-page__color-picker">
                <legend>Farbe</legend>
                <div className="activity-page__color-swatches">
                  {ACTIVITY_PASTEL_COLORS.map((color, index) => (
                    <button
                      key={color}
                      type="button"
                      className="activity-page__color-swatch"
                      style={{ backgroundColor: color }}
                      aria-label={`Pastellfarbe ${index + 1}`}
                      aria-pressed={activeDraft.color === color}
                      title={`Pastellfarbe ${index + 1}`}
                      onClick={() => updateDraft({ color })}
                    />
                  ))}
                  <button
                    type="button"
                    className="activity-page__color-auto"
                    onClick={() =>
                      updateDraft({
                        color: defaultActivityColor(activeDraft.activityName),
                      })
                    }
                  >
                    Automatisch
                  </button>
                </div>
                <small>
                  Die Farbe gilt für alle Einträge mit demselben Aktivitätsnamen.
                </small>
              </fieldset>

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

              <fieldset className="activity-page__time-editor">
                <legend>Zeitraum</legend>

                <label className="activity-page__ongoing-toggle">
                  <input
                    type="checkbox"
                    checked={activeDraft.isOngoing}
                    onChange={(event) =>
                      updateDraft({
                        isOngoing: event.target.checked,
                        end: event.target.checked
                          ? ongoingDisplayEnd(activeDraft.start, date, nowTime)
                          : activeDraft.end,
                      })
                    }
                  />
                  <span>Läuft noch</span>
                </label>

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
                    {activeDraft.isOngoing ? (
                      <>
                        <span>Ende</span>
                        <output className="activity-page__ongoing-end">
                          läuft noch
                        </output>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                </div>

                <div className="activity-page__duration">
                  <span>Dauer</span>
                  <output aria-live="polite">{durationLabel(activeDraft)}</output>
                </div>

                <p id="activity-time-help" className="activity-page__time-help">
                  Uhrzeiten als HH:MM eingeben. Für das Tagesende ist 24:00
                  möglich. Bei „Läuft noch“ bleibt das Ende offen.
                </p>
                <p
                  id="activity-time-error"
                  className="activity-page__time-error"
                  aria-live="polite"
                >
                  {draftValidationMessage}
                </p>
              </fieldset>

              <div className="activity-page__dialog-actions">
                <button
                  type="button"
                  className="activity-page__remove"
                  disabled={detailsSaving}
                  onClick={() => void removeRange(activeRangeIndex)}
                >
                  Zeitraum entfernen
                </button>
                <div className="activity-page__dialog-primary-actions">
                  {activeDraft.isOngoing && date === localToday() ? (
                    <button
                      type="button"
                      className="activity-page__finish-running"
                      disabled={detailsSaving || !canApplyDraft}
                      onClick={finishOngoingNow}
                    >
                      Jetzt beenden
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="activity-page__primary"
                    disabled={detailsSaving || !canApplyDraft}
                    onClick={() => void applyActiveDraft()}
                  >
                    {detailsSaving ? 'Speichert …' : 'Fertig'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>

      <CopyDayDialog
        open={copyOpen}
        sourceDate={copySourceDate}
        targetDate={date}
        items={copyItems}
        selectedIds={copySelectedIds}
        loading={copyLoading}
        busy={copyBusy}
        emptyMessage="Für diesen Tag sind keine Aktivitäten gespeichert."
        errorMessage={copyError}
        onSourceDateChange={(nextDate) => {
          setCopySourceDate(nextDate)
          setCopyError('')
        }}
        onSelectionChange={toggleCopyEntry}
        onCancel={() => {
          if (!copyBusy) setCopyOpen(false)
        }}
        onConfirm={() => void confirmCopyDay()}
      />
    </form>
  )
}
