import { describe, expect, it } from 'vitest'

type Device='A'|'B'
type PendingWrite={id:string;bytes:string;committed:boolean}
type Model={
  canonicalWriter:Device
  generation:number
  accepted:Record<Device,number>
  running:Record<Device,boolean>
  pending:Record<Device,PendingWrite|null>
  rows:string[]
  materialized:Set<string>
  controls:Set<string>
  pendingRekey:boolean
  recoveryGeneration:number
  staleRejections:number
  tamperRejections:number
  nextWrite:number
}
type Event=
  |{kind:'Write';device:Device;outcome:'committed'|'unknown-committed'|'unknown-not-committed'}
  |{kind:'Handoff';from:Device;to:Device}
  |{kind:'Crash';device:Device}
  |{kind:'Resume';device:Device}
  |{kind:'ForcedTakeover';device:Device;recoveryGeneration:number}
  |{kind:'Tamper';device:Device}
  |{kind:'Reload';device:Device}

const devices:readonly Device[]=['A','B']
function initial():Model{return{canonicalWriter:'A',generation:1,accepted:{A:1,B:0},running:{A:true,B:true},pending:{A:null,B:null},rows:[],materialized:new Set(),controls:new Set(),pendingRekey:false,recoveryGeneration:0,staleRejections:0,tamperRejections:0,nextWrite:0}}
function clone(state:Model):Model{return{...state,accepted:{...state.accepted},running:{...state.running},pending:{...state.pending},rows:[...state.rows],materialized:new Set(state.materialized),controls:new Set(state.controls)}}
function authorized(state:Model,device:Device):boolean{return state.running[device]&&state.canonicalWriter===device&&state.accepted[device]===state.generation&&!state.pendingRekey}
function appendOnce(state:Model,id:string):void{if(!state.rows.includes(id))state.rows.push(id)}
function reconcilePending(state:Model,device:Device):void{
  const pending=state.pending[device]
  if(!pending)return
  // Resume retries the exact persisted envelope. A committed response-loss is
  // reconciled. A no-commit outcome appends those same bytes only while fresh
  // authority still matches; stale authority can observe a prior commit but
  // must never turn an absent row into a new append.
  if(state.rows.includes(pending.id))state.materialized.add(pending.id)
  else if(authorized(state,device)){appendOnce(state,pending.id);state.materialized.add(pending.id)}
  else state.staleRejections+=1
  state.pending[device]=null
}
function apply(state:Model,event:Event):Model{
  const next=clone(state)
  switch(event.kind){
    case 'Write':{
      if(!authorized(next,event.device)){next.staleRejections+=1;break}
      const id=`write-${next.nextWrite++}`,pending={id,bytes:`envelope:${id}`,committed:event.outcome!=='unknown-not-committed'}
      if(event.outcome==='committed'){appendOnce(next,id);next.materialized.add(id)}
      else{next.pending[event.device]=pending;if(pending.committed)appendOnce(next,id)}
      break
    }
    case 'Handoff':{
      if(event.from!==next.canonicalWriter||event.to===event.from||!authorized(next,event.from))break
      const id=`handoff-${next.generation+1}`
      appendOnce(next,id);next.controls.add(id);next.generation+=1;next.canonicalWriter=event.to
      next.accepted[event.to]=next.generation;break
    }
    case 'Crash':next.running[event.device]=false;break
    case 'Resume':
      next.running[event.device]=true;next.accepted[event.device]=Math.max(next.accepted[event.device],next.generation)
      reconcilePending(next,event.device)
      // Abstract the exact persisted maintenance operation completing Phase B;
      // only the canonical replacement Writer can lift Pending-Rekey.
      if(next.pendingRekey&&next.canonicalWriter===event.device)next.pendingRekey=false
      break
    case 'Reload':
      next.running[event.device]=true;next.accepted[event.device]=Math.max(next.accepted[event.device],next.generation)
      reconcilePending(next,event.device);break
    case 'ForcedTakeover':{
      if(event.recoveryGeneration!==next.recoveryGeneration||event.device===next.canonicalWriter)break
      const id=`takeover-${next.generation+1}`
      appendOnce(next,id);next.controls.add(id);next.generation+=1;next.canonicalWriter=event.device
      next.accepted[event.device]=next.generation;next.pendingRekey=true;next.recoveryGeneration+=1;break
    }
    case 'Tamper':
      // An invalid candidate is rejected before materialization or authority
      // acceptance; canonical state is deliberately unchanged.
      next.tamperRejections+=1;break
  }
  return next
}
function evidence(seed:number,step:number,event:Event,trace:readonly string[]):string{return`seed=${seed} step=${step} event=${JSON.stringify(event)} trace=${trace.join(' -> ')}`}
function assertInvariants(state:Model,message:string):void{
  const valid=devices.filter(device=>state.canonicalWriter===device).length===1
    && state.accepted.A<=state.generation&&state.accepted.B<=state.generation
    && new Set(state.rows).size===state.rows.length
    && [...state.materialized].every(id=>state.rows.includes(id))
    && [...state.controls].every(id=>state.rows.filter(row=>row===id).length===1)
    && devices.every(device=>!state.pending[device]||state.pending[device]!.bytes===`envelope:${state.pending[device]!.id}`)
  if(!valid)throw new Error(message)
}
function generatedEvent(random:number,state:Model):Event{
  const device=devices[(random>>>4)%2]!,other:Device=device==='A'?'B':'A'
  switch(random%7){
    case 0:return{kind:'Write',device,outcome:(['committed','unknown-committed','unknown-not-committed'] as const)[(random>>>8)%3]!}
    case 1:return{kind:'Handoff',from:device,to:other}
    case 2:return{kind:'Crash',device}
    case 3:return{kind:'Resume',device}
    case 4:return{kind:'ForcedTakeover',device,recoveryGeneration:(random>>>10)%3===0?state.recoveryGeneration+1:state.recoveryGeneration}
    case 5:return{kind:'Tamper',device}
    default:return{kind:'Reload',device}
  }
}

describe('transferable single-writer generative protocol model',()=>{
  it('preserves authority, exact-resume, tamper and semantic uniqueness invariants across seeded interleavings',()=>{
    for(let seed=1;seed<=512;seed+=1){
      let random=seed>>>0,state=initial();const trace:string[]=[]
      for(let step=0;step<256;step+=1){
        random=(Math.imul(random,1664525)+1013904223)>>>0
        const event=generatedEvent(random,state);trace.push(JSON.stringify(event));state=apply(state,event)
        assertInvariants(state,evidence(seed,step,event,trace))
      }
    }
  },20_000)

  it('rejects stale Writer A after Handoff and Recovery takeover',()=>{
    let state=apply(initial(),{kind:'Handoff',from:'A',to:'B'})
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.rows).toEqual(['handoff-2']);expect(state.staleRejections).toBe(1)
    state=apply(state,{kind:'ForcedTakeover',device:'A',recoveryGeneration:0})
    expect(state.canonicalWriter).toBe('A');expect(state.pendingRekey).toBe(true)
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.staleRejections).toBe(2)
  })

  it.each(['unknown-committed','unknown-not-committed'] as const)('resumes exact persisted bytes once after %s and crash',outcome=>{
    let state=apply(initial(),{kind:'Write',device:'A',outcome})
    const pending=state.pending.A;expect(pending).not.toBeNull()
    state=apply(state,{kind:'Crash',device:'A'});state=apply(state,{kind:'Resume',device:'A'})
    expect(state.rows).toEqual([pending!.id]);expect(state.materialized).toEqual(new Set([pending!.id]));expect(state.pending.A).toBeNull()
  })

  it('does not append an unresolved old-Writer envelope after takeover',()=>{
    let state=apply(initial(),{kind:'Write',device:'A',outcome:'unknown-not-committed'})
    const unresolved=state.pending.A;state=apply(state,{kind:'Crash',device:'A'})
    state=apply(state,{kind:'ForcedTakeover',device:'B',recoveryGeneration:0})
    state=apply(state,{kind:'Resume',device:'A'})
    expect(state.rows).not.toContain(unresolved!.id);expect(state.pending.A).toBeNull();expect(state.staleRejections).toBe(1)
  })

  it('rejects tampered candidates without changing accepted authority or materialization',()=>{
    const before=initial(),after=apply(before,{kind:'Tamper',device:'A'})
    expect(after.tamperRejections).toBe(1);expect(after.generation).toBe(before.generation)
    expect(after.canonicalWriter).toBe(before.canonicalWriter);expect(after.rows).toEqual([]);expect(after.materialized.size).toBe(0)
  })
})
