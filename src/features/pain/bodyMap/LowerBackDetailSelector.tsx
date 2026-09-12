import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView } from '../painEntry'
import './LowerBackDetailSelector.css'

export interface LowerBackDetailSelectorProps {
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

const LOWER_BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'lumbar-midline', label: 'LWS Mitte', color: [232, 111, 104] },
  {
    id: 'left-paraspinal-lumbar',
    label: 'Linker paraspinaler Bereich',
    color: [104, 158, 218],
  },
  {
    id: 'right-paraspinal-lumbar',
    label: 'Rechter paraspinaler Bereich',
    color: [120, 190, 130],
  },
  { id: 'sacrum', label: 'Kreuzbein', color: [155, 130, 204] },
  { id: 'left-si-joint', label: 'Linkes SI-Gelenk', color: [242, 199, 94] },
  { id: 'right-si-joint', label: 'Rechtes SI-Gelenk', color: [225, 147, 184] },
]

const LOWER_BACK_IMAGE = `${import.meta.env.BASE_URL}body-map/details/lower-back-hitmap.png?v=1`

export function isLowerBackRegionId(regionId: string, view: BodyView): boolean {
  return view === 'back' && regionId === 'lower-back'
}

export function lowerBackDetailLabel(regionId: string): string {
  return LOWER_BACK_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

function colorKey(red: number, green: number, blue: number): string {
  return `${red},${green},${blue}`
}

function createHitMapData(imageData: ImageData): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height)
  regionAtPixel.fill(NO_REGION)

  const colorLookup = new Map(
    LOWER_BACK_REGIONS.map((region, index) => [
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

export function LowerBackDetailSelector({
  value,
  onChange,
  onClose,
}: LowerBackDetailSelectorProps) {
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
    image.src = LOWER_BACK_IMAGE

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
    LOWER_BACK_REGIONS.forEach((region, index) => {
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
    const region = LOWER_BACK_REGIONS[regionIndex]
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
      className="lower-back-detail-selector"
      aria-label="Unteren Rücken genauer auswählen"
    >
      <div className="lower-back-detail-selector__heading">
        <div>
          <strong>Unterer Rücken · Rückseite</strong>
          <span>Optional · mehrere Bereiche möglich</span>
        </div>
        <button type="button" onClick={onClose}>Fertig</button>
      </div>

      <div
        className="lower-back-detail-selector__artwork"
        role="img"
        aria-label="Unterer Rücken: Bereich antippen"
      >
        <img
          className="lower-back-detail-selector__image"
          src={LOWER_BACK_IMAGE}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="lower-back-detail-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={() => { gestureRef.current = null }}
        />
      </div>

      <div className="lower-back-detail-selector__selection" aria-live="polite">
        {value.length === 0 ? (
          <span>Noch keine Feinauswahl</span>
        ) : (
          <>
            <span>{value.map(lowerBackDetailLabel).join(', ')}</span>
            <button type="button" onClick={() => onChange([])}>Feinauswahl löschen</button>
          </>
        )}
      </div>

      <details className="lower-back-detail-selector__list">
        <summary>Bereiche alternativ als Liste auswählen</summary>
        <div className="lower-back-detail-selector__list-grid">
          {LOWER_BACK_REGIONS.map((region) => (
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
