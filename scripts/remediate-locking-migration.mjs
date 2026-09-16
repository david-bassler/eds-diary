import fs from 'node:fs'
const path='src/data/localDatabase.ts'
let source=fs.readFileSync(path,'utf8')
const before="canonicalBytes(['legacy-migration-v2',migration.operationId,item.key,item.value])"
const after="canonicalBytes(['legacy-migration-v2',migration.operationId,item.key,item.value] as never)"
if(!source.includes(before))throw new Error('Missing migration canonical cast target')
source=source.replace(before,after)
fs.writeFileSync(path,source)
