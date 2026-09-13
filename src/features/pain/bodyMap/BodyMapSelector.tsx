import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BodyView, PainLocation } from '../painEntry'
import { HandDetailSelector, handDetailLabel, isHandRegionId } from './HandDetailSelector'
import { HeadDetailSelector, headDetailLabel, isHeadRegionId } from './HeadDetailSelector'
import { ShoulderDetailSelector, isShoulderRegionId, shoulderDetailLabel } from './ShoulderDetailSelector'
import { HipDetailSelector, hipDetailLabel, isHipRegionId } from './HipDetailSelector'
import { KneeDetailSelector, isKneeRegionId, kneeDetailLabel } from './KneeDetailSelector'
import { LowerBackDetailSelector, isLowerBackRegionId, lowerBackDetailLabel } from './LowerBackDetailSelector'
import { FootDetailSelector, footDetailLabel, isFootRegionId } from './FootDetailSelector'
import './BodyMapSelector.css'

export interface BodyMapSelectorProps {
  value: readonly PainLocation[]
  onChange: (locations: PainLocation[]) => void
}

type RegionDefinition = { id: string; label: string; color: readonly [number, number, number] }
type HitMapData = { width: number; height: number; regionAtPixel: Uint8Array; boundaryAtPixel: Uint8Array }
type DetailTarget = { view: BodyView; regionId: string }

const NO_REGION = 255
const TAP_MAX_MOVEMENT = 14
const SWIPE_MIN_DISTANCE = 56
const SWIPE_AXIS_RATIO = 1.2
const MOBILE_BODY_MAP_QUERY = '(max-width: 639px)'

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
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', color: [197, 148, 100] },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', color: [207, 143, 107] },
  { id: 'left-shoulder', label: 'Linke Schulter', color: [171, 158, 95] },
  { id: 'right-shoulder', label: 'Rechte Schulter', color: [185, 153, 95] },
  { id: 'left-upper-arm', label: 'Linker Oberarm', color: [140, 166, 105] },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', color: [156, 163, 98] },
  { id: 'left-elbow', label: 'Linker Ellenbogen', color: [105, 172, 128] },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', color: [123, 170, 115] },
  { id: 'left-forearm', label: 'Linker Unterarm', color: [67, 174, 157] },
  { id: 'right-forearm', label: 'Rechter Unterarm', color: [87, 174, 142] },
  { id: 'left-hand', label: 'Linke Hand', color: [30, 174, 186] },
  { id: 'right-hand', label: 'Rechte Hand', color: [46, 175, 172] },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', color: [50, 170, 208] },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', color: [31, 172, 198] },
  { id: 'left-knee', label: 'Linke Kniekehle', color: [100, 163, 219] },
  { id: 'right-knee', label: 'Rechte Kniekehle', color: [75, 167, 216] },
  { id: 'left-calf', label: 'Linke Wade', color: [147, 153, 216] },
  { id: 'right-calf', label: 'Rechte Wade', color: [125, 158, 220] },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', color: [185, 143, 200] },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', color: [168, 148, 209] },
  { id: 'left-foot', label: 'Linker Fuß', color: [210, 135, 174] },
  { id: 'right-foot', label: 'Rechter Fuß', color: [199, 138, 187] },
]

const BODY_MAPS = {
  front: { visibleImage: `${import.meta.env.BASE_URL}body-map/front-gray.png`, hitMapImage: `${import.meta.env.BASE_URL}body-map/front-hitmap.png`, regions: FRONT_REGIONS },
  back: { visibleImage: `${import.meta.env.BASE_URL}body-map/back-gray.png`, hitMapImage: `${import.meta.env.BASE_URL}body-map/back-hitmap.png`, regions: BACK_REGIONS },
} as const

const LABELS = new Map([
  ...FRONT_REGIONS.map((r) => [`front:${r.id}`, `Vorne: ${r.label}`] as const),
  ...BACK_REGIONS.map((r) => [`back:${r.id}`, `Hinten: ${r.label}`] as const),
])

const colorKey = (r: number, g: number, b: number) => `${r},${g},${b}`

function createHitMapData(imageData: ImageData, regions: readonly RegionDefinition[]): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height).fill(NO_REGION)
  const colorLookup = new Map(regions.map((r, i) => [colorKey(...r.color), i]))
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    if (data[offset + 3] === 0) continue
    const region = colorLookup.get(colorKey(data[offset], data[offset + 1], data[offset + 2]))
    if (region !== undefined) regionAtPixel[pixel] = region
  }
  const boundaryAtPixel = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const region = regionAtPixel[pixel]
      if (region === NO_REGION) continue
      for (let dy = -1; dy <= 1 && !boundaryAtPixel[pixel]; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || regionAtPixel[ny * width + nx] !== region) {
            boundaryAtPixel[pixel] = 1
            break
          }
        }
      }
    }
  }
  return { width, height, regionAtPixel, boundaryAtPixel }
}

function detailRegionLabel(location: PainLocation, id: string): string {
  if (isHeadRegionId(location.regionId)) return headDetailLabel(id, location.view)
  if (isShoulderRegionId(location.regionId)) return shoulderDetailLabel(id)
  if (isHipRegionId(location.regionId)) return hipDetailLabel(id)
  if (isKneeRegionId(location.regionId, location.view)) return kneeDetailLabel(id)
  if (isLowerBackRegionId(location.regionId, location.view)) return lowerBackDetailLabel(id)
  if (isFootRegionId(location.regionId, location.view)) return footDetailLabel(id, location.view)
  return handDetailLabel(id, location.view)
}

export function painLocationLabel(location: PainLocation): string {
  const base = LABELS.get(`${location.view}:${location.regionId}`) ?? location.regionId
  const details = location.detailRegionIds ?? []
  return details.length ? `${base} → ${details.map((id) => detailRegionLabel(location, id)).join(', ')}` : base
}

const isSelected = (value: readonly PainLocation[], view: BodyView, regionId: string) =>
  value.some((location) => location.view === view && location.regionId === regionId)

const isDetailRegionId = (view: BodyView, regionId: string) =>
  isHandRegionId(regionId) || isHeadRegionId(regionId) || isShoulderRegionId(regionId) ||
  isHipRegionId(regionId) || isKneeRegionId(regionId, view) || isLowerBackRegionId(regionId, view) ||
  isFootRegionId(regionId, view)

function BodyViewMap({ view, value, onToggle, onSwipe, activeOnMobile }: {
  view: BodyView
  value: readonly PainLocation[]
  onToggle: (view: BodyView, regionId: string) => void
  onSwipe: (direction: 'left' | 'right') => void
  activeOnMobile: boolean
}) {
  const map = BODY_MAPS[view]
  const title = view === 'front' ? 'Vorderseite' : 'Rückseite'
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null)
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
      setHitMap(createHitMapData(context.getImageData(0, 0, canvas.width, canvas.height), map.regions))
    }
    image.onerror = () => { if (active) setHitMap(null) }
    image.src = map.hitMapImage
    return () => { active = false; image.onload = null; image.onerror = null }
  }, [map.hitMapImage, map.regions])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    if (!hitMap) { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return }
    canvas.width = hitMap.width
    canvas.height = hitMap.height
    const context = canvas.getContext('2d')
    if (!context) return
    const selected = new Set<number>()
    map.regions.forEach((r, i) => { if (isSelected(value, view, r.id)) selected.add(i) })
    const overlay = context.createImageData(hitMap.width, hitMap.height)
    for (let pixel = 0; pixel < hitMap.regionAtPixel.length; pixel += 1) {
      const region = hitMap.regionAtPixel[pixel]
      if (region === NO_REGION || hitMap.boundaryAtPixel[pixel] || !selected.has(region)) continue
      const o = pixel * 4
      overlay.data[o] = 45
      overlay.data[o + 1] = 112
      overlay.data[o + 2] = 83
      overlay.data[o + 3] = 122
    }
    context.putImageData(overlay, 0, 0)
  }, [hitMap, map.regions, value, view])

  function selectAtPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!hitMap) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(hitMap.width - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * hitMap.width)))
    const y = Math.min(hitMap.height - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * hitMap.height)))
    const index = hitMap.regionAtPixel[y * hitMap.width + x]
    if (index !== NO_REGION) onToggle(view, map.regions[index].id)
  }

  function beginGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
  }

  function finishGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    const g = gestureRef.current
    gestureRef.current = null
    if (!g || g.pointerId !== event.pointerId) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    if (activeOnMobile && window.matchMedia(MOBILE_BODY_MAP_QUERY).matches && Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO) {
      onSwipe(dx < 0 ? 'left' : 'right')
      return
    }
    if (Math.hypot(dx, dy) <= TAP_MAX_MOVEMENT) selectAtPointer(event)
  }

  return (
    <section className="body-map-selector__view" data-mobile-active={activeOnMobile} aria-label={title}>
      <h3 className="body-map-selector__view-title">{title}</h3>
      <div className="body-map-selector__artwork" role="img" aria-label={`${title}: Körperregion antippen. Eine vollständige Auswahl als Checkbox-Liste folgt unter den Körperkarten.`}>
        <img className="body-map-selector__image" src={map.visibleImage} alt="" aria-hidden="true" draggable={false} />
        <canvas
          ref={overlayRef}
          className="body-map-selector__overlay"
          data-hit-map-ready={hitMap !== null}
          aria-hidden="true"
          onPointerDown={beginGesture}
          onPointerUp={finishGesture}
          onPointerCancel={() => { gestureRef.current = null }}
        />
      </div>
    </section>
  )
}

const sameTarget = (location: PainLocation, target: DetailTarget) =>
  location.view === target.view && location.regionId === target.regionId

function detailActionLabel(location: PainLocation): string {
  if (isHeadRegionId(location.regionId)) return `Kopf ${location.view === 'front' ? 'vorne' : 'hinten'}`
  if (isShoulderRegionId(location.regionId)) return location.regionId === 'left-shoulder' ? 'Linke Schulter' : 'Rechte Schulter'
  if (isHipRegionId(location.regionId)) return 'Becken / Hüfte'
  if (isKneeRegionId(location.regionId, location.view)) return location.regionId === 'left-knee' ? 'Linkes Knie' : 'Rechtes Knie'
  if (isLowerBackRegionId(location.regionId, location.view)) return 'Unterer Rücken'
  if (isFootRegionId(location.regionId, location.view)) return location.regionId === 'left-foot' ? 'Linker Fuß' : 'Rechter Fuß'
  return `${location.regionId === 'left-hand' ? 'Linke' : 'Rechte'} Hand`
}

export function BodyMapSelector({ value, onChange }: BodyMapSelectorProps) {
  const [mobileView, setMobileView] = useState<BodyView>('front')
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(() => {
    const location = value.find((item) => isDetailRegionId(item.view, item.regionId))
    return location ? { view: location.view, regionId: location.regionId } : null
  })
  const detailLocation = detailTarget ? value.find((location) => sameTarget(location, detailTarget)) : undefined

  useEffect(() => {
    if (detailTarget && !detailLocation) setDetailTarget(null)
  }, [detailLocation, detailTarget])

  function toggle(view: BodyView, regionId: string) {
    if (isSelected(value, view, regionId)) {
      onChange(value.filter((location) => !(location.view === view && location.regionId === regionId)))
      if (detailTarget?.view === view && detailTarget.regionId === regionId) setDetailTarget(null)
      return
    }
    onChange([...value, { view, regionId }])
    if (isDetailRegionId(view, regionId)) setDetailTarget({ view, regionId })
  }

  function updateDetails(detailRegionIds: string[]) {
    if (!detailTarget) return
    onChange(value.map((location) =>
      sameTarget(location, detailTarget)
        ? detailRegionIds.length
          ? { ...location, detailRegionIds }
          : { view: location.view, regionId: location.regionId }
        : location,
    ))
  }

  const closeDetails = () => setDetailTarget(null)
  const swipeBodyView = (direction: 'left' | 'right') =>
    setMobileView((current) =>
      direction === 'left' && current === 'front'
        ? 'back'
        : direction === 'right' && current === 'back'
          ? 'front'
          : current,
    )

  return (
    <div className="body-map-selector">
      <div className="body-map-selector__tabs" role="group" aria-label="Körperansicht">
        <button type="button" aria-pressed={mobileView === 'front'} onClick={() => setMobileView('front')}>Vorne</button>
        <button type="button" aria-pressed={mobileView === 'back'} onClick={() => setMobileView('back')}>Hinten</button>
      </div>

      <div className="body-map-selector__views">
        <BodyViewMap view="front" value={value} onToggle={toggle} onSwipe={swipeBodyView} activeOnMobile={mobileView === 'front'} />
        <BodyViewMap view="back" value={value} onToggle={toggle} onSwipe={swipeBodyView} activeOnMobile={mobileView === 'back'} />
      </div>

      {detailTarget && detailLocation && isHandRegionId(detailTarget.regionId) && (
        <HandDetailSelector view={detailTarget.view} side={detailTarget.regionId === 'left-hand' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isHeadRegionId(detailTarget.regionId) && (
        <HeadDetailSelector view={detailTarget.view} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isShoulderRegionId(detailTarget.regionId) && (
        <ShoulderDetailSelector side={detailTarget.regionId === 'left-shoulder' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isHipRegionId(detailTarget.regionId) && (
        <HipDetailSelector value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isKneeRegionId(detailTarget.regionId, detailTarget.view) && (
        <KneeDetailSelector view={detailTarget.view} side={detailTarget.regionId === 'left-knee' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isLowerBackRegionId(detailTarget.regionId, detailTarget.view) && (
        <LowerBackDetailSelector value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isFootRegionId(detailTarget.regionId, detailTarget.view) && (
        <FootDetailSelector view={detailTarget.view} side={detailTarget.regionId === 'left-foot' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}

      <div className="body-map-selector__selection" aria-live="polite">
        <strong>{value.length === 0 ? 'Noch keine Region ausgewählt' : `${value.length} ${value.length === 1 ? 'Region' : 'Regionen'} ausgewählt`}</strong>
        {value.length > 0 && (
          <>
            <span>{value.map(painLocationLabel).join(', ')}</span>
            <div className="body-map-selector__detail-actions">
              {value.filter((location) => isDetailRegionId(location.view, location.regionId)).map((location) => (
                <button
                  key={`${location.view}:${location.regionId}`}
                  type="button"
                  onClick={() => setDetailTarget({ view: location.view, regionId: location.regionId })}
                >
                  {detailActionLabel(location)} {location.detailRegionIds?.length ? 'ändern' : 'genauer auswählen'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <details className="body-map-selector__list">
        <summary>Regionen alternativ als Liste auswählen</summary>
        <div className="body-map-selector__list-grid">
          {([['front', 'Vorne', FRONT_REGIONS], ['back', 'Hinten', BACK_REGIONS]] as const).map(([view, title, regions]) => (
            <fieldset key={view}>
              <legend>{title}</legend>
              {regions.map((region) => (
                <label key={region.id}>
                  <input type="checkbox" checked={isSelected(value, view, region.id)} onChange={() => toggle(view, region.id)} />
                  <span>{region.label}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </details>
    </div>
  )
}
