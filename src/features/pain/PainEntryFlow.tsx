import { FormEvent, useEffect, useState } from 'react'
import { createPainEntry } from './painRepository'
import {
  addCustomPainType,
  listCustomPainTypes,
} from './painTypeOptions'
import type { PainLocation } from './painEntry'
import {
  BodyMapSelector,
  painLocationLabel,
} from './bodyMap/BodyMapSelector'
import './PainEntryFlow.css'

const DEFAULT_PAIN_TYPES = [
  'Stechend',
  'Ziehend',
  'Dumpf',
  'Brennend',
  'Pulsierend',
  'Drückend',
  'Krampfartig',
  'Elektrisierend',
  'Sonstiges',
] as const

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

export function PainEntryFlow() {
  const [step, setStep] = useState<1 | 2>(1)
  const [locations, setLocations] = useState<PainLocation[]>([])
  const [selectedPainTypes, setSelectedPainTypes] = useState<string[]>([])
  const [customPainTypes, setCustomPainTypes] = useState<string[]>([])
  const [newPainType, setNewPainType] = useState('')
  const [cause, setCause] = useState('')
  const [occursWhen, setOccursWhen] = useState('')
  const [note, setNote] = useState('')
  const [when, setWhen] = useState<LocalDateTime>(localNow)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    void listCustomPainTypes().then((values) => {
      if (active) setCustomPainTypes(values)
    })

    return () => {
      active = false
    }
  }, [])

  const painTypes = [
    ...DEFAULT_PAIN_TYPES,
    ...customPainTypes.filter(
      (custom) =>
        !DEFAULT_PAIN_TYPES.some(
          (preset) =>
            preset.toLocaleLowerCase('de') === custom.toLocaleLowerCase('de'),
        ),
    ),
  ]

  function togglePainType(type: string): void {
    setSelectedPainTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    )
  }

  async function addPainType(): Promise<void> {
    const trimmed = newPainType.trim()
    if (!trimmed) return

    const values = await addCustomPainType(trimmed)
    setCustomPainTypes(values)
    setNewPainType('')
    setSelectedPainTypes((current) =>
      current.some(
        (item) =>
          item.toLocaleLowerCase('de') === trimmed.toLocaleLowerCase('de'),
      )
        ? current
        : [...current, trimmed],
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const startedAt = toIso(when.date, when.time)

    if (!startedAt) {
      setStatus('Bitte ein gültiges Datum und eine gültige Uhrzeit wählen.')
      return
    }

    if (!locations.length) {
      setStep(1)
      setStatus('Bitte mindestens eine Körperregion auswählen.')
      return
    }

    if (!selectedPainTypes.length) {
      setStatus('Bitte mindestens eine Schmerzart auswählen.')
      return
    }

    setSaving(true)
    setStatus('')

    try {
      await createPainEntry({
        startedAt,
        locations,
        qualities: selectedPainTypes,
        cause,
        occursWhen,
        note,
      })

      setLocations([])
      setSelectedPainTypes([])
      setCause('')
      setOccursWhen('')
      setNote('')
      setWhen(localNow())
      setStep(1)
      setStatus('Schmerzeintrag gespeichert.')
    } catch {
      setStatus('Der Schmerzeintrag konnte lokal nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pain-entry-flow" aria-labelledby="pain-entry-flow-title">
      <div className="pain-entry-flow__progress" aria-label="Erfassungsschritte">
        <span data-active={step === 1}>1 · Region</span>
        <span data-active={step === 2}>2 · Details</span>
      </div>

      {step === 1 ? (
        <div className="pain-entry-flow__step">
          <div className="pain-entry-flow__intro">
            <p className="pain-entry-flow__eyebrow">Schritt 1 von 2</p>
            <h2 id="pain-entry-flow-title">Wo tut es weh?</h2>
            <p>
              Wähle eine oder mehrere Regionen. Auf größeren Bildschirmen siehst
              du Vorder- und Rückseite gleichzeitig.
            </p>
          </div>

          <BodyMapSelector value={locations} onChange={setLocations} />

          <div className="pain-entry-flow__footer">
            <button
              className="pain-entry-flow__primary"
              type="button"
              disabled={!locations.length}
              onClick={() => {
                setStatus('')
                setStep(2)
              }}
            >
              Weiter
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      ) : (
        <form className="pain-entry-flow__step" onSubmit={(event) => void submit(event)}>
          <div className="pain-entry-flow__intro">
            <p className="pain-entry-flow__eyebrow">Schritt 2 von 2</p>
            <h2 id="pain-entry-flow-title">Schmerzdetails</h2>
            <p>
              {locations.length} {locations.length === 1 ? 'Region' : 'Regionen'}:
              {' '}
              {locations.map(painLocationLabel).join(', ')}
            </p>
          </div>

          <fieldset className="pain-entry-flow__fieldset">
            <legend>Art des Schmerzes</legend>
            <p className="pain-entry-flow__hint">Mehrfachauswahl ist möglich.</p>
            <div className="pain-entry-flow__chips">
              {painTypes.map((type) => {
                const selected = selectedPainTypes.includes(type)
                return (
                  <button
                    key={type}
                    type="button"
                    className="pain-entry-flow__chip"
                    aria-pressed={selected}
                    onClick={() => togglePainType(type)}
                  >
                    {type}
                  </button>
                )
              })}
            </div>

            <div className="pain-entry-flow__add-type">
              <label htmlFor="new-pain-type">Eigene Schmerzart</label>
              <div>
                <input
                  id="new-pain-type"
                  value={newPainType}
                  maxLength={60}
                  placeholder="z. B. bohrend"
                  onChange={(event) => setNewPainType(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!newPainType.trim()}
                  onClick={() => void addPainType()}
                >
                  Hinzufügen
                </button>
              </div>
            </div>
          </fieldset>

          <label className="pain-entry-flow__field">
            <span>Mögliche Ursache <small>(optional)</small></span>
            <input
              type="text"
              value={cause}
              maxLength={240}
              placeholder="z. B. Überlastung, Fehlhaltung, unklare Ursache …"
              onChange={(event) => setCause(event.target.value)}
            />
          </label>

          <label className="pain-entry-flow__field">
            <span>Tritt auf, wenn <small>(optional)</small></span>
            <input
              type="text"
              value={occursWhen}
              maxLength={240}
              placeholder="z. B. beim Aufstehen, nach langem Sitzen, bei Belastung …"
              onChange={(event) => setOccursWhen(event.target.value)}
            />
          </label>

          <label className="pain-entry-flow__field">
            <span>Notizen <small>(optional)</small></span>
            <textarea
              value={note}
              maxLength={2000}
              rows={4}
              placeholder="Was möchtest du zusätzlich festhalten?"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <fieldset className="pain-entry-flow__fieldset">
            <legend>Zeitpunkt</legend>
            <p className="pain-entry-flow__hint">
              Standardmäßig ist der aktuelle Zeitpunkt eingestellt.
            </p>
            <div className="pain-entry-flow__datetime">
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

          <div className="pain-entry-flow__footer pain-entry-flow__footer--split">
            <button
              className="pain-entry-flow__secondary"
              type="button"
              onClick={() => {
                setStatus('')
                setStep(1)
              }}
            >
              <span aria-hidden="true">←</span>
              Regionen
            </button>
            <button
              className="pain-entry-flow__primary"
              type="submit"
              disabled={saving || !selectedPainTypes.length}
            >
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
        </form>
      )}

      <p className="pain-entry-flow__status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
