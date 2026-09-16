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
  const path='src/sync/google/GoogleSheetsSingleWriterTransport.ts'
  let source=read(path)
  source=replaceOnce(source,
`/** Strict Google wire adapter. Large grids are never requested before dimensions
 * are checked, and record data is subsequently fetched in bounded ranges. */
export class GoogleSheetsSingleWriterTransport implements RemoteTransport {`,
`const AUTHENTICATED_TRANSPORTS=new WeakSet<GoogleSheetsSingleWriterTransport>()
export function isAuthenticatedGoogleTransport(value:unknown):value is GoogleSheetsSingleWriterTransport{
  return typeof value==='object'&&value!==null&&AUTHENTICATED_TRANSPORTS.has(value as GoogleSheetsSingleWriterTransport)
}

/** Strict Google wire adapter. Large grids are never requested before dimensions
 * are checked, and record data is subsequently fetched in bounded ranges. */
export class GoogleSheetsSingleWriterTransport implements RemoteTransport {`,
'google transport brand')
  source=replaceOnce(source,
`    const googleAccountBinding=await expectedAccountBinding(partial)
    return new GoogleSheetsSingleWriterTransport(api,{...partial,googleAccountBinding})`,
`    const googleAccountBinding=await expectedAccountBinding(partial)
    const transport=new GoogleSheetsSingleWriterTransport(api,{...partial,googleAccountBinding})
    AUTHENTICATED_TRANSPORTS.add(transport)
    return transport`,
'authenticated transport factory')
  write(path,source)
}

{
  const path='src/sync/core/remoteVerifier.ts'
  let source=read(path)
  source=replaceOnce(source,
`import { GoogleSheetsSingleWriterTransport } from '../google/GoogleSheetsSingleWriterTransport'`,
`import { GoogleSheetsSingleWriterTransport, isAuthenticatedGoogleTransport } from '../google/GoogleSheetsSingleWriterTransport'`,
'recovery transport import')
  source=replaceOnce(source,
`  static async fromAuthenticatedGoogleDiscovery(transport:GoogleSheetsSingleWriterTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>{if(!(transport instanceof GoogleSheetsSingleWriterTransport))throw new Error('Recovery authority requires the productive Google identity boundary.');const authenticatedAccountBinding=await transport.authenticatedAccountBinding();const candidates=await transport.discover(locator);if(!candidates.some(candidate=>candidate.remoteId===remoteResourceId))throw new Error('Recovery resource was not established by authenticated discovery.');return new IndependentBootstrapAuthority('authenticated-remote',remoteResourceId,authenticatedAccountBinding,transport)}`,
`  static async fromAuthenticatedGoogleDiscovery(transport:GoogleSheetsSingleWriterTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>{if(!isAuthenticatedGoogleTransport(transport))throw new Error('Recovery authority requires the productive Google identity boundary.');const authenticatedAccountBinding=await transport.authenticatedAccountBinding();const candidates=await transport.discover(locator);if(!candidates.some(candidate=>candidate.remoteId===remoteResourceId))throw new Error('Recovery resource was not established by authenticated discovery.');return new IndependentBootstrapAuthority('authenticated-remote',remoteResourceId,authenticatedAccountBinding,transport)}`,
'recovery provenance check')
  write(path,source)
}

{
  const path='src/test/architecture.test.ts'
  let source=read(path)
  source=replaceOnce(source,
`it('loads no Google runtime script on the sensitive main origin',async()=>expect(await readFile('index.html','utf8')).not.toMatch(/accounts\\.google\\.com\\/gsi/))`,
`it('loads no Google runtime script on the sensitive main origin',async()=>expect(await readFile('index.html','utf8')).not.toMatch(/accounts\\.google\\.com\\/gsi/));it('keeps bearer credentials out of the main-origin auth boundary',async()=>{const source=await readFile('src/sync/google/GoogleAuthProvider.ts','utf8');expect(source).not.toMatch(/Bearer\\s|access[_-]?token/i);expect(source).toMatch(/MessageChannel/)})`,
'auth architecture assertion')
  write(path,source)
}

write('src/test/googleAuthBoundary.test.ts',`import { describe, expect, it } from 'vitest'
import { issueControlledTestGoogleClient } from '../sync/google/GoogleAuthProvider'
import { GoogleSheetsSingleWriterTransport, isAuthenticatedGoogleTransport, type GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { IndependentBootstrapAuthority } from '../sync/core/remoteVerifier'

const diaryId='AAECAwQFBgcICQoLDA0ODw'
const epochId='EBESExQVFhcYGRobHB0eHw'
const permissionId='permission-owner-1'
const api:GoogleApiClient={
  identity:()=>permissionId,
  async request<T>(url:string):Promise<T>{
    if(url.includes('/drive/v3/about'))return {user:{permissionId}} as T
    return {files:[]} as T
  },
}

describe('productive Google capability provenance',()=>{
  it('brands only transports returned by the authenticated factory',async()=>{
    const issued=issueControlledTestGoogleClient(api)
    const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(issued,diaryId,epochId)
    expect(isAuthenticatedGoogleTransport(transport)).toBe(true)
  })

  it('rejects a runtime-constructed lookalike transport for recovery authority',async()=>{
    const Constructor=GoogleSheetsSingleWriterTransport as unknown as new (api:GoogleApiClient,binding:Record<string,string>)=>GoogleSheetsSingleWriterTransport
    const forged=new Constructor(api,{diaryId,epochId,ownerPermissionId:permissionId,googleAccountBinding:'forged'})
    expect(isAuthenticatedGoogleTransport(forged)).toBe(false)
    await expect(IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(forged,'locator','remote')).rejects.toThrow('productive Google identity boundary')
  })
})
`)
