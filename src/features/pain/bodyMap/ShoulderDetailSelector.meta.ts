

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

export const SHOULDER_REGIONS: readonly RegionDefinition[] = [
  {
    id: 'clavicular-shoulder-base',
    label: 'Schulterbasis',
    color: [232, 154, 177],
  },
  { id: 'ac-joint', label: 'Schulterdach / AC-Gelenk', color: [244, 203, 92] },
  {
    id: 'anterior-deltoid',
    label: 'Vordere Schulter',
    color: [234, 112, 108],
  },
  {
    id: 'lateral-shoulder',
    label: 'Seitliche Schulter',
    color: [104, 154, 218],
  },
  {
    id: 'inferior-shoulder-axillary',
    label: 'Untere Schulter / Achsel',
    color: [116, 190, 126],
  },
  {
    id: 'proximal-upper-arm',
    label: 'Oberarmansatz',
    color: [166, 135, 214],
  },
]

export const SHOULDER_IMAGE = `${import.meta.env.BASE_URL}body-map/details/shoulder-right-hitmap.png?v=1`

export function isShoulderRegionId(regionId: string): boolean {
  return regionId === 'left-shoulder' || regionId === 'right-shoulder'
}

export function shoulderDetailLabel(regionId: string): string {
  return SHOULDER_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

