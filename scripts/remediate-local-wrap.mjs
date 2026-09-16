import fs from 'node:fs'

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,value){fs.writeFileSync(path,value)}
function replaceOnce(source,before,after,label){const at=source.indexOf(before);if(at<0)throw new Error(`Missing ${label}`);if(source.indexOf(before,at+before.length)>=0)throw new Error(`Duplicate ${label}`);return source.slice(0,at)+after+source.slice(at+before.length)}

{
  const path='src/data/localDatabase.ts'
  let source=read(path)
  source=replaceOnce(source,
`  createBestEffortRootWrap,
  journalInitial,
  journalNext,
  openBestEffortRootWrap,`,
`  createBestEffortRootWrap,
  createPassphraseRootWrap,
  createPrfRootWrap,
  journalInitial,
  journalNext,
  openBestEffortRootWrap,
  openPassphraseRootWrap,
  openPrfRootWrap,`,
'local wrap imports')
  source=replaceOnce(source,
`  type EpochLocalSecurityState,
  type RootWrap,`,
`  type EpochLocalSecurityState,
  type PrfWrapEnrollmentMaterial,
  type RootWrap,`,
'local wrap types')
  source=replaceOnce(source,
`let databasePromise:Promise<IDBDatabase>|null=null
let readyPromise:Promise<void>|null=null`,
`let databasePromise:Promise<IDBDatabase>|null=null
let readyPromise:Promise<void>|null=null
type LocalUnlockFactor={mode:'passphrase';passphrase:string}|{mode:'prf';credentialId:Uint8Array;prfEvalInput:Uint8Array;prfOutput:Uint8Array;rpId:string}
const unlockedRoots=new Map<string,Uint8Array>()
const unlockFactors=new Map<string,LocalUnlockFactor>()
export class LocalUnlockRequiredError extends Error{constructor(readonly mode:'passphrase'|'prf'){super(\`Local root key requires ${mode} unlock.\`);this.name='LocalUnlockRequiredError'}}`,
'unlock cache')
  const oldLoad=`async function loadEpoch(db:IDBDatabase):Promise<{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityState;epochSalt:Uint8Array}>{
  const contextTx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(contextTx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(contextTx);if(!context){const made=await initialContext(db);return{...made,epochSalt:await deriveEpochSalt(fromBase64Url(made.context.diaryId),fromBase64Url(made.context.epochId))}}
  const tx=db.transaction([STORES.wraps,STORES.state],'readonly'),wrapRequest=tx.objectStore(STORES.wraps).get(context.epochId),stateRequest=tx.objectStore(STORES.state).get(context.epochId),[storedWrap,stored]=await Promise.all([result<{id:string;wrap:RootWrap}|undefined>(wrapRequest),result<StoredState|undefined>(stateRequest)]);await complete(tx);if(!storedWrap||!stored)throw new Error('Incomplete local epoch security state.')
  const rootKey=await openBestEffortRootWrap(storedWrap.wrap,await wrappingKey(db,context.wrapId)),epochSalt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,epochSalt,stored.state,stored.tag);return{context,rootKey,state:stored.state,epochSalt}
}`
  const newLoad=`async function readEpochRecords(db:IDBDatabase,context:EpochContext):Promise<{wrap:RootWrap;stored:StoredState}>{const tx=db.transaction([STORES.wraps,STORES.state],'readonly'),wrapRequest=tx.objectStore(STORES.wraps).get(context.epochId),stateRequest=tx.objectStore(STORES.state).get(context.epochId),[storedWrap,stored]=await Promise.all([result<{id:string;wrap:RootWrap}|undefined>(wrapRequest),result<StoredState|undefined>(stateRequest)]);await complete(tx);if(!storedWrap||!stored)throw new Error('Incomplete local epoch security state.');return{wrap:storedWrap.wrap,stored}}
function sameBytes(left:Uint8Array,right:Uint8Array):boolean{return left.byteLength===right.byteLength&&left.every((byte,index)=>byte===right[index])}
async function openStoredRoot(db:IDBDatabase,context:EpochContext,wrap:RootWrap):Promise<Uint8Array>{const cached=unlockedRoots.get(context.epochId);if(cached)return new Uint8Array(cached);let rootKey:Uint8Array;if(wrap.mode==='best-effort')rootKey=await openBestEffortRootWrap(wrap,await wrappingKey(db,context.wrapId));else{const factor=unlockFactors.get(context.diaryId);if(!factor||factor.mode!==wrap.mode)throw new LocalUnlockRequiredError(wrap.mode);if(wrap.mode==='passphrase')rootKey=await openPassphraseRootWrap(wrap,factor.passphrase);else{const expectedInput=fromBase64Url(wrap.mode_metadata.prf_eval_input);if(!sameBytes(expectedInput,factor.prfEvalInput)||wrap.mode_metadata.rp_id!==factor.rpId)throw new LocalUnlockRequiredError('prf');rootKey=await openPrfRootWrap(wrap,factor.credentialId,factor.prfOutput)}}unlockedRoots.set(context.epochId,new Uint8Array(rootKey));return rootKey}
async function loadEpoch(db:IDBDatabase):Promise<{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityState;epochSalt:Uint8Array}>{
  const contextTx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(contextTx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(contextTx);if(!context){const made=await initialContext(db);unlockedRoots.set(made.context.epochId,new Uint8Array(made.rootKey));return{...made,epochSalt:await deriveEpochSalt(fromBase64Url(made.context.diaryId),fromBase64Url(made.context.epochId))}}
  const {wrap,stored}=await readEpochRecords(db,context),rootKey=await openStoredRoot(db,context,wrap),epochSalt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,epochSalt,stored.state,stored.tag);return{context,rootKey,state:stored.state,epochSalt}
}`
  source=replaceOnce(source,oldLoad,newLoad,'load epoch')
  source=replaceOnce(source,
`function revisionData(value:Record<string,unknown>):unknown{`,
`export interface LocalRootWrapStatus{initialized:boolean;mode:'best-effort'|'passphrase'|'prf';locked:boolean;credentialId?:string;prfEvalInput?:string;rpId?:string}
export async function localRootWrapStatus():Promise<LocalRootWrapStatus>{const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)return{initialized:false,mode:'best-effort',locked:false};const {wrap}=await readEpochRecords(db,context);if(wrap.mode==='prf')return{initialized:true,mode:'prf',locked:!unlockedRoots.has(context.epochId),credentialId:wrap.mode_metadata.credential_id,prfEvalInput:wrap.mode_metadata.prf_eval_input,rpId:wrap.mode_metadata.rp_id};return{initialized:true,mode:wrap.mode,locked:wrap.mode!=='best-effort'&&!unlockedRoots.has(context.epochId)}}
export async function unlockActiveRootWithPassphrase(passphrase:string):Promise<void>{const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)throw new Error('No active epoch exists.');const{wrap,stored}=await readEpochRecords(db,context);if(wrap.mode!=='passphrase')throw new Error('Active root wrap is not passphrase mode.');const rootKey=await openPassphraseRootWrap(wrap,passphrase),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,salt,stored.state,stored.tag);unlockFactors.set(context.diaryId,{mode:'passphrase',passphrase});unlockedRoots.set(context.epochId,new Uint8Array(rootKey));readyPromise=null}
export async function unlockActiveRootWithPrf(assertedCredentialId:Uint8Array,prfOutput:Uint8Array):Promise<void>{const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)throw new Error('No active epoch exists.');const{wrap,stored}=await readEpochRecords(db,context);if(wrap.mode!=='prf')throw new Error('Active root wrap is not PRF mode.');const evalInput=fromBase64Url(wrap.mode_metadata.prf_eval_input),rootKey=await openPrfRootWrap(wrap,assertedCredentialId,prfOutput),salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId));await verifyStateTag(rootKey,salt,stored.state,stored.tag);unlockFactors.set(context.diaryId,{mode:'prf',credentialId:new Uint8Array(assertedCredentialId),prfEvalInput:evalInput,prfOutput:new Uint8Array(prfOutput),rpId:wrap.mode_metadata.rp_id});unlockedRoots.set(context.epochId,new Uint8Array(rootKey));readyPromise=null}
export async function lockActiveRoot():Promise<void>{const db=await openDatabase(),tx=db.transaction(STORES.context,'readonly'),context=await result<EpochContext|undefined>(tx.objectStore(STORES.context).get(ACTIVE_CONTEXT));await complete(tx);if(!context)return;unlockedRoots.delete(context.epochId);unlockFactors.delete(context.diaryId);readyPromise=null}
async function replaceActiveRootWrap(create:(loaded:Awaited<ReturnType<typeof loadEpoch>>)=>Promise<RootWrap>,factor:LocalUnlockFactor):Promise<void>{const db=await openDatabase(),initial=await loadEpoch(db);await withDiaryLock(initial.context.diaryId,async()=>{const current=await loadEpoch(db),oldContext=current.context,wrap=await create(current),context={...oldContext,wrapId:wrap.wrap_id},state={...current.state,operation_generation:current.state.operation_generation+1},tag=await stateTag(current.rootKey,current.epochSalt,state),tx=db.transaction([STORES.context,STORES.wraps,STORES.wrappingKeys,STORES.state],'readwrite');tx.objectStore(STORES.context).put(context);tx.objectStore(STORES.wraps).put({id:context.epochId,wrap});tx.objectStore(STORES.wrappingKeys).delete(oldContext.wrapId);tx.objectStore(STORES.state).put({id:context.epochId,state,tag} satisfies StoredState);await complete(tx);unlockFactors.set(context.diaryId,factor);unlockedRoots.set(context.epochId,new Uint8Array(current.rootKey))})}
export async function enrollActivePassphraseRootWrap(passphrase:string):Promise<void>{let factor:LocalUnlockFactor={mode:'passphrase',passphrase};await replaceActiveRootWrap(async loaded=>createPassphraseRootWrap(loaded.rootKey,passphrase,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),factor)}
export async function enrollActivePrfRootWrap(material:PrfWrapEnrollmentMaterial):Promise<void>{const factor:LocalUnlockFactor={mode:'prf',credentialId:new Uint8Array(material.credentialId),prfEvalInput:new Uint8Array(material.prfEvalInput),prfOutput:new Uint8Array(material.prfOutput),rpId:material.rpId};await replaceActiveRootWrap(async loaded=>createPrfRootWrap(loaded.rootKey,material,{diary_id:loaded.context.diaryId,epoch_id:loaded.context.epochId,key_id:loaded.context.keyId,manifest_fingerprint:loaded.context.manifestFingerprint}),factor)}

function revisionData(value:Record<string,unknown>):unknown{`,
'root wrap product APIs')

  const lines=source.split('\n')
  let index=lines.findIndex(line=>line.startsWith('  async persistSuccessor(input:'))
  if(index<0)throw new Error('Missing persistSuccessor')
  lines.splice(index,1,...`  async persistSuccessor(input:{context:EpochContext;rootKey:Uint8Array;state:EpochLocalSecurityState}):Promise<void>{
    const db=await openDatabase(),activeTx=db.transaction([STORES.context,STORES.wraps],'readonly'),activeContext=await result<EpochContext|undefined>(activeTx.objectStore(STORES.context).get(ACTIVE_CONTEXT)),sourceStored=activeContext?await result<{wrap:RootWrap}|undefined>(activeTx.objectStore(STORES.wraps).get(activeContext.epochId)):undefined;await complete(activeTx)
    let wrap:RootWrap
    if(sourceStored?.wrap.mode==='passphrase'){
      const factor=unlockFactors.get(input.context.diaryId);if(!factor||factor.mode!=='passphrase')throw new LocalUnlockRequiredError('passphrase')
      wrap=await createPassphraseRootWrap(input.rootKey,factor.passphrase,{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint})
    }else if(sourceStored?.wrap.mode==='prf'){
      const factor=unlockFactors.get(input.context.diaryId);if(!factor||factor.mode!=='prf')throw new LocalUnlockRequiredError('prf')
      wrap=await createPrfRootWrap(input.rootKey,{credentialId:factor.credentialId,prfEvalInput:factor.prfEvalInput,prfOutput:factor.prfOutput,rpId:factor.rpId},{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint})
    }else{
      const key=await wrappingKey(db,input.context.wrapId);wrap=await createBestEffortRootWrap(input.rootKey,key,{diary_id:input.context.diaryId,epoch_id:input.context.epochId,key_id:input.context.keyId,manifest_fingerprint:input.context.manifestFingerprint},fromBase64Url(input.context.wrapId));const opened=await openBestEffortRootWrap(wrap,key);if(base64Url(opened)!==base64Url(input.rootKey))throw new Error('Successor root-wrap readback failed.')
    }
    const context={...input.context,wrapId:wrap.wrap_id},salt=await deriveEpochSalt(fromBase64Url(context.diaryId),fromBase64Url(context.epochId)),tag=await stateTag(input.rootKey,salt,input.state),tx=db.transaction([STORES.wraps,STORES.state],'readwrite');tx.objectStore(STORES.wraps).put({id:context.epochId,wrap});tx.objectStore(STORES.state).put({id:context.epochId,state:input.state,tag} satisfies StoredState);await complete(tx);unlockedRoots.set(context.epochId,new Uint8Array(input.rootKey));const check=db.transaction([STORES.wraps,STORES.state],'readonly'),storedWrap=await result<{wrap:RootWrap}|undefined>(check.objectStore(STORES.wraps).get(context.epochId)),state=await result<StoredState|undefined>(check.objectStore(STORES.state).get(context.epochId));await complete(check);if(!storedWrap||!state)throw new Error('Successor staging readback failed.');await verifyStateTag(input.rootKey,salt,state.state,state.tag);await openStoredRoot(db,context,storedWrap.wrap)
  }`.split('\n'))
  index=lines.findIndex(line=>line.startsWith('  async successorRoot(epochId:string,wrapId:string):Promise<Uint8Array>{'))
  if(index<0)throw new Error('Missing successorRoot')
  lines.splice(index,1,...`  async successorRoot(epochId:string,wrapId:string):Promise<Uint8Array>{const db=await openDatabase(),active=await loadEpoch(db),tx=db.transaction(STORES.wraps,'readonly'),stored=await result<{wrap:RootWrap}|undefined>(tx.objectStore(STORES.wraps).get(epochId));await complete(tx);if(!stored)throw new Error('Successor root wrap missing.');const context:EpochContext={id:'active',diaryId:stored.wrap.diary_id,epochId,keyId:stored.wrap.key_id,manifestFingerprint:stored.wrap.manifest_fingerprint,wrapId};return openStoredRoot(db,context,stored.wrap)}`.split('\n'))
  source=lines.join('\n')
  source=replaceOnce(source,
`async function resetDatabaseForTesting():Promise<void>{if(import.meta.env.MODE!=='test')throw new Error('Database reset is test-only.');if(databasePromise){const db=await databasePromise;db.close()}databasePromise=null;readyPromise=null}`,
`async function resetDatabaseForTesting():Promise<void>{if(import.meta.env.MODE!=='test')throw new Error('Database reset is test-only.');if(databasePromise){const db=await databasePromise;db.close()}databasePromise=null;readyPromise=null;unlockedRoots.clear();unlockFactors.clear()}`,
'reset unlock cache')
  write(path,source)
}

write('src/test/localRootWrap.test.ts',`import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url, randomBytes } from '../security/crypto/bytes'
import { __localDatabaseTesting, enrollActivePassphraseRootWrap, enrollActivePrfRootWrap, getRecord, LOCAL_STORES, localRootWrapStatus, lockActiveRoot, putRecord, unlockActiveRootWithPassphrase, unlockActiveRootWithPrf } from '../data/localDatabase'

const pain=(id:string)=>({id,startedAt:'2026-09-16T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'local wrap fixture',createdAt:'2026-09-16T10:00:00.000Z',updatedAt:'2026-09-16T10:00:00.000Z'})
async function deleteDatabase(){await __localDatabaseTesting.resetForTesting();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('eds-diary');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('blocked'))})}

describe('strong local root wraps',()=>{
  beforeEach(deleteDatabase)
  it('enrolls, locks and unlocks an Argon2id passphrase wrap',async()=>{
    await putRecord(LOCAL_STORES.painEntries,pain('passphrase'))
    const passphrase='correct horse battery staple 2026'
    await enrollActivePassphraseRootWrap(passphrase)
    expect((await localRootWrapStatus()).mode).toBe('passphrase')
    await lockActiveRoot()
    expect((await localRootWrapStatus()).locked).toBe(true)
    await expect(getRecord(LOCAL_STORES.painEntries,'passphrase')).rejects.toThrow(/passphrase unlock/)
    await expect(unlockActiveRootWithPassphrase('incorrect passphrase long enough')).rejects.toThrow()
    await unlockActiveRootWithPassphrase(passphrase)
    expect((await localRootWrapStatus()).locked).toBe(false)
    expect(await getRecord<{id:string}>(LOCAL_STORES.painEntries,'passphrase')).toMatchObject({id:'passphrase'})
  },30_000)

  it('enrolls and byte-binds a WebAuthn PRF wrap',async()=>{
    await putRecord(LOCAL_STORES.painEntries,pain('prf'))
    const material={credentialId:randomBytes(32),prfEvalInput:randomBytes(32),prfOutput:randomBytes(32),rpId:'example.test'}
    await enrollActivePrfRootWrap(material)
    const status=await localRootWrapStatus();expect(status.mode).toBe('prf');expect(status.credentialId).toBe(base64Url(material.credentialId))
    await lockActiveRoot()
    await expect(unlockActiveRootWithPrf(randomBytes(32),material.prfOutput)).rejects.toThrow(/credential/)
    await unlockActiveRootWithPrf(material.credentialId,material.prfOutput)
    expect(await getRecord<{id:string}>(LOCAL_STORES.painEntries,'prf')).toMatchObject({id:'prf'})
  })
})
`)
