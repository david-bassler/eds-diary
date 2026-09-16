import fs from 'node:fs'

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,value){fs.writeFileSync(path,value)}
function replaceOnce(source,before,after,label){
  const first=source.indexOf(before)
  if(first<0)throw new Error(`Missing ${label}`)
  if(source.indexOf(before,first+before.length)>=0)throw new Error(`Duplicate ${label}`)
  return source.slice(0,first)+after+source.slice(first+before.length)
}

{
  const path='src/data/localDatabase.ts'
  let source=read(path)
  source=replaceOnce(source,
`export async function verifyLocalIntegrity():Promise<void>{return verifyLocalIntegrityFor(await openDatabase())}
export const __localDatabaseTesting={openDatabase,loadEpoch,STORES}`,
`export async function verifyLocalIntegrity():Promise<void>{return verifyLocalIntegrityFor(await openDatabase())}
async function resetDatabaseForTesting():Promise<void>{if(import.meta.env.MODE!=='test')throw new Error('Database reset is test-only.');if(databasePromise){const db=await databasePromise;db.close()}databasePromise=null;readyPromise=null}
export const __localDatabaseTesting={openDatabase,loadEpoch,STORES,resetForTesting:resetDatabaseForTesting}`,
'test database reset seam')
  write(path,source)
}

{
  const path='src/test/productiveRotationService.test.ts'
  let source=read(path)
  source=replaceOnce(source,
`  beforeEach(async()=>{await deleteDatabase();globalThis.localStorage?.clear?.()})`,
`  beforeEach(async()=>{await __localDatabaseTesting.resetForTesting();await deleteDatabase();globalThis.localStorage?.clear?.()})`,
'rotation test isolation')
  write(path,source)
}
