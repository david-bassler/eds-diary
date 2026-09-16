type HipSide = 'left' | 'right'

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

export const HIP_REGIONS: readonly RegionDefinition[] = [
  { id: 'iliac-crest', label: 'Hüftkamm', color: [120, 190, 130] },
  { id: 'anterior-hip', label: 'Vordere Hüfte', color: [242, 199, 94] },
  {
    id: 'lateral-hip',
    label: 'Äußere Hüfte / Trochanterregion',
    color: [232, 111, 104],
  },
  {
    id: 'anterior-hip-transition',
    label: 'Vorderer Hüftübergang',
    color: [104, 158, 218],
  },
  { id: 'inferior-hip', label: 'Untere Hüfte', color: [155, 130, 204] },
  {
    id: 'proximal-upper-thigh',
    label: 'Oberer Oberschenkelansatz',
    color: [225, 147, 184],
  },
]

export const HIP_IMAGE = `${import.meta.env.BASE_URL}body-map/details/hip-right-hitmap.png?v=1`

export function isHipRegionId(regionId: string): boolean {
  return regionId === 'pelvis'
}

export function splitHipRegionId(regionId: string): {
  side: HipSide | null
  regionId: string
} {
  if (regionId.startsWith('left:')) {
    return { side: 'left', regionId: regionId.slice('left:'.length) }
  }
  if (regionId.startsWith('right:')) {
    return { side: 'right', regionId: regionId.slice('right:'.length) }
  }
  return { side: null, regionId }
}

export function hipDetailLabel(regionId: string): string {
  const parsed = splitHipRegionId(regionId)
  const label =
    HIP_REGIONS.find((region) => region.id === parsed.regionId)?.label ??
    parsed.regionId
  if (!parsed.side) return label
  return `${parsed.side === 'left' ? 'Links' : 'Rechts'}: ${label}`
}

