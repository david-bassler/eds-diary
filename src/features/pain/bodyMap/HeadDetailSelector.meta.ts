import type { BodyView } from '../painEntry'

export interface RegionDefinition {
  id: string
  label: string
  color: readonly [number, number, number]
}

export interface HeadDetailMapDefinition {
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

export const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'crown', label: 'Oberkopf / Scheitel', color: [196, 153, 235] },
  { id: 'forehead', label: 'Stirn', color: [251, 227, 121] },
  { id: 'right-temple', label: 'Rechte Schläfe', color: [245, 150, 93] },
  { id: 'left-temple', label: 'Linke Schläfe', color: [246, 151, 94] },
  { id: 'face', label: 'Gesicht / Mittelgesicht', color: [251, 136, 133] },
  { id: 'right-eye', label: 'Rechtes Auge', color: [126, 214, 178] },
  { id: 'left-eye', label: 'Linkes Auge', color: [127, 214, 179] },
  { id: 'right-ear', label: 'Rechtes Ohr', color: [135, 202, 243] },
  { id: 'left-ear', label: 'Linkes Ohr', color: [136, 202, 243] },
  { id: 'right-jaw', label: 'Rechter Kiefer', color: [130, 160, 249] },
  { id: 'left-jaw', label: 'Linker Kiefer', color: [131, 160, 249] },
  {
    id: 'right-tmj',
    label: 'Rechtes Kiefergelenk (TMJ)',
    color: [167, 242, 112],
  },
  {
    id: 'left-tmj',
    label: 'Linkes Kiefergelenk (TMJ)',
    color: [167, 242, 113],
  },
  { id: 'front-neck', label: 'Vorderer Hals', color: [136, 216, 243] },
]

export const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'crown', label: 'Oberkopf / Scheitel', color: [187, 150, 240] },
  {
    id: 'central-occipital',
    label: 'Zentraler Hinterkopf',
    color: [252, 231, 113],
  },
  {
    id: 'left-occipital',
    label: 'Linker seitlicher Hinterkopf',
    color: [246, 148, 82],
  },
  {
    id: 'right-occipital',
    label: 'Rechter seitlicher Hinterkopf',
    color: [246, 147, 81],
  },
  { id: 'left-ear', label: 'Linkes Ohr', color: [158, 245, 135] },
  { id: 'right-ear', label: 'Rechtes Ohr', color: [248, 135, 134] },
  { id: 'neck', label: 'Nacken', color: [132, 217, 249] },
]

export const HEAD_DETAIL_MAPS: Record<BodyView, HeadDetailMapDefinition> = {
  front: {
    image: `${import.meta.env.BASE_URL}body-map/details/head-front-hitmap.png?v=1`,
    surfaceLabel: 'Vorderseite',
    regions: FRONT_REGIONS,
  },
  back: {
    image: `${import.meta.env.BASE_URL}body-map/details/head-back-hitmap.png?v=1`,
    surfaceLabel: 'Rückseite',
    regions: BACK_REGIONS,
  },
}

export function isHeadRegionId(regionId: string): boolean {
  return regionId === 'head'
}

export function headDetailLabel(regionId: string, view: BodyView): string {
  return (
    HEAD_DETAIL_MAPS[view].regions.find((region) => region.id === regionId)?.label ??
    regionId
  )
}

