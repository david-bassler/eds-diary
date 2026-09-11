import { PAIN_INTENSITY_SCALES } from './painIntensityScales'
import './PainIntensitySelector.css'

export interface PainIntensitySelectorProps {
  value: number | null
  onChange: (value: number) => void
}

const PAIN_VALUES = Array.from({ length: 11 }, (_, index) => index)

export function PainIntensitySelector({
  value,
  onChange,
}: PainIntensitySelectorProps) {
  const inputValue = value ?? 5

  return (
    <div className="pain-intensity-selector">
      <div className="pain-intensity-selector__scale">
        <div className="pain-intensity-selector__numbers" aria-hidden="true">
          {PAIN_VALUES.map((number) => (
            <span
              key={number}
              className="pain-intensity-selector__number"
              data-selected={value === number}
            >
              {number}
            </span>
          ))}
        </div>
        <input
          className="pain-intensity-selector__input"
          type="range"
          min="0"
          max="10"
          step="1"
          value={inputValue}
          aria-label="Schmerzstärke von 0 bis 10"
          aria-valuetext={
            value === null ? 'Noch nicht ausgewählt' : `${value} von 10`
          }
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>

      {value === null ? (
        <p className="pain-intensity-selector__empty">
          Wähle eine Zahl von 0 bis 10.
        </p>
      ) : (
        <div
          className="pain-intensity-selector__descriptions"
          aria-live="polite"
        >
          {PAIN_INTENSITY_SCALES.map((scale) => (
            <article key={scale.id} className="pain-intensity-selector__card">
              <p>{scale.descriptions[value]}</p>
              <footer className="pain-intensity-selector__source">
                <span>{scale.name}</span>
                <a
                  href={scale.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Quelle ↗
                </a>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
