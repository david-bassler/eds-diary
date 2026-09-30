export function isLoopbackHostname(hostname:string):boolean {
  const normalized=hostname.toLowerCase()
  return normalized==='localhost'||normalized==='127.0.0.1'||normalized==='[::1]'||normalized==='::1'
}

export function assertHttpsOrLoopbackUrl(url:URL,label:string):void {
  if(url.protocol==='https:')return
  if(url.protocol==='http:'&&isLoopbackHostname(url.hostname))return
  throw new Error(`${label} must use HTTPS except on a loopback development host.`)
}

export function allowedSecureOrigin(value:string,configuredOrigins:readonly string[]):string|null {
  try{
    const url=new URL(value)
    if(url.origin!==value)return null
    assertHttpsOrLoopbackUrl(url,'Configured web origin')
    return configuredOrigins.includes(url.origin)?url.origin:null
  }catch{return null}
}
