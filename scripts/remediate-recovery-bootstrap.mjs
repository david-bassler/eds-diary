import fs from 'node:fs'
for(const path of ['src/data/recoveryProfile.ts','src/data/localDatabase.ts']){
  let source=fs.readFileSync(path,'utf8')
  source=source.replaceAll("revision.record_status!=='deleted')validateDomainData", "revision.record_status==='active')validateDomainData")
  fs.writeFileSync(path,source)
}
