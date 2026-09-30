import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateGoogleAuthEndpoint } from '../sync/google/googleAuthDeploymentPolicy'
import { allowedSecureOrigin } from '../security/webOriginPolicy'

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

  it('accepts only HTTPS or loopback Diary return origins from an Auth-origin allowlist',()=>{
    const configured=['https://diary.example.test','http://localhost:4173','http://diary-insecure.example.test']
    expect(allowedSecureOrigin('https://diary.example.test',configured)).toBe('https://diary.example.test')
    expect(allowedSecureOrigin('http://localhost:4173',configured)).toBe('http://localhost:4173')
    expect(allowedSecureOrigin('http://diary-insecure.example.test',configured)).toBeNull()
    expect(allowedSecureOrigin('https://other.example.test',configured)).toBeNull()
  })

  it('pins the GitHub Pages same-origin deployment as an explicit test-only exception',async()=>{
    const workflow=await readFile(new URL('../../.github/workflows/deploy-pages.yml',import.meta.url),'utf8')
    expect(workflow).toContain('VITE_GOOGLE_AUTH_ORIGIN: https://david-bassler.github.io/eds-diary/google-auth/')
    expect(workflow).toContain('VITE_ALLOW_SAME_ORIGIN_AUTH_TEST_ONLY: "true"')
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
