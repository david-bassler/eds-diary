import { type FormEvent, useEffect, useState } from 'react'
import {
  createMedicationEntry,
  listMedicationEntries,
  listMedicationNames,
} from './medicationRepository'
import './MedicationEntryForm.css'

interface LocalDateTime {
  date: string
  time: string
}

interface MedicationQuickChoice {
  name: string
  dose: string
  count: number
  lastTakenAt: string
}

const MAX_QUICK_CHOICES = 5

export interface MedicationEntryFormProps {
  date: string
  refreshNamesKey?: number
  onDateChange: (date: string) => void
  onCopyDay: () => void
}

function localNow(): LocalDateTime {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  }
}

function toIso(date: string, time: string): string | null {
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

async function loadMedicationChoices(): Promise<{
  names: string[]
  quickChoices: MedicationQuickChoice[]
}> {
  const [names, entries] = await Promise.all([
    listMedicationNames(),
    listMedicationEntries(),
  ])
  const choices = new Map<string, MedicationQuickChoice>()

  for (const entry of entries) {
    const key = entry.medicationName.trim().toLocaleLowerCase('de')
    const current = choices.get(key)

    if (!current) {
      choices.set(key, {
        name: entry.medicationName,
        dose: entry.dose,
        count: 1,
        lastTakenAt: entry.takenAt,
      })
      continue
    }

    current.count += 1
    if (entry.takenAt > current.lastTakenAt) {
      current.name = entry.medicationName
      current.dose = entry.dose
      current.lastTakenAt = entry.takenAt
    }
  }

  return {
    names,
    quickChoices: [...choices.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.lastTakenAt.localeCompare(left.lastTakenAt) ||
          left.name.localeCompare(right.name, 'de'),
      )
      .slice(0, MAX_QUICK_CHOICES),
  }
}

export function MedicationEntryForm({
  date,
  refreshNamesKey = 0,
  onDateChange,
  onCopyDay,
}: MedicationEntryFormProps) {
  const [medicationName, setMedicationName] = useState('')
  const [dose, setDose] = useState('')
  const [time, setTime] = useState(() => localNow().time)
  const [knownMedicationNames, setKnownMedicationNames] = useState<string[]>([])
  const [quickChoices, setQuickChoices] = useState<MedicationQuickChoice[]>([])
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    void loadMedicationChoices().then(({ names, quickChoices }) => {
      if (!active) return
      setKnownMedicationNames(names)
      setQuickChoices(quickChoices)
    })

    return () => {
      active = false
    }
  }, [refreshNamesKey])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const takenAt = toIso(date, time)
    if (!takenAt) {
      setStatus('Bitte ein gültiges Datum und eine gültige Uhrzeit wählen.')
      return
    }

    const name = medicationName.trim()
    const trimmedDose = dose.trim()
    if (!name) {
      setStatus('Bitte einen Medikamentennamen eingeben.')
      return
    }
    if (!trimmedDose) {
      setStatus('Bitte eine Dosis eingeben.')
      return
    }

    setSaving(true)
    setStatus('')

    try {
      await createMedicationEntry({
        medicationName: name,
        dose: trimmedDose,
        takenAt,
      })

      const choices = await loadMedicationChoices()
      setKnownMedicationNames(choices.names)
      setQuickChoices(choices.quickChoices)
      setMedicationName('')
      setDose('')
      setTime(localNow().time)
      setStatus('Medikamenteneinnahme gespeichert.')
    } catch {
      setStatus('Die Medikamenteneinnahme konnte lokal nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="medication-entry-form"
      aria-labelledby="medication-entry-form-title"
    >
      <div className="medication-entry-form__intro">
        <h2 id="medication-entry-form-title">Einnahme erfassen</h2>
        <p>
          Dokumentiere, welches Medikament du wann und in welcher Dosis
          eingenommen hast.
        </p>
      </div>

      {quickChoices.length ? (
        <div
          className="medication-entry-form__quick-access"
          aria-label="Medikamenten-Schnellzugriff"
        >
          <span className="medication-entry-form__quick-title">Schnellzugriff</span>
          <div className="medication-entry-form__quick-choices">
            {quickChoices.map((choice) => (
              <button
                key={choice.name.toLocaleLowerCase('de')}
                type="button"
                className="medication-entry-form__quick-choice"
                onClick={() => {
                  setMedicationName(choice.name)
                  setDose(choice.dose)
                  setStatus('')
                }}
              >
                <strong>{choice.name}</strong>
                <span>{choice.dose}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="medication-entry-form__form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="medication-entry-form__field">
          <span>Medikament</span>
          <input
            type="text"
            list="medication-name-options"
            value={medicationName}
            maxLength={120}
            autoComplete="off"
            required
            placeholder="Medikamentenname"
            onChange={(event) => setMedicationName(event.target.value)}
          />
          <datalist id="medication-name-options">
            {knownMedicationNames.map((name) => (
              <option key={name.toLocaleLowerCase('de')} value={name} />
            ))}
          </datalist>
          <small>
            Bereits erfasste Medikamentennamen werden automatisch vorgeschlagen.
          </small>
        </label>

        <label className="medication-entry-form__field">
          <span>Dosis</span>
          <input
            type="text"
            value={dose}
            maxLength={80}
            required
            placeholder="z. B. 10 mg oder 1 Tablette"
            onChange={(event) => setDose(event.target.value)}
          />
        </label>

        <fieldset className="medication-entry-form__fieldset">
          <legend>Zeitpunkt</legend>
          <p>
            Standardmäßig ist der aktuelle lokale Zeitpunkt eingestellt.
          </p>
          <div className="medication-entry-form__datetime">
            <label>
              <span>Datum</span>
              <input
                type="date"
                required
                value={date}
                onChange={(event) => onDateChange(event.target.value)}
              />
            </label>
            <label>
              <span>Uhrzeit</span>
              <input
                type="time"
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>

          <div className="medication-entry-form__day-actions">
            <button type="button" onClick={onCopyDay}>
              Tag kopieren
            </button>
          </div>
        </fieldset>

        <div className="medication-entry-form__footer">
          <button
            className="medication-entry-form__primary"
            type="submit"
            disabled={saving || !medicationName.trim() || !dose.trim()}
          >
            {saving ? 'Speichert …' : 'Einnahme speichern'}
          </button>
        </div>
      </form>

      <p className="medication-entry-form__status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
