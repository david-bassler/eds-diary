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
  { id: 'head', label: 'Kopf', shape: { type: 'path', d: 'M160 14 C139 14 126 31 127 55 C128 78 140 96 160 102 C180 96 192 78 193 55 C194 31 181 14 160 14 Z' } },
  { id: 'neck', label: 'Nacken / Hals', shape: { type: 'path', d: 'M143 95 C146 106 145 117 139 126 C149 134 171 134 181 126 C175 117 174 106 177 95 C168 101 152 101 143 95 Z' } },
  { id: 'chest', label: 'Brustkorb', shape: { type: 'path', d: 'M118 126 C130 121 141 118 148 117 C151 125 155 130 160 130 C165 130 169 125 172 117 C179 118 190 121 202 126 C201 154 199 185 194 214 C184 222 172 226 160 226 C148 226 136 222 126 214 C121 185 119 154 118 126 Z' } },
  { id: 'abdomen', label: 'Bauch', shape: { type: 'path', d: 'M126 214 C136 222 148 226 160 226 C172 226 184 222 194 214 C194 236 196 260 199 282 C188 292 175 297 160 297 C145 297 132 292 121 282 C124 260 126 236 126 214 Z' } },
  { id: 'pelvis', label: 'Becken / Hüfte', shape: { type: 'path', d: 'M121 282 C132 292 145 297 160 297 C175 297 188 292 199 282 C207 295 211 312 212 329 C197 341 179 347 160 347 C141 347 123 341 108 329 C109 312 113 295 121 282 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M118 126 C103 124 91 128 82 136 C76 143 73 153 74 168 C84 169 94 175 103 185 C108 165 113 144 118 126 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M74 168 C84 169 94 175 103 185 C99 205 95 225 91 243 C84 248 73 247 65 241 C67 217 70 191 74 168 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 78, cy: 252, rx: 16, ry: 15 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M65 260 C73 266 83 267 91 261 C86 282 79 304 72 325 C65 331 55 330 48 324 C52 303 58 281 65 260 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'path', d: 'M48 324 C55 330 65 331 72 325 C72 337 70 348 67 359 L60 382 C58 389 53 391 49 386 L51 367 L44 385 C42 391 37 391 34 386 L38 365 L31 381 C29 387 24 386 22 381 L29 350 C32 338 39 329 48 324 Z' } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M202 126 C217 124 229 128 238 136 C244 143 247 153 246 168 C236 169 226 175 217 185 C212 165 207 144 202 126 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M246 168 C236 169 226 175 217 185 C221 205 225 225 229 243 C236 248 247 247 255 241 C253 217 250 191 246 168 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 242, cy: 252, rx: 16, ry: 15 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M255 260 C247 266 237 267 229 261 C234 282 241 304 248 325 C255 331 265 330 272 324 C268 303 262 281 255 260 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'path', d: 'M272 324 C265 330 255 331 248 325 C248 337 250 348 253 359 L260 382 C262 389 267 391 271 386 L269 367 L276 385 C278 391 283 391 286 386 L282 365 L289 381 C291 387 296 386 298 381 L291 350 C288 338 281 329 272 324 Z' } },
  { id: 'left-thigh', label: 'Linker Oberschenkel', shape: { type: 'path', d: 'M108 329 C123 341 140 347 157 347 C155 378 152 409 148 438 C138 446 123 447 109 439 C105 404 104 365 108 329 Z' } },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', shape: { type: 'path', d: 'M212 329 C197 341 180 347 163 347 C165 378 168 409 172 438 C182 446 197 447 211 439 C215 404 216 365 212 329 Z' } },
  { id: 'left-knee', label: 'Linkes Knie', shape: { type: 'ellipse', cx: 128, cy: 456, rx: 18, ry: 20 } },
  { id: 'right-knee', label: 'Rechtes Knie', shape: { type: 'ellipse', cx: 192, cy: 456, rx: 18, ry: 20 } },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', shape: { type: 'path', d: 'M111 474 C121 481 135 482 145 474 C145 501 143 532 141 560 C133 566 123 566 115 560 C113 532 111 501 111 474 Z' } },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', shape: { type: 'path', d: 'M175 474 C185 481 199 482 209 474 C209 501 207 532 205 560 C197 566 187 566 179 560 C177 532 175 501 175 474 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'path', d: 'M115 560 C123 566 133 566 141 560 L140 585 C133 590 123 590 116 585 Z' } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'path', d: 'M179 560 C187 566 197 566 205 560 L204 585 C197 590 187 590 180 585 Z' } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M116 585 C123 590 133 590 140 585 C143 596 147 608 147 616 C146 623 140 626 131 626 L105 626 C98 625 97 620 101 613 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M180 585 C187 590 197 590 204 585 C211 595 217 605 219 613 C223 620 222 625 215 626 L189 626 C180 626 174 623 173 616 C173 608 177 596 180 585 Z' } },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', shape: { type: 'path', d: 'M160 14 C139 14 126 31 127 55 C128 78 140 96 160 102 C180 96 192 78 193 55 C194 31 181 14 160 14 Z' } },
  { id: 'neck', label: 'Nacken', shape: { type: 'path', d: 'M143 95 C146 106 145 117 139 126 C149 132 171 132 181 126 C175 117 174 106 177 95 C168 101 152 101 143 95 Z' } },
  { id: 'upper-back', label: 'Oberer Rücken', shape: { type: 'path', d: 'M118 126 C131 121 141 118 148 117 C152 123 156 126 160 126 C164 126 168 123 172 117 C179 118 189 121 202 126 C201 153 199 183 194 212 C184 220 172 224 160 224 C148 224 136 220 126 212 C121 183 119 153 118 126 Z' } },
  { id: 'lower-back', label: 'Unterer Rücken', shape: { type: 'path', d: 'M126 212 C136 220 148 224 160 224 C172 224 184 220 194 212 C194 236 196 259 199 282 C188 291 175 295 160 295 C145 295 132 291 121 282 C124 259 126 236 126 212 Z' } },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', shape: { type: 'path', d: 'M121 282 C132 291 145 295 157 295 L157 347 C139 347 122 341 108 329 C109 311 113 295 121 282 Z' } },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', shape: { type: 'path', d: 'M199 282 C188 291 175 295 163 295 L163 347 C181 347 198 341 212 329 C211 311 207 295 199 282 Z' } },
  { id: 'left-shoulder', label: 'Linke Schulter', shape: { type: 'path', d: 'M118 126 C103 124 91 128 82 136 C76 143 73 153 74 168 C84 169 94 175 103 185 C108 165 113 144 118 126 Z' } },
  { id: 'left-upper-arm', label: 'Linker Oberarm', shape: { type: 'path', d: 'M74 168 C84 169 94 175 103 185 C99 205 95 225 91 243 C84 248 73 247 65 241 C67 217 70 191 74 168 Z' } },
  { id: 'left-elbow', label: 'Linker Ellenbogen', shape: { type: 'ellipse', cx: 78, cy: 252, rx: 16, ry: 15 } },
  { id: 'left-forearm', label: 'Linker Unterarm', shape: { type: 'path', d: 'M65 260 C73 266 83 267 91 261 C86 282 79 304 72 325 C65 331 55 330 48 324 C52 303 58 281 65 260 Z' } },
  { id: 'left-hand', label: 'Linke Hand', shape: { type: 'path', d: 'M48 324 C55 330 65 331 72 325 C72 337 70 348 67 359 L60 382 C58 389 53 391 49 386 L51 367 L44 385 C42 391 37 391 34 386 L38 365 L31 381 C29 387 24 386 22 381 L29 350 C32 338 39 329 48 324 Z' } },
  { id: 'right-shoulder', label: 'Rechte Schulter', shape: { type: 'path', d: 'M202 126 C217 124 229 128 238 136 C244 143 247 153 246 168 C236 169 226 175 217 185 C212 165 207 144 202 126 Z' } },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', shape: { type: 'path', d: 'M246 168 C236 169 226 175 217 185 C221 205 225 225 229 243 C236 248 247 247 255 241 C253 217 250 191 246 168 Z' } },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', shape: { type: 'ellipse', cx: 242, cy: 252, rx: 16, ry: 15 } },
  { id: 'right-forearm', label: 'Rechter Unterarm', shape: { type: 'path', d: 'M255 260 C247 266 237 267 229 261 C234 282 241 304 248 325 C255 331 265 330 272 324 C268 303 262 281 255 260 Z' } },
  { id: 'right-hand', label: 'Rechte Hand', shape: { type: 'path', d: 'M272 324 C265 330 255 331 248 325 C248 337 250 348 253 359 L260 382 C262 389 267 391 271 386 L269 367 L276 385 C278 391 283 391 286 386 L282 365 L289 381 C291 387 296 386 298 381 L291 350 C288 338 281 329 272 324 Z' } },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', shape: { type: 'path', d: 'M108 329 C122 341 139 347 157 347 C155 378 152 409 148 438 C138 446 123 447 109 439 C105 404 104 365 108 329 Z' } },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', shape: { type: 'path', d: 'M212 329 C198 341 181 347 163 347 C165 378 168 409 172 438 C182 446 197 447 211 439 C215 404 216 365 212 329 Z' } },
  { id: 'left-knee', label: 'Linke Kniekehle', shape: { type: 'ellipse', cx: 128, cy: 456, rx: 18, ry: 20 } },
  { id: 'right-knee', label: 'Rechte Kniekehle', shape: { type: 'ellipse', cx: 192, cy: 456, rx: 18, ry: 20 } },
  { id: 'left-calf', label: 'Linke Wade', shape: { type: 'path', d: 'M111 474 C121 481 135 482 145 474 C146 501 144 532 141 560 C133 566 123 566 115 560 C112 532 110 501 111 474 Z' } },
  { id: 'right-calf', label: 'Rechte Wade', shape: { type: 'path', d: 'M175 474 C185 481 199 482 209 474 C210 501 208 532 205 560 C197 566 187 566 179 560 C176 532 174 501 175 474 Z' } },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', shape: { type: 'path', d: 'M115 560 C123 566 133 566 141 560 L140 585 C133 590 123 590 116 585 Z' } },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', shape: { type: 'path', d: 'M179 560 C187 566 197 566 205 560 L204 585 C197 590 187 590 180 585 Z' } },
  { id: 'left-foot', label: 'Linker Fuß', shape: { type: 'path', d: 'M116 585 C123 590 133 590 140 585 C143 596 147 608 147 616 C146 623 140 626 131 626 L105 626 C98 625 97 620 101 613 Z' } },
  { id: 'right-foot', label: 'Rechter Fuß', shape: { type: 'path', d: 'M180 585 C187 590 197 590 204 585 C211 595 217 605 219 613 C223 620 222 625 215 626 L189 626 C180 626 174 623 173 616 C173 608 177 596 180 585 Z' } },
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
        <g className="body-map-selector__details" aria-hidden="true">
          {view === 'front' ? (
            <>
              <path d="M137 151 Q149 144 160 151 Q171 144 183 151" />
              <path d="M160 232 C157 246 157 263 160 279" />
              <circle cx="160" cy="263" r="2.6" />
            </>
          ) : (
            <>
              <path d="M160 137 C158 177 158 220 160 278" />
              <path d="M132 158 Q145 149 152 165" />
              <path d="M188 158 Q175 149 168 165" />
            </>
          )}
        </g>

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
