import { base64Url, fixedBase64Url, randomBytes } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { sha256 } from '../security/crypto/core'
import type { PreparedEnvelope } from '../security/envelopes'
import {
  deriveEpochSaltV2,
  generateWriterDeviceKeyV2,
  verifyWriterDeviceKeyPairV2,
  writerKeyIdV2,
} from '../security/v2/crypto'
import {
  journalNextV2,
  localStateTagV6,
  validateEpochLocalSecurityStateV6,
  verifyLocalStateTagV6,
  type EpochLocalSecurityStateV6,
  type RootWrapV6,
  validateRootWrapV6,
} from '../security/v2/localState'

const DEFAULT_DATABASE_NAME='eds-diary-v2-security'
const DATABASE_VERSION=1
const STORES={
  state:'epochSecurityStateV6',
  writerKeys:'writerDeviceKeysV2',
  rootWraps:'rootWrapsV6',
  wrappingKeys:'wrappingKeysV6',
  reservations:'envelopeReservationsV6',
  envelopes:'envelopesV6',
  outbox:'outboxV6',
} as const

type V2OutboxStatus='prepared'|'pending'|'durable'|'stale_writer_pending'

interface StoredStateV6 {id:string;state:EpochLocalSecurityStateV6;tag:string}
export interface StoredWriterDeviceKeyV2 {
  writer_signing_key_id:string
  writer_device_id:string
  writer_public_key:string
  private_key:CryptoKey
}
interface StoredReservationV6 {id:string;epoch_id:string;status:'reserved'|'consumed'}
interface StoredEnvelopeV6 extends PreparedEnvelope {id:string;epoch_id:string;local_seq:number;row:readonly [string,string,string]}
interface StoredOutboxV6 {id:string;epoch_id:string;envelope_id:string;status:V2OutboxStatus}

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
function exactObjectKeys(value:Record<string,unknown>,expected:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...expected].sort().join('\0'))throw new Error(`${label} has unknown or missing properties.`)
}
function assertPrivateSigningKey(key:CryptoKey):void{
  if(key.type!=='private'||key.algorithm.name!=='Ed25519'||key.extractable||key.usages.length!==1||key.usages[0]!=='sign')throw new Error('Stored writer private key is not an exact non-extractable Ed25519 signing key.')
}

export class IndexedDbV2LocalSecurityStore {
  private dbPromise:Promise<IDBDatabase>|null=null
  constructor(private readonly databaseName=DEFAULT_DATABASE_NAME){}

  private open():Promise<IDBDatabase>{
    if(this.dbPromise)return this.dbPromise
    this.dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.databaseName,DATABASE_VERSION)
      request.addEventListener('upgradeneeded',()=>{
        const db=request.result
        if(!db.objectStoreNames.contains(STORES.state))db.createObjectStore(STORES.state,{keyPath:'id'})
        if(!db.objectStoreNames.contains(STORES.writerKeys))db.createObjectStore(STORES.writerKeys,{keyPath:'writer_signing_key_id'})
        if(!db.objectStoreNames.contains(STORES.rootWraps))db.createObjectStore(STORES.rootWraps,{keyPath:'id'})
        if(!db.objectStoreNames.contains(STORES.wrappingKeys))db.createObjectStore(STORES.wrappingKeys,{keyPath:'id'})
        if(!db.objectStoreNames.contains(STORES.reservations)){const store=db.createObjectStore(STORES.reservations,{keyPath:'id'});store.createIndex('byEpoch','epoch_id')}
        if(!db.objectStoreNames.contains(STORES.envelopes)){const store=db.createObjectStore(STORES.envelopes,{keyPath:'id'});store.createIndex('byEpoch','epoch_id');store.createIndex('byEpochSeq',['epoch_id','local_seq'],{unique:true});store.createIndex('byIv','iv',{unique:true})}
        if(!db.objectStoreNames.contains(STORES.outbox)){const store=db.createObjectStore(STORES.outbox,{keyPath:'id'});store.createIndex('byEpoch','epoch_id')}
      })
      request.addEventListener('success',()=>resolve(request.result),{once:true})
      request.addEventListener('error',()=>{this.dbPromise=null;reject(request.error??new Error('v2 local security database open failed.'))},{once:true})
      request.addEventListener('blocked',()=>{this.dbPromise=null;reject(new Error('v2 local security database upgrade is blocked.'))},{once:true})
    })
    return this.dbPromise
  }

  async persistRootWrap(epochId:string,wrap:RootWrapV6):Promise<void>{
    fixedBase64Url(epochId,16,'epoch_id')
    const checked=validateRootWrapV6(wrap)
    if(checked.epoch_id!==epochId)throw new Error('RootWrapV6 epoch binding mismatch.')
    const db=await this.open(),tx=db.transaction(STORES.rootWraps,'readwrite')
    tx.objectStore(STORES.rootWraps).put({id:epochId,wrap:structuredClone(checked)})
    await transactionDone(tx)
    const read=db.transaction(STORES.rootWraps,'readonly'),stored=await requestResult<{id:string;wrap:RootWrapV6}|undefined>(read.objectStore(STORES.rootWraps).get(epochId));await transactionDone(read)
    if(!stored)throw new Error('RootWrapV6 persistence readback failed.')
    validateRootWrapV6(stored.wrap)
  }

  async readRootWrap(epochId:string):Promise<RootWrapV6|null>{
    fixedBase64Url(epochId,16,'epoch_id')
    const db=await this.open(),tx=db.transaction(STORES.rootWraps,'readonly')
    const stored=await requestResult<{id:string;wrap:RootWrapV6}|undefined>(tx.objectStore(STORES.rootWraps).get(epochId));await transactionDone(tx)
    return stored?validateRootWrapV6(stored.wrap):null
  }

  async createBestEffortWrappingKey(wrapId:string):Promise<CryptoKey>{
    fixedBase64Url(wrapId,16,'wrap_id')
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    const db=await this.open(),tx=db.transaction(STORES.wrappingKeys,'readwrite')
    tx.objectStore(STORES.wrappingKeys).add({id:wrapId,key})
    await transactionDone(tx)
    const checked=await this.loadBestEffortWrappingKey(wrapId)
    if(!checked)throw new Error('RootWrapV6 best-effort key persistence readback failed.')
    return checked
  }

  async loadBestEffortWrappingKey(wrapId:string):Promise<CryptoKey|null>{
    fixedBase64Url(wrapId,16,'wrap_id')
    const db=await this.open(),tx=db.transaction(STORES.wrappingKeys,'readonly')
    const stored=await requestResult<{id:string;key:CryptoKey}|undefined>(tx.objectStore(STORES.wrappingKeys).get(wrapId));await transactionDone(tx)
    if(!stored)return null
    const usages=[...stored.key.usages].sort().join(',')
    if(stored.key.type!=='secret'||stored.key.algorithm.name!=='AES-GCM'||stored.key.extractable||usages!=='decrypt,encrypt')throw new Error('Stored RootWrapV6 best-effort key is invalid.')
    return stored.key
  }

  async persistState(rootKey:Uint8Array,state:EpochLocalSecurityStateV6):Promise<void>{
    validateEpochLocalSecurityStateV6(state)
    const salt=await deriveEpochSaltV2(fixedBase64Url(state.diary_id,16),fixedBase64Url(state.epoch_id,16))
    const tag=await localStateTagV6(rootKey,salt,state)
    const db=await this.open(),tx=db.transaction(STORES.state,'readwrite')
    tx.objectStore(STORES.state).put({id:state.epoch_id,state:structuredClone(state),tag} satisfies StoredStateV6)
    await transactionDone(tx)
    const checked=await this.readState(rootKey,state.epoch_id)
    if(!checked||checked.operation_generation!==state.operation_generation)throw new Error('EpochLocalSecurityStateV6 readback failed.')
  }

  async replaceStateIfGeneration(rootKey:Uint8Array,nextState:EpochLocalSecurityStateV6,expectedGeneration:number):Promise<void>{
    validateEpochLocalSecurityStateV6(nextState)
    if(nextState.operation_generation!==expectedGeneration+1)throw new Error('Replacement StateV6 must advance operation_generation exactly once.')
    const salt=await deriveEpochSaltV2(fixedBase64Url(nextState.diary_id,16),fixedBase64Url(nextState.epoch_id,16))
    const tag=await localStateTagV6(rootKey,salt,nextState)
    const db=await this.open(),tx=db.transaction(STORES.state,'readwrite')
    const store=tx.objectStore(STORES.state),current=await requestResult<StoredStateV6|undefined>(store.get(nextState.epoch_id))
    if(!current||current.state.operation_generation!==expectedGeneration){tx.abort();throw new Error('Stale v2 local security generation.')}
    store.put({id:nextState.epoch_id,state:structuredClone(nextState),tag} satisfies StoredStateV6)
    await transactionDone(tx)
  }

  async readState(rootKey:Uint8Array,epochId:string):Promise<EpochLocalSecurityStateV6|null>{
    fixedBase64Url(epochId,16,'epoch_id')
    const db=await this.open(),tx=db.transaction(STORES.state,'readonly')
    const stored=await requestResult<StoredStateV6|undefined>(tx.objectStore(STORES.state).get(epochId))
    await transactionDone(tx)
    if(!stored)return null
    validateEpochLocalSecurityStateV6(stored.state)
    const salt=await deriveEpochSaltV2(fixedBase64Url(stored.state.diary_id,16),fixedBase64Url(stored.state.epoch_id,16))
    await verifyLocalStateTagV6(rootKey,salt,stored.state,stored.tag)
    return structuredClone(stored.state)
  }

  async createAndPersistWriterKey(diaryId:string,epochId:string,writerDeviceId:string):Promise<StoredWriterDeviceKeyV2>{
    fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id');fixedBase64Url(writerDeviceId,16,'writer_device_id')
    const generated=await generateWriterDeviceKeyV2()
    const record:StoredWriterDeviceKeyV2={
      writer_signing_key_id:generated.writerKeyId,
      writer_device_id:writerDeviceId,
      writer_public_key:base64Url(generated.publicKeyRaw),
      private_key:generated.privateKey,
    }
    const db=await this.open(),tx=db.transaction(STORES.writerKeys,'readwrite')
    tx.objectStore(STORES.writerKeys).add(record)
    await transactionDone(tx)
    const checked=await this.loadAndVerifyWriterKey(diaryId,epochId,writerDeviceId,record.writer_signing_key_id)
    if(!checked)throw new Error('WriterDeviceKeyV2 persistence readback failed.')
    return checked
  }

  async loadAndVerifyWriterKey(diaryId:string,epochId:string,writerDeviceId:string,writerSigningKeyId:string):Promise<StoredWriterDeviceKeyV2|null>{
    fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id');fixedBase64Url(writerDeviceId,16,'writer_device_id');fixedBase64Url(writerSigningKeyId,32,'writer_signing_key_id')
    const db=await this.open(),tx=db.transaction(STORES.writerKeys,'readonly')
    const record=await requestResult<StoredWriterDeviceKeyV2|undefined>(tx.objectStore(STORES.writerKeys).get(writerSigningKeyId))
    await transactionDone(tx)
    if(!record)return null
    exactObjectKeys(record as unknown as Record<string,unknown>,['writer_signing_key_id','writer_device_id','writer_public_key','private_key'],'WriterDeviceKeyV2 store record')
    if(record.writer_signing_key_id!==writerSigningKeyId||record.writer_device_id!==writerDeviceId)throw new Error('Stored WriterDeviceKeyV2 identity binding mismatch.')
    const raw=fixedBase64Url(record.writer_public_key,32,'writer_public_key')
    if(await writerKeyIdV2(raw)!==record.writer_signing_key_id)throw new Error('Stored WriterDeviceKeyV2 public key ID mismatch.')
    assertPrivateSigningKey(record.private_key)
    if(!await verifyWriterDeviceKeyPairV2(record.private_key,raw,diaryId,epochId,writerDeviceId))throw new Error('Stored WriterDeviceKeyV2 keypair challenge failed.')
    return record
  }

  async reserveEnvelope(epochId:string,envelopeId:string):Promise<void>{
    fixedBase64Url(epochId,16,'epoch_id');fixedBase64Url(envelopeId,32,'envelope_id')
    const db=await this.open(),tx=db.transaction(STORES.reservations,'readwrite')
    tx.objectStore(STORES.reservations).add({id:envelopeId,epoch_id:epochId,status:'reserved'} satisfies StoredReservationV6)
    await transactionDone(tx)
    const read=db.transaction(STORES.reservations,'readonly'),stored=await requestResult<StoredReservationV6|undefined>(read.objectStore(STORES.reservations).get(envelopeId));await transactionDone(read)
    if(!stored||stored.epoch_id!==epochId||stored.status!=='reserved')throw new Error('EnvelopeV6 reservation readback failed.')
  }

  async persistPreparedEnvelope(rootKey:Uint8Array,epochId:string,envelope:PreparedEnvelope,expectedGeneration:number):Promise<number>{
    const db=await this.open()
    const readTx=db.transaction([STORES.state,STORES.reservations,STORES.envelopes],'readonly')
    const stateReq=readTx.objectStore(STORES.state).get(epochId),reservationReq=readTx.objectStore(STORES.reservations).get(envelope.envelopeId),existingReq=readTx.objectStore(STORES.envelopes).get(envelope.envelopeId)
    const [stored,reservation,existing]=await Promise.all([
      requestResult<StoredStateV6|undefined>(stateReq),
      requestResult<StoredReservationV6|undefined>(reservationReq),
      requestResult<StoredEnvelopeV6|undefined>(existingReq),
    ])
    await transactionDone(readTx)
    if(!stored)throw new Error('EpochLocalSecurityStateV6 is missing.')
    const state=validateEpochLocalSecurityStateV6(stored.state)
    const salt=await deriveEpochSaltV2(fixedBase64Url(state.diary_id,16),fixedBase64Url(state.epoch_id,16))
    await verifyLocalStateTagV6(rootKey,salt,state,stored.tag)
    if(state.operation_generation!==expectedGeneration)throw new Error('Stale v2 local security generation.')
    if(!reservation||reservation.epoch_id!==epochId||reservation.status!=='reserved')throw new Error('EnvelopeV6 was not persistently reserved.')
    if(existing)throw new Error('EnvelopeV6 ID is already persisted.')
    const row=[envelope.envelopeId,envelope.iv,envelope.ciphertext] as const
    fixedBase64Url(envelope.envelopeId,32,'envelope_id');fixedBase64Url(envelope.iv,12,'iv')
    const expectedBytesHash=base64Url(await sha256(canonicalBytes(row as unknown as string[])))
    if(envelope.bytesHash!==expectedBytesHash)throw new Error('Prepared EnvelopeV6 bytesHash mismatch.')
    const ivTx=db.transaction(STORES.envelopes,'readonly'),ivOwner=await requestResult<StoredEnvelopeV6|undefined>(ivTx.objectStore(STORES.envelopes).index('byIv').get(envelope.iv));await transactionDone(ivTx)
    if(ivOwner&&ivOwner.envelopeId!==envelope.envelopeId)throw new Error('EnvelopeV6 IV reuse across envelope IDs is forbidden.')
    const nextCount=state.local_journal_count+1
    const nextHash=await journalNextV2(state.local_journal_hash,nextCount,row)
    const nextState={...state,local_journal_count:nextCount,local_journal_hash:nextHash,operation_generation:state.operation_generation+1}
    const nextTag=await localStateTagV6(rootKey,salt,nextState)
    const storedEnvelope:StoredEnvelopeV6={...envelope,id:envelope.envelopeId,epoch_id:epochId,local_seq:nextCount,row}
    const outbox:StoredOutboxV6={id:envelope.envelopeId,epoch_id:epochId,envelope_id:envelope.envelopeId,status:'prepared'}

    const tx=db.transaction([STORES.state,STORES.reservations,STORES.envelopes,STORES.outbox],'readwrite')
    tx.objectStore(STORES.envelopes).add(storedEnvelope)
    tx.objectStore(STORES.outbox).add(outbox)
    tx.objectStore(STORES.reservations).put({...reservation,status:'consumed'} satisfies StoredReservationV6)
    tx.objectStore(STORES.state).put({id:epochId,state:nextState,tag:nextTag} satisfies StoredStateV6)
    await transactionDone(tx)
    return nextState.operation_generation
  }

  async loadEnvelope(epochId:string,envelopeId:string):Promise<PreparedEnvelope|null>{
    const db=await this.open(),tx=db.transaction(STORES.envelopes,'readonly')
    const item=await requestResult<StoredEnvelopeV6|undefined>(tx.objectStore(STORES.envelopes).get(envelopeId));await transactionDone(tx)
    if(!item)return null
    if(item.epoch_id!==epochId)throw new Error('EnvelopeV6 belongs to another epoch.')
    return{envelopeId:item.envelopeId,iv:item.iv,ciphertext:item.ciphertext,bytesHash:item.bytesHash}
  }

  async quarantineStaleWriter(rootKey:Uint8Array,epochId:string,envelopeId:string,expectedGeneration:number):Promise<number>{
    const db=await this.open(),read=db.transaction([STORES.state,STORES.outbox],'readonly')
    const [stored,outbox]=await Promise.all([
      requestResult<StoredStateV6|undefined>(read.objectStore(STORES.state).get(epochId)),
      requestResult<StoredOutboxV6|undefined>(read.objectStore(STORES.outbox).get(envelopeId)),
    ]);await transactionDone(read)
    if(!stored||!outbox||outbox.epoch_id!==epochId)throw new Error('Stale-writer envelope or state is missing.')
    const state=validateEpochLocalSecurityStateV6(stored.state),salt=await deriveEpochSaltV2(fixedBase64Url(state.diary_id,16),fixedBase64Url(state.epoch_id,16))
    await verifyLocalStateTagV6(rootKey,salt,state,stored.tag)
    if(state.operation_generation!==expectedGeneration)throw new Error('Stale v2 local security generation.')
    if(outbox.status==='stale_writer_pending')return state.operation_generation
    const next={...state,stale_writer_pending_count:state.stale_writer_pending_count+1,operation_generation:state.operation_generation+1}
    const tag=await localStateTagV6(rootKey,salt,next)
    const tx=db.transaction([STORES.state,STORES.outbox],'readwrite')
    tx.objectStore(STORES.outbox).put({...outbox,status:'stale_writer_pending'} satisfies StoredOutboxV6)
    tx.objectStore(STORES.state).put({id:epochId,state:next,tag} satisfies StoredStateV6)
    await transactionDone(tx)
    return next.operation_generation
  }

  async setOutboxStatus(epochId:string,envelopeId:string,status:'pending'|'durable'):Promise<void>{
    const db=await this.open(),read=db.transaction(STORES.outbox,'readonly'),item=await requestResult<StoredOutboxV6|undefined>(read.objectStore(STORES.outbox).get(envelopeId));await transactionDone(read)
    if(!item||item.epoch_id!==epochId)throw new Error('OutboxV6 item missing.')
    if(item.status==='stale_writer_pending')throw new Error('A stale-writer envelope cannot re-enter the normal outbox.')
    const tx=db.transaction(STORES.outbox,'readwrite');tx.objectStore(STORES.outbox).put({...item,status} satisfies StoredOutboxV6);await transactionDone(tx)
  }

  async listOutbox(epochId:string,status?:V2OutboxStatus):Promise<PreparedEnvelope[]>{
    const db=await this.open(),tx=db.transaction([STORES.outbox,STORES.envelopes],'readonly')
    const outbox=await requestResult<StoredOutboxV6[]>(tx.objectStore(STORES.outbox).index('byEpoch').getAll(epochId))
    const envelopes=await requestResult<StoredEnvelopeV6[]>(tx.objectStore(STORES.envelopes).index('byEpoch').getAll(epochId))
    await transactionDone(tx)
    const byId=new Map(envelopes.map(item=>[item.envelopeId,item] as const))
    return outbox.filter(item=>status===undefined||item.status===status).map(item=>{const envelope=byId.get(item.envelope_id);if(!envelope)throw new Error('OutboxV6 references a missing immutable envelope.');return{envelopeId:envelope.envelopeId,iv:envelope.iv,ciphertext:envelope.ciphertext,bytesHash:envelope.bytesHash}})
  }

  async deleteForTesting():Promise<void>{
    if(import.meta.env.MODE!=='test')throw new Error('v2 security database deletion is test-only.')
    if(this.dbPromise){const db=await this.dbPromise;db.close();this.dbPromise=null}
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(this.databaseName);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('v2 security database deletion blocked.'))})
  }

  async openForTesting():Promise<IDBDatabase>{
    if(import.meta.env.MODE!=='test')throw new Error('v2 security database inspection is test-only.')
    return this.open()
  }
}

export function newV2ProtocolId(bytes:16|32):string{return base64Url(randomBytes(bytes))}
export const __v2LocalSecurityTesting={STORES,DEFAULT_DATABASE_NAME}
