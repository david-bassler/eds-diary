import type { BodyView } from '../painEntry'

export interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

export interface HandDetailMapDefinition {
  image: string
  surfaceLabel: string
  regions: readonly RegionDefinition[]
}

export interface HitMapData {
  width: number
  height: number
  regionAtPixel: Uint8Array
  boundaryAtPixel: Uint8Array
}

export const NO_REGION = 255
export const TAP_MAX_MOVEMENT = 14

export const WRIST_REGION: RegionDefinition = {
  id: 'wrist',
  label: 'Handgelenk',
  color: [234, 140, 140],
}

export const FINGER_REGIONS: readonly RegionDefinition[] = [
  { id: 'thumb-distal-phalanx', label: 'Daumen: Endglied', color: [188, 156, 113] },
  { id: 'thumb-distal-joint', label: 'Daumen: Endgelenk', color: [176, 161, 106] },
  { id: 'thumb-proximal-phalanx', label: 'Daumen: Grundglied', color: [166, 164, 100] },
  { id: 'thumb-base-joint', label: 'Daumen: Grundgelenk', color: [156, 167, 100] },
  { id: 'index-distal-phalanx', label: 'Zeigefinger: Endglied', color: [146, 170, 102] },
  { id: 'index-distal-joint', label: 'Zeigefinger: Endgelenk', color: [135, 173, 104] },
  { id: 'index-middle-phalanx', label: 'Zeigefinger: Mittelglied', color: [124, 176, 106] },
  { id: 'index-middle-joint', label: 'Zeigefinger: Mittelgelenk', color: [112, 179, 108] },
  { id: 'index-proximal-phalanx', label: 'Zeigefinger: Grundglied', color: [108, 180, 117] },
  { id: 'index-base-joint', label: 'Zeigefinger: Grundgelenk', color: [107, 179, 130] },
  { id: 'middle-distal-phalanx', label: 'Mittelfinger: Endglied', color: [107, 178, 143] },
  { id: 'middle-distal-joint', label: 'Mittelfinger: Endgelenk', color: [106, 176, 156] },
  { id: 'middle-middle-phalanx', label: 'Mittelfinger: Mittelglied', color: [105, 175, 169] },
  { id: 'middle-middle-joint', label: 'Mittelfinger: Mittelgelenk', color: [108, 173, 180] },
  { id: 'middle-proximal-phalanx', label: 'Mittelfinger: Grundglied', color: [115, 170, 192] },
  { id: 'middle-base-joint', label: 'Mittelfinger: Grundgelenk', color: [124, 166, 206] },
  { id: 'ring-distal-phalanx', label: 'Ringfinger: Endglied', color: [133, 162, 222] },
  { id: 'ring-distal-joint', label: 'Ringfinger: Endgelenk', color: [144, 157, 240] },
  { id: 'ring-middle-phalanx', label: 'Ringfinger: Mittelglied', color: [158, 151, 252] },
  { id: 'ring-middle-joint', label: 'Ringfinger: Mittelgelenk', color: [173, 148, 246] },
  { id: 'ring-proximal-phalanx', label: 'Ringfinger: Grundglied', color: [187, 144, 240] },
  { id: 'ring-base-joint', label: 'Ringfinger: Grundgelenk', color: [201, 140, 234] },
  { id: 'little-distal-phalanx', label: 'Kleiner Finger: Endglied', color: [214, 137, 229] },
  { id: 'little-distal-joint', label: 'Kleiner Finger: Endgelenk', color: [224, 135, 222] },
  { id: 'little-middle-phalanx', label: 'Kleiner Finger: Mittelglied', color: [226, 136, 206] },
  { id: 'little-middle-joint', label: 'Kleiner Finger: Mittelgelenk', color: [228, 137, 190] },
  { id: 'little-proximal-phalanx', label: 'Kleiner Finger: Grundglied', color: [230, 138, 173] },
  { id: 'little-base-joint', label: 'Kleiner Finger: Grundgelenk', color: [232, 139, 157] },
]

export const BACK_REGIONS: readonly RegionDefinition[] = [
  WRIST_REGION,
  { id: 'hand-back', label: 'Handrücken', color: [216, 146, 130] },
  ...FINGER_REGIONS,
]

export const FRONT_REGIONS: readonly RegionDefinition[] = [
  WRIST_REGION,
  { id: 'palm', label: 'Handfläche', color: [216, 146, 130] },
  { id: 'thenar', label: 'Daumenballen', color: [201, 152, 121] },
  ...FINGER_REGIONS,
]

export const HAND_DETAIL_MAPS: Record<BodyView, HandDetailMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/hand-palm-hitmap.png?v=3`,
    surfaceLabel: 'Handfläche',
    regions: FRONT_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/hand-top-hitmap.png?v=3`,
    surfaceLabel: 'Handrücken',
    regions: BACK_REGIONS,
  },
}

export const GENERIC_LABELS = new Map(
  [...BACK_REGIONS, ...FRONT_REGIONS].map(
    (region) => [region.id, region.label] as const,
  ),
)

export function handDetailLabel(regionId: string, view?: BodyView): string {
  if (view === 'front' && regionId === 'hand-back') return 'Handfläche'

  const viewLabel = view
    ? HAND_DETAIL_MAPS[view].regions.find((region) => region.id === regionId)?.label
    : undefined

  return viewLabel ?? GENERIC_LABELS.get(regionId) ?? regionId
}

export function isHandRegionId(regionId: string): boolean {
  return regionId === 'left-hand' || regionId === 'right-hand'
}

