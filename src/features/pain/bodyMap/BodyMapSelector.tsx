import { useState } from 'react'
import type { BodyView, PainLocation } from '../painEntry'
import './BodyMapSelector.css'

export interface BodyMapSelectorProps {
  value: readonly PainLocation[]
  onChange: (locations: PainLocation[]) => void
}

interface RegionDefinition {
  id: string
  label: string
  shape:
    | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'path'; d: string }
}

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Kopf', shape: { type: 'ellipse', cx: 160, cy: 58, rx: 35, ry: 44 } },
  { id: 'neck', label: 'Nacken / Hals', shape: { type: 'path', d: 'M145 96 L145 119 Q160 129 175 119 L175 96 Z' } },
  { id: 'chest', label: 'Brustkorb', shape: { type: 'path', d: 'M116 126 Q136 118 145 116 Q160 126 175 116 Q184 118 204 126 L196 219 Q178 226 160 226 Q142 226 124 219 Z' } },
  { id: 'abdomen', label: 'Bauch', shape: { type: 'path', d: 'M124 219 Q142 226 160 226 Q178 226 196 219 L200 286 Q179 297 160 297 Q141 297 120 286 Z' } },
  { id: 'pelvis', label: 'Becken / Hüfte', shape: { type: 'path', d: 'M120 286 Q141 297 160 297 Q179 297 200 286 L211 329 Q185 343 160 343 Q135 343 109 329 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M116 126 Q93 128 83 147 L79 177 Q94 176 108 185 L120 155 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M79 177 Q94 176 108 185 L94 244 Q82 250 68 242 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 79, cy: 252, rx: 17, ry: 16 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M67 263 Q80 270 91 262 L72 327 Q62 333 50 325 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'path', d: 'M50 325 Q62 333 72 327 L68 353 L58 382 Q53 392 47 386 L50 366 L43 386 Q39 395 33 389 L38 364 L30 382 Q26 390 21 384 L29 351 Q33 335 50 325 Z' } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M204 126 Q227 128 237 147 L241 177 Q226 176 212 185 L200 155 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M241 177 Q226 176 212 185 L226 244 Q238 250 252 242 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 241, cy: 252, rx: 17, ry: 16 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M253 263 Q240 270 229 262 L248 327 Q258 333 270 325 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'path', d: 'M270 325 Q258 333 248 327 L252 353 L262 382 Q267 392 273 386 L270 366 L277 386 Q281 395 287 389 L282 364 L290 382 Q294 390 299 384 L291 351 Q287 335 270 325 Z' } },
  { id: 'left-thigh', label: 'Linker Oberschenkel', shape: { type: 'path', d: 'M109 329 Q134 342 155 343 L148 441 Q129 449 108 440 Q99 387 109 329 Z' } },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', shape: { type: 'path', d: 'M211 329 Q186 342 165 343 L172 441 Q191 449 212 440 Q221 387 211 329 Z' } },
  { id: 'left-knee', label: 'Linkes Knie', shape: { type: 'ellipse', cx: 128, cy: 457, rx: 19, ry: 21 } },
  { id: 'right-knee', label: 'Rechtes Knie', shape: { type: 'ellipse', cx: 192, cy: 457, rx: 19, ry: 21 } },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', shape: { type: 'path', d: 'M111 475 Q128 484 145 475 L141 563 Q128 571 115 563 Z' } },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', shape: { type: 'path', d: 'M175 475 Q192 484 209 475 L205 563 Q192 571 179 563 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'path', d: 'M115 563 Q128 571 141 563 L140 587 Q128 593 116 587 Z' } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'path', d: 'M179 563 Q192 571 205 563 L204 587 Q192 593 180 587 Z' } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M116 587 Q128 593 140 587 L146 615 Q147 625 136 626 L105 626 Q97 624 101 614 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M180 587 Q192 593 204 587 L219 614 Q223 624 215 626 L184 626 Q173 625 174 615 Z' } },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', shape: { type: 'ellipse', cx: 160, cy: 58, rx: 35, ry: 44 } },
  { id: 'neck', label: 'Nacken', shape: { type: 'path', d: 'M145 96 L145 119 Q160 126 175 119 L175 96 Z' } },
  { id: 'upper-back', label: 'Oberer Rücken', shape: { type: 'path', d: 'M116 126 Q138 117 145 116 Q160 125 175 116 Q182 117 204 126 L196 215 Q177 222 160 222 Q143 222 124 215 Z' } },
  { id: 'lower-back', label: 'Unterer Rücken', shape: { type: 'path', d: 'M124 215 Q143 222 160 222 Q177 222 196 215 L200 286 Q180 295 160 295 Q140 295 120 286 Z' } },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', shape: { type: 'path', d: 'M120 286 Q140 295 157 295 L157 343 Q132 348 109 329 Z' } },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', shape: { type: 'path', d: 'M200 286 Q180 295 163 295 L163 343 Q188 348 211 329 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M116 126 Q93 128 83 147 L79 177 Q94 176 108 185 L120 155 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M79 177 Q94 176 108 185 L94 244 Q82 250 68 242 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 79, cy: 252, rx: 17, ry: 16 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M67 263 Q80 270 91 262 L72 327 Q62 333 50 325 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'path', d: 'M50 325 Q62 333 72 327 L68 353 L58 382 Q53 392 47 386 L50 366 L43 386 Q39 395 33 389 L38 364 L30 382 Q26 390 21 384 L29 351 Q33 335 50 325 Z' } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M204 126 Q227 128 237 147 L241 177 Q226 176 212 185 L200 155 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M241 177 Q226 176 212 185 L226 244 Q238 250 252 242 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 241, cy: 252, rx: 17, ry: 16 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M253 263 Q240 270 229 262 L248 327 Q258 333 270 325 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'path', d: 'M270 325 Q258 333 248 327 L252 353 L262 382 Q267 392 273 386 L270 366 L277 386 Q281 395 287 389 L282 364 L290 382 Q294 390 299 384 L291 351 Q287 335 270 325 Z' } },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', shape: { type: 'path', d: 'M109 329 Q132 348 157 343 L148 441 Q129 449 108 440 Q99 387 109 329 Z' } },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', shape: { type: 'path', d: 'M211 329 Q188 348 163 343 L172 441 Q191 449 212 440 Q221 387 211 329 Z' } },
  { id: 'left-knee', label: 'Linke Kniekehle', shape: { type: 'ellipse', cx: 128, cy: 457, rx: 19, ry: 21 } },
  { id: 'right-knee', label: 'Rechte Kniekehle', shape: { type: 'ellipse', cx: 192, cy: 457, rx: 19, ry: 21 } },
  { id: 'left-calf', label: 'Linke Wade', shape: { type: 'path', d: 'M111 475 Q128 484 145 475 L141 563 Q128 571 115 563 Z' } },
  { id: 'right-calf', label: 'Rechte Wade', shape: { type: 'path', d: 'M175 475 Q192 484 209 475 L205 563 Q192 571 179 563 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'path', d: 'M115 563 Q128 571 141 563 L140 587 Q128 593 116 587 Z' } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'path', d: 'M179 563 Q192 571 205 563 L204 587 Q192 593 180 587 Z' } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M116 587 Q128 593 140 587 L146 615 Q147 625 136 626 L105 626 Q97 624 101 614 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M180 587 Q192 593 204 587 L219 614 Q223 624 215 626 L184 626 Q173 625 174 615 Z' } },
]

const LABELS = new Map(
  [
    ...FRONT_REGIONS.map((region) => [`front:${region.id}`, `Vorne: ${region.label}`] as const),
    ...BACK_REGIONS.map((region) => [`back:${region.id}`, `Hinten: ${region.label}`] as const),
  ],
)

export function painLocationLabel(location: PainLocation): string {
  return LABELS.get(`${location.view}:${location.regionId}`) ?? location.regionId
}

function isSelected(
  value: readonly PainLocation[],
  view: BodyView,
  regionId: string,
): boolean {
  return value.some(
    (location) => location.view === view && location.regionId === regionId,
  )
}

function BodyViewMap({
  view,
  regions,
  value,
  onToggle,
  activeOnMobile,
}: {
  view: BodyView
  regions: readonly RegionDefinition[]
  value: readonly PainLocation[]
  onToggle: (view: BodyView, regionId: string) => void
  activeOnMobile: boolean
}) {
  const title = view === 'front' ? 'Vorderseite' : 'Rückseite'

  return (
    <section
      className="body-map-selector__view"
      data-mobile-active={activeOnMobile}
      aria-label={title}
    >
      <h3 className="body-map-selector__view-title">{title}</h3>
      <svg
        className="body-map-selector__svg"
        viewBox="0 0 320 640"
        role="group"
        aria-label={`Körperansicht ${title}`}
      >
        {regions.map((region) => {
          const selected = isSelected(value, view, region.id)
          const commonProps = {
            className: 'body-map-selector__region',
            'data-selected': selected,
            role: 'button',
            tabIndex: 0,
            'aria-pressed': selected,
            'aria-label': `${title}: ${region.label}`,
            onClick: () => onToggle(view, region.id),
            onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onToggle(view, region.id)
            },
          }

          return region.shape.type === 'ellipse' ? (
            <ellipse
              key={region.id}
              {...commonProps}
              cx={region.shape.cx}
              cy={region.shape.cy}
              rx={region.shape.rx}
              ry={region.shape.ry}
            />
          ) : (
            <path key={region.id} {...commonProps} d={region.shape.d} />
          )
        })}
      </svg>
    </section>
  )
}

export function BodyMapSelector({ value, onChange }: BodyMapSelectorProps) {
  const [mobileView, setMobileView] = useState<BodyView>('front')

  function toggle(view: BodyView, regionId: string): void {
    const selected = isSelected(value, view, regionId)
    onChange(
      selected
        ? value.filter(
            (location) =>
              !(location.view === view && location.regionId === regionId),
          )
        : [...value, { view, regionId }],
    )
  }

  return (
    <div className="body-map-selector">
      <div
        className="body-map-selector__tabs"
        role="group"
        aria-label="Körperansicht"
      >
        <button
          type="button"
          aria-pressed={mobileView === 'front'}
          onClick={() => setMobileView('front')}
        >
          Vorne
        </button>
        <button
          type="button"
          aria-pressed={mobileView === 'back'}
          onClick={() => setMobileView('back')}
        >
          Hinten
        </button>
      </div>

      <div className="body-map-selector__views">
        <BodyViewMap
          view="front"
          regions={FRONT_REGIONS}
          value={value}
          onToggle={toggle}
          activeOnMobile={mobileView === 'front'}
        />
        <BodyViewMap
          view="back"
          regions={BACK_REGIONS}
          value={value}
          onToggle={toggle}
          activeOnMobile={mobileView === 'back'}
        />
      </div>

      <div className="body-map-selector__selection" aria-live="polite">
        <strong>
          {value.length === 0
            ? 'Noch keine Region ausgewählt'
            : `${value.length} ${value.length === 1 ? 'Region' : 'Regionen'} ausgewählt`}
        </strong>
        {value.length > 0 ? (
          <span>{value.map(painLocationLabel).join(', ')}</span>
        ) : null}
      </div>

      <details className="body-map-selector__list">
        <summary>Regionen alternativ als Liste auswählen</summary>
        <div className="body-map-selector__list-grid">
          {(
            [
              ['front', 'Vorne', FRONT_REGIONS],
              ['back', 'Hinten', BACK_REGIONS],
            ] as const
          ).map(([view, title, regions]) => (
            <fieldset key={view}>
              <legend>{title}</legend>
              {regions.map((region) => {
                const checked = isSelected(value, view, region.id)
                return (
                  <label key={region.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(view, region.id)}
                    />
                    <span>{region.label}</span>
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
      </details>
    </div>
  )
}
