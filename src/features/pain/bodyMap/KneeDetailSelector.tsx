import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView } from '../painEntry'
import './KneeDetailSelector.css'

export type KneeSide = 'left' | 'right'

export interface KneeDetailSelectorProps {
  side: KneeSide
  value: readonly string[]
  onChange: (regionIds: string[]) => void
  onClose: () => void
}

interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

interface HitMapData {
  width: number
  height: number
  regionAtPixel: Uint8Array
  boundaryAtPixel: Uint8Array
}

const NO_REGION = 255
const TAP_MAX_MOVEMENT = 14

const KNEE_REGIONS: readonly RegionDefinition[] = [
  {
    id: 'suprapatellar',
    label: 'Oberhalb der Kniescheibe',
    color: [104, 158, 218],
  },
  { id: 'patella', label: 'Kniescheibe', color: [232, 111, 104] },
  {
    id: 'medial-knee',
    label: 'Innere Knieseite',
    color: [120, 190, 130],
  },
  {
    id: 'lateral-knee',
    label: 'Äußere Knieseite',
    color: [242, 199, 94],
  },
  {
    id: 'infrapatellar',
    label: 'Unterhalb der Kniescheibe',
    color: [155, 130, 204],
  },
  {
    id: 'proximal-shin',
    label: 'Oberer Schienbeinansatz',
    color: [225, 147, 184],
  },
]

const KNEE_IMAGE = `${import.meta.env.BASE_URL}body-map/details/knee-front-right-hitmap.png?v=2`

export function isKneeRegionId(regionId: string, view: BodyView): boolean {
  return (
    view === 'front' &&
    (regionId === 'left-knee' || regionId === 'right-knee')
  )
}

export function kneeDetailLabel(regionId: string): string {
  return KNEE_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

function colorKey(red: number, green: number, blue: number): string {
  return `${red},${green},${blue}`
}

function createHitMapData(imageData: ImageData): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height)
  regionAtPixel.fill(NO_REGION)

  const colorLookup = new Map(
    KNEE_REGIONS.map((region, index) => [
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

export function KneeDetailSelector({
  side,
  value,
  onChange,
  onClose,
}: KneeDetailSelectorProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [hitMap, setHitMap] = useState<HitMapData | null>(null)
  const mirrored = side === 'left'
  const sideLabel = side === 'left' ? 'Linkes Knie' : 'Rechtes Knie'

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
        ),
      )
    }

    image.onerror = () => {
      if (active) setHitMap(null)
    }
    image.src = KNEE_IMAGE

    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    if (!hitMap) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    canvas.width = hitMap.width
    canvas.height = hitMap.height
    const context = canvas.getContext('2d')
    if (!context) return

    const selectedRegions = new Set<number>()
    KNEE_REGIONS.forEach((region, index) => {
      if (value.includes(region.id)) selectedRegions.add(index)
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
  }, [hitMap, value])

  function toggleRegion(regionId: string): void {
    onChange(
      value.includes(regionId)
        ? value.filter((selectedRegionId) => selectedRegionId !== regionId)
        : [...value, regionId],
    )
  }

  function selectAtPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!hitMap) return
    const rectangle = event.currentTarget.getBoundingClientRect()
    if (rectangle.width === 0 || rectangle.height === 0) return

    const normalizedX = (event.clientX - rectangle.left) / rectangle.width
    const sourceX = mirrored ? 1 - normalizedX : normalizedX
    const x = Math.min(
      hitMap.width - 1,
      Math.max(0, Math.floor(sourceX * hitMap.width)),
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
    const region = KNEE_REGIONS[regionIndex]
    if (region) toggleRegion(region.id)
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
    if (
      Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      ) <= TAP_MAX_MOVEMENT
    ) {
      selectAtPointer(event)
    }
  }

  return (
    <section
      className="knee-detail-selector"
      aria-label={`${sideLabel} genauer auswählen`}
      data-side={side}
    >
      <div className="knee-detail-selector__heading">
        <div>
          <strong>{sideLabel} · Vorderseite</strong>
          <span>Optional · mehrere Bereiche möglich</span>
        </div>
        <button type="button" onClick={onClose}>Fertig</button>
      </div>

      <div
        className="knee-detail-selector__artwork"
        data-mirrored={mirrored}
        role="img"
        aria-label={`${sideLabel} Vorderseite: Bereich antippen`}
      >
        <img
          className="knee-detail-selector__image"
          src={KNEE_IMAGE}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="knee-detail-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={() => { gestureRef.current = null }}
        />
      </div>

      <div className="knee-detail-selector__selection" aria-live="polite">
        {value.length === 0 ? (
          <span>Noch keine Feinauswahl</span>
        ) : (
          <>
            <span>{value.map(kneeDetailLabel).join(', ')}</span>
            <button type="button" onClick={() => onChange([])}>Feinauswahl löschen</button>
          </>
        )}
      </div>

      <details className="knee-detail-selector__list">
        <summary>Bereiche alternativ als Liste auswählen</summary>
        <div className="knee-detail-selector__list-grid">
          {KNEE_REGIONS.map((region) => (
            <label key={region.id}>
              <input
                type="checkbox"
                checked={value.includes(region.id)}
                onChange={() => toggleRegion(region.id)}
              />
              <span>{region.label}</span>
            </label>
          ))}
        </div>
      </details>
    </section>
  )
}
