import { canonicalBytes } from '../../security/crypto/canonical'
import { base64Url } from '../../security/crypto/bytes'
import { sha256 } from '../../security/crypto/core'
import type { RemoteSnapshot, RemoteTransport, TransportProfileCodec, VerifiedRemoteState } from './contracts'

export const CREATION_PHASES=['planned','discovery_verified','create_pending','candidate_known','manifest_pending','manifest_verified','properties_pending','properties_verified','final_reconcile','bound'] as const
export type CreationPhase=typeof CREATION_PHASES[number]
export type CreationStatus=CreationPhase|'ambiguous'|'creation_pending'
export interface CreationState {
  locator:string; manifestFingerprint:string; status:CreationStatus; remoteId:string|null
  diaryId?:string;epochId?:string;keyId?:string;manifest?:readonly string[];manifestBytes?:string
  expectedProperties?:Readonly<Record<string,string>>;operationGeneration?:number;candidateIds?:readonly string[]
}
export interface CreationPersistence {read(locator:string):Promise<CreationState|null>;write(state:CreationState):Promise<void>}
export type CandidateClass='empty'|'expected-manifest'|'partial'|'conflicting'

function isEmpty(snapshot:RemoteSnapshot):boolean{return snapshot.manifest.length===0&&snapshot.rows.length===0}
async function classify(remoteId:string,state:CreationState,transport:RemoteTransport,codec:TransportProfileCodec):Promise<{remoteId:string;kind:CandidateClass;snapshot:RemoteSnapshot;verified?:VerifiedRemoteState}>{
  try{const snapshot=await transport.read(remoteId);if(isEmpty(snapshot))return{remoteId,kind:'empty',snapshot};if(snapshot.rows.length)return{remoteId,kind:'conflicting',snapshot};codec.validate(snapshot);const verified=await codec.verifyRemote(snapshot);if(verified.manifestFingerprint!==state.manifestFingerprint)return{remoteId,kind:'conflicting',snapshot};if(!transport.readProperties||state.expectedProperties===undefined)return{remoteId,kind:'expected-manifest',snapshot,verified};const properties=await transport.readProperties(remoteId);return{remoteId,kind:Object.keys(properties).length?propertiesEqual(properties,state.expectedProperties)?'expected-manifest':'conflicting':'partial',snapshot,verified}}catch{return{remoteId,kind:'conflicting',snapshot:{manifest:[],rows:[]}}}
}
function propertiesEqual(actual:Readonly<Record<string,string>>,expected:Readonly<Record<string,string>>):boolean{const a=Object.entries(actual).sort(),b=Object.entries(expected).sort();return JSON.stringify(a)===JSON.stringify(b)}
async function persist(store:CreationPersistence,state:CreationState):Promise<CreationState>{await store.write(state);const read=await store.read(state.locator);if(!read||decodeURIComponent(JSON.stringify(read))!==decodeURIComponent(JSON.stringify(state)))throw new Error('Creation state readback failed.');return read}
function next(state:CreationState,status:CreationStatus,extra:Partial<CreationState>={}):CreationState{return{...state,...extra,status}}
async function discovered(state:CreationState,transport:RemoteTransport,codec:TransportProfileCodec){const candidates=[];for(const item of await transport.discover(state.locator))candidates.push(await classify(item.remoteId,state,transport,codec));return candidates}
function select(candidates:Awaited<ReturnType<typeof discovered>>):{id:string|null;ambiguous:boolean;kind:CandidateClass|null}{const conflict=candidates.some(c=>c.kind==='conflicting'),manifest=candidates.filter(c=>c.kind==='expected-manifest'||c.kind==='partial');if(conflict||manifest.length>1)return{id:null,ambiguous:true,kind:null};if(manifest.length===1)return{id:manifest[0]!.remoteId,ambiguous:false,kind:manifest[0]!.kind};const empty=candidates.filter(c=>c.kind==='empty').sort((a,b)=>a.remoteId.localeCompare(b.remoteId));return{id:empty[0]?.remoteId??null,ambiguous:false,kind:empty[0]?.kind??null}}

/**
 * Persistent, replay-safe resource creation. Every remote mutation has a
 * persisted intent phase; its result is established only by discovery/readback.
 */
export async function runCreationStateMachine(initial:CreationState,manifest:readonly string[],transport:RemoteTransport,codec:TransportProfileCodec,store:CreationPersistence):Promise<CreationState>{
  let state=(await store.read(initial.locator))??initial
  if(state.status==='creation_pending')state=next(state,'planned')
  if(state.status==='bound'||state.status==='ambiguous')return state
  if(!state.manifest){const bytes=new TextDecoder().decode(canonicalBytes([...manifest]));state=await persist(store,{...state,status:'planned',manifest:[...manifest],manifestBytes:bytes,operationGeneration:state.operationGeneration??0})}
  if(state.status==='planned'){const candidates=await discovered(state,transport,codec),choice=select(candidates);if(choice.ambiguous)return persist(store,next(state,'ambiguous',{remoteId:null}));state=await persist(store,next(state,'discovery_verified',{remoteId:choice.id,candidateIds:candidates.map(c=>c.remoteId)}))}
  if(state.status==='discovery_verified'&&!state.remoteId)state=await persist(store,next(state,'create_pending'))
  if(state.status==='create_pending'){
    try{await transport.create(state.locator,[])}catch{/* unknown outcome is resolved below */}
    const choice=select(await discovered(state,transport,codec));if(choice.ambiguous)return persist(store,next(state,'ambiguous',{remoteId:null}));if(!choice.id)return state
    state=await persist(store,next(state,'candidate_known',{remoteId:choice.id}))
  }
  if(state.status==='discovery_verified'&&state.remoteId)state=await persist(store,next(state,'candidate_known'))
  if(state.status==='candidate_known')state=await persist(store,next(state,'manifest_pending'))
  if(state.status==='manifest_pending'){
    if(!state.remoteId)throw new Error('Creation candidate missing.')
    const duplicates=(state.candidateIds??[]).filter(id=>id!==state.remoteId)
    if(duplicates.length)await transport.orphanCandidates?.(duplicates)
    const current=await transport.read(state.remoteId)
    if(isEmpty(current)){try{if(transport.writeManifest)await transport.writeManifest(state.remoteId,state.manifest!);else await transport.replaceManifest?.(state.remoteId,state.manifest!)}catch{/* reconcile readback */}}
    const checked=await classify(state.remoteId,state,transport,codec);if(checked.kind!=='partial'&&checked.kind!=='expected-manifest')return persist(store,next(state,'ambiguous',{remoteId:null}));state=await persist(store,next(state,'manifest_verified'))
  }
  if(state.status==='manifest_verified')state=await persist(store,next(state,'properties_pending'))
  if(state.status==='properties_pending'){
    if(!state.remoteId)throw new Error('Creation candidate missing.');const expected=state.expectedProperties??{}
    const actual=await transport.readProperties?.(state.remoteId);if(!actual||!propertiesEqual(actual,expected)){try{await transport.patchProperties?.(state.remoteId,expected)}catch{/* reconcile readback */}}
    const read=await transport.readProperties?.(state.remoteId);if(transport.readProperties&&!propertiesEqual(read??{},expected))return state;state=await persist(store,next(state,'properties_verified'))
  }
  if(state.status==='properties_verified')state=await persist(store,next(state,'final_reconcile'))
  if(state.status==='final_reconcile'){
    const candidates=await discovered(state,transport,codec),canonical=candidates.filter(c=>c.kind==='expected-manifest');if(canonical.length!==1||candidates.some(c=>c.kind==='partial'||c.kind==='conflicting'))return persist(store,next(state,'ambiguous',{remoteId:null}))
    state=await persist(store,next(state,'bound',{remoteId:canonical[0]!.remoteId}))
  }
  return state
}

export async function reconcileCreation(state:CreationState,transport:RemoteTransport,codec:TransportProfileCodec):Promise<CreationState>{const choice=select(await discovered(state,transport,codec));if(choice.ambiguous)return next(state,'ambiguous',{remoteId:null});return choice.kind==='expected-manifest'?next(state,'bound',{remoteId:choice.id}):state}

/** Backwards-compatible entry point; production callers should supply durable persistence. */
export async function createOrReconcile(state:CreationState,manifest:readonly string[],transport:RemoteTransport,codec:TransportProfileCodec,persistence?:CreationPersistence):Promise<CreationState>{const memory=persistence??new class implements CreationPersistence{value:CreationState|null=null;async read(){return this.value}async write(value:CreationState){this.value=structuredClone(value)}}();const fingerprint=state.manifestFingerprint||base64Url(await sha256(canonicalBytes([...manifest])));return runCreationStateMachine({...state,manifestFingerprint:fingerprint},manifest,transport,codec,memory)}
