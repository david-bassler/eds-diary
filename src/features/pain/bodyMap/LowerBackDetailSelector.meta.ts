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

export const LOWER_BACK_REGIONS: readonly RegionDefinition[] = [
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

export const LOWER_BACK_IMAGE = `${import.meta.env.BASE_URL}body-map/details/lower-back-hitmap.png?v=2`

export function isLowerBackRegionId(regionId: string, view: BodyView): boolean {
  return view === 'back' && regionId === 'lower-back'
}

export function lowerBackDetailLabel(regionId: string): string {
  return LOWER_BACK_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

