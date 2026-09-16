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

export const FRONT_KNEE_REGIONS: readonly RegionDefinition[] = [
  {
    id: 'suprapatellar',
    label: 'Oberhalb der Kniescheibe',
    color: [104, 158, 218],
  },
  { id: 'patella', label: 'Kniescheibe', color: [232, 111, 104] },
  {
    id: 'medial-knee',
    label: 'Innere Knieseite',
    color: [120, 190, 130],
  },
  {
    id: 'lateral-knee',
    label: 'Äußere Knieseite',
    color: [242, 199, 94],
  },
  {
    id: 'infrapatellar',
    label: 'Unterhalb der Kniescheibe',
    color: [155, 130, 204],
  },
  {
    id: 'proximal-shin',
    label: 'Oberer Schienbeinansatz',
    color: [225, 147, 184],
  },
]

export const BACK_KNEE_REGIONS: readonly RegionDefinition[] = [
  {
    id: 'distal-thigh',
    label: 'Distaler Oberschenkel',
    color: [104, 181, 103],
  },
  {
    id: 'medial-posterior-knee',
    label: 'Innere Kniekehle / innere Knierückseite',
    color: [242, 199, 94],
  },
  {
    id: 'popliteal-fossa',
    label: 'Zentrale Kniekehle',
    color: [232, 111, 104],
  },
  {
    id: 'lateral-posterior-knee',
    label: 'Äußere Kniekehle / äußere Knierückseite',
    color: [104, 158, 218],
  },
  {
    id: 'upper-calf-transition',
    label: 'Übergang zur Wade',
    color: [155, 130, 204],
  },
  {
    id: 'proximal-calf',
    label: 'Obere Wade',
    color: [225, 147, 84],
  },
]

export const KNEE_MAPS: Record<BodyView, {
  image: string
  regions: readonly RegionDefinition[]
  label: string
}> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/knee-front-right-hitmap.png?v=2`,
    regions: FRONT_KNEE_REGIONS,
    label: 'Vorderseite',
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/knee-back-right-hitmap.png?v=1`,
    regions: BACK_KNEE_REGIONS,
    label: 'Rückseite',
  },
}

export function isKneeRegionId(regionId: string, view: BodyView): boolean {
  return (
    (view === 'front' || view === 'back') &&
    (regionId === 'left-knee' || regionId === 'right-knee')
  )
}

export function kneeDetailLabel(regionId: string): string {
  const regions = [...FRONT_KNEE_REGIONS, ...BACK_KNEE_REGIONS]
  return regions.find((region) => region.id === regionId)?.label ?? regionId
}

