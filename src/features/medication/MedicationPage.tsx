import { useEffect, useState } from 'react'
import {
  CopyDayDialog,
  type CopyDayItem,
} from '../../components/CopyDayDialog/CopyDayDialog'
import { MedicationEntryForm } from './MedicationEntryForm'
import { MedicationPrescriptionForm } from './MedicationPrescriptionForm'
import type { MedicationEntry } from './medicationEntry'
import {
  createMedicationEntries,
  listMedicationEntries,
} from './medicationRepository'
import './MedicationPage.css'

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localToday(): string {
  return formatLocalDate(new Date())
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  parsed.setDate(parsed.getDate() - 1)
  return formatLocalDate(parsed)
}

function entryLocalDate(entry: MedicationEntry): string {
  return formatLocalDate(new Date(entry.takenAt))
}

function entryLocalTime(entry: MedicationEntry): string {
  const date = new Date(entry.takenAt)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function medicationEntriesForDate(
  entries: readonly MedicationEntry[],
  date: string,
): MedicationEntry[] {
  return entries
    .filter((entry) => entryLocalDate(entry) === date)
    .sort((left, right) => left.takenAt.localeCompare(right.takenAt))
}

function copyTakenAt(targetDate: string, sourceTakenAt: string): string {
  const source = new Date(sourceTakenAt)
  const target = new Date(`${targetDate}T00:00:00`)
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  )
  return target.toISOString()
}

export function MedicationPage() {
  const [date, setDate] = useState(localToday)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySourceDate, setCopySourceDate] = useState(() =>
    previousDate(localToday()),
  )
  const [copyEntries, setCopyEntries] = useState<MedicationEntry[]>([])
  const [copySelectedIds, setCopySelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [refreshNamesKey, setRefreshNamesKey] = useState(0)

  useEffect(() => {
    if (!copyOpen || !copySourceDate) return

    let active = true
    setCopyLoading(true)
    setCopyError('')

    void listMedicationEntries()
      .then((entries) => {
        if (!active) return
        const sourceEntries = medicationEntriesForDate(entries, copySourceDate)
        setCopyEntries(sourceEntries)
        setCopySelectedIds(new Set(sourceEntries.map((entry) => entry.id)))
      })
      .catch(() => {
        if (!active) return
        setCopyEntries([])
        setCopySelectedIds(new Set())
        setCopyError('Die Einnahmen dieses Tages konnten nicht geladen werden.')
      })
      .finally(() => {
        if (active) setCopyLoading(false)
      })

    return () => {
      active = false
    }
  }, [copyOpen, copySourceDate])

  function openCopyDay(): void {
    setCopySourceDate(previousDate(date))
    setCopyEntries([])
    setCopySelectedIds(new Set())
    setCopyError('')
    setCopyStatus('')
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

    try {
      await createMedicationEntries(
        selectedEntries.map((entry) => ({
          medicationName: entry.medicationName,
          dose: entry.dose,
          takenAt: copyTakenAt(date, entry.takenAt),
        })),
      )
      setRefreshNamesKey((current) => current + 1)
      setCopyOpen(false)
      setCopyStatus(
        selectedEntries.length === 1
          ? '1 Einnahme wurde auf den aktuellen Tag übernommen.'
          : `${selectedEntries.length} Einnahmen wurden auf den aktuellen Tag übernommen.`,
      )
    } catch {
      setCopyError('Die ausgewählten Einnahmen konnten nicht übernommen werden.')
    } finally {
      setCopyBusy(false)
    }
  }

  const copyItems: CopyDayItem[] = copyEntries.map((entry) => ({
    id: entry.id,
    primary: `${entryLocalTime(entry)} · ${entry.medicationName}`,
    secondary: entry.dose,
  }))

  return (
    <div className="medication-page">
      <MedicationEntryForm
        date={date}
        refreshNamesKey={refreshNamesKey}
        onDateChange={(nextDate) => {
          setDate(nextDate)
          setCopyStatus('')
        }}
        onCopyDay={openCopyDay}
      />

      <p className="medication-page__copy-status" aria-live="polite">
        {copyStatus}
      </p>

      <MedicationPrescriptionForm />

      <CopyDayDialog
        open={copyOpen}
        sourceDate={copySourceDate}
        targetDate={date}
        items={copyItems}
        selectedIds={copySelectedIds}
        loading={copyLoading}
        busy={copyBusy}
        emptyMessage="Für diesen Tag sind keine Medikamenteneinnahmen gespeichert."
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
    </div>
  )
}
