import fs from 'node:fs'

function replaceOnce(file,before,after,label){let source=fs.readFileSync(file,'utf8');const count=source.split(before).length-1;if(count!==1)throw new Error(`${label}: expected 1, found ${count}`);source=source.replace(before,after);fs.writeFileSync(file,source)}

for(const file of ['AbdomenDetailSelector.tsx','GluteDetailSelector.tsx','LowerBackDetailSelector.tsx']){
  replaceOnce(`src/features/pain/bodyMap/${file}`,"import type { BodyView } from '../painEntry'\n",'',`${file} BodyView import`)
}
replaceOnce('src/features/pain/bodyMap/BodyMapSelector.meta.ts',"import { handDetailLabel, isHandRegionId } from './HandDetailSelector.meta'","import { handDetailLabel } from './HandDetailSelector.meta'",'unused hand predicate import')
