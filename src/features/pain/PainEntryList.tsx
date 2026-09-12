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
  | { kind: 'pain'; entry: PainEntry }
  | { kind: 'activity'; entry: ActivityEntry }

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

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return hours * 60 + minutes
}

function activityDuration(entry: ActivityEntry): string {
  if (entry.isOngoing) return 'läuft'
  const duration = timeMinutes(entry.endTime) - timeMinutes(entry.startTime)
  if (duration <= 0) return ''

  const hours = Math.floor(duration / 60)
  const minutes = duration % 60
  if (!hours) return `${minutes} min`
  if (!minutes) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function isOngoing(entry: PainEntry): boolean {
  return !entry.endedAt
}

function timeRangeLabel(entry: PainEntry): string {
  if (isOngoing(entry)) return `seit ${formatTime(entry.startedAt)}`
  return `${formatTime(entry.startedAt)} – ${formatTime(entry.endedAt)}`
}

function activityTimeRangeLabel(entry: ActivityEntry): string {
  if (entry.isOngoing) return `seit ${entry.startTime}`
  return `${entry.startTime} – ${entry.endTime}`
}

function detailRows(entry: PainEntry): Array<[string, string]> {
  const rows: Array<[string, string]> = []

  if (entry.qualities.length) rows.push(['Schmerzart', entry.qualities.join(', ')])
  if (entry.cause) rows.push(['Mögliche Ursache', entry.cause])
  if (entry.occursWhen) rows.push(['Tritt auf, wenn', entry.occursWhen])
  if (entry.note) rows.push(['Notizen', entry.note])

  return rows
}

function timelineDayKey(item: TimelineItem): string {
  return item.kind === 'pain' ? localDateKey(item.entry.startedAt) : item.entry.date
}

function timelineStartMinutes(item: TimelineItem): number {
  if (item.kind === 'activity') return timeMinutes(item.entry.startTime)

  const date = new Date(item.entry.startedAt)
  if (Number.isNaN(date.getTime())) return 0
  return date.getHours() * 60 + date.getMinutes()
}

function timelineItemIsActive(item: TimelineItem): boolean {
  return item.kind === 'pain' ? isOngoing(item.entry) : item.entry.isOngoing
}

export function PainEntryList({
  refreshKey = 0,
  onEdit,
  onChanged,
}: PainEntryListProps) {
  const [entries, setEntries] = useState<PainEntry[]>([])
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [filter, setFilter] = useState<ListFilter>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [showActivities, setShowActivities] = useState(false)
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
      setStatus('Die Verlaufseinträge konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries, refreshKey])

  const timelineItems = useMemo(() => {
    const painItems: TimelineItem[] = entries
      .filter((entry) => {
        if (filter === 'active' && !isOngoing(entry)) return false
        if (dateFilter && localDateKey(entry.startedAt) !== dateFilter) return false
        return true
      })
      .map((entry) => ({ kind: 'pain', entry }))

    const activityItems: TimelineItem[] = showActivities
      ? activities
          .filter((entry) => {
            if (filter === 'active' && !entry.isOngoing) return false
            if (dateFilter && entry.date !== dateFilter) return false
            return true
          })
          .map((entry) => ({ kind: 'activity', entry }))
      : []

    return [...painItems, ...activityItems].sort((left, right) => {
      const dayComparison = timelineDayKey(right).localeCompare(timelineDayKey(left))
      if (dayComparison) return dayComparison
      return timelineStartMinutes(right) - timelineStartMinutes(left)
    })
  }, [activities, dateFilter, entries, filter, showActivities])

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimelineItem[]>()
    for (const item of timelineItems) {
      const key = timelineDayKey(item)
      const group = groups.get(key)
      if (group) group.push(item)
      else groups.set(key, [item])
    }
    return [...groups.entries()]
  }, [timelineItems])

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
          <span>Aktivitäten anzeigen</span>
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

      {!loading && !timelineItems.length ? (
        <p className="pain-entry-list__state">
          {entries.length || (showActivities && activities.length)
            ? showActivities
              ? 'Für diesen Filter gibt es keine Schmerzen oder Aktivitäten.'
              : 'Für diesen Filter gibt es keine Schmerzeinträge.'
            : showActivities
              ? 'Noch keine Schmerzen oder Aktivitäten vorhanden.'
              : 'Noch keine Schmerzeinträge vorhanden.'}
        </p>
      ) : null}

      <div className="pain-entry-list__days">
        {groupedEntries.map(([dayKey, dayItems]) => {
          const painCount = dayItems.filter((item) => item.kind === 'pain').length
          const activityCount = dayItems.length - painCount
          const activeCount = dayItems.filter(timelineItemIsActive).length
          const summaryParts: string[] = []

          if (painCount) {
            summaryParts.push(`${painCount} ${painCount === 1 ? 'Schmerz' : 'Schmerzen'}`)
          }
          if (activityCount) {
            summaryParts.push(
              `${activityCount} ${activityCount === 1 ? 'Aktivität' : 'Aktivitäten'}`,
            )
          }
          if (activeCount) summaryParts.push(`${activeCount} aktiv`)

          return (
            <section className="pain-entry-list__day" key={dayKey}>
              <header className="pain-entry-list__day-header">
                <h2>{formatDayLabel(dayKey)}</h2>
                <span>{summaryParts.join(' · ')}</span>
              </header>

              <div className="pain-entry-list__entries">
                {dayItems.map((item) => {
                  if (item.kind === 'activity') {
                    const activity = item.entry
                    const duration = activityDuration(activity)

                    return (
                      <article
                        className="pain-entry-list__activity"
                        data-active={activity.isOngoing}
                        key={`activity:${activity.id}`}
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
                          <span
                            className="pain-entry-list__activity-color"
                            style={{ backgroundColor: activity.color }}
                            aria-hidden="true"
                          />
                          <strong>{activity.activityName}</strong>
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
