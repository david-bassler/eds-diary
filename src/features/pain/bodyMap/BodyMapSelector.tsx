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

interface RegionMeta {
  id: string
  label: string
}

interface RegionDefinition extends RegionMeta {
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
const TAP_MAX_MOVEMENT = 14
const SWIPE_MIN_DISTANCE = 56
const SWIPE_AXIS_RATIO = 1.2
const MOBILE_BODY_MAP_QUERY = '(max-width: 639px)'

const FRONT_REGION_META: readonly RegionMeta[] = [
  { id: 'head', label: 'Kopf' },
  { id: 'face', label: 'Gesicht' },
  { id: 'jaw', label: 'Kiefer / Kiefergelenk' },
  { id: 'neck', label: 'Nacken / Hals' },
  { id: 'chest', label: 'Brustkorb' },
  { id: 'abdomen', label: 'Bauch' },
  { id: 'pelvis', label: 'Becken / Leiste' },
  { id: 'left-hip', label: 'Linke Hüfte' },
  { id: 'right-hip', label: 'Rechte Hüfte' },
  { id: 'left-shoulder', label: 'Linke Schulter' },
  { id: 'right-shoulder', label: 'Rechte Schulter' },
  { id: 'left-upper-arm', label: 'Linker Oberarm' },
  { id: 'right-upper-arm', label: 'Rechter Oberarm' },
  { id: 'left-elbow', label: 'Linker Ellenbogen' },
  { id: 'right-elbow', label: 'Rechter Ellenbogen' },
  { id: 'left-forearm', label: 'Linker Unterarm' },
  { id: 'right-forearm', label: 'Rechter Unterarm' },
  { id: 'left-wrist', label: 'Linkes Handgelenk' },
  { id: 'right-wrist', label: 'Rechtes Handgelenk' },
  { id: 'left-hand', label: 'Linke Hand' },
  { id: 'right-hand', label: 'Rechte Hand' },
  { id: 'left-thigh', label: 'Linker Oberschenkel' },
  { id: 'right-thigh', label: 'Rechter Oberschenkel' },
  { id: 'left-knee', label: 'Linkes Knie' },
  { id: 'right-knee', label: 'Rechtes Knie' },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel' },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel' },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk' },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk' },
  { id: 'left-foot', label: 'Linker Fuß' },
  { id: 'right-foot', label: 'Rechter Fuß' },
]

const BACK_REGION_META: readonly RegionMeta[] = [
  { id: 'head', label: 'Hinterkopf' },
  { id: 'neck', label: 'Nacken' },
  { id: 'upper-back', label: 'Oberer Rücken' },
  { id: 'mid-back', label: 'Mittlerer Rücken / BWS' },
  { id: 'lower-back', label: 'Unterer Rücken / LWS' },
  { id: 'sacrum', label: 'Kreuzbein / SI-Bereich' },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion' },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion' },
  { id: 'left-shoulder', label: 'Linke Schulter' },
  { id: 'right-shoulder', label: 'Rechte Schulter' },
  { id: 'left-upper-arm', label: 'Linker Oberarm' },
  { id: 'right-upper-arm', label: 'Rechter Oberarm' },
  { id: 'left-elbow', label: 'Linker Ellenbogen' },
  { id: 'right-elbow', label: 'Rechter Ellenbogen' },
  { id: 'left-forearm', label: 'Linker Unterarm' },
  { id: 'right-forearm', label: 'Rechter Unterarm' },
  { id: 'left-wrist', label: 'Linkes Handgelenk' },
  { id: 'right-wrist', label: 'Rechtes Handgelenk' },
  { id: 'left-hand', label: 'Linke Hand' },
  { id: 'right-hand', label: 'Rechte Hand' },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel' },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel' },
  { id: 'left-knee', label: 'Linke Kniekehle' },
  { id: 'right-knee', label: 'Rechte Kniekehle' },
  { id: 'left-calf', label: 'Linke Wade' },
  { id: 'right-calf', label: 'Rechte Wade' },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk' },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk' },
  { id: 'left-foot', label: 'Linker Fuß' },
  { id: 'right-foot', label: 'Rechter Fuß' },
]

function regionColor(
  index: number,
  total: number,
): readonly [number, number, number] {
  const hue = (index * 360) / total
  const saturation = 0.54
  const lightness = 0.62
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hueSection = hue / 60
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (hueSection < 1) [red, green, blue] = [chroma, secondary, 0]
  else if (hueSection < 2) [red, green, blue] = [secondary, chroma, 0]
  else if (hueSection < 3) [red, green, blue] = [0, chroma, secondary]
  else if (hueSection < 4) [red, green, blue] = [0, secondary, chroma]
  else if (hueSection < 5) [red, green, blue] = [secondary, 0, chroma]
  else [red, green, blue] = [chroma, 0, secondary]

  const offset = lightness - chroma / 2
  return [red, green, blue].map((value) =>
    Math.round((value + offset) * 255),
  ) as [number, number, number]
}

function withRegionColors(
  regions: readonly RegionMeta[],
): readonly RegionDefinition[] {
  return regions.map((region, index) => ({
    ...region,
    color: regionColor(index, regions.length),
  }))
}

const FRONT_REGIONS = withRegionColors(FRONT_REGION_META)
const BACK_REGIONS = withRegionColors(BACK_REGION_META)

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
  onSwipe,
  activeOnMobile,
}: {
  view: BodyView
  value: readonly PainLocation[]
  onToggle: (view: BodyView, regionId: string) => void
  onSwipe: (direction: 'left' | 'right') => void
  activeOnMobile: boolean
}) {
  const title = view === 'front' ? 'Vorderseite' : 'Rückseite'
  const map = BODY_MAPS[view]
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
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

  function beginGesture(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  function finishGesture(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture || gesture.pointerId !== event.pointerId) return

    const deltaX = event.clientX - gesture.startX
    const deltaY = event.clientY - gesture.startY
    const horizontalDistance = Math.abs(deltaX)
    const verticalDistance = Math.abs(deltaY)

    const isMobileSwipe =
      activeOnMobile &&
      window.matchMedia(MOBILE_BODY_MAP_QUERY).matches &&
      horizontalDistance >= SWIPE_MIN_DISTANCE &&
      horizontalDistance > verticalDistance * SWIPE_AXIS_RATIO

    if (isMobileSwipe) {
      onSwipe(deltaX < 0 ? 'left' : 'right')
      return
    }

    if (Math.hypot(deltaX, deltaY) <= TAP_MAX_MOVEMENT) {
      selectAtPointer(event)
    }
  }

  function cancelGesture(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = null
    }
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
        aria-label={`${title}: Körperregion antippen.`}
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
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelGesture}
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

  function swipeBodyView(direction: 'left' | 'right'): void {
    setMobileView((current) => {
      if (direction === 'left' && current === 'front') return 'back'
      if (direction === 'right' && current === 'back') return 'front'
      return current
    })
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
          onSwipe={swipeBodyView}
          activeOnMobile={mobileView === 'front'}
        />
        <BodyViewMap
          view="back"
          value={value}
          onToggle={toggle}
          onSwipe={swipeBodyView}
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
    </div>
  )
}
