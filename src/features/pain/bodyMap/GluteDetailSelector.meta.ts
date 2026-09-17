import type { BodyView } from '../painEntry'

export interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

export interface HitMapData {
  width: number
  height: number
  regionAtPixel: Uint8Array
  boundaryAtPixel: Uint8Array
}

export const NO_REGION = 255
export const TAP_MAX_MOVEMENT = 14

export const GLUTE_REGIONS: readonly RegionDefinition[] = [
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

export const GLUTE_IMAGE = `${import.meta.env.BASE_URL}body-map/details/glute-right-hitmap.png?v=1`

export function isGluteRegionId(regionId: string, view?: BodyView): boolean {
  return (
    view === 'back' &&
    (regionId === 'left-glute' || regionId === 'right-glute')
  )
}

export function gluteDetailLabel(regionId: string): string {
  return GLUTE_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

