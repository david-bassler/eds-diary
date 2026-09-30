import { describe, expect, it } from 'vitest'
import { validateGoogleAuthEndpoint } from '../sync/google/googleAuthDeploymentPolicy'

describe('Google Auth deployment endpoint policy',()=>{
  it('requires HTTPS for every non-loopback Auth endpoint',()=>{
    expect(()=>validateGoogleAuthEndpoint({
      authUrl:'http://auth.example.test/google-auth/',
      pageUrl:'https://diary.example.test/',
      production:false,
      allowSameOriginTest:false,
    })).toThrow(/must use HTTPS except on a loopback/i)
  })

  it('permits loopback HTTP for local development and preview',()=>{
    for(const authUrl of ['http://localhost:4173/google-auth/','http://127.0.0.1:4173/google-auth/','http://[::1]:4173/google-auth/']){
      expect(validateGoogleAuthEndpoint({
        authUrl,
        pageUrl:'http://localhost:4173/',
        production:true,
        allowSameOriginTest:false,
      }).url.toString()).toBe(authUrl)
    }
  })

  it('requires an explicit test-only opt-in for same-origin production builds',()=>{
    const args={
      authUrl:'https://diary.example.test/google-auth/',
      pageUrl:'https://diary.example.test/',
      production:true,
      allowSameOriginTest:false,
    }
    expect(()=>validateGoogleAuthEndpoint(args)).toThrow(/same-origin Google authentication is test-only/i)
    expect(validateGoogleAuthEndpoint({...args,allowSameOriginTest:true})).toMatchObject({
      sameOrigin:true,
      sameOriginTestException:true,
      authOrigin:'https://diary.example.test',
    })
  })

  it('allows a separate HTTPS Auth origin without any test exception',()=>{
    expect(validateGoogleAuthEndpoint({
      authUrl:'https://auth.example.test/google-auth/',
      pageUrl:'https://diary.example.test/',
      production:true,
      allowSameOriginTest:false,
    })).toMatchObject({
      sameOrigin:false,
      sameOriginTestException:false,
      authOrigin:'https://auth.example.test',
    })
  })
})
