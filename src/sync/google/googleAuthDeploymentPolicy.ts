import { assertHttpsOrLoopbackUrl, isLoopbackHostname } from '../../security/webOriginPolicy'

export interface GoogleAuthEndpointPolicy {
  url: URL
  authOrigin: string
  sameOrigin: boolean
  sameOriginTestException: boolean
}

export function validateGoogleAuthEndpoint(args:{
  authUrl:string
  pageUrl:string
  production:boolean
  allowSameOriginTest:boolean
}):GoogleAuthEndpointPolicy {
  if(!args.authUrl)throw new Error('Google auth URL is not configured.')
  const url=new URL(args.authUrl,args.pageUrl)
  assertHttpsOrLoopbackUrl(url,'Google auth URL')
  const page=new URL(args.pageUrl),sameOrigin=url.origin===page.origin,loopback=isLoopbackHostname(url.hostname)
  if(args.production&&sameOrigin&&!loopback&&!args.allowSameOriginTest){
    throw new Error('Same-origin Google authentication is test-only; production requires a separate Auth origin.')
  }
  return{
    url,
    authOrigin:url.origin,
    sameOrigin,
    sameOriginTestException:args.production&&sameOrigin&&!loopback&&args.allowSameOriginTest,
  }
}

export function currentGoogleAuthEndpointPolicy(authUrl:string):GoogleAuthEndpointPolicy {
  return validateGoogleAuthEndpoint({
    authUrl,
    pageUrl:window.location.href,
    production:import.meta.env.PROD,
    allowSameOriginTest:import.meta.env.VITE_ALLOW_SAME_ORIGIN_AUTH_TEST_ONLY==='true',
  })
}

export function googleAuthDeploymentWarning(authUrl:string|undefined):string|null {
  if(!authUrl||typeof window==='undefined')return null
  try{
    const policy=currentGoogleAuthEndpointPolicy(authUrl)
    if(!policy.sameOriginTestException)return null
    return 'Testbereitstellung: Google-Anmeldung und Tagebuch teilen denselben Origin. Diese Bereitstellung ist nicht für Produktionsbetrieb oder echte Gesundheitsdaten freigegeben.'
  }catch{return null}
}
