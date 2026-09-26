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
