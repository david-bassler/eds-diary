import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BodyView, PainLocation } from '../painEntry'
import { HandDetailSelector } from './HandDetailSelector'
import { isHandRegionId } from './HandDetailSelector.meta'
import { HeadDetailSelector } from './HeadDetailSelector'
import { isHeadRegionId } from './HeadDetailSelector.meta'
import { ShoulderDetailSelector } from './ShoulderDetailSelector'
import { isShoulderRegionId } from './ShoulderDetailSelector.meta'
import { HipDetailSelector } from './HipDetailSelector'
import { isHipRegionId } from './HipDetailSelector.meta'
import { KneeDetailSelector } from './KneeDetailSelector'
import { isKneeRegionId } from './KneeDetailSelector.meta'
import { LowerBackDetailSelector } from './LowerBackDetailSelector'
import { isLowerBackRegionId } from './LowerBackDetailSelector.meta'
import { FootDetailSelector } from './FootDetailSelector'
import { isFootRegionId } from './FootDetailSelector.meta'
import { GluteDetailSelector } from './GluteDetailSelector'
import { isGluteRegionId } from './GluteDetailSelector.meta'
import { AbdomenDetailSelector } from './AbdomenDetailSelector'
import { isAbdomenRegionId } from './AbdomenDetailSelector.meta'
import { NO_REGION, TAP_MAX_MOVEMENT, SWIPE_MIN_DISTANCE, SWIPE_AXIS_RATIO, MOBILE_BODY_MAP_QUERY, FRONT_REGIONS, BACK_REGIONS, BODY_MAPS, createHitMapData, painLocationLabel } from './BodyMapSelector.meta'
import type { HitMapData, DetailTarget } from './BodyMapSelector.meta'
import './BodyMapSelector.css'

export interface BodyMapSelectorProps {
  value: readonly PainLocation[]
  onChange: (locations: PainLocation[]) => void
}

const isSelected = (value: readonly PainLocation[], view: BodyView, regionId: string) =>
  value.some((location) => location.view === view && location.regionId === regionId)

const isDetailRegionId = (view: BodyView, regionId: string) =>
  isHandRegionId(regionId) || isHeadRegionId(regionId) || isShoulderRegionId(regionId) ||
  isHipRegionId(regionId) || isKneeRegionId(regionId, view) || isLowerBackRegionId(regionId, view) ||
  isFootRegionId(regionId, view) || isGluteRegionId(regionId, view) || isAbdomenRegionId(regionId, view)

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
  if (isGluteRegionId(location.regionId, location.view)) return location.regionId === 'left-glute' ? 'Linke Gesäß- / Hüftregion' : 'Rechte Gesäß- / Hüftregion'
  if (isAbdomenRegionId(location.regionId, location.view)) return 'Bauch'
  return `${location.regionId === 'left-hand' ? 'Linke' : 'Rechte'} Hand`
}

export function BodyMapSelector({ value, onChange }: BodyMapSelectorProps) {
  const [mobileView, setMobileView] = useState<BodyView>('front')
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(() => {
    const location = value.find((item) => isDetailRegionId(item.view, item.regionId))
    return location ? { view: location.view, regionId: location.regionId } : null
  })
  const detailLocation = detailTarget ? value.find((location) => sameTarget(location, detailTarget)) : undefined

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
      {detailTarget && detailLocation && isGluteRegionId(detailTarget.regionId, detailTarget.view) && (
        <GluteDetailSelector side={detailTarget.regionId === 'left-glute' ? 'left' : 'right'} value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
      )}
      {detailTarget && detailLocation && isAbdomenRegionId(detailTarget.regionId, detailTarget.view) && (
        <AbdomenDetailSelector value={detailLocation.detailRegionIds ?? []} onChange={updateDetails} onClose={closeDetails} />
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
