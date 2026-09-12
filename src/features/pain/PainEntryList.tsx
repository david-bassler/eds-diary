import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityEntry } from '../activity/activityEntry'
import { listActivityEntries } from '../activity/activityRepository'
import type { PainEntry } from './painEntry'
import {
  deletePainEntry,
  listPainEntries,
  savePainEntry,
} from './painRepository'
import { painLocationLabel } from './bodyMap/BodyMapSelector'
import './PainEntryList.css'

export interface PainEntryListProps {
  refreshKey?: number
  onEdit: (entry: PainEntry) => void
  onChanged?: () => void
}

type ListFilter = 'all' | 'active'
type TimelineItem =
  | { kind: 'pain'; entry: PainEntry; sortKey: string }
  | { kind: 'activity'; entry: ActivityEntry; sortKey: string }

function localDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)

  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateKeyForOffset(offset: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return localDateKey(date.toISOString())
}

function formatDayLabel(key: string): string {
  if (key === dateKeyForOffset(0)) return `Heute · ${formatCalendarDate(key)}`
  if (key === dateKeyForOffset(-1)) return `Gestern · ${formatCalendarDate(key)}`
  return formatCalendarDate(key)
}

function formatCalendarDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return key

  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12))
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDuration(entry: PainEntry): string {
  const start = Date.parse(entry.startedAt)
  const end = entry.endedAt ? Date.parse(entry.endedAt) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''

  const totalMinutes = Math.floor((end - start) / 60_000)
  return formatMinutes(totalMinutes)
}

function formatActivityDuration(entry: ActivityEntry): string {
  const [startHour, startMinute] = entry.startTime.split(':').map(Number)
  const [endHour, endMinute] = (entry.isOngoing ? currentLocalTime() : entry.endTime)
    .split(':')
    .map(Number)
  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(startMinute) ||
    !Number.isFinite(endHour) ||
    !Number.isFinite(endMinute)
  ) {
    return ''
  }

  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (end < start) return ''
  return formatMinutes(end - start)
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 1) return '< 1 Min.'

  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (days) parts.push(`${days} T`)
  if (hours) parts.push(`${hours} h`)
  if (minutes || !parts.length) parts.push(`${minutes} min`)
  return parts.join(' ')
}

function currentLocalTime(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
}

function isOngoing(entry: PainEntry): boolean {
  return !entry.endedAt
}

function timeRangeLabel(entry: PainEntry): string {
  if (isOngoing(entry)) return `seit ${formatTime(entry.startedAt)}`
  return `${formatTime(entry.startedAt)} – ${formatTime(entry.endedAt)}`
}

function activityTimeRangeLabel(entry: ActivityEntry): string {
  return entry.isOngoing
    ? `seit ${entry.startTime}`
    : `${entry.startTime} – ${entry.endTime}`
}

function detailRows(entry: PainEntry): Array<[string, string]> {
  const rows: Array<[string, string]> = []

  if (entry.qualities.length) rows.push(['Schmerzart', entry.qualities.join(', ')])
  if (entry.cause) rows.push(['Mögliche Ursache', entry.cause])
  if (entry.occursWhen) rows.push(['Tritt auf, wenn', entry.occursWhen])
  if (entry.note) rows.push(['Notizen', entry.note])

  return rows
}

function activitySortKey(entry: ActivityEntry): string {
  return `${entry.date}T${entry.startTime}`
}

export function PainEntryList({
  refreshKey = 0,
  onEdit,
  onChanged,
}: PainEntryListProps) {
  const [entries, setEntries] = useState<PainEntry[]>([])
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [showActivities, setShowActivities] = useState(false)
  const [filter, setFilter] = useState<ListFilter>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const [painEntries, activityEntries] = await Promise.all([
        listPainEntries(),
        listActivityEntries(),
      ])
      setEntries(painEntries)
      setActivities(activityEntries)
      setStatus('')
    } catch {
      setStatus('Die Verlaufsdaten konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries, refreshKey])

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (filter === 'active' && !isOngoing(entry)) return false
        if (dateFilter && localDateKey(entry.startedAt) !== dateFilter) return false
        return true
      }),
    [dateFilter, entries, filter],
  )

  const filteredActivities = useMemo(
    () =>
      showActivities
        ? activities.filter((entry) => {
            if (filter === 'active' && !entry.isOngoing) return false
            if (dateFilter && entry.date !== dateFilter) return false
            return true
          })
        : [],
    [activities, dateFilter, filter, showActivities],
  )

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimelineItem[]>()

    for (const entry of filteredEntries) {
      const key = localDateKey(entry.startedAt)
      const item: TimelineItem = {
        kind: 'pain',
        entry,
        sortKey: entry.startedAt,
      }
      const group = groups.get(key)
      if (group) group.push(item)
      else groups.set(key, [item])
    }

    for (const entry of filteredActivities) {
      const item: TimelineItem = {
        kind: 'activity',
        entry,
        sortKey: activitySortKey(entry),
      }
      const group = groups.get(entry.date)
      if (group) group.push(item)
      else groups.set(entry.date, [item])
    }

    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, items]) => [
        key,
        items.sort((left, right) => right.sortKey.localeCompare(left.sortKey)),
      ] as const)
  }, [filteredActivities, filteredEntries])

  async function endEntry(entry: PainEntry): Promise<void> {
    if (!isOngoing(entry)) return

    const now = new Date()
    if (now.getTime() <= Date.parse(entry.startedAt)) {
      setStatus('Dieser Eintrag beginnt in der Zukunft und kann noch nicht beendet werden.')
      return
    }

    setBusyId(entry.id)
    setStatus('')
    try {
      await savePainEntry({ ...entry, endedAt: now.toISOString() })
      await loadEntries()
      onChanged?.()
    } catch {
      setStatus('Der Schmerzeintrag konnte nicht beendet werden.')
    } finally {
      setBusyId(null)
    }
  }

  async function removeEntry(entry: PainEntry): Promise<void> {
    if (!window.confirm('Diesen Schmerzeintrag wirklich löschen?')) return

    setBusyId(entry.id)
    setStatus('')
    try {
      await deletePainEntry(entry.id)
      await loadEntries()
      onChanged?.()
    } catch {
      setStatus('Der Schmerzeintrag konnte nicht gelöscht werden.')
    } finally {
      setBusyId(null)
    }
  }

  const hasVisibleItems = filteredEntries.length + filteredActivities.length > 0

  return (
    <section className="pain-entry-list" aria-label="Schmerzverlauf">
      <div className="pain-entry-list__filters">
        <div className="pain-entry-list__filter-tabs" role="group" aria-label="Einträge filtern">
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            Alle
          </button>
          <button
            type="button"
            aria-pressed={filter === 'active'}
            onClick={() => setFilter('active')}
          >
            Aktiv
          </button>
        </div>

        <label className="pain-entry-list__activity-toggle">
          <input
            type="checkbox"
            checked={showActivities}
            onChange={(event) => setShowActivities(event.target.checked)}
          />
          <span>Aktivitäten einblenden</span>
        </label>

        <label className="pain-entry-list__date-filter">
          <span>Datum</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />
        </label>
        {dateFilter ? (
          <button
            type="button"
            className="pain-entry-list__clear-date"
            onClick={() => setDateFilter('')}
          >
            Datum zurücksetzen
          </button>
        ) : null}
      </div>

      {loading ? <p className="pain-entry-list__state">Einträge werden geladen …</p> : null}

      {!loading && !hasVisibleItems ? (
        <p className="pain-entry-list__state">
          {entries.length || (showActivities && activities.length)
            ? 'Für diesen Filter gibt es keine Einträge.'
            : 'Noch keine Schmerzeinträge vorhanden.'}
        </p>
      ) : null}

      <div className="pain-entry-list__days">
        {groupedEntries.map(([dayKey, dayItems]) => {
          const painCount = dayItems.filter((item) => item.kind === 'pain').length
          const activityCount = dayItems.filter(
            (item) => item.kind === 'activity',
          ).length
          const activeCount = dayItems.filter((item) =>
            item.kind === 'pain' ? isOngoing(item.entry) : item.entry.isOngoing,
          ).length

          return (
            <section className="pain-entry-list__day" key={dayKey}>
              <header className="pain-entry-list__day-header">
                <h2>{formatDayLabel(dayKey)}</h2>
                <span>
                  {painCount} {painCount === 1 ? 'Schmerz' : 'Schmerzen'}
                  {activityCount
                    ? ` · ${activityCount} ${activityCount === 1 ? 'Aktivität' : 'Aktivitäten'}`
                    : ''}
                  {activeCount ? ` · ${activeCount} aktiv` : ''}
                </span>
              </header>

              <div className="pain-entry-list__entries">
                {dayItems.map((item) => {
                  if (item.kind === 'activity') {
                    const activity = item.entry
                    const duration = formatActivityDuration(activity)

                    return (
                      <article
                        className="pain-entry-list__activity"
                        style={{ borderLeftColor: activity.color }}
                        key={`activity-${activity.id}`}
                      >
                        <div className="pain-entry-list__summary-top">
                          <strong>{activityTimeRangeLabel(activity)}</strong>
                          <div className="pain-entry-list__badges">
                            <span className="pain-entry-list__activity-badge">
                              Aktivität
                            </span>
                            {activity.isOngoing ? (
                              <span className="pain-entry-list__active-badge">Aktiv</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="pain-entry-list__activity-name">
                          {activity.activityName}
                        </div>
                        <div className="pain-entry-list__summary-bottom">
                          <span className="pain-entry-list__preview">
                            {activity.note || 'Keine Notiz'}
                          </span>
                          {duration ? <span>{duration}</span> : null}
                        </div>
                      </article>
                    )
                  }

                  const entry = item.entry
                  const ongoing = isOngoing(entry)
                  const rows = detailRows(entry)
                  const duration = formatDuration(entry)

                  return (
                    <details
                      className="pain-entry-list__entry"
                      data-active={ongoing}
                      key={entry.id}
                    >
                      <summary>
                        <div className="pain-entry-list__summary-top">
                          <strong>{timeRangeLabel(entry)}</strong>
                          <div className="pain-entry-list__badges">
                            {entry.intensity !== null ? (
                              <span className="pain-entry-list__intensity">
                                {entry.intensity}/10
                              </span>
                            ) : null}
                            {ongoing ? (
                              <span className="pain-entry-list__active-badge">Aktiv</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="pain-entry-list__locations">
                          {entry.locations.length
                            ? entry.locations.map(painLocationLabel).join(' · ')
                            : 'Keine Körperregion angegeben'}
                        </div>

                        <div className="pain-entry-list__summary-bottom">
                          <span className="pain-entry-list__preview">
                            {entry.note || entry.qualities.join(', ') || 'Keine zusätzlichen Angaben'}
                          </span>
                          {duration ? <span>{duration}</span> : null}
                        </div>
                      </summary>

                      <div className="pain-entry-list__details">
                        <dl>
                          <div>
                            <dt>Beginn</dt>
                            <dd>
                              {new Intl.DateTimeFormat('de-DE', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              }).format(new Date(entry.startedAt))}
                            </dd>
                          </div>
                          <div>
                            <dt>Ende</dt>
                            <dd>
                              {ongoing
                                ? 'Noch aktiv'
                                : new Intl.DateTimeFormat('de-DE', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }).format(new Date(entry.endedAt))}
                            </dd>
                          </div>
                          <div>
                            <dt>Dauer</dt>
                            <dd>{duration || '—'}</dd>
                          </div>
                          {rows.map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>

                        <div className="pain-entry-list__actions">
                          {ongoing ? (
                            <button
                              type="button"
                              disabled={busyId === entry.id}
                              onClick={() => void endEntry(entry)}
                            >
                              Jetzt beenden
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busyId === entry.id}
                            onClick={() => onEdit(entry)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="pain-entry-list__delete"
                            disabled={busyId === entry.id}
                            onClick={() => void removeEntry(entry)}
                          >
                            Löschen
                          </button>
                        </div>
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <p className="pain-entry-list__status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
