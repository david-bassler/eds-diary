import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView, PainLocation } from '../painEntry'
import './BodyMapSelector.css'

export interface BodyMapSelectorProps {
  value: readonly PainLocation[]
  onChange: (locations: PainLocation[]) => void
}

interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

interface BodyMapDefinition {
  visibleImage: string
  hitMapImage: string
  regions: readonly RegionDefinition[]
}

interface HitMapData {
  width: number
  height: number
  regionAtPixel: Uint8Array
  boundaryAtPixel: Uint8Array
}

const NO_REGION = 255

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Kopf', color: [216, 133, 159] },
  { id: 'neck', label: 'Nacken / Hals', color: [219, 134, 144] },
  { id: 'chest', label: 'Brustkorb', color: [218, 136, 129] },
  { id: 'abdomen', label: 'Bauch', color: [213, 139, 116] },
  { id: 'pelvis', label: 'Becken / Hüfte', color: [205, 144, 106] },
  { id: 'left-shoulder', label: 'Linke Schulter', color: [195, 149, 98] },
  { id: 'right-shoulder', label: 'Rechte Schulter', color: [182, 155, 95] },
  { id: 'left-upper-arm', label: 'Linker Oberarm', color: [167, 159, 95] },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', color: [151, 164, 100] },
  { id: 'left-elbow', label: 'Linker Ellenbogen', color: [134, 168, 108] },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', color: [116, 171, 120] },
  { id: 'left-forearm', label: 'Linker Unterarm', color: [97, 173, 134] },
  { id: 'right-forearm', label: 'Rechter Unterarm', color: [77, 174, 149] },
  { id: 'left-hand', label: 'Linke Hand', color: [56, 175, 165] },
  { id: 'right-hand', label: 'Rechte Hand', color: [36, 174, 180] },
  { id: 'left-thigh', label: 'Linker Oberschenkel', color: [27, 173, 194] },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', color: [42, 171, 205] },
  { id: 'left-knee', label: 'Linkes Knie', color: [67, 168, 214] },
  { id: 'right-knee', label: 'Rechtes Knie', color: [93, 164, 219] },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', color: [119, 160, 220] },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', color: [143, 154, 217] },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', color: [165, 149, 211] },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', color: [183, 143, 201] },
  { id: 'left-foot', label: 'Linker Fuß', color: [198, 139, 188] },
  { id: 'right-foot', label: 'Rechter Fuß', color: [209, 135, 174] },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', color: [216, 133, 159] },
  { id: 'neck', label: 'Nacken', color: [219, 134, 144] },
  { id: 'upper-back', label: 'Oberer Rücken', color: [218, 136, 130] },
  { id: 'lower-back', label: 'Unterer Rücken', color: [214, 139, 118] },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', color: [207, 143, 107] },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', color: [197, 148, 100] },
  { id: 'left-shoulder', label: 'Linke Schulter', color: [185, 153, 95] },
  { id: 'right-shoulder', label: 'Rechte Schulter', color: [171, 158, 95] },
  { id: 'left-upper-arm', label: 'Linker Oberarm', color: [156, 163, 98] },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', color: [140, 166, 105] },
  { id: 'left-elbow', label: 'Linker Ellenbogen', color: [123, 170, 115] },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', color: [105, 172, 128] },
  { id: 'left-forearm', label: 'Linker Unterarm', color: [87, 174, 142] },
  { id: 'right-forearm', label: 'Rechter Unterarm', color: [67, 174, 157] },
  { id: 'left-hand', label: 'Linke Hand', color: [46, 175, 172] },
  { id: 'right-hand', label: 'Rechte Hand', color: [30, 174, 186] },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', color: [31, 172, 198] },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', color: [50, 170, 208] },
  { id: 'left-knee', label: 'Linke Kniekehle', color: [75, 167, 216] },
  { id: 'right-knee', label: 'Rechte Kniekehle', color: [100, 163, 219] },
  { id: 'left-calf', label: 'Linke Wade', color: [125, 158, 220] },
  { id: 'right-calf', label: 'Rechte Wade', color: [147, 153, 216] },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', color: [168, 148, 209] },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', color: [185, 143, 200] },
  { id: 'left-foot', label: 'Linker Fuß', color: [199, 138, 187] },
  { id: 'right-foot', label: 'Rechter Fuß', color: [210, 135, 174] },
]

const BODY_MAPS: Record<BodyView, BodyMapDefinition> = {
  front: {
    visibleImage: `${import.meta.env.BASE_URL}body-map/front-gray.png`,
    hitMapImage: `${import.meta.env.BASE_URL}body-map/front-hitmap.png`,
    regions: FRONT_REGIONS,
  },
  back: {
    visibleImage: `${import.meta.env.BASE_URL}body-map/back-gray.png`,
    hitMapImage: `${import.meta.env.BASE_URL}body-map/back-hitmap.png`,
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

function colorKey(red: number, green: number, blue: number): string {
  return `${red},${green},${blue}`
}

function createHitMapData(
  imageData: ImageData,
  regions: readonly RegionDefinition[],
): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height)
  regionAtPixel.fill(NO_REGION)

  const colorLookup = new Map(
    regions.map((region, index) => [
      colorKey(region.color[0], region.color[1], region.color[2]),
      index,
    ]),
  )

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    if (data[offset + 3] === 0) continue

    const regionIndex = colorLookup.get(
      colorKey(data[offset], data[offset + 1], data[offset + 2]),
    )
    if (regionIndex !== undefined) regionAtPixel[pixel] = regionIndex
  }

  const boundaryAtPixel = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const region = regionAtPixel[pixel]
      if (region === NO_REGION) continue

      let boundary = false
      for (let deltaY = -1; deltaY <= 1 && !boundary; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue

          const neighborX = x + deltaX
          const neighborY = y + deltaY
          if (
            neighborX < 0 ||
            neighborX >= width ||
            neighborY < 0 ||
            neighborY >= height ||
            regionAtPixel[neighborY * width + neighborX] !== region
          ) {
            boundary = true
            break
          }
        }
      }
      if (boundary) boundaryAtPixel[pixel] = 1
    }
  }

  return { width, height, regionAtPixel, boundaryAtPixel }
}

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
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [hitMap, setHitMap] = useState<HitMapData | null>(null)

  useEffect(() => {
    let active = true
    const image = new Image()
    image.decoding = 'async'

    image.onload = () => {
      if (!active) return

      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return

      context.drawImage(image, 0, 0)
      setHitMap(
        createHitMapData(
          context.getImageData(0, 0, canvas.width, canvas.height),
          map.regions,
        ),
      )
    }

    image.onerror = () => {
      if (active) setHitMap(null)
    }

    image.src = map.hitMapImage

    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [map.hitMapImage, map.regions])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return

    if (!hitMap) {
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    canvas.width = hitMap.width
    canvas.height = hitMap.height
    const context = canvas.getContext('2d')
    if (!context) return

    const selectedRegions = new Set<number>()
    map.regions.forEach((region, index) => {
      if (isSelected(value, view, region.id)) selectedRegions.add(index)
    })

    const overlay = context.createImageData(hitMap.width, hitMap.height)
    for (let pixel = 0; pixel < hitMap.regionAtPixel.length; pixel += 1) {
      const region = hitMap.regionAtPixel[pixel]
      if (
        region === NO_REGION ||
        hitMap.boundaryAtPixel[pixel] === 1 ||
        !selectedRegions.has(region)
      ) {
        continue
      }

      const offset = pixel * 4
      overlay.data[offset] = 45
      overlay.data[offset + 1] = 112
      overlay.data[offset + 2] = 83
      overlay.data[offset + 3] = 122
    }

    context.putImageData(overlay, 0, 0)
  }, [hitMap, map.regions, value, view])

  function selectAtPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!hitMap) return

    const rectangle = event.currentTarget.getBoundingClientRect()
    if (rectangle.width === 0 || rectangle.height === 0) return

    const x = Math.min(
      hitMap.width - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientX - rectangle.left) / rectangle.width) * hitMap.width,
        ),
      ),
    )
    const y = Math.min(
      hitMap.height - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientY - rectangle.top) / rectangle.height) * hitMap.height,
        ),
      ),
    )
    const regionIndex = hitMap.regionAtPixel[y * hitMap.width + x]
    if (regionIndex === NO_REGION) return

    const region = map.regions[regionIndex]
    if (region) onToggle(view, region.id)
  }

  return (
    <section
      className="body-map-selector__view"
      data-mobile-active={activeOnMobile}
      aria-label={title}
    >
      <h3 className="body-map-selector__view-title">{title}</h3>
      <div
        className="body-map-selector__artwork"
        role="img"
        aria-label={`${title}: Körperregion antippen. Eine vollständige Auswahl als Checkbox-Liste folgt unter den Körperkarten.`}
      >
        <img
          className="body-map-selector__image"
          src={map.visibleImage}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="body-map-selector__overlay"
          aria-hidden="true"
          onPointerDown={selectAtPointer}
        />
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
          ).map(([view, listTitle, regions]) => (
            <fieldset key={view}>
              <legend>{listTitle}</legend>
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
