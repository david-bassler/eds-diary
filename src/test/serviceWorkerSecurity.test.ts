import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface FetchEventLike {
  request:{method:string;url:string;mode:string;destination:string}
  respondWith(value:Promise<unknown>):void
}

async function serviceWorkerHarness(){
  const source=await readFile(new URL('../../public/sw.js',import.meta.url),'utf8')
  const handlers=new Map<string,(event:any)=>void>()
  const puts:Array<{key:unknown;response:unknown}>=[]
  const response={ok:true,clone(){return this}}
  const context={
    self:{
      location:{origin:'https://example.test',href:'https://example.test/eds-diary/sw.js'},
      addEventListener(type:string,handler:(event:any)=>void){handlers.set(type,handler)},
      skipWaiting(){return Promise.resolve()},
      clients:{claim(){return Promise.resolve()}},
    },
    caches:{
      open:async()=>({addAll:async()=>undefined,put:async(key:unknown,value:unknown)=>{puts.push({key,response:value})}}),
      keys:async()=>[],
      delete:async()=>true,
      match:async()=>undefined,
    },
    fetch:async()=>response,
    URL,
    Set,
    Promise,
  }
  runInNewContext(source,context)
  function dispatch(url:string){
    let handled:Promise<unknown>|undefined
    const event:FetchEventLike={
      request:{method:'GET',url,mode:'navigate',destination:'document'},
      respondWith(value){handled=value},
    }
    handlers.get('fetch')?.(event)
    return{handled,puts}
  }
  return{dispatch,puts}
}

describe('Diary service-worker navigation isolation',()=>{
  it('never intercepts the same-origin Google Auth subtree',async()=>{
    const {dispatch,puts}=await serviceWorkerHarness()
    expect(dispatch('https://example.test/eds-diary/google-auth/').handled).toBeUndefined()
    expect(dispatch('https://example.test/eds-diary/google-auth').handled).toBeUndefined()
    expect(puts).toHaveLength(0)
  })

  it('updates the root shell only from an actual Diary-root navigation',async()=>{
    const {dispatch,puts}=await serviceWorkerHarness()
    const root=dispatch('https://example.test/eds-diary/')
    await root.handled
    expect(puts.map(entry=>entry.key)).toEqual(['./'])

    puts.length=0
    const route=dispatch('https://example.test/eds-diary/konfiguration')
    await route.handled
    expect(puts).toHaveLength(0)
  })
})
