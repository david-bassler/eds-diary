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

interface BodyMapDefinition {
  image: string
  viewBox: string
  regions: readonly RegionDefinition[]
}

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Kopf', shape: { type: 'ellipse', cx: 80, cy: 31, rx: 18, ry: 27 } },
  { id: 'neck', label: 'Nacken / Hals', shape: { type: 'path', d: 'M66 51 H95 L96 75 H64 Z' } },
  { id: 'chest', label: 'Brustkorb', shape: { type: 'path', d: 'M39 72 Q80 61 118 72 L112 132 H47 Z' } },
  { id: 'abdomen', label: 'Bauch', shape: { type: 'path', d: 'M47 126 H112 L108 184 H51 Z' } },
  { id: 'pelvis', label: 'Becken / Hüfte', shape: { type: 'path', d: 'M50 178 H109 L114 226 H45 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M36 71 Q48 65 59 71 L54 103 L31 104 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M30 91 L53 100 L35 145 L10 139 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 18, cy: 145, rx: 14, ry: 15 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M12 151 L36 142 L53 177 L33 188 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'ellipse', cx: 37, cy: 187, rx: 13, ry: 15 } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M101 70 Q113 65 124 73 L128 105 L105 103 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M111 97 L130 94 L132 149 L113 150 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 122, cy: 153, rx: 12, ry: 14 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M113 162 L132 160 L127 210 L108 209 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'ellipse', cx: 116, cy: 220, rx: 12, ry: 17 } },
  { id: 'left-thigh', label: 'Linker Oberschenkel', shape: { type: 'path', d: 'M45 215 L80 218 L78 309 L57 310 Z' } },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', shape: { type: 'path', d: 'M81 218 L114 215 L104 310 L82 309 Z' } },
  { id: 'left-knee', label: 'Linkes Knie', shape: { type: 'ellipse', cx: 67, cy: 315, rx: 13, ry: 14 } },
  { id: 'right-knee', label: 'Rechtes Knie', shape: { type: 'ellipse', cx: 94, cy: 315, rx: 13, ry: 14 } },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', shape: { type: 'path', d: 'M56 326 H78 L76 397 H59 Z' } },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', shape: { type: 'path', d: 'M82 326 H105 L101 397 H84 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'ellipse', cx: 68, cy: 400, rx: 10, ry: 10 } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'ellipse', cx: 92, cy: 400, rx: 10, ry: 10 } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M56 405 H78 L79 438 H54 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M82 405 H104 L107 438 H81 Z' } },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', shape: { type: 'ellipse', cx: 56, cy: 29, rx: 18, ry: 26 } },
  { id: 'neck', label: 'Nacken', shape: { type: 'path', d: 'M43 49 H69 L72 73 H40 Z' } },
  { id: 'upper-back', label: 'Oberer Rücken', shape: { type: 'path', d: 'M27 68 Q55 59 84 70 L80 139 H31 Z' } },
  { id: 'lower-back', label: 'Unterer Rücken', shape: { type: 'path', d: 'M31 132 H80 L78 194 H33 Z' } },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', shape: { type: 'path', d: 'M31 187 H55 L55 230 L27 226 Z' } },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', shape: { type: 'path', d: 'M56 187 H80 L84 226 L56 230 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M20 69 Q31 63 42 68 L40 102 L18 103 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M17 94 H37 L36 153 H16 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 25, cy: 157, rx: 11, ry: 13 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M16 166 H36 L37 219 H21 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'ellipse', cx: 29, cy: 229, rx: 10, ry: 15 } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M69 68 Q80 63 91 69 L93 103 L71 102 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M74 94 H94 L95 153 H75 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 85, cy: 157, rx: 11, ry: 13 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M75 166 H95 L89 219 H73 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'ellipse', cx: 80, cy: 229, rx: 10, ry: 15 } },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', shape: { type: 'path', d: 'M27 218 L55 222 L54 304 L36 305 Z' } },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', shape: { type: 'path', d: 'M56 222 L84 218 L74 305 L56 304 Z' } },
  { id: 'left-knee', label: 'Linke Kniekehle', shape: { type: 'ellipse', cx: 44, cy: 309, rx: 12, ry: 14 } },
  { id: 'right-knee', label: 'Rechte Kniekehle', shape: { type: 'ellipse', cx: 66, cy: 309, rx: 12, ry: 14 } },
  { id: 'left-calf', label: 'Linke Wade', shape: { type: 'path', d: 'M35 320 H54 L53 383 H38 Z' } },
  { id: 'right-calf', label: 'Rechte Wade', shape: { type: 'path', d: 'M56 320 H75 L72 383 H57 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'ellipse', cx: 45, cy: 387, rx: 9, ry: 10 } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'ellipse', cx: 65, cy: 387, rx: 9, ry: 10 } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M36 392 H54 L55 419 H34 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M56 392 H74 L77 419 H55 Z' } },
]

const BODY_MAPS: Record<BodyView, BodyMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/female-front.svg`,
    viewBox: '0 0 138.04 441.27',
    regions: FRONT_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/female-back.svg`,
    viewBox: '0 0 108.5 421.5',
    regions: BACK_REGIONS,
  },
}

const LABELS = new Map(
  [
    ...FRONT_REGIONS.map(
      (region) => [`front:${region.id}`, `Vorne: ${region.label}`] as const,
    ),
    ...BACK_REGIONS.map(
      (region) => [`back:${region.id}`, `Hinten: ${region.label}`] as const,
    ),
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
  value,
  onToggle,
  activeOnMobile,
}: {
  view: BodyView
  value: readonly PainLocation[]
  onToggle: (view: BodyView, regionId: string) => void
  activeOnMobile: boolean
}) {
  const title = view === 'front' ? 'Vorderseite' : 'Rückseite'
  const map = BODY_MAPS[view]

  return (
    <section
      className="body-map-selector__view"
      data-mobile-active={activeOnMobile}
      aria-label={title}
    >
      <h3 className="body-map-selector__view-title">{title}</h3>
      <div className="body-map-selector__artwork">
        <img
          className="body-map-selector__image"
          src={map.image}
          alt=""
          aria-hidden="true"
        />
        <svg
          className="body-map-selector__overlay"
          viewBox={map.viewBox}
          role="group"
          aria-label={`Körperansicht ${title}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {map.regions.map((region) => {
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
      </div>
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
          value={value}
          onToggle={toggle}
          activeOnMobile={mobileView === 'front'}
        />
        <BodyViewMap
          view="back"
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
