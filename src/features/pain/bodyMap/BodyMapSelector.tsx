import { useId, useState } from 'react'
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

const FRONT_BODY_PATH =
  'M100 30 C94 38 94 58 100 70 C104 77 105 87 103 96 C95 101 84 103 74 104 C77 126 80 150 80 174 C80 195 78 216 81 232 C71 249 66 266 65 286 C63 320 69 355 78 390 C74 414 75 444 80 475 C77 495 79 514 86 530 C81 540 80 548 88 553 C96 558 108 557 112 552 C115 548 112 539 110 532 C113 494 115 454 112 416 C110 386 109 349 111 318 L112 288 C112 284 115 284 115 288 L118 318 C120 349 119 386 117 416 C114 454 116 494 120 532 C118 539 115 548 119 552 C123 557 135 558 143 553 C151 548 150 540 145 530 C152 514 154 495 151 475 C156 444 157 414 153 390 C162 355 168 320 166 286 C165 266 160 249 150 232 C153 216 151 195 151 174 C151 150 154 126 157 104 C147 103 136 101 128 96 C126 87 127 77 131 70 C137 58 137 38 131 30 C124 22 107 22 100 30 Z'

const FRONT_LEFT_ARM_PATH =
  'M76 105 C67 106 61 111 55 119 L8 188 C3 196 3 204 7 213 C18 241 34 268 51 288 C56 294 63 294 68 290 L80 259 C76 252 72 245 68 237 L38 201 L80 151 C85 143 86 132 83 121 C81 114 79 109 76 105 Z'

const FRONT_RIGHT_ARM_PATH =
  'M154 105 C165 106 176 108 184 112 C189 115 191 122 192 132 C196 156 199 181 198 202 C202 210 201 224 199 236 L191 305 C194 319 191 331 183 340 C178 346 173 350 168 351 C164 349 165 344 169 339 L177 331 C173 332 169 333 166 332 L169 313 C170 287 171 262 170 238 C169 213 167 187 166 161 C163 142 160 123 154 105 Z'

const BACK_BODY_PATH =
  'M98 68 C100 78 99 88 96 95 C89 101 80 103 70 105 C74 128 76 151 76 174 C76 195 74 216 78 232 C68 248 63 266 62 286 C60 321 66 355 75 390 C71 414 72 444 77 475 C74 495 76 514 83 530 C78 540 77 548 85 553 C93 558 105 557 109 552 C112 548 109 539 107 532 C110 494 112 454 109 416 C107 386 106 349 108 318 L109 288 C109 284 112 284 112 288 L115 318 C117 349 116 386 114 416 C111 454 113 494 117 532 C115 539 112 548 116 552 C120 557 132 558 140 553 C148 548 147 540 142 530 C149 514 151 495 148 475 C153 444 154 414 150 390 C159 355 165 321 163 286 C162 266 157 248 147 232 C151 216 149 195 149 174 C149 151 151 128 155 105 C145 103 136 101 129 95 C126 88 125 78 127 68 C120 64 105 64 98 68 Z'

const BACK_LEFT_ARM_PATH =
  'M71 105 C59 107 51 112 48 123 C43 146 42 174 43 198 C39 209 40 225 42 239 L50 305 C50 321 54 332 61 339 C65 343 68 344 70 341 L68 326 C66 296 66 270 67 243 C69 216 71 191 72 164 C75 143 78 123 71 105 Z'

const BACK_RIGHT_ARM_PATH =
  'M154 105 C166 107 174 112 177 123 C182 146 183 174 182 198 C186 209 185 225 183 239 L175 305 C175 321 171 332 164 339 C160 343 157 344 155 341 L157 326 C159 296 159 270 158 243 C156 216 154 191 153 164 C150 143 147 123 154 105 Z'

const FRONT_HAIR_PATH =
  'M88 75 C83 54 85 20 100 7 C113 -4 137 0 147 15 C157 31 158 55 153 78 L137 75 C139 58 139 39 133 33 C126 26 106 26 100 33 C94 40 95 59 101 75 Z'

const BACK_HAIR_PATH =
  'M80 68 C77 45 79 17 94 6 C108 -4 132 0 143 15 C151 28 153 48 149 71 C127 66 102 65 80 68 Z'

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Kopf', shape: { type: 'ellipse', cx: 115, cy: 48, rx: 31, ry: 44 } },
  { id: 'neck', label: 'Nacken / Hals', shape: { type: 'path', d: 'M91 78 L136 78 L136 110 L91 110 Z' } },
  { id: 'chest', label: 'Brustkorb', shape: { type: 'path', d: 'M70 103 L158 103 L153 180 L77 180 Z' } },
  { id: 'abdomen', label: 'Bauch', shape: { type: 'path', d: 'M77 174 L153 174 L151 238 L80 238 Z' } },
  { id: 'pelvis', label: 'Becken / Hüfte', shape: { type: 'path', d: 'M65 230 L166 230 L166 300 L63 300 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M55 105 L88 103 L88 145 L42 158 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M43 145 L82 145 L57 208 L12 212 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 25, cy: 218, rx: 22, ry: 23 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M20 224 L60 205 L82 263 L51 291 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'ellipse', cx: 62, cy: 286, rx: 22, ry: 25 } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M145 103 L185 108 L194 150 L151 151 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M163 145 L199 142 L202 225 L168 225 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 185, cy: 228, rx: 19, ry: 22 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M169 231 L199 231 L192 309 L166 309 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'ellipse', cx: 179, cy: 327, rx: 20, ry: 28 } },
  { id: 'left-thigh', label: 'Linker Oberschenkel', shape: { type: 'path', d: 'M63 286 L113 286 L112 391 L75 394 Z' } },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', shape: { type: 'path', d: 'M115 286 L166 286 L153 394 L117 391 Z' } },
  { id: 'left-knee', label: 'Linkes Knie', shape: { type: 'ellipse', cx: 93, cy: 397, rx: 22, ry: 24 } },
  { id: 'right-knee', label: 'Rechtes Knie', shape: { type: 'ellipse', cx: 135, cy: 397, rx: 22, ry: 24 } },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', shape: { type: 'path', d: 'M76 411 L112 411 L111 510 L79 510 Z' } },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', shape: { type: 'path', d: 'M117 411 L153 411 L150 510 L119 510 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'ellipse', cx: 95, cy: 512, rx: 18, ry: 18 } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'ellipse', cx: 134, cy: 512, rx: 18, ry: 18 } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M78 517 L113 517 L115 558 L76 558 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M116 517 L151 517 L154 558 L115 558 Z' } },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', shape: { type: 'ellipse', cx: 112, cy: 40, rx: 34, ry: 42 } },
  { id: 'neck', label: 'Nacken', shape: { type: 'path', d: 'M91 65 L133 65 L137 108 L88 108 Z' } },
  { id: 'upper-back', label: 'Oberer Rücken', shape: { type: 'path', d: 'M69 103 L156 103 L151 184 L74 184 Z' } },
  { id: 'lower-back', label: 'Unterer Rücken', shape: { type: 'path', d: 'M75 178 L151 178 L149 239 L78 239 Z' } },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', shape: { type: 'path', d: 'M62 231 L111 231 L111 302 L61 302 Z' } },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', shape: { type: 'path', d: 'M112 231 L164 231 L164 302 L112 302 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M48 103 L88 103 L84 150 L42 151 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M42 140 L72 140 L70 224 L41 224 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 55, cy: 229, rx: 18, ry: 21 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M42 230 L69 230 L70 310 L49 310 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'ellipse', cx: 61, cy: 324, rx: 17, ry: 25 } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M137 103 L177 103 L183 151 L141 150 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M153 140 L183 140 L184 224 L155 224 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 170, cy: 229, rx: 18, ry: 21 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M156 230 L183 230 L176 310 L155 310 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'ellipse', cx: 164, cy: 324, rx: 17, ry: 25 } },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', shape: { type: 'path', d: 'M60 286 L110 286 L109 391 L73 394 Z' } },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', shape: { type: 'path', d: 'M112 286 L164 286 L150 394 L114 391 Z' } },
  { id: 'left-knee', label: 'Linke Kniekehle', shape: { type: 'ellipse', cx: 90, cy: 397, rx: 22, ry: 24 } },
  { id: 'right-knee', label: 'Rechte Kniekehle', shape: { type: 'ellipse', cx: 132, cy: 397, rx: 22, ry: 24 } },
  { id: 'left-calf', label: 'Linke Wade', shape: { type: 'path', d: 'M73 411 L109 411 L108 510 L76 510 Z' } },
  { id: 'right-calf', label: 'Rechte Wade', shape: { type: 'path', d: 'M114 411 L150 411 L147 510 L116 510 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'ellipse', cx: 92, cy: 512, rx: 18, ry: 18 } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'ellipse', cx: 131, cy: 512, rx: 18, ry: 18 } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M75 517 L110 517 L112 558 L73 558 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M113 517 L148 517 L151 558 L112 558 Z' } },
]

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

function Silhouette({ view, clipId }: { view: BodyView; clipId: string }) {
  if (view === 'front') {
    return (
      <>
        <defs>
          <clipPath id={clipId}>
            <path d={FRONT_LEFT_ARM_PATH} />
            <path d={FRONT_RIGHT_ARM_PATH} />
            <path d={FRONT_BODY_PATH} />
            <path d={FRONT_HAIR_PATH} />
          </clipPath>
        </defs>

        <g className="body-map-selector__silhouette">
          <path d={FRONT_LEFT_ARM_PATH} />
          <path d={FRONT_RIGHT_ARM_PATH} />
          <path d={FRONT_BODY_PATH} />
          <path className="body-map-selector__hair" d={FRONT_HAIR_PATH} />
          <g className="body-map-selector__anatomy">
            <path d="M72 166 C82 173 91 171 98 163" />
            <path d="M132 163 C139 171 149 173 158 166" />
          </g>
        </g>
      </>
    )
  }

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={BACK_LEFT_ARM_PATH} />
          <path d={BACK_RIGHT_ARM_PATH} />
          <path d={BACK_BODY_PATH} />
          <path d={BACK_HAIR_PATH} />
        </clipPath>
      </defs>

      <g className="body-map-selector__silhouette">
        <path d={BACK_LEFT_ARM_PATH} />
        <path d={BACK_RIGHT_ARM_PATH} />
        <path d={BACK_BODY_PATH} />
        <path className="body-map-selector__hair" d={BACK_HAIR_PATH} />
        <g className="body-map-selector__anatomy">
          <path d="M76 270 C88 277 101 278 110 267" />
          <path d="M110 267 C119 278 132 277 144 270" />
        </g>
      </g>
    </>
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
  const generatedId = useId()
  const clipId = `body-clip-${view}-${generatedId.replaceAll(':', '')}`

  return (
    <section
      className="body-map-selector__view"
      data-mobile-active={activeOnMobile}
      aria-label={title}
    >
      <h3 className="body-map-selector__view-title">{title}</h3>
      <svg
        className="body-map-selector__svg"
        viewBox="0 0 220 560"
        role="group"
        aria-label={`Körperansicht ${title}`}
      >
        <Silhouette view={view} clipId={clipId} />

        <g clipPath={`url(#${clipId})`}>
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
        </g>
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
