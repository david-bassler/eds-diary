import { type FormEvent, useEffect, useState } from 'react'
import { listMedicationNames } from './medicationRepository'
import { createMedicationPrescription } from './medicationPrescriptionRepository'
import './MedicationPrescriptionForm.css'

function localToday(): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MedicationPrescriptionForm() {
  const [medicationName, setMedicationName] = useState('')
  const [prescribedOn, setPrescribedOn] = useState(localToday)
  const [prescriber, setPrescriber] = useState('')
  const [reason, setReason] = useState('')
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

    const name = medicationName.trim()
    if (!name) {
      setStatus('Bitte einen Medikamentennamen eingeben.')
      return
    }
    if (!prescribedOn) {
      setStatus('Bitte ein Datum der Verordnung wählen.')
      return
    }

    setSaving(true)
    setStatus('')

    try {
      await createMedicationPrescription({
        medicationName: name,
        prescribedOn,
        prescriber,
        reason,
      })

      setKnownMedicationNames(await listMedicationNames())
      setMedicationName('')
      setPrescribedOn(localToday())
      setPrescriber('')
      setReason('')
      setStatus('Medikamentenverordnung gespeichert.')
    } catch {
      setStatus('Die Medikamentenverordnung konnte lokal nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="medication-prescription-form"
      aria-labelledby="medication-prescription-form-title"
    >
      <div className="medication-prescription-form__intro">
        <h2 id="medication-prescription-form-title">
          Verordnung dokumentieren
        </h2>
      </div>

      <form
        className="medication-prescription-form__form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="medication-prescription-form__field">
          <span>Medikament</span>
          <input
            type="text"
            list="prescription-medication-name-options"
            value={medicationName}
            maxLength={120}
            autoComplete="off"
            required
            placeholder="Medikamentenname"
            onChange={(event) => setMedicationName(event.target.value)}
          />
          <datalist id="prescription-medication-name-options">
            {knownMedicationNames.map((name) => (
              <option key={name.toLocaleLowerCase('de')} value={name} />
            ))}
          </datalist>
        </label>

        <label className="medication-prescription-form__field">
          <span>Datum der Verordnung</span>
          <input
            type="date"
            value={prescribedOn}
            required
            onChange={(event) => setPrescribedOn(event.target.value)}
          />
        </label>

        <label className="medication-prescription-form__field">
          <span>
            Verschrieben von <small>(optional)</small>
          </span>
          <input
            type="text"
            value={prescriber}
            maxLength={160}
            placeholder="z. B. Hausarztpraxis oder Name"
            onChange={(event) => setPrescriber(event.target.value)}
          />
        </label>

        <label className="medication-prescription-form__field">
          <span>
            Grund / Anlass <small>(optional)</small>
          </span>
          <textarea
            value={reason}
            maxLength={500}
            rows={3}
            placeholder="Weshalb wurde das Medikament verordnet?"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <div className="medication-prescription-form__footer">
          <button
            className="medication-prescription-form__primary"
            type="submit"
            disabled={saving || !medicationName.trim() || !prescribedOn}
          >
            {saving ? 'Speichert …' : 'Verordnung speichern'}
          </button>
        </div>
      </form>

      <p className="medication-prescription-form__status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
