import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 512
const HEIGHT = 768
const VISIBLE_GRAY = 205
const OUTLINE = 24

const FRONT_REGIONS = [
  'head',
  'face',
  'jaw',
  'neck',
  'chest',
  'abdomen',
  'pelvis',
  'left-hip',
  'right-hip',
  'left-shoulder',
  'right-shoulder',
  'left-upper-arm',
  'right-upper-arm',
  'left-elbow',
  'right-elbow',
  'left-forearm',
  'right-forearm',
  'left-wrist',
  'right-wrist',
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
  'mid-back',
  'lower-back',
  'sacrum',
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
  'left-wrist',
  'right-wrist',
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(__dirname, '../public/body-map')

function regionColor(index, total) {
  const hue = (index * 360) / total
  const saturation = 0.54
  const lightness = 0.62
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hueSection = hue / 60
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (hueSection < 1) [red, green, blue] = [chroma, secondary, 0]
  else if (hueSection < 2) [red, green, blue] = [secondary, chroma, 0]
  else if (hueSection < 3) [red, green, blue] = [0, chroma, secondary]
  else if (hueSection < 4) [red, green, blue] = [0, secondary, chroma]
  else if (hueSection < 5) [red, green, blue] = [secondary, 0, chroma]
  else [red, green, blue] = [chroma, 0, secondary]

  const offset = lightness - chroma / 2
  return [red, green, blue].map((value) => Math.round((value + offset) * 255))
}

function indexFor(regions, id) {
  const index = regions.indexOf(id)
  if (index < 0) throw new Error(`Unknown body-map region: ${id}`)
  return index + 1
}

function fillCircle(mask, value, centerX, centerY, radius) {
  const minX = Math.max(0, Math.floor(centerX - radius))
  const maxX = Math.min(WIDTH - 1, Math.ceil(centerX + radius))
  const minY = Math.max(0, Math.floor(centerY - radius))
  const maxY = Math.min(HEIGHT - 1, Math.ceil(centerY + radius))
  const radiusSquared = radius * radius

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const deltaX = x - centerX
      const deltaY = y - centerY
      if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
        mask[y * WIDTH + x] = value
      }
    }
  }
}

function fillEllipse(mask, value, centerX, centerY, radiusX, radiusY) {
  const minX = Math.max(0, Math.floor(centerX - radiusX))
  const maxX = Math.min(WIDTH - 1, Math.ceil(centerX + radiusX))
  const minY = Math.max(0, Math.floor(centerY - radiusY))
  const maxY = Math.min(HEIGHT - 1, Math.ceil(centerY + radiusY))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const deltaX = (x - centerX) / radiusX
      const deltaY = (y - centerY) / radiusY
      if (deltaX * deltaX + deltaY * deltaY <= 1) {
        mask[y * WIDTH + x] = value
      }
    }
  }
}

function fillPolygon(mask, value, points) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))))
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(...points.map(([x]) => x))))
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))))
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...points.map(([, y]) => y))))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false
      for (
        let index = 0, previous = points.length - 1;
        index < points.length;
        previous = index, index += 1
      ) {
        const [currentX, currentY] = points[index]
        const [previousX, previousY] = points[previous]
        const intersects =
          currentY > y !== previousY > y &&
          x <
            ((previousX - currentX) * (y - currentY)) /
              (previousY - currentY || 1) +
              currentX
        if (intersects) inside = !inside
      }
      if (inside) mask[y * WIDTH + x] = value
    }
  }
}

function fillCapsule(
  mask,
  value,
  startX,
  startY,
  endX,
  endY,
  startRadius,
  endRadius = startRadius,
) {
  const length = Math.hypot(endX - startX, endY - startY)
  const steps = Math.max(1, Math.ceil(length / 2))

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps
    fillCircle(
      mask,
      value,
      startX + (endX - startX) * ratio,
      startY + (endY - startY) * ratio,
      startRadius + (endRadius - startRadius) * ratio,
    )
  }
}

function drawFrontMask() {
  const mask = new Uint8Array(WIDTH * HEIGHT)
  const region = (id) => indexFor(FRONT_REGIONS, id)

  fillEllipse(mask, region('head'), 256, 66, 50, 58)
  fillEllipse(mask, region('face'), 256, 82, 38, 34)
  fillEllipse(mask, region('jaw'), 256, 112, 30, 20)
  fillCapsule(mask, region('neck'), 256, 127, 256, 166, 24, 28)

  fillPolygon(mask, region('chest'), [
    [210, 154],
    [302, 154],
    [331, 190],
    [318, 275],
    [194, 275],
    [181, 190],
  ])
  fillPolygon(mask, region('abdomen'), [
    [199, 265],
    [313, 265],
    [304, 350],
    [208, 350],
  ])
  fillPolygon(mask, region('pelvis'), [
    [208, 340],
    [304, 340],
    [320, 398],
    [286, 424],
    [226, 424],
    [192, 398],
  ])

  // Anatomical left appears on the viewer's right in the front view.
  fillEllipse(mask, region('left-hip'), 299, 390, 34, 39)
  fillEllipse(mask, region('right-hip'), 213, 390, 34, 39)

  fillCircle(mask, region('left-shoulder'), 334, 190, 32)
  fillCircle(mask, region('right-shoulder'), 178, 190, 32)
  fillCapsule(mask, region('left-upper-arm'), 347, 207, 366, 290, 25, 20)
  fillCapsule(mask, region('right-upper-arm'), 165, 207, 146, 290, 25, 20)
  fillCircle(mask, region('left-elbow'), 369, 307, 21)
  fillCircle(mask, region('right-elbow'), 143, 307, 21)
  fillCapsule(mask, region('left-forearm'), 371, 324, 390, 404, 19, 15)
  fillCapsule(mask, region('right-forearm'), 141, 324, 122, 404, 19, 15)
  fillCapsule(mask, region('left-wrist'), 391, 413, 395, 432, 14, 13)
  fillCapsule(mask, region('right-wrist'), 121, 413, 117, 432, 14, 13)
  fillEllipse(mask, region('left-hand'), 398, 458, 18, 31)
  fillEllipse(mask, region('right-hand'), 114, 458, 18, 31)

  fillCapsule(mask, region('left-thigh'), 294, 418, 304, 535, 32, 25)
  fillCapsule(mask, region('right-thigh'), 218, 418, 208, 535, 32, 25)
  fillCircle(mask, region('left-knee'), 305, 558, 25)
  fillCircle(mask, region('right-knee'), 207, 558, 25)
  fillCapsule(mask, region('left-lower-leg'), 306, 580, 314, 675, 21, 15)
  fillCapsule(mask, region('right-lower-leg'), 206, 580, 198, 675, 21, 15)
  fillCapsule(mask, region('left-ankle'), 314, 684, 315, 706, 14, 13)
  fillCapsule(mask, region('right-ankle'), 198, 684, 197, 706, 14, 13)
  fillEllipse(mask, region('left-foot'), 323, 733, 25, 15)
  fillEllipse(mask, region('right-foot'), 189, 733, 25, 15)

  return mask
}

function drawBackMask() {
  const mask = new Uint8Array(WIDTH * HEIGHT)
  const region = (id) => indexFor(BACK_REGIONS, id)

  fillEllipse(mask, region('head'), 256, 68, 50, 60)
  fillCapsule(mask, region('neck'), 256, 128, 256, 166, 24, 28)
  fillPolygon(mask, region('upper-back'), [
    [210, 154],
    [302, 154],
    [331, 190],
    [321, 252],
    [191, 252],
    [181, 190],
  ])
  fillPolygon(mask, region('mid-back'), [
    [193, 244],
    [319, 244],
    [313, 323],
    [199, 323],
  ])
  fillPolygon(mask, region('lower-back'), [
    [199, 315],
    [313, 315],
    [305, 382],
    [207, 382],
  ])
  fillEllipse(mask, region('sacrum'), 256, 397, 34, 34)
  fillEllipse(mask, region('left-glute'), 219, 411, 39, 43)
  fillEllipse(mask, region('right-glute'), 293, 411, 39, 43)

  // In the back view anatomical left appears on the viewer's left.
  fillCircle(mask, region('left-shoulder'), 178, 190, 32)
  fillCircle(mask, region('right-shoulder'), 334, 190, 32)
  fillCapsule(mask, region('left-upper-arm'), 165, 207, 146, 290, 25, 20)
  fillCapsule(mask, region('right-upper-arm'), 347, 207, 366, 290, 25, 20)
  fillCircle(mask, region('left-elbow'), 143, 307, 21)
  fillCircle(mask, region('right-elbow'), 369, 307, 21)
  fillCapsule(mask, region('left-forearm'), 141, 324, 122, 404, 19, 15)
  fillCapsule(mask, region('right-forearm'), 371, 324, 390, 404, 19, 15)
  fillCapsule(mask, region('left-wrist'), 121, 413, 117, 432, 14, 13)
  fillCapsule(mask, region('right-wrist'), 391, 413, 395, 432, 14, 13)
  fillEllipse(mask, region('left-hand'), 114, 458, 18, 31)
  fillEllipse(mask, region('right-hand'), 398, 458, 18, 31)

  fillCapsule(mask, region('left-thigh'), 218, 435, 208, 535, 32, 25)
  fillCapsule(mask, region('right-thigh'), 294, 435, 304, 535, 32, 25)
  fillCircle(mask, region('left-knee'), 207, 558, 25)
  fillCircle(mask, region('right-knee'), 305, 558, 25)
  fillCapsule(mask, region('left-calf'), 206, 580, 198, 675, 21, 15)
  fillCapsule(mask, region('right-calf'), 306, 580, 314, 675, 21, 15)
  fillCapsule(mask, region('left-ankle'), 198, 684, 197, 706, 14, 13)
  fillCapsule(mask, region('right-ankle'), 314, 684, 315, 706, 14, 13)
  fillEllipse(mask, region('left-foot'), 189, 733, 25, 15)
  fillEllipse(mask, region('right-foot'), 323, 733, 25, 15)

  return mask
}

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
  const header = Buffer.alloc(13)
  header.writeUInt32BE(WIDTH, 0)
  header.writeUInt32BE(HEIGHT, 4)
  header[8] = 8
  header[9] = 6

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
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function isBoundary(mask, index, x, y) {
  const region = mask[index]
  if (region === 0) return false

  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) continue
      const neighborX = x + deltaX
      const neighborY = y + deltaY
      if (
        neighborX < 0 ||
        neighborX >= WIDTH ||
        neighborY < 0 ||
        neighborY >= HEIGHT ||
        mask[neighborY * WIDTH + neighborX] !== region
      ) {
        return true
      }
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

function renderHitMap(mask, regionCount) {
  const colors = Array.from({ length: regionCount }, (_, index) =>
    regionColor(index, regionCount),
  )
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4)

  for (let index = 0; index < mask.length; index += 1) {
    const region = mask[index]
    if (region === 0) continue

    const color = colors[region - 1]
    const output = index * 4
    rgba[output] = color[0]
    rgba[output + 1] = color[1]
    rgba[output + 2] = color[2]
    rgba[output + 3] = 255
  }

  return encodePng(rgba)
}

await mkdir(OUTPUT_DIR, { recursive: true })
const frontMask = drawFrontMask()
const backMask = drawBackMask()

await Promise.all([
  writeFile(resolve(OUTPUT_DIR, 'front-gray.png'), renderVisible(frontMask)),
  writeFile(
    resolve(OUTPUT_DIR, 'front-hitmap.png'),
    renderHitMap(frontMask, FRONT_REGIONS.length),
  ),
  writeFile(resolve(OUTPUT_DIR, 'back-gray.png'), renderVisible(backMask)),
  writeFile(
    resolve(OUTPUT_DIR, 'back-hitmap.png'),
    renderHitMap(backMask, BACK_REGIONS.length),
  ),
])
