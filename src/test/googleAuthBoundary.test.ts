import { describe, expect, it } from 'vitest'
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
