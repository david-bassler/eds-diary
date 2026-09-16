import fs from 'node:fs'
const path='src/data/localDatabase.ts'
let s=fs.readFileSync(path,'utf8')
s=s.replace("export async function enrollActivePassphraseRootWrap(passphrase:string):Promise<void>{let factor:LocalUnlockFactor={mode:'passphrase',passphrase};", "export async function enrollActivePassphraseRootWrap(passphrase:string):Promise<void>{const factor:LocalUnlockFactor={mode:'passphrase',passphrase};")
fs.writeFileSync(path,s)
