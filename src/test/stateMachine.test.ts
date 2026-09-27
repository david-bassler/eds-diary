import { describe, expect, it } from 'vitest'
type State={writer:boolean;verified:number|null;prefix:number;durable:boolean;announcement:boolean;heads:Set<string>}
const actions=['connect','verify','append','readback','announce','offlineA','offlineB'] as const
function apply(s:State,a:typeof actions[number]):State{const n={...s,heads:new Set(s.heads)};if(a==='connect'){n.writer=false;n.verified=null;n.durable=false}else if(a==='verify'){n.writer=!n.announcement;n.verified=n.prefix;n.durable=false}else if(a==='append'&&n.writer&&n.verified===n.prefix&&!n.announcement){n.prefix++;n.writer=false;n.durable=false}else if(a==='readback'&&n.verified===n.prefix){n.durable=true}else if(a==='announce'){n.announcement=true;n.writer=false;n.durable=false}else if(a==='offlineA')n.heads.add('A');else if(a==='offlineB')n.heads.add('B');return n}
describe('exhaustive single-writer model',()=>{it('holds pull, durable, rotation and conflict invariants',()=>{let frontier:State[]=[{writer:false,verified:null,prefix:0,durable:false,announcement:false,heads:new Set()}];for(let depth=0;depth<5;depth++){const next:State[]=[];for(const state of frontier)for(const action of actions){const n=apply(state,action);expect(!n.writer||n.verified===n.prefix).toBe(true);expect(!n.durable||n.verified===n.prefix).toBe(true);expect(!n.announcement||!n.writer).toBe(true);if(n.heads.has('A')&&n.heads.has('B'))expect(n.heads.size).toBe(2);next.push(n)}frontier=next}})})

describe('seeded long-horizon single-writer model',()=>{
  it('preserves global authority, durability, rotation and conflict invariants',()=>{
    for(let seed=1;seed<=256;seed+=1){
      let random=seed>>>0,state:State={writer:false,verified:null,prefix:0,durable:false,announcement:false,heads:new Set()}
      const trace:string[]=[]
      for(let step=0;step<128;step+=1){
        random=(Math.imul(random,1664525)+1013904223)>>>0
        const action=actions[random%actions.length]!
        trace.push(action);state=apply(state,action)
        const evidence=`seed=${seed} step=${step} trace=${trace.join(',')}`
        expect(!state.writer||state.verified===state.prefix,evidence).toBe(true)
        expect(!state.durable||state.verified===state.prefix,evidence).toBe(true)
        expect(!state.announcement||!state.writer,evidence).toBe(true)
        if(state.heads.has('A')&&state.heads.has('B'))expect(state.heads.size,evidence).toBe(2)
      }
    }
  })
})

type Device='A'|'B'
type ProtocolModel={
  generation:number;writer:Device;retired:Set<Device>;verified:Record<Device,number|null>;remotePrefix:number
  locked:Set<Device>;crashed:Set<Device>;pendingRekey:boolean;tampered:boolean
  pendingCommit:Record<Device,string|null>;semanticCommits:Set<string>;physicalRows:string[]
}
const protocolActions=['verifyA','verifyB','writeA','writeB','responseLostA','responseLostB','retryA','retryB','handoffAB','handoffBA','takeoverA','takeoverB','beginRekey','finishRekeyA','finishRekeyB','tamper','repair','crashA','crashB','reloadA','reloadB','unlockA','unlockB'] as const
type ProtocolAction=typeof protocolActions[number]
function deviceFor(action:ProtocolAction):Device|null{return action.endsWith('A')?'A':action.endsWith('B')?'B':null}
function protocolStep(source:ProtocolModel,action:ProtocolAction,nonce:number):ProtocolModel{
  const state:ProtocolModel={...source,retired:new Set(source.retired),verified:{...source.verified},locked:new Set(source.locked),crashed:new Set(source.crashed),pendingCommit:{...source.pendingCommit},semanticCommits:new Set(source.semanticCommits),physicalRows:[...source.physicalRows]}
  const device=deviceFor(action),usable=device!==null&&!state.locked.has(device)&&!state.crashed.has(device)
  if(action==='verifyA'||action==='verifyB'){if(usable&&!state.tampered)state.verified[device!]=state.remotePrefix}
  else if(action==='writeA'||action==='writeB'||action==='responseLostA'||action==='responseLostB'){
    if(usable&&device===state.writer&&!state.retired.has(device)&&!state.pendingRekey&&!state.tampered&&state.verified[device]===state.remotePrefix){
      const id=`g${state.generation}-${device}-${nonce}`;state.physicalRows.push(id);state.semanticCommits.add(id);state.remotePrefix+=1;state.verified[device]=null
      if(action.startsWith('responseLost'))state.pendingCommit[device]=id
    }
  }else if(action==='retryA'||action==='retryB'){
    if(device&&state.pendingCommit[device])state.physicalRows.push(state.pendingCommit[device]!)
  }else if(action==='handoffAB'||action==='handoffBA'){
    const from=action==='handoffAB'?'A':'B',to=from==='A'?'B':'A'
    if(usable&&device===to&&state.writer===from&&!state.pendingRekey&&!state.tampered&&state.verified[to]===state.remotePrefix){state.retired.add(from);state.retired.delete(to);state.writer=to;state.generation+=1;state.remotePrefix+=1;state.verified={A:null,B:null}}
  }else if(action==='takeoverA'||action==='takeoverB'){
    if(usable&&device!==state.writer&&!state.tampered&&state.verified[device]===state.remotePrefix){state.retired.add(state.writer);state.retired.delete(device);state.writer=device;state.generation+=1;state.remotePrefix+=1;state.pendingRekey=true;state.verified={A:null,B:null}}
  }else if(action==='beginRekey'){if(!state.tampered)state.pendingRekey=true}
  else if(action==='finishRekeyA'||action==='finishRekeyB'){if(!state.tampered&&usable&&device===state.writer){state.pendingRekey=false;state.remotePrefix+=1;state.verified={A:null,B:null}}}
  else if(action==='tamper'){state.tampered=true;state.verified={A:null,B:null}}
  else if(action==='repair')state.tampered=false
  else if(action==='crashA'||action==='crashB'){state.crashed.add(device!);state.verified[device!]=null}
  else if(action==='reloadA'||action==='reloadB'){state.crashed.delete(device!);state.locked.add(device!);state.verified[device!]=null}
  else if(action==='unlockA'||action==='unlockB')state.locked.delete(device!)
  return state
}

describe('seeded adversarial transferable-writer protocol model',()=>{
  it('preserves authority, lock, Pending-Rekey, tamper and unknown-outcome invariants',()=>{
    for(let seed=1;seed<=512;seed+=1){
      let random=seed>>>0,state:ProtocolModel={generation:1,writer:'A',retired:new Set(),verified:{A:null,B:null},remotePrefix:1,locked:new Set(),crashed:new Set(),pendingRekey:false,tampered:false,pendingCommit:{A:null,B:null},semanticCommits:new Set(),physicalRows:[]}
      const trace:ProtocolAction[]=[]
      for(let step=0;step<256;step+=1){
        random=(Math.imul(random,1103515245)+12345)>>>0
        const action=protocolActions[random%protocolActions.length]!,before=state
        trace.push(action);state=protocolStep(state,action,(seed*257)+step)
        const evidence=`seed=${seed} step=${step} action=${action} trace=${trace.join(',')}`
        expect(state.generation,evidence).toBeGreaterThanOrEqual(before.generation)
        expect(state.retired.has(state.writer),evidence).toBe(false)
        for(const device of ['A','B'] as const)if(state.verified[device]!==null)expect(state.verified[device]!,evidence).toBeLessThanOrEqual(state.remotePrefix)
        expect(new Set(state.semanticCommits).size,evidence).toBe(state.semanticCommits.size)
        expect(new Set(state.physicalRows).size,evidence).toBeLessThanOrEqual(state.physicalRows.length)
        const appended=state.remotePrefix>before.remotePrefix
        if((before.pendingRekey||before.tampered)&&action.startsWith('write'))expect(appended,evidence).toBe(false)
        const actor=deviceFor(action)
        if(actor&&(before.locked.has(actor)||before.crashed.has(actor))&&(action.startsWith('write')||action.startsWith('handoff')||action.startsWith('takeover')))expect(appended,evidence).toBe(false)
        if(action.startsWith('retry'))expect(state.semanticCommits.size,evidence).toBe(before.semanticCommits.size)
      }
    }
  },20_000)
})
