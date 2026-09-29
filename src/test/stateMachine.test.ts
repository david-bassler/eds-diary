import { describe, expect, it } from 'vitest'

type Device='A'|'B'
type PendingWrite={id:string;bytes:string;committed:boolean;epoch:number;generation:number;writer:Device}
type PendingMaintenance={transitionId:string;sourceEpoch:number;toRecoveryGeneration:number}
type Model={
  canonicalWriter:Device
  generation:number
  epoch:number
  maintenance:PendingMaintenance|null
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
  |{kind:'RecoveryRekeyTransition';device:Device;fromRecoveryGeneration:number;transitionId:string}
  |{kind:'PhaseBRotation';device:Device;transitionId:string}
  |{kind:'Tamper';device:Device}
  |{kind:'Reload';device:Device}

const devices:readonly Device[]=['A','B']
function initial():Model{return{canonicalWriter:'A',generation:1,epoch:1,maintenance:null,accepted:{A:1,B:0},running:{A:true,B:true},pending:{A:null,B:null},rows:[],materialized:new Set(),controls:new Set(),pendingRekey:false,recoveryGeneration:0,staleRejections:0,tamperRejections:0,nextWrite:0}}
function clone(state:Model):Model{return{...state,maintenance:state.maintenance?{...state.maintenance}:null,accepted:{...state.accepted},running:{...state.running},pending:{...state.pending},rows:[...state.rows],materialized:new Set(state.materialized),controls:new Set(state.controls)}}
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
  else if(authorized(state,device)
    &&pending.epoch===state.epoch
    &&pending.generation===state.generation
    &&pending.writer===device){appendOnce(state,pending.id);state.materialized.add(pending.id)}
  else state.staleRejections+=1
  state.pending[device]=null
}
function apply(state:Model,event:Event):Model{
  const next=clone(state)
  switch(event.kind){
    case 'Write':{
      if(!authorized(next,event.device)){next.staleRejections+=1;break}
      const id=`write-${next.nextWrite++}`,pending:PendingWrite={id,bytes:`envelope:${id}`,committed:event.outcome!=='unknown-not-committed',epoch:next.epoch,generation:next.generation,writer:event.device}
      if(event.outcome==='committed'){appendOnce(next,id);next.materialized.add(id)}
      else{next.pending[event.device]=pending;if(pending.committed)appendOnce(next,id)}
      break
    }
    case 'Handoff':{
      if(event.from!==next.canonicalWriter||event.to===event.from||!authorized(next,event.from))break
      const id=`handoff-${next.epoch}-${next.generation+1}`
      appendOnce(next,id);next.controls.add(id);next.generation+=1;next.canonicalWriter=event.to
      next.accepted[event.to]=next.generation;break
    }
    case 'Crash':next.running[event.device]=false;break
    case 'Resume':
      next.running[event.device]=true;next.accepted[event.device]=Math.max(next.accepted[event.device],next.generation)
      // A generic application Resume can reconcile existing domain envelopes.
      // It must NEVER silently complete a persisted Recovery-Rekey transition.
      reconcilePending(next,event.device)
      break
    case 'Reload':
      next.running[event.device]=true;next.accepted[event.device]=Math.max(next.accepted[event.device],next.generation)
      reconcilePending(next,event.device);break
    case 'ForcedTakeover':{
      if(event.recoveryGeneration!==next.recoveryGeneration
        ||event.device===next.canonicalWriter||next.pendingRekey)break
      // Recovery-authorized Writer takeover changes Writer generation only.
      // It does not itself authorize a new Recovery key or require Phase B.
      const id=`takeover-${next.epoch}-${next.generation+1}`
      appendOnce(next,id);next.controls.add(id);next.generation+=1
      next.canonicalWriter=event.device
      next.accepted[event.device]=next.generation
      break
    }
    case 'RecoveryRekeyTransition':{
      if(!authorized(next,event.device)
        ||event.fromRecoveryGeneration!==next.recoveryGeneration
        ||!event.transitionId
        ||next.controls.has(`rekey-${event.transitionId}`)){
        next.staleRejections+=1;break
      }
      // The exact durable RecoveryAuthorityTransition is a separate event:
      // only now is normal Writer activity fenced pending mandatory Phase B.
      next.recoveryGeneration+=1
      next.maintenance={transitionId:event.transitionId,sourceEpoch:next.epoch,toRecoveryGeneration:next.recoveryGeneration}
      next.pendingRekey=true
      const id=`rekey-${event.transitionId}`
      appendOnce(next,id);next.controls.add(id)
      break
    }
    case 'PhaseBRotation':{
      const maintenance=next.maintenance
      if(!maintenance||!next.pendingRekey
        ||next.canonicalWriter!==event.device||!next.running[event.device]
        ||maintenance.transitionId!==event.transitionId
        ||maintenance.sourceEpoch!==next.epoch
        ||maintenance.toRecoveryGeneration!==next.recoveryGeneration){
        next.staleRejections+=1;break
      }
      // Only the exact recovered/persisted ceremony may cut over the epoch.
      const id=`phase-b-${event.transitionId}`
      appendOnce(next,id);next.controls.add(id)
      next.epoch+=1
      next.maintenance=null
      next.pendingRekey=false
      break
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
    && Number.isSafeInteger(state.epoch)&&state.epoch>=1
    && state.pendingRekey===(state.maintenance!==null)
    && (!state.maintenance||(state.maintenance.sourceEpoch===state.epoch
      &&state.maintenance.toRecoveryGeneration===state.recoveryGeneration
      &&state.controls.has(`rekey-${state.maintenance.transitionId}`)))
    && new Set(state.rows).size===state.rows.length
    && [...state.materialized].every(id=>state.rows.includes(id))
    && [...state.controls].every(id=>state.rows.filter(row=>row===id).length===1)
    && devices.every(device=>!state.pending[device]||(
      state.pending[device]!.bytes===`envelope:${state.pending[device]!.id}`
      &&state.pending[device]!.writer===device
      &&state.pending[device]!.epoch<=state.epoch
      &&state.pending[device]!.generation<=state.generation))
  if(!valid)throw new Error(message)
}
function generatedEvent(random:number,state:Model):Event{
  const device=devices[(random>>>4)%2]!,other:Device=device==='A'?'B':'A'
  switch(random%9){
    case 0:return{kind:'Write',device,outcome:(['committed','unknown-committed','unknown-not-committed'] as const)[(random>>>8)%3]!}
    case 1:return{kind:'Handoff',from:device,to:other}
    case 2:return{kind:'Crash',device}
    case 3:return{kind:'Resume',device}
    case 4:return{kind:'ForcedTakeover',device,recoveryGeneration:(random>>>10)%3===0?state.recoveryGeneration+1:state.recoveryGeneration}
    case 5:return{kind:'Tamper',device}
    case 6:return{kind:'Reload',device}
    case 7:return{
      kind:'RecoveryRekeyTransition',device,
      fromRecoveryGeneration:(random>>>10)%3===0?state.recoveryGeneration+1:state.recoveryGeneration,
      transitionId:(random>>>12)%3===0?'stale-or-foreign-transition':`transition-${state.epoch}-${state.recoveryGeneration+1}`,
    }
    default:return{
      kind:'PhaseBRotation',device,
      transitionId:(random>>>10)%3===0?'stale-or-foreign-transition':state.maintenance?.transitionId??'missing-transition',
    }
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

  it('separates Writer takeover, Recovery authority transition and mandatory Phase B',()=>{
    let state=apply(initial(),{kind:'Handoff',from:'A',to:'B'})
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.rows).toEqual(['handoff-1-2']);expect(state.staleRejections).toBe(1)
    state=apply(state,{kind:'ForcedTakeover',device:'A',recoveryGeneration:0})
    expect(state.canonicalWriter).toBe('A')
    expect(state.generation).toBe(3)
    expect(state.recoveryGeneration).toBe(0)
    expect(state.pendingRekey).toBe(false) // Takeover alone must not trigger rekey.
    state=apply(state,{kind:'RecoveryRekeyTransition',device:'A',fromRecoveryGeneration:0,transitionId:'transition-1-1'})
    expect(state.pendingRekey).toBe(true)
    expect(state.recoveryGeneration).toBe(1)
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.staleRejections).toBe(2)
    state=apply(state,{kind:'Crash',device:'A'})
    state=apply(state,{kind:'Resume',device:'A'})
    state=apply(state,{kind:'Reload',device:'A'})
    expect(state.pendingRekey).toBe(true) // Neither generic resume nor reload is Phase B.
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'stale-or-foreign-transition'})
    expect(state.pendingRekey).toBe(true)
    expect(state.epoch).toBe(1)
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'transition-1-1'})
    expect(state.pendingRekey).toBe(false)
    expect(state.epoch).toBe(2)
    state=apply(state,{kind:'Write',device:'B',outcome:'committed'})
    expect(state.rows).not.toContain('write-0')
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.rows).toContain('write-0')
    assertInvariants(state,'handoff/takeover/rekey/phase-b deterministic sibling')
  })

  it.each(['unknown-committed','unknown-not-committed'] as const)('resumes exact persisted bytes once after %s and crash',outcome=>{
    let state=apply(initial(),{kind:'Write',device:'A',outcome})
    const pending=state.pending.A;expect(pending).not.toBeNull()
    state=apply(state,{kind:'Crash',device:'A'});state=apply(state,{kind:'Resume',device:'A'})
    expect(state.rows).toEqual([pending!.id]);expect(state.materialized).toEqual(new Set([pending!.id]));expect(state.pending.A).toBeNull()
  })

  it('rejects a wrong Recovery generation and replayed Phase-B transition',()=>{
    let state=apply(initial(),{kind:'RecoveryRekeyTransition',device:'A',fromRecoveryGeneration:1,transitionId:'unverified'})
    expect(state.pendingRekey).toBe(false)
    state=apply(state,{kind:'RecoveryRekeyTransition',device:'A',fromRecoveryGeneration:0,transitionId:'verified-transition'})
    expect(state.pendingRekey).toBe(true)
    const pendingRows=[...state.rows]
    state=apply(state,{kind:'ForcedTakeover',device:'B',recoveryGeneration:1})
    expect(state.canonicalWriter).toBe('A')
    expect(state.rows).toEqual(pendingRows)
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'verified-transition'})
    expect(state.pendingRekey).toBe(false)
    expect(state.epoch).toBe(2)
    const after=[...state.rows]
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'verified-transition'})
    expect(state.rows).toEqual(after)
    expect(state.epoch).toBe(2)
    assertInvariants(state,'wrong-generation/phase-b replay sibling')
  })

  it('never appends a Source-epoch unresolved envelope after the exact Phase-B switch',()=>{
    let state=apply(initial(),{kind:'Write',device:'A',outcome:'unknown-not-committed'})
    const original=state.pending.A
    expect(original).toMatchObject({epoch:1,generation:1,writer:'A'})
    state=apply(state,{kind:'RecoveryRekeyTransition',device:'A',fromRecoveryGeneration:0,transitionId:'source-rekey-1'})
    state=apply(state,{kind:'Crash',device:'A'})
    state=apply(state,{kind:'Resume',device:'A'})
    expect(state.pending.A).toBeNull()
    expect(state.rows).not.toContain(original!.id)
    // Retry is rejected while the maintenance fence is active.
    expect(state.staleRejections).toBe(1)
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'source-rekey-1'})
    expect(state.epoch).toBe(2)
    expect(state.pendingRekey).toBe(false)
    state=apply(state,{kind:'Write',device:'A',outcome:'committed'})
    expect(state.rows).toContain('write-1')
    expect(state.rows).not.toContain(original!.id)
    assertInvariants(state,'source pending envelope must never cross native epoch boundary')
  })

  it('rejects an absent persisted Source envelope when a successful Phase B retains the same Writer',()=>{
    let state=apply(initial(),{kind:'Write',device:'A',outcome:'unknown-not-committed'})
    const original=state.pending.A
    state=apply(state,{kind:'RecoveryRekeyTransition',device:'A',fromRecoveryGeneration:0,transitionId:'bound-rekey'})
    state=apply(state,{kind:'PhaseBRotation',device:'A',transitionId:'bound-rekey'})
    // The same physical Writer and generation are still active. The old
    // encrypted envelope must nevertheless fail the *epoch* provenance gate.
    expect(state.canonicalWriter).toBe('A')
    expect(state.generation).toBe(original!.generation)
    expect(state.epoch).toBe(2)
    state=apply(state,{kind:'Reload',device:'A'})
    expect(state.rows).not.toContain(original!.id)
    expect(state.staleRejections).toBe(1)
    assertInvariants(state,'same-Writer after rotation cannot replay old-epoch bytes')
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
