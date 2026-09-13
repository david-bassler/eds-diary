import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView } from '../painEntry'
import './GluteDetailSelector.css'

export type GluteSide = 'left' | 'right'

export interface GluteDetailSelectorProps {
  side: GluteSide
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

const GLUTE_REGIONS: readonly RegionDefinition[] = [
  { id: 'upper-gluteal', label: 'Oberes Gesäß', color: [104, 158, 218] },
  { id: 'medial-gluteal', label: 'Innere Gesäßregion', color: [120, 190, 130] },
  { id: 'central-gluteal', label: 'Zentrale Gesäßregion', color: [232, 111, 104] },
  {
    id: 'lateral-gluteal',
    label: 'Äußere Gesäß- / Hüftregion',
    color: [242, 199, 94],
  },
  { id: 'ischial-region', label: 'Sitzbeinregion', color: [155, 130, 204] },
  {
    id: 'gluteal-fold',
    label: 'Gesäßfalte / hinterer Oberschenkelansatz',
    color: [225, 147, 84],
  },
]

const GLUTE_IMAGE = `${import.meta.env.BASE_URL}body-map/details/glute-right-hitmap.png?v=1`

export function isGluteRegionId(regionId: string, view?: BodyView): boolean {
  return (
    view === 'back' &&
    (regionId === 'left-glute' || regionId === 'right-glute')
  )
}

export function gluteDetailLabel(regionId: string): string {
  return GLUTE_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

function colorKey(red: number, green: number, blue: number): string {
  return `${red},${green},${blue}`
}

function createHitMapData(imageData: ImageData): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height)
  regionAtPixel.fill(NO_REGION)

  const colorLookup = new Map(
    GLUTE_REGIONS.map((region, index) => [
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

export function GluteDetailSelector({
  side,
  value,
  onChange,
  onClose,
}: GluteDetailSelectorProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [hitMap, setHitMap] = useState<HitMapData | null>(null)
  const mirrored = side === 'left'
  const sideLabel = side === 'left'
    ? 'Linke Gesäß- / Hüftregion'
    : 'Rechte Gesäß- / Hüftregion'

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
    image.src = GLUTE_IMAGE

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
    GLUTE_REGIONS.forEach((region, index) => {
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

    const region = GLUTE_REGIONS[regionIndex]
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
      className="glute-detail-selector"
      aria-label={`${sideLabel} genauer auswählen`}
      data-side={side}
    >
      <div className="glute-detail-selector__heading">
        <div>
          <strong>{sideLabel}</strong>
          <span>Optional · mehrere Bereiche möglich</span>
        </div>
        <button type="button" onClick={onClose}>Fertig</button>
      </div>

      <div
        className="glute-detail-selector__artwork"
        data-mirrored={mirrored}
        role="img"
        aria-label={`${sideLabel}: Bereich antippen`}
      >
        <img
          className="glute-detail-selector__image"
          src={GLUTE_IMAGE}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="glute-detail-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={() => { gestureRef.current = null }}
        />
      </div>

      <div className="glute-detail-selector__selection" aria-live="polite">
        {value.length === 0 ? (
          <span>Noch keine Feinauswahl</span>
        ) : (
          <>
            <span>{value.map(gluteDetailLabel).join(', ')}</span>
            <button type="button" onClick={() => onChange([])}>
              Feinauswahl löschen
            </button>
          </>
        )}
      </div>

      <details className="glute-detail-selector__list">
        <summary>Bereiche alternativ als Liste auswählen</summary>
        <div className="glute-detail-selector__list-grid">
          {GLUTE_REGIONS.map((region) => (
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
