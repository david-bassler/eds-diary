import type { BodyView, PainLocation } from '../painEntry'
import { handDetailLabel } from './HandDetailSelector.meta'
import { headDetailLabel, isHeadRegionId } from './HeadDetailSelector.meta'
import { shoulderDetailLabel, isShoulderRegionId } from './ShoulderDetailSelector.meta'
import { hipDetailLabel, isHipRegionId } from './HipDetailSelector.meta'
import { kneeDetailLabel, isKneeRegionId } from './KneeDetailSelector.meta'
import { lowerBackDetailLabel, isLowerBackRegionId } from './LowerBackDetailSelector.meta'
import { footDetailLabel, isFootRegionId } from './FootDetailSelector.meta'
import { gluteDetailLabel, isGluteRegionId } from './GluteDetailSelector.meta'
import { abdomenDetailLabel, isAbdomenRegionId } from './AbdomenDetailSelector.meta'

export type RegionDefinition = { id: string; label: string; color: readonly [number, number, number] }
export type HitMapData = { width: number; height: number; regionAtPixel: Uint8Array; boundaryAtPixel: Uint8Array }
export type DetailTarget = { view: BodyView; regionId: string }

export const NO_REGION = 255
export const TAP_MAX_MOVEMENT = 14
export const SWIPE_MIN_DISTANCE = 56
export const SWIPE_AXIS_RATIO = 1.2
export const MOBILE_BODY_MAP_QUERY = '(max-width: 639px)'

export const FRONT_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Kopf', color: [216, 133, 159] },
  { id: 'neck', label: 'Nacken / Hals', color: [219, 134, 144] },
  { id: 'chest', label: 'Brustkorb', color: [218, 136, 129] },
  { id: 'abdomen', label: 'Bauch', color: [213, 139, 116] },
  { id: 'pelvis', label: 'Becken / Hüfte', color: [205, 144, 106] },
  { id: 'left-shoulder', label: 'Linke Schulter', color: [195, 149, 98] },
  { id: 'right-shoulder', label: 'Rechte Schulter', color: [182, 155, 95] },
  { id: 'left-upper-arm', label: 'Linker Oberarm', color: [167, 159, 95] },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', color: [151, 164, 100] },
  { id: 'left-elbow', label: 'Linker Ellenbogen', color: [134, 168, 108] },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', color: [116, 171, 120] },
  { id: 'left-forearm', label: 'Linker Unterarm', color: [97, 173, 134] },
  { id: 'right-forearm', label: 'Rechter Unterarm', color: [77, 174, 149] },
  { id: 'left-hand', label: 'Linke Hand', color: [56, 175, 165] },
  { id: 'right-hand', label: 'Rechte Hand', color: [36, 174, 180] },
  { id: 'left-thigh', label: 'Linker Oberschenkel', color: [27, 173, 194] },
  { id: 'right-thigh', label: 'Rechter Oberschenkel', color: [42, 171, 205] },
  { id: 'left-knee', label: 'Linkes Knie', color: [67, 168, 214] },
  { id: 'right-knee', label: 'Rechtes Knie', color: [93, 164, 219] },
  { id: 'left-lower-leg', label: 'Linker Unterschenkel', color: [119, 160, 220] },
  { id: 'right-lower-leg', label: 'Rechter Unterschenkel', color: [143, 154, 217] },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', color: [165, 149, 211] },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', color: [183, 143, 201] },
  { id: 'left-foot', label: 'Linker Fuß', color: [198, 139, 188] },
  { id: 'right-foot', label: 'Rechter Fuß', color: [209, 135, 174] },
]

export const BACK_REGIONS: readonly RegionDefinition[] = [
  { id: 'head', label: 'Hinterkopf', color: [216, 133, 159] },
  { id: 'neck', label: 'Nacken', color: [219, 134, 144] },
  { id: 'upper-back', label: 'Oberer Rücken', color: [218, 136, 130] },
  { id: 'lower-back', label: 'Unterer Rücken', color: [214, 139, 118] },
  { id: 'left-glute', label: 'Linke Gesäß- / Hüftregion', color: [197, 148, 100] },
  { id: 'right-glute', label: 'Rechte Gesäß- / Hüftregion', color: [207, 143, 107] },
  { id: 'left-shoulder', label: 'Linke Schulter', color: [171, 158, 95] },
  { id: 'right-shoulder', label: 'Rechte Schulter', color: [185, 153, 95] },
  { id: 'left-upper-arm', label: 'Linker Oberarm', color: [140, 166, 105] },
  { id: 'right-upper-arm', label: 'Rechter Oberarm', color: [156, 163, 98] },
  { id: 'left-elbow', label: 'Linker Ellenbogen', color: [105, 172, 128] },
  { id: 'right-elbow', label: 'Rechter Ellenbogen', color: [123, 170, 115] },
  { id: 'left-forearm', label: 'Linker Unterarm', color: [67, 174, 157] },
  { id: 'right-forearm', label: 'Rechter Unterarm', color: [87, 174, 142] },
  { id: 'left-hand', label: 'Linke Hand', color: [30, 174, 186] },
  { id: 'right-hand', label: 'Rechte Hand', color: [46, 175, 172] },
  { id: 'left-thigh', label: 'Linker hinterer Oberschenkel', color: [50, 170, 208] },
  { id: 'right-thigh', label: 'Rechter hinterer Oberschenkel', color: [31, 172, 198] },
  { id: 'left-knee', label: 'Linke Kniekehle', color: [100, 163, 219] },
  { id: 'right-knee', label: 'Rechte Kniekehle', color: [75, 167, 216] },
  { id: 'left-calf', label: 'Linke Wade', color: [147, 153, 216] },
  { id: 'right-calf', label: 'Rechte Wade', color: [125, 158, 220] },
  { id: 'left-ankle', label: 'Linkes Sprunggelenk', color: [185, 143, 200] },
  { id: 'right-ankle', label: 'Rechtes Sprunggelenk', color: [168, 148, 209] },
  { id: 'left-foot', label: 'Linker Fuß', color: [210, 135, 174] },
  { id: 'right-foot', label: 'Rechter Fuß', color: [199, 138, 187] },
]

export const BODY_MAPS = {
  front: { visibleImage: `${import.meta.env.BASE_URL}body-map/front-gray.png`, hitMapImage: `${import.meta.env.BASE_URL}body-map/front-hitmap.png`, regions: FRONT_REGIONS },
  back: { visibleImage: `${import.meta.env.BASE_URL}body-map/back-gray.png`, hitMapImage: `${import.meta.env.BASE_URL}body-map/back-hitmap.png`, regions: BACK_REGIONS },
} as const

export const LABELS = new Map([
  ...FRONT_REGIONS.map((r) => [`front:${r.id}`, `Vorne: ${r.label}`] as const),
  ...BACK_REGIONS.map((r) => [`back:${r.id}`, `Hinten: ${r.label}`] as const),
])

export const colorKey = (r: number, g: number, b: number) => `${r},${g},${b}`

export function createHitMapData(imageData: ImageData, regions: readonly RegionDefinition[]): HitMapData {
  const { width, height, data } = imageData
  const regionAtPixel = new Uint8Array(width * height).fill(NO_REGION)
  const colorLookup = new Map(regions.map((r, i) => [colorKey(...r.color), i]))
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    if (data[offset + 3] === 0) continue
    const region = colorLookup.get(colorKey(data[offset], data[offset + 1], data[offset + 2]))
    if (region !== undefined) regionAtPixel[pixel] = region
  }
  const boundaryAtPixel = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const region = regionAtPixel[pixel]
      if (region === NO_REGION) continue
      for (let dy = -1; dy <= 1 && !boundaryAtPixel[pixel]; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || regionAtPixel[ny * width + nx] !== region) {
            boundaryAtPixel[pixel] = 1
            break
          }
        }
      }
    }
  }
  return { width, height, regionAtPixel, boundaryAtPixel }
}

export function detailRegionLabel(location: PainLocation, id: string): string {
  if (isHeadRegionId(location.regionId)) return headDetailLabel(id, location.view)
  if (isShoulderRegionId(location.regionId)) return shoulderDetailLabel(id)
  if (isHipRegionId(location.regionId)) return hipDetailLabel(id)
  if (isKneeRegionId(location.regionId, location.view)) return kneeDetailLabel(id)
  if (isLowerBackRegionId(location.regionId, location.view)) return lowerBackDetailLabel(id)
  if (isFootRegionId(location.regionId, location.view)) return footDetailLabel(id, location.view)
  if (isGluteRegionId(location.regionId, location.view)) return gluteDetailLabel(id)
  if (isAbdomenRegionId(location.regionId, location.view)) return abdomenDetailLabel(id)
  return handDetailLabel(id, location.view)
}

export function painLocationLabel(location: PainLocation): string {
  const base = LABELS.get(`${location.view}:${location.regionId}`) ?? location.regionId
  const details = location.detailRegionIds ?? []
  return details.length ? `${base} → ${details.map((id) => detailRegionLabel(location, id)).join(', ')}` : base
}

