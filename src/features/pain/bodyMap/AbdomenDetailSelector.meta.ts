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

export const ABDOMEN_REGIONS: readonly RegionDefinition[] = [
  { id: 'right-upper-abdomen', label: 'Rechter Oberbauch', color: [104, 158, 218] },
  { id: 'upper-mid-abdomen', label: 'Mittlerer Oberbauch', color: [232, 111, 104] },
  { id: 'left-upper-abdomen', label: 'Linker Oberbauch', color: [242, 199, 94] },
  { id: 'right-mid-abdomen', label: 'Rechte Bauchseite / Flanke', color: [120, 190, 130] },
  { id: 'umbilical-region', label: 'Nabelregion / Bauchmitte', color: [155, 130, 204] },
  { id: 'left-mid-abdomen', label: 'Linke Bauchseite / Flanke', color: [110, 190, 170] },
  { id: 'right-lower-abdomen', label: 'Rechter Unterbauch', color: [225, 147, 84] },
  { id: 'lower-mid-abdomen', label: 'Unterbauch Mitte', color: [115, 135, 215] },
  { id: 'left-lower-abdomen', label: 'Linker Unterbauch', color: [225, 147, 184] },
]

export const ABDOMEN_IMAGE = `${import.meta.env.BASE_URL}body-map/details/abdomen-hitmap.png?v=1`

export function isAbdomenRegionId(regionId: string, view?: BodyView): boolean {
  return view === 'front' && regionId === 'abdomen'
}

export function abdomenDetailLabel(regionId: string): string {
  return ABDOMEN_REGIONS.find((region) => region.id === regionId)?.label ?? regionId
}

