import { type FormEvent, useEffect, useState } from 'react'
import {
  createMedicationEntry,
  listMedicationNames,
} from './medicationRepository'
import './MedicationEntryForm.css'

interface LocalDateTime {
  date: string
  time: string
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

export function MedicationEntryForm() {
  const [medicationName, setMedicationName] = useState('')
  const [dose, setDose] = useState('')
  const [when, setWhen] = useState<LocalDateTime>(localNow)
  const [knownMedicationNames, setKnownMedicationNames] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    void listMedicationNames().then((names) => {
      if (active) setKnownMedicationNames(names)
    })

    return () => {
      active = false
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const takenAt = toIso(when.date, when.time)
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

      setKnownMedicationNames(await listMedicationNames())
      setMedicationName('')
      setDose('')
      setWhen(localNow())
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
                value={when.date}
                onChange={(event) =>
                  setWhen((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Uhrzeit</span>
              <input
                type="time"
                required
                value={when.time}
                onChange={(event) =>
                  setWhen((current) => ({
                    ...current,
                    time: event.target.value,
                  }))
                }
              />
            </label>
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
