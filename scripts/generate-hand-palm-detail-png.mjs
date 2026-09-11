import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 558
const HEIGHT = 1022
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/body-map/details/hand-palm-hitmap.png',
)

const SILHOUETTE = [[252,8],[237,11],[223,24],[219,31],[215,47],[214,104],[216,107],[214,109],[212,152],[205,223],[208,227],[205,230],[204,324],[201,346],[198,352],[193,329],[187,263],[184,260],[186,258],[186,250],[175,163],[172,159],[174,155],[168,106],[161,85],[149,73],[138,69],[131,69],[120,73],[106,88],[102,103],[105,163],[108,166],[106,168],[110,258],[111,267],[114,270],[112,273],[112,285],[119,358],[119,371],[116,383],[112,375],[99,332],[95,327],[97,325],[79,256],[76,253],[77,248],[68,210],[60,188],[46,174],[32,172],[23,176],[12,187],[8,198],[10,233],[14,260],[18,264],[16,266],[23,315],[28,341],[32,345],[30,350],[46,424],[48,469],[51,472],[48,476],[49,514],[58,581],[72,628],[104,693],[117,729],[121,751],[124,754],[122,756],[125,779],[124,870],[118,945],[110,1005],[111,1013],[356,1012],[347,933],[344,860],[345,796],[349,768],[352,760],[351,754],[355,749],[361,732],[360,730],[388,687],[421,648],[453,615],[468,595],[479,571],[492,526],[507,487],[506,484],[509,481],[549,401],[548,390],[537,378],[532,375],[521,372],[511,372],[496,377],[484,386],[463,408],[403,498],[398,502],[393,497],[377,464],[374,461],[375,458],[367,429],[365,396],[363,394],[366,391],[372,338],[383,272],[381,269],[384,266],[397,174],[395,169],[399,162],[405,118],[404,97],[400,88],[389,77],[380,73],[366,73],[360,76],[350,85],[344,95],[331,156],[333,158],[330,161],[311,252],[313,255],[310,258],[294,339],[290,351],[287,352],[284,341],[287,232],[284,228],[287,225],[285,111],[282,108],[285,105],[285,44],[278,24],[264,11]]
const REGIONS = [{"id":"wrist","color":[216,133,159],"points":[[127,756],[130,779],[129,870],[124,935],[115,1012],[352,1012],[342,933],[339,860],[340,796],[347,756],[309,764],[262,768],[196,767],[160,763]]},{"id":"palm","color":[219,134,144],"points":[[120,386],[116,404],[102,427],[92,439],[53,476],[56,537],[65,590],[81,638],[101,676],[115,708],[122,729],[126,751],[153,758],[216,764],[292,762],[328,757],[349,751],[356,732],[333,717],[316,700],[302,678],[293,650],[291,616],[298,571],[304,551],[319,518],[343,484],[370,459],[362,429],[360,396],[331,389],[313,381],[304,375],[288,357],[266,362],[238,363],[219,361],[201,356],[184,369],[169,377],[140,385]]},{"id":"thenar","color":[42,171,205],"points":[[372,464],[358,474],[343,490],[321,523],[305,562],[298,592],[296,609],[297,648],[302,667],[311,686],[322,701],[332,711],[356,727],[359,726],[367,710],[391,677],[459,601],[459,599],[431,574],[417,556],[403,530],[398,515],[397,506],[391,501],[384,491]]},{"id":"thumb-distal-joint","color":[218,136,129],"points":[[526,378],[506,378],[490,386],[472,403],[445,441],[445,443],[452,450],[469,463],[502,481],[504,481],[544,401],[544,393],[541,387],[534,381]]},{"id":"thumb-base-joint","color":[213,139,116],"points":[[442,446],[411,494],[401,505],[401,510],[407,529],[424,559],[452,589],[462,596],[474,571],[487,526],[502,486],[474,471]]},{"id":"index-distal-joint","color":[205,144,106],"points":[[366,78],[355,85],[347,100],[336,156],[392,167],[400,118],[399,97],[395,88],[389,82],[380,78]]},{"id":"index-middle-joint","color":[195,149,98],"points":[[335,161],[316,252],[379,266],[392,172],[360,164]]},{"id":"index-base-joint","color":[182,155,95],"points":[[316,257],[299,339],[292,356],[306,372],[315,378],[333,386],[358,392],[361,391],[363,366],[378,272],[352,263]]},{"id":"middle-distal-joint","color":[167,159,95],"points":[[239,15],[228,24],[222,37],[219,68],[219,104],[279,106],[281,66],[280,44],[277,32],[273,24],[264,16],[252,13]]},{"id":"middle-middle-joint","color":[151,164,100],"points":[[219,109],[217,152],[210,223],[254,222],[282,225],[280,111],[243,108]]},{"id":"middle-base-joint","color":[134,168,108],"points":[[211,229],[209,324],[206,346],[203,352],[213,356],[232,359],[261,359],[283,354],[279,341],[282,232],[280,230],[255,226],[227,226]]},{"id":"ring-distal-joint","color":[116,171,120],"points":[[143,75],[131,74],[120,78],[113,85],[109,93],[107,103],[107,121],[110,163],[112,164],[169,156],[161,97],[156,85],[149,78]]},{"id":"ring-middle-joint","color":[97,173,134],"points":[[169,161],[111,168],[116,267],[149,261],[181,258]]},{"id":"ring-base-joint","color":[77,174,149],"points":[[182,263],[149,265],[127,269],[117,273],[124,358],[122,383],[138,382],[164,375],[179,368],[194,356],[189,337]]},{"id":"little-distal-joint","color":[56,175,165],"points":[[40,177],[32,177],[23,181],[17,187],[13,198],[13,216],[19,260],[23,262],[72,251],[59,196],[53,185],[46,179]]},{"id":"little-middle-joint","color":[36,174,180],"points":[[74,256],[61,257],[21,266],[28,315],[34,342],[92,325]]},{"id":"little-base-joint","color":[27,173,194],"points":[[93,330],[69,335],[35,347],[51,424],[53,469],[55,469],[73,453],[93,432],[105,416],[114,397],[115,388],[111,384],[107,375]]}]

function fillPolygon(pixels, points, color) {
  let minY = HEIGHT - 1
  let maxY = 0
  for (const [, y] of points) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  for (let y = Math.max(0, minY); y <= Math.min(HEIGHT - 1, maxY); y += 1) {
    const scanY = y + 0.5
    const intersections = []
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index]
      const [x2, y2] = points[(index + 1) % points.length]
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    intersections.sort((left, right) => left - right)

    for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
      const start = Math.max(0, Math.ceil(intersections[pair]))
      const end = Math.min(WIDTH - 1, Math.floor(intersections[pair + 1]))
      for (let x = start; x <= end; x += 1) {
        const offset = (y * WIDTH + x) * 4
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
        pixels[offset + 3] = color[3]
      }
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(WIDTH, 0)
  ihdr.writeUInt32BE(HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const scanlines = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT)
  for (let y = 0; y < HEIGHT; y += 1) {
    const target = y * (WIDTH * 4 + 1)
    scanlines[target] = 0
    pixels.copy(scanlines, target + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4)
fillPolygon(pixels, SILHOUETTE, [24, 24, 24, 255])
for (const region of REGIONS) {
  fillPolygon(pixels, region.points, [...region.color, 255])
}

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, encodePng(pixels))
