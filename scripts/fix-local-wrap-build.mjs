import fs from 'node:fs'
import path from 'node:path'

function replaceOnce(file,before,after,label){let source=fs.readFileSync(file,'utf8');const count=source.split(before).length-1;if(count!==1)throw new Error(`${label}: expected 1, found ${count}`);source=source.replace(before,after);fs.writeFileSync(file,source)}
function used(text,name){return new RegExp(`\\b${name}\\b`).test(text)}

const painList='src/features/pain/PainEntryList.tsx'
replaceOnce(painList,"  useEffect(() => {\n    void loadEntries()\n  }, [loadEntries, refreshKey])",`  useEffect(() => {
    let active = true
    void Promise.all([listPainEntries(), listActivityEntries()])
      .then(([painEntries, activityEntries]) => {
        if (!active) return
        setEntries(painEntries)
        setActivities(activityEntries)
        setStatus('')
      })
      .catch(() => {
        if (active) setStatus('Die Verlaufsdaten konnten nicht geladen werden.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshKey])`,'pain initial refresh effect')

const bodyMapDir='src/features/pain/bodyMap'
const detailFiles=['AbdomenDetailSelector','FootDetailSelector','GluteDetailSelector','HandDetailSelector','HeadDetailSelector','HipDetailSelector','KneeDetailSelector','LowerBackDetailSelector','ShoulderDetailSelector']

function splitDetailModule(baseName){
  const file=path.join(bodyMapDir,`${baseName}.tsx`)
  let source=fs.readFileSync(file,'utf8')
  const start=source.indexOf('interface RegionDefinition {')
  const end=source.indexOf('function colorKey',start)
  if(start<0||end<0)throw new Error(`Could not split ${baseName}`)
  const block=source.slice(start,end)
  let remainder=source.slice(0,start)+source.slice(end)
  const interfaceNames=[...block.matchAll(/^interface\s+(\w+)/gm)].map(match=>match[1])
  const constNames=[...block.matchAll(/^const\s+(\w+)/gm)].map(match=>match[1])
  const functionNames=[...block.matchAll(/^(?:export\s+)?function\s+(\w+)/gm)].map(match=>match[1])
  const typeImports=interfaceNames.filter(name=>used(remainder,name))
  const valueImports=[...constNames,...functionNames].filter(name=>used(remainder,name))
  let meta=block
    .replace(/^interface\s+/gm,'export interface ')
    .replace(/^const\s+/gm,'export const ')
    .replace(/^function\s+/gm,'export function ')
  const prelude=[]
  if(block.includes('BodyView'))prelude.push("import type { BodyView } from '../painEntry'")
  if(baseName==='HipDetailSelector')prelude.push("type HipSide = 'left' | 'right'")
  meta=`${prelude.join('\n')}\n\n${meta}`
  fs.writeFileSync(path.join(bodyMapDir,`${baseName}.meta.ts`),meta)
  const imports=[]
  if(valueImports.length)imports.push(`import { ${valueImports.join(', ')} } from './${baseName}.meta'`)
  if(typeImports.length)imports.push(`import type { ${typeImports.join(', ')} } from './${baseName}.meta'`)
  const cssImport=`import './${baseName}.css'`
  if(!remainder.includes(cssImport))throw new Error(`CSS import missing for ${baseName}`)
  remainder=remainder.replace(cssImport,`${imports.join('\n')}\n${cssImport}`)
  fs.writeFileSync(file,remainder)
}
for(const file of detailFiles)splitDetailModule(file)

const bodyMapPath=path.join(bodyMapDir,'BodyMapSelector.tsx')
let bodyMap=fs.readFileSync(bodyMapPath,'utf8')
const helperImports=[
  ['HandDetailSelector','handDetailLabel','isHandRegionId'],
  ['HeadDetailSelector','headDetailLabel','isHeadRegionId'],
  ['ShoulderDetailSelector','shoulderDetailLabel','isShoulderRegionId'],
  ['HipDetailSelector','hipDetailLabel','isHipRegionId'],
  ['KneeDetailSelector','kneeDetailLabel','isKneeRegionId'],
  ['LowerBackDetailSelector','lowerBackDetailLabel','isLowerBackRegionId'],
  ['FootDetailSelector','footDetailLabel','isFootRegionId'],
  ['GluteDetailSelector','gluteDetailLabel','isGluteRegionId'],
  ['AbdomenDetailSelector','abdomenDetailLabel','isAbdomenRegionId'],
]
for(const [component,label,predicate] of helperImports){
  const old=`import { ${component}, ${label}, ${predicate} } from './${component}'`
  const next=`import { ${component} } from './${component}'\nimport { ${predicate} } from './${component}.meta'`
  if(!bodyMap.includes(old))throw new Error(`Body-map import missing for ${component}`)
  bodyMap=bodyMap.replace(old,next)
}
const bodyStart=bodyMap.indexOf('type RegionDefinition =')
const bodyEnd=bodyMap.indexOf('const isSelected',bodyStart)
if(bodyStart<0||bodyEnd<0)throw new Error('Could not split BodyMapSelector metadata')
const bodyBlock=bodyMap.slice(bodyStart,bodyEnd)
let bodyRemainder=bodyMap.slice(0,bodyStart)+bodyMap.slice(bodyEnd)
const typeNames=[...bodyBlock.matchAll(/^(?:type|interface)\s+(\w+)/gm)].map(match=>match[1])
const constNames=[...bodyBlock.matchAll(/^const\s+(\w+)/gm)].map(match=>match[1])
const functionNames=[...bodyBlock.matchAll(/^(?:export\s+)?function\s+(\w+)/gm)].map(match=>match[1])
const bodyTypeImports=typeNames.filter(name=>used(bodyRemainder,name))
const bodyValueImports=[...constNames,...functionNames].filter(name=>used(bodyRemainder,name))
let bodyMeta=bodyBlock
  .replace(/^type\s+/gm,'export type ')
  .replace(/^interface\s+/gm,'export interface ')
  .replace(/^const\s+/gm,'export const ')
  .replace(/^function\s+/gm,'export function ')
const metaHelperImports=helperImports.map(([component,label,predicate])=>`import { ${label}, ${predicate} } from './${component}.meta'`).join('\n')
bodyMeta=`import type { BodyView, PainLocation } from '../painEntry'\n${metaHelperImports}\n\n${bodyMeta}`
fs.writeFileSync(path.join(bodyMapDir,'BodyMapSelector.meta.ts'),bodyMeta)
const bodyImports=[]
if(bodyValueImports.length)bodyImports.push(`import { ${bodyValueImports.join(', ')} } from './BodyMapSelector.meta'`)
if(bodyTypeImports.length)bodyImports.push(`import type { ${bodyTypeImports.join(', ')} } from './BodyMapSelector.meta'`)
const bodyCss="import './BodyMapSelector.css'"
if(!bodyRemainder.includes(bodyCss))throw new Error('BodyMapSelector CSS import missing')
bodyRemainder=bodyRemainder.replace(bodyCss,`${bodyImports.join('\n')}\n${bodyCss}`)
fs.writeFileSync(bodyMapPath,bodyRemainder)

replaceOnce('src/features/pain/PainEntryFlow.tsx',`import {
  BodyMapSelector,
  painLocationLabel,
} from './bodyMap/BodyMapSelector'`,`import { BodyMapSelector } from './bodyMap/BodyMapSelector'
import { painLocationLabel } from './bodyMap/BodyMapSelector.meta'`,'pain location label import')
