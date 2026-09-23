import { base64Url, equalBytes, fixedBase64Url, fromBase64Url, randomBytes } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { hmacSha256 } from '../crypto/core'
import { deriveLocalStateMacKeyV2 } from './crypto'
import type { PreparedEnvelope } from '../envelopes'
import { localJournalNextV2, localStateTagV6, validateEpochLocalSecurityStateV6, validateStoredWriterDeviceKeyV2, verifyLocalStateTagV6, withDiaryLockV2, type EpochLocalSecurityStateV6, type StoredWriterDeviceKeyV2 } from './localState'

const DATABASE_NAME='eds-diary-v2-security'
const DATABASE_VERSION=2
const STORES={states:'epochSecurityStateV6',writerKeys:'writerDeviceKeysV2',reservations:'envelopeReservationsV6',envelopes:'envelopesV6',outbox:'outboxV6'} as const

export interface EnvelopeReservationV6 {
  id:string
  epoch_id:string
  envelope_id:string
  iv:string
  state:'reserved'|'sealed'
}
export interface PersistedEnvelopeV6 extends PreparedEnvelope {
  id:string
  epoch_id:string
  local_sequence:number
}
export interface PreparedEnvelopeAuthorityV2 {
  writer_generation:number
  writer_grant_id:string
  writer_device_id:string
  writer_key_id:string
}
export type V2OutboxStatus='prepared'|'pending'|'durable'|'stale_writer_pending'
export interface V2OutboxEntryCore {
  id:string
  epoch_id:string
  envelope_id:string
  status:V2OutboxStatus
  authority:PreparedEnvelopeAuthorityV2
}
export interface V2OutboxEntry extends V2OutboxEntryCore {tag:string}
async function outboxTag(rootKey:Uint8Array,epochSalt:Uint8Array,entry:V2OutboxEntryCore):Promise<string>{
  return base64Url(await hmacSha256(await deriveLocalStateMacKeyV2(rootKey,epochSalt),canonicalBytes(entry as never)))
}
async function verifyOutboxTag(rootKey:Uint8Array,epochSalt:Uint8Array,entry:V2OutboxEntry):Promise<void>{
  const {tag,...core}=entry,expected=fromBase64Url(await outboxTag(rootKey,epochSalt,core))
  if(!equalBytes(fixedBase64Url(tag,32,'outbox_tag'),expected))throw new Error('V2 outbox MAC failed.')
}

function requestResult<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.addEventListener('success',()=>resolve(request.result),{once:true})
    request.addEventListener('error',()=>reject(request.error??new Error('IndexedDB request failed.')),{once:true})
  })
}
function transactionDone(tx:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    tx.addEventListener('complete',()=>resolve(),{once:true})
    tx.addEventListener('abort',()=>reject(tx.error??new Error('IndexedDB transaction aborted.')),{once:true})
    tx.addEventListener('error',()=>reject(tx.error??new Error('IndexedDB transaction failed.')),{once:true})
  })
}
let databasePromise:Promise<IDBDatabase>|null=null
async function openDatabase():Promise<IDBDatabase>{
  if(databasePromise)return databasePromise
  databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,DATABASE_VERSION)
    request.addEventListener('upgradeneeded',()=>{
      const db=request.result
      if(!db.objectStoreNames.contains(STORES.states))db.createObjectStore(STORES.states,{keyPath:'id'})
      if(!db.objectStoreNames.contains(STORES.writerKeys))db.createObjectStore(STORES.writerKeys,{keyPath:'writer_signing_key_id'})
      if(!db.objectStoreNames.contains(STORES.reservations)){const store=db.createObjectStore(STORES.reservations,{keyPath:'id'});store.createIndex('byEpoch','epoch_id')}
      if(!db.objectStoreNames.contains(STORES.envelopes)){const store=db.createObjectStore(STORES.envelopes,{keyPath:'id'});store.createIndex('byEpoch','epoch_id');store.createIndex('bySequence',['epoch_id','local_sequence'],{unique:true})}
      if(!db.objectStoreNames.contains(STORES.outbox)){const store=db.createObjectStore(STORES.outbox,{keyPath:'id'});store.createIndex('byEpoch','epoch_id')}
    })
    request.addEventListener('success',()=>{
      const db=request.result
      db.addEventListener('versionchange',()=>{db.close();databasePromise=null})
      resolve(db)
    },{once:true})
    request.addEventListener('error',()=>{databasePromise=null;reject(request.error??new Error('V2 security database open failed.'))},{once:true})
  })
  return databasePromise
}

export class IndexedDbV2LocalSecurityStore {
  async initializeState(rootKey:Uint8Array,epochSalt:Uint8Array,state:EpochLocalSecurityStateV6):Promise<void>{
    validateEpochLocalSecurityStateV6(state)
    const db=await openDatabase(),tag=await localStateTagV6(rootKey,epochSalt,state),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).add({id:state.epoch_id,state:structuredClone(state),tag})
    await transactionDone(tx)
    await this.loadState(rootKey,epochSalt,state.epoch_id)
  }

  async loadState(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<EpochLocalSecurityStateV6>{
    const db=await openDatabase(),tx=db.transaction(STORES.states,'readonly')
    const stored=await requestResult<{id:string;state:EpochLocalSecurityStateV6;tag:string}|undefined>(tx.objectStore(STORES.states).get(epochId))
    await transactionDone(tx)
    if(!stored)throw new Error('EpochLocalSecurityStateV6 is missing.')
    validateEpochLocalSecurityStateV6(stored.state)
    await verifyLocalStateTagV6(rootKey,epochSalt,stored.state,stored.tag)
    if(stored.id!==stored.state.epoch_id||stored.id!==epochId)throw new Error('EpochLocalSecurityStateV6 identity mismatch.')
    return structuredClone(stored.state)
  }

  async replaceState(rootKey:Uint8Array,epochSalt:Uint8Array,expectedOperationGeneration:number,next:EpochLocalSecurityStateV6):Promise<void>{
    validateEpochLocalSecurityStateV6(next)
    const db=await openDatabase(),current=await this.loadState(rootKey,epochSalt,next.epoch_id)
    if(current.operation_generation!==expectedOperationGeneration||next.operation_generation!==expectedOperationGeneration+1)throw new Error('Stale EpochLocalSecurityStateV6 generation.')
    const tag=await localStateTagV6(rootKey,epochSalt,next),tx=db.transaction(STORES.states,'readwrite')
    tx.objectStore(STORES.states).put({id:next.epoch_id,state:structuredClone(next),tag})
    await transactionDone(tx)
    await this.loadState(rootKey,epochSalt,next.epoch_id)
  }

  async persistWriterKey(entry:StoredWriterDeviceKeyV2,diaryId:string,epochId:string):Promise<void>{
    await validateStoredWriterDeviceKeyV2(entry,diaryId,epochId)
    const db=await openDatabase(),tx=db.transaction(STORES.writerKeys,'readwrite'),store=tx.objectStore(STORES.writerKeys)
    const existing=await requestResult<StoredWriterDeviceKeyV2|undefined>(store.get(entry.writer_signing_key_id))
    if(existing){
      await validateStoredWriterDeviceKeyV2(existing,diaryId,epochId)
      if(existing.writer_device_id!==entry.writer_device_id||existing.writer_public_key!==entry.writer_public_key)throw new Error('Writer key ID collision in local key store.')
    }else store.add(entry)
    await transactionDone(tx)
  }

  async loadWriterKey(writerSigningKeyId:string,diaryId:string,epochId:string):Promise<StoredWriterDeviceKeyV2|null>{
    const db=await openDatabase(),tx=db.transaction(STORES.writerKeys,'readonly')
    const entry=await requestResult<StoredWriterDeviceKeyV2|undefined>(tx.objectStore(STORES.writerKeys).get(writerSigningKeyId))
    await transactionDone(tx)
    if(!entry)return null
    await validateStoredWriterDeviceKeyV2(entry,diaryId,epochId)
    return entry
  }

  async reserveEnvelope(epochId:string):Promise<EnvelopeReservationV6>{
    const db=await openDatabase()
    for(let attempt=0;attempt<4;attempt+=1){
      const envelopeId=base64Url(randomBytes(32)),reservation:EnvelopeReservationV6={id:`${epochId}:${envelopeId}`,epoch_id:epochId,envelope_id:envelopeId,iv:base64Url(randomBytes(12)),state:'reserved'}
      const tx=db.transaction(STORES.reservations,'readwrite')
      try{tx.objectStore(STORES.reservations).add(reservation);await transactionDone(tx);return reservation}catch(error){if(attempt===3)throw error}
    }
    throw new Error('Envelope reservation failed.')
  }

  async commitReservedEnvelope(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    expectedOperationGeneration:number,
    reservation:EnvelopeReservationV6,
    envelope:PreparedEnvelope,
    authority:PreparedEnvelopeAuthorityV2,
  ):Promise<EpochLocalSecurityStateV6>{
    if(reservation.state!=='reserved'||reservation.envelope_id!==envelope.envelopeId||reservation.iv!==envelope.iv)throw new Error('Prepared envelope does not match its one-shot reservation.')
    const db=await openDatabase(),current=await this.loadState(rootKey,epochSalt,reservation.epoch_id)
    if(current.operation_generation!==expectedOperationGeneration)throw new Error('Stale local-state generation before envelope commit.')
    const reservationId=reservation.id
    const checkTx=db.transaction(STORES.reservations,'readonly')
    const storedReservation=await requestResult<EnvelopeReservationV6|undefined>(checkTx.objectStore(STORES.reservations).get(reservationId))
    await transactionDone(checkTx)
    if(!storedReservation||storedReservation.state!=='reserved'||storedReservation.envelope_id!==envelope.envelopeId||storedReservation.iv!==envelope.iv)throw new Error('Envelope reservation is missing, consumed or changed.')

    const sequence=current.local_journal_count+1
    const nextState:EpochLocalSecurityStateV6={
      ...current,
      operation_generation:current.operation_generation+1,
      local_journal_count:sequence,
      local_journal_hash:await localJournalNextV2(current.local_journal_hash,sequence,envelope),
    }
    validateEpochLocalSecurityStateV6(nextState)
    const tag=await localStateTagV6(rootKey,epochSalt,nextState)
    const tx=db.transaction([STORES.reservations,STORES.envelopes,STORES.outbox,STORES.states],'readwrite')
    tx.objectStore(STORES.reservations).put({...storedReservation,state:'sealed'} satisfies EnvelopeReservationV6)
    tx.objectStore(STORES.envelopes).add({...envelope,id:reservationId,epoch_id:reservation.epoch_id,local_sequence:sequence} satisfies PersistedEnvelopeV6)
    const outboxCore:V2OutboxEntryCore={id:reservationId,epoch_id:reservation.epoch_id,envelope_id:envelope.envelopeId,status:'prepared',authority:structuredClone(authority)}
    tx.objectStore(STORES.outbox).add({...outboxCore,tag:await outboxTag(rootKey,epochSalt,outboxCore)} satisfies V2OutboxEntry)
    tx.objectStore(STORES.states).put({id:reservation.epoch_id,state:structuredClone(nextState),tag})
    await transactionDone(tx)
    return this.loadState(rootKey,epochSalt,reservation.epoch_id)
  }


  async commitVerifiedDispositions(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    expectedOperationGeneration:number,
    nextState:EpochLocalSecurityStateV6,
    acceptedEnvelopeIds:ReadonlySet<string>,
    staleWriterEnvelopeIds:ReadonlySet<string>,
  ):Promise<EpochLocalSecurityStateV6>{
    return withDiaryLockV2(nextState.diary_id,async()=>{
      const current=await this.loadState(rootKey,epochSalt,nextState.epoch_id)
      if(current.operation_generation!==expectedOperationGeneration||nextState.operation_generation!==expectedOperationGeneration+1)throw new Error('Stale StateV6 generation during verified disposition commit.')
      const entries=await this.outbox(rootKey,epochSalt,nextState.epoch_id)
      const updated=entries.map(entry=>{
        if(acceptedEnvelopeIds.has(entry.envelope_id))return{...entry,status:'durable' as const}
        if(staleWriterEnvelopeIds.has(entry.envelope_id))return{...entry,status:'stale_writer_pending' as const}
        return entry
      })
      const staleCount=updated.filter(entry=>entry.status==='stale_writer_pending').length
      const finalState={...nextState,stale_writer_pending_count:staleCount}
      validateEpochLocalSecurityStateV6(finalState)
      const tag=await localStateTagV6(rootKey,epochSalt,finalState),db=await openDatabase(),tx=db.transaction([STORES.outbox,STORES.states],'readwrite')
      for(const entry of updated){
        const {tag: _tag,...core}=entry
        tx.objectStore(STORES.outbox).put({...core,tag:await outboxTag(rootKey,epochSalt,core)})
      }
      tx.objectStore(STORES.states).put({id:finalState.epoch_id,state:structuredClone(finalState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,finalState.epoch_id)
    })
  }

  async updateOutboxStatus(
    rootKey:Uint8Array,
    epochSalt:Uint8Array,
    epochId:string,
    envelopeId:string,
    expectedOperationGeneration:number,
    status:'pending'|'stale_writer_pending',
  ):Promise<EpochLocalSecurityStateV6>{
    const current=await this.loadState(rootKey,epochSalt,epochId)
    return withDiaryLockV2(current.diary_id,async()=>{
      const fresh=await this.loadState(rootKey,epochSalt,epochId)
      if(fresh.operation_generation!==expectedOperationGeneration)throw new Error('Stale StateV6 generation during outbox update.')
      const db=await openDatabase(),readTx=db.transaction(STORES.outbox,'readonly')
      const entry=await requestResult<V2OutboxEntry|undefined>(readTx.objectStore(STORES.outbox).get(`${epochId}:${envelopeId}`))
      await transactionDone(readTx)
      if(!entry)throw new Error('V2 outbox envelope is missing.')
      const entries=await this.outbox(rootKey,epochSalt,epochId)
      const nextEntries=entries.map(item=>item.id===entry.id?{...item,status}:item)
      const staleCount=nextEntries.filter(item=>item.status==='stale_writer_pending').length
      const nextState={...fresh,operation_generation:fresh.operation_generation+1,stale_writer_pending_count:staleCount}
      const tag=await localStateTagV6(rootKey,epochSalt,nextState),tx=db.transaction([STORES.outbox,STORES.states],'readwrite')
      const {tag: _tag,...entryCore}=entry,nextCore={...entryCore,status}
      tx.objectStore(STORES.outbox).put({...nextCore,tag:await outboxTag(rootKey,epochSalt,nextCore)})
      tx.objectStore(STORES.states).put({id:epochId,state:structuredClone(nextState),tag})
      await transactionDone(tx)
      return this.loadState(rootKey,epochSalt,epochId)
    })
  }

  async envelopeAuthority(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string,envelopeId:string):Promise<PreparedEnvelopeAuthorityV2|null>{
    const db=await openDatabase(),tx=db.transaction(STORES.outbox,'readonly')
    const entry=await requestResult<V2OutboxEntry|undefined>(tx.objectStore(STORES.outbox).get(`${epochId}:${envelopeId}`))
    await transactionDone(tx)
    if(!entry)return null
    await verifyOutboxTag(rootKey,epochSalt,entry)
    return structuredClone(entry.authority)
  }

  async outbox(rootKey:Uint8Array,epochSalt:Uint8Array,epochId:string):Promise<V2OutboxEntry[]>{
    const db=await openDatabase(),tx=db.transaction(STORES.outbox,'readonly')
    const entries=await requestResult<V2OutboxEntry[]>(tx.objectStore(STORES.outbox).index('byEpoch').getAll(epochId))
    await transactionDone(tx)
    for(const entry of entries)await verifyOutboxTag(rootKey,epochSalt,entry)
    return entries.map(entry=>structuredClone(entry))
  }

  async envelopes(epochId:string):Promise<PreparedEnvelope[]>{
    const db=await openDatabase(),tx=db.transaction(STORES.envelopes,'readonly')
    const stored=await requestResult<PersistedEnvelopeV6[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId))
    await transactionDone(tx)
    return stored.sort((a,b)=>a.local_sequence-b.local_sequence).map(({envelopeId,iv,ciphertext,bytesHash})=>({envelopeId,iv,ciphertext,bytesHash}))
  }
}

export const __v2LocalPersistenceTesting={
  async reset():Promise<void>{
    if(databasePromise){const db=await databasePromise;db.close();databasePromise=null}
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(DATABASE_NAME);request.addEventListener('success',()=>resolve(),{once:true});request.addEventListener('error',()=>reject(request.error),{once:true});request.addEventListener('blocked',()=>reject(new Error('V2 security database reset blocked.')),{once:true})})
  },
  STORES,
}
