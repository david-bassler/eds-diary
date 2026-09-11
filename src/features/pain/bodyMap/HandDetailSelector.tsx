import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView } from '../painEntry'
import './HandDetailSelector.css'

export interface HandDetailSelectorProps {
  view: BodyView
  side: 'left' | 'right'
  value: readonly string[]
  onChange: (regionIds: string[]) => void
  onClose: () => void
}

interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

interface HandDetailMapDefinition {
  image: string
  surfaceLabel: string
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

const FINGER_REGIONS: readonly RegionDefinition[] = [
  { id: 'thumb-distal-joint', label: 'Daumen: Endgelenk', color: [218, 136, 129] },
  { id: 'thumb-base-joint', label: 'Daumen: Grundgelenk', color: [213, 139, 116] },
  { id: 'index-distal-joint', label: 'Zeigefinger: Endgelenk', color: [205, 144, 106] },
  { id: 'index-middle-joint', label: 'Zeigefinger: Mittelgelenk', color: [195, 149, 98] },
  { id: 'index-base-joint', label: 'Zeigefinger: Grundgelenk', color: [182, 155, 95] },
  { id: 'middle-distal-joint', label: 'Mittelfinger: Endgelenk', color: [167, 159, 95] },
  { id: 'middle-middle-joint', label: 'Mittelfinger: Mittelgelenk', color: [151, 164, 100] },
  { id: 'middle-base-joint', label: 'Mittelfinger: Grundgelenk', color: [134, 168, 108] },
  { id: 'ring-distal-joint', label: 'Ringfinger: Endgelenk', color: [116, 171, 120] },
  { id: 'ring-middle-joint', label: 'Ringfinger: Mittelgelenk', color: [97, 173, 134] },
  { id: 'ring-base-joint', label: 'Ringfinger: Grundgelenk', color: [77, 174, 149] },
  { id: 'little-distal-joint', label: 'Kleiner Finger: Endgelenk', color: [56, 175, 165] },
  { id: 'little-middle-joint', label: 'Kleiner Finger: Mittelgelenk', color: [36, 174, 180] },
  { id: 'little-base-joint', label: 'Kleiner Finger: Grundgelenk', color: [27, 173, 194] },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'wrist', label: 'Handgelenk', color: [216, 133, 159] },
  { id: 'hand-back', label: 'Handrücken', color: [219, 134, 144] },
  ...FINGER_REGIONS,
]

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'wrist', label: 'Handgelenk', color: [216, 133, 159] },
  { id: 'palm', label: 'Handfläche', color: [219, 134, 144] },
  { id: 'thenar', label: 'Daumenballen', color: [42, 171, 205] },
  ...FINGER_REGIONS,
]

const HAND_DETAIL_MAPS: Record<BodyView, HandDetailMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/hand-palm-hitmap.png`,
    surfaceLabel: 'Handfläche',
    regions: FRONT_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/hand-top-hitmap.png`,
    surfaceLabel: 'Handrücken',
    regions: BACK_REGIONS,
  },
}

const GENERIC_LABELS = new Map(
  [...BACK_REGIONS, ...FRONT_REGIONS].map(
    (region) => [region.id, region.label] as const,
  ),
)

export function handDetailLabel(regionId: string, view?: BodyView): string {
  if (view === 'front' && regionId === 'hand-back') return 'Handfläche'

  const viewLabel = view
    ? HAND_DETAIL_MAPS[view].regions.find((region) => region.id === regionId)?.label
    : undefined

  return viewLabel ?? GENERIC_LABELS.get(regionId) ?? regionId
}

export function isHandRegionId(regionId: string): boolean {
  return regionId === 'left-hand' || regionId === 'right-hand'
}

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

export function HandDetailSelector({
  view,
  side,
  value,
  onChange,
  onClose,
}: HandDetailSelectorProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [hitMap, setHitMap] = useState<HitMapData | null>(null)
  const map = HAND_DETAIL_MAPS[view]
  const mirrored = side === 'right'

  useEffect(() => {
    let active = true
    const image = new Image()
    image.decoding = 'async'
    setHitMap(null)

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

    image.src = map.image

    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [map.image, map.regions])

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
      const selected =
        value.includes(region.id) ||
        (view === 'front' &&
          region.id === 'palm' &&
          value.includes('hand-back'))
      if (selected) selectedRegions.add(index)
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
      overlay.data[offset + 3] = 145
    }

    context.putImageData(overlay, 0, 0)
  }, [hitMap, map.regions, value, view])

  function selectAtPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!hitMap) return

    const rectangle = event.currentTarget.getBoundingClientRect()
    if (rectangle.width === 0 || rectangle.height === 0) return

    const rawX = Math.min(
      hitMap.width - 1,
      Math.max(
        0,
        Math.floor(
          ((event.clientX - rectangle.left) / rectangle.width) * hitMap.width,
        ),
      ),
    )
    const x = mirrored ? hitMap.width - 1 - rawX : rawX
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
    if (!region) return

    const legacyPalmSelected =
      view === 'front' &&
      region.id === 'palm' &&
      value.includes('hand-back')
    const selected = value.includes(region.id) || legacyPalmSelected
    const normalizedValue =
      view === 'front' ? value.filter((regionId) => regionId !== 'hand-back') : value

    onChange(
      selected
        ? normalizedValue.filter((regionId) => regionId !== region.id)
        : [...normalizedValue, region.id],
    )
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

    const movement = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    )
    if (movement <= TAP_MAX_MOVEMENT) selectAtPointer(event)
  }

  function cancelGesture(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = null
    }
  }

  return (
    <section
      className="hand-detail-selector"
      aria-label={`${side === 'left' ? 'Linke' : 'Rechte'} Hand genauer auswählen`}
      data-surface={view}
    >
      <div className="hand-detail-selector__heading">
        <div>
          <strong>
            {side === 'left' ? 'Linke Hand' : 'Rechte Hand'} · {map.surfaceLabel}
          </strong>
          <span>Optional · mehrere Bereiche möglich</span>
        </div>
        <button type="button" onClick={onClose}>
          Fertig
        </button>
      </div>

      <div
        className="hand-detail-selector__artwork"
        data-mirrored={mirrored}
        role="img"
        aria-label={`${map.surfaceLabel}, Handregionen und Fingergelenke antippen`}
      >
        <img
          className="hand-detail-selector__image"
          src={map.image}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="hand-detail-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelGesture}
        />
      </div>

      <div className="hand-detail-selector__selection" aria-live="polite">
        {value.length === 0 ? (
          <span>Noch keine Feinauswahl</span>
        ) : (
          <>
            <span>{value.map((regionId) => handDetailLabel(regionId, view)).join(', ')}</span>
            <button type="button" onClick={() => onChange([])}>
              Feinauswahl löschen
            </button>
          </>
        )}
      </div>
    </section>
  )
}
