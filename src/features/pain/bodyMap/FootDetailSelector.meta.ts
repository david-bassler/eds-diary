import type { BodyView } from '../painEntry'

export interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

export interface FootDetailMapDefinition {
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

export const DORSAL_REGIONS: readonly RegionDefinition[] = [
  { id: 'hindfoot', label: 'Rückfuß / Fersenbereich', color: [155, 130, 204] },
  { id: 'medial-midfoot', label: 'Innerer Mittelfuß', color: [242, 199, 94] },
  { id: 'central-dorsum', label: 'Zentraler Fußrücken', color: [120, 190, 130] },
  { id: 'lateral-midfoot', label: 'Äußerer Mittelfuß', color: [104, 158, 218] },
  { id: 'forefoot', label: 'Vorfuß / Ballenbereich', color: [225, 147, 84] },
  { id: 'great-toe', label: 'Großzehe', color: [232, 111, 104] },
  { id: 'second-toe', label: 'Zweite Zehe', color: [110, 190, 170] },
  { id: 'third-toe', label: 'Dritte Zehe', color: [93, 170, 220] },
  { id: 'fourth-toe', label: 'Vierte Zehe', color: [175, 125, 205] },
  { id: 'fifth-toe', label: 'Kleine Zehe', color: [225, 147, 184] },
]

export const PLANTAR_REGIONS: readonly RegionDefinition[] = [
  { id: 'heel', label: 'Ferse', color: [155, 130, 204] },
  { id: 'medial-arch', label: 'Inneres Fußgewölbe', color: [242, 199, 94] },
  { id: 'lateral-sole', label: 'Äußere Fußsohle', color: [104, 158, 218] },
  { id: 'forefoot-pad', label: 'Ballen / Vorfußsohle', color: [225, 147, 84] },
  { id: 'great-toe', label: 'Großzehe', color: [232, 111, 104] },
  { id: 'second-toe', label: 'Zweite Zehe', color: [110, 190, 170] },
  { id: 'third-toe', label: 'Dritte Zehe', color: [93, 170, 220] },
  { id: 'fourth-toe', label: 'Vierte Zehe', color: [175, 125, 205] },
  { id: 'fifth-toe', label: 'Kleine Zehe', color: [225, 147, 184] },
]

export const FOOT_DETAIL_MAPS: Record<BodyView, FootDetailMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/foot-dorsal-right-hitmap.png?v=1`,
    surfaceLabel: 'Fußrücken',
    regions: DORSAL_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/foot-plantar-right-hitmap.png?v=1`,
    surfaceLabel: 'Fußsohle',
    regions: PLANTAR_REGIONS,
  },
}

export const GENERIC_LABELS = new Map(
  [...DORSAL_REGIONS, ...PLANTAR_REGIONS].map(
    (region) => [region.id, region.label] as const,
  ),
)

export function isFootRegionId(regionId: string, view?: BodyView): boolean {
  return (
    (view === 'front' || view === 'back') &&
    (regionId === 'left-foot' || regionId === 'right-foot')
  )
}

export function footDetailLabel(regionId: string, view?: BodyView): string {
  const viewLabel = view
    ? FOOT_DETAIL_MAPS[view].regions.find((region) => region.id === regionId)?.label
    : undefined
  return viewLabel ?? GENERIC_LABELS.get(regionId) ?? regionId
}

