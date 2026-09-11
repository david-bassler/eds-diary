import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BodyView } from '../painEntry'
import './HeadDetailSelector.css'

export interface HeadDetailSelectorProps {
  view: BodyView
  value: readonly string[]
  onChange: (regionIds: string[]) => void
  onClose: () => void
}

interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

interface HeadDetailMapDefinition {
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

const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'crown', label: 'Oberkopf / Scheitel', color: [196, 153, 235] },
  { id: 'forehead', label: 'Stirn', color: [251, 227, 121] },
  { id: 'right-temple', label: 'Rechte Schläfe', color: [245, 150, 93] },
  { id: 'left-temple', label: 'Linke Schläfe', color: [246, 151, 94] },
  { id: 'face', label: 'Gesicht / Mittelgesicht', color: [251, 136, 133] },
  { id: 'right-eye', label: 'Rechtes Auge', color: [126, 214, 178] },
  { id: 'left-eye', label: 'Linkes Auge', color: [127, 214, 179] },
  { id: 'right-ear', label: 'Rechtes Ohr', color: [135, 202, 243] },
  { id: 'left-ear', label: 'Linkes Ohr', color: [136, 202, 243] },
  { id: 'right-jaw', label: 'Rechter Kiefer', color: [130, 160, 249] },
  { id: 'left-jaw', label: 'Linker Kiefer', color: [131, 160, 249] },
  {
    id: 'right-tmj',
    label: 'Rechtes Kiefergelenk (TMJ)',
    color: [167, 242, 112],
  },
  {
    id: 'left-tmj',
    label: 'Linkes Kiefergelenk (TMJ)',
    color: [167, 242, 113],
  },
  { id: 'front-neck', label: 'Vorderer Hals', color: [136, 216, 243] },
]

const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'crown', label: 'Oberkopf / Scheitel', color: [187, 150, 240] },
  {
    id: 'central-occipital',
    label: 'Zentraler Hinterkopf',
    color: [252, 231, 113],
  },
  {
    id: 'left-occipital',
    label: 'Linker seitlicher Hinterkopf',
    color: [246, 148, 82],
  },
  {
    id: 'right-occipital',
    label: 'Rechter seitlicher Hinterkopf',
    color: [246, 147, 81],
  },
  { id: 'left-ear', label: 'Linkes Ohr', color: [158, 245, 135] },
  { id: 'right-ear', label: 'Rechtes Ohr', color: [248, 135, 134] },
  { id: 'neck', label: 'Nacken', color: [132, 217, 249] },
]

const HEAD_DETAIL_MAPS: Record<BodyView, HeadDetailMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/head-front-hitmap.png?v=1`,
    surfaceLabel: 'Vorderseite',
    regions: FRONT_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/head-back-hitmap.png?v=1`,
    surfaceLabel: 'Rückseite',
    regions: BACK_REGIONS,
  },
}

export function isHeadRegionId(regionId: string): boolean {
  return regionId === 'head'
}

export function headDetailLabel(regionId: string, view: BodyView): string {
  return (
    HEAD_DETAIL_MAPS[view].regions.find((region) => region.id === regionId)?.label ??
    regionId
  )
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

export function HeadDetailSelector({
  view,
  value,
  onChange,
  onClose,
}: HeadDetailSelectorProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [hitMap, setHitMap] = useState<HitMapData | null>(null)
  const map = HEAD_DETAIL_MAPS[view]

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
  }, [hitMap, map.regions, value])

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

    const region = map.regions[regionIndex]
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
      className="head-detail-selector"
      aria-label={`Kopf ${map.surfaceLabel} genauer auswählen`}
      data-surface={view}
    >
      <div className="head-detail-selector__heading">
        <div>
          <strong>Kopf · {map.surfaceLabel}</strong>
          <span>Optional · mehrere Bereiche möglich</span>
        </div>
        <button type="button" onClick={onClose}>
          Fertig
        </button>
      </div>

      <div
        className="head-detail-selector__artwork"
        role="img"
        aria-label={`Kopf ${map.surfaceLabel}: Bereich antippen`}
      >
        <img
          className="head-detail-selector__image"
          src={map.image}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <canvas
          ref={overlayRef}
          className="head-detail-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelGesture}
        />
      </div>

      <div className="head-detail-selector__selection" aria-live="polite">
        {value.length === 0 ? (
          <span>Noch keine Feinauswahl</span>
        ) : (
          <>
            <span>
              {value.map((regionId) => headDetailLabel(regionId, view)).join(', ')}
            </span>
            <button type="button" onClick={() => onChange([])}>
              Feinauswahl löschen
            </button>
          </>
        )}
      </div>

      <details className="head-detail-selector__list">
        <summary>Bereiche alternativ als Liste auswählen</summary>
        <div className="head-detail-selector__list-grid">
          {map.regions.map((region) => (
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
