import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync, inflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 512
const HEIGHT = 768
const VISIBLE_GRAY = 205
const OUTLINE = 24

const FRONT_REGIONS = [
  'head',
  'neck',
  'chest',
  'abdomen',
  'pelvis',
  'left-shoulder',
  'right-shoulder',
  'left-upper-arm',
  'right-upper-arm',
  'left-elbow',
  'right-elbow',
  'left-forearm',
  'right-forearm',
  'left-hand',
  'right-hand',
  'left-thigh',
  'right-thigh',
  'left-knee',
  'right-knee',
  'left-lower-leg',
  'right-lower-leg',
  'left-ankle',
  'right-ankle',
  'left-foot',
  'right-foot',
]

const BACK_REGIONS = [
  'head',
  'neck',
  'upper-back',
  'lower-back',
  'left-glute',
  'right-glute',
  'left-shoulder',
  'right-shoulder',
  'left-upper-arm',
  'right-upper-arm',
  'left-elbow',
  'right-elbow',
  'left-forearm',
  'right-forearm',
  'left-hand',
  'right-hand',
  'left-thigh',
  'right-thigh',
  'left-knee',
  'right-knee',
  'left-calf',
  'right-calf',
  'left-ankle',
  'right-ankle',
  'left-foot',
  'right-foot',
]

// The hit-map colors use approximately the same CIELAB lightness (L*=65).
// Hue therefore identifies the region without creating visible light/dark cues.
const FRONT_COLORS = [
  [216, 133, 159],
  [219, 134, 144],
  [218, 136, 129],
  [213, 139, 116],
  [205, 144, 106],
  [195, 149, 98],
  [182, 155, 95],
  [167, 159, 95],
  [151, 164, 100],
  [134, 168, 108],
  [116, 171, 120],
  [97, 173, 134],
  [77, 174, 149],
  [56, 175, 165],
  [36, 174, 180],
  [27, 173, 194],
  [42, 171, 205],
  [67, 168, 214],
  [93, 164, 219],
  [119, 160, 220],
  [143, 154, 217],
  [165, 149, 211],
  [183, 143, 201],
  [198, 139, 188],
  [209, 135, 174],
]

const BACK_COLORS = [
  [216, 133, 159],
  [219, 134, 144],
  [218, 136, 130],
  [214, 139, 118],
  [207, 143, 107],
  [197, 148, 100],
  [185, 153, 95],
  [171, 158, 95],
  [156, 163, 98],
  [140, 166, 105],
  [123, 170, 115],
  [105, 172, 128],
  [87, 174, 142],
  [67, 174, 157],
  [46, 175, 172],
  [30, 174, 186],
  [31, 172, 198],
  [50, 170, 208],
  [75, 167, 216],
  [100, 163, 219],
  [125, 158, 220],
  [147, 153, 216],
  [168, 148, 209],
  [185, 143, 200],
  [199, 138, 187],
  [210, 135, 174],
]

const FRONT_MASK =
  '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'

const BACK_MASK =
  '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'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(__dirname, '../public/body-map')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(WIDTH, 0)
  ihdr.writeUInt32BE(HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 4))
  for (let y = 0; y < HEIGHT; y += 1) {
    const targetOffset = y * (1 + WIDTH * 4)
    scanlines[targetOffset] = 0
    rgba.copy(
      scanlines,
      targetOffset + 1,
      y * WIDTH * 4,
      (y + 1) * WIDTH * 4,
    )
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function decodeMask(encoded) {
  const mask = inflateSync(Buffer.from(encoded, 'base64'))
  if (mask.length !== WIDTH * HEIGHT) {
    throw new Error(`Unexpected body-map mask size: ${mask.length}`)
  }
  return mask
}

function isBoundary(mask, index, x, y) {
  const region = mask[index]
  if (region === 0) return false

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) return true
      if (mask[ny * WIDTH + nx] !== region) return true
    }
  }
  return false
}

function renderVisible(mask) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4)

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x
      const region = mask[index]
      if (region === 0) continue

      const output = index * 4
      const shade = isBoundary(mask, index, x, y) ? OUTLINE : VISIBLE_GRAY
      rgba[output] = shade
      rgba[output + 1] = shade
      rgba[output + 2] = shade
      rgba[output + 3] = 255
    }
  }

  return encodePng(rgba)
}

function renderHitMap(mask, colors) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4)

  for (let index = 0; index < mask.length; index += 1) {
    const region = mask[index]
    if (region === 0) continue

    const color = colors[region - 1]
    if (!color) throw new Error(`Missing body-map color for region ${region}`)

    const output = index * 4
    rgba[output] = color[0]
    rgba[output + 1] = color[1]
    rgba[output + 2] = color[2]
    rgba[output + 3] = 255
  }

  return encodePng(rgba)
}

async function writeMaps(prefix, encodedMask, colors, regionNames) {
  if (colors.length !== regionNames.length) {
    throw new Error(`Region/color mismatch for ${prefix}`)
  }

  const mask = decodeMask(encodedMask)
  await Promise.all([
    writeFile(resolve(OUTPUT_DIR, `${prefix}-gray.png`), renderVisible(mask)),
    writeFile(resolve(OUTPUT_DIR, `${prefix}-hitmap.png`), renderHitMap(mask, colors)),
  ])
}

await mkdir(OUTPUT_DIR, { recursive: true })
await Promise.all([
  writeMaps('front', FRONT_MASK, FRONT_COLORS, FRONT_REGIONS),
  writeMaps('back', BACK_MASK, BACK_COLORS, BACK_REGIONS),
])
