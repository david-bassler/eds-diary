import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import { TestRemoteVerifier } from '../sync/testing/TestRemoteVerifier'
import { openEnvelope } from '../security/envelopes'
import { base64Url, randomBytes } from '../security/crypto/bytes'

const pain=(id:string)=>({id,startedAt:'2026-09-15T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'synthetic fixture',createdAt:'2026-09-15T10:00:00.000Z',updatedAt:'2026-09-15T10:00:00.000Z'})
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('eds-diary',5);request.onupgradeneeded=()=>{for(const name of ['painEntries','medicationEntries','medicationPrescriptions','activityEntries','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});request.transaction!.objectStore('painEntries').put(pain('legacy-1'));};request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)})})
describe('legacy secure migration',()=>{it('reads migrated data and never writes new plaintext to the legacy store',async()=>{const db=await import('../data/localDatabase');expect(await db.getRecord<{id:string;note:string}>(db.LOCAL_STORES.painEntries,'legacy-1')).toMatchObject({id:'legacy-1',note:'synthetic fixture'});await db.putRecord(db.LOCAL_STORES.painEntries,pain('new-1'));const raw=await new Promise<unknown>((resolve,reject)=>{const request=indexedDB.open('eds-diary');request.onsuccess=()=>{const tx=request.result.transaction('painEntries','readonly');const get=tx.objectStore('painEntries').get('new-1');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};request.onerror=()=>reject(request.error)});expect(raw).toBeUndefined();expect(await db.getRecord(db.LOCAL_STORES.painEntries,'new-1')).toMatchObject({id:'new-1',note:'synthetic fixture'});await expect(db.verifyLocalIntegrity()).resolves.toBeUndefined()})
it('rejects invalid domain data before reserving an envelope',async()=>{const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase();await expect(db.putRecord(db.LOCAL_STORES.painEntries,{id:'invalid',note:'incomplete'})).rejects.toThrow('required');const tx=raw.transaction([db.__localDatabaseTesting.STORES.reservations,db.__localDatabaseTesting.STORES.envelopes],'readonly'),reservations=await new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.reservations).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),envelopes=await new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.envelopes).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});expect(reservations).toHaveLength(2);expect(envelopes).toHaveLength(2)})
it('detects journal and authenticated-state manipulation',async()=>{const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),epoch=await db.__localDatabaseTesting.loadEpoch(raw),tx=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite'),request=tx.objectStore(db.__localDatabaseTesting.STORES.state).get(epoch.context.epochId),stored=await new Promise<{id:string;state:typeof epoch.state;tag:string}>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});const authentic=structuredClone(stored);stored.state={...stored.state,local_journal_count:stored.state.local_journal_count+1};const write=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite');write.objectStore(db.__localDatabaseTesting.STORES.state).put(stored);await new Promise<void>((resolve,reject)=>{write.oncomplete=()=>resolve();write.onerror=()=>reject(write.error)});await expect(db.__localDatabaseTesting.loadEpoch(raw)).rejects.toThrow('MAC');const restore=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite');restore.objectStore(db.__localDatabaseTesting.STORES.state).put(authentic);await new Promise<void>((resolve,reject)=>{restore.oncomplete=()=>resolve();restore.onerror=()=>reject(restore.error)})})})

describe('productive IndexedDB coordinator store',()=>{it('persists every envelope durable and reconstructs an empty outbox after reload',async()=>{
  indexedDB.deleteDatabase('eds-diary-coordinator-unused')
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw)
  await db.putRecords(db.LOCAL_STORES.painEntries,[pain('sync-1'),pain('sync-2'),pain('sync-3')])
  const transport=new InMemoryTransport(),remoteId='real-idb-remote',manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA'];transport.remotes.set(remoteId,{manifest,rows:[]})
  const coordinator=new SingleWriterCoordinator(active.context.diaryId,active.context.epochId,remoteId,transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),new db.IndexedDbCoordinatorStore(active.context.epochId))
  coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
  const snapshot=await transport.read(remoteId),store=new db.IndexedDbCoordinatorStore(active.context.epochId)
  expect(snapshot.rows.length).toBeGreaterThanOrEqual(3);expect(await store.pending(snapshot.rows)).toEqual([])
  const tx=raw.transaction(db.__localDatabaseTesting.STORES.outbox,'readonly'),rows=await new Promise<Array<{status:string}>>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.outbox).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  expect(rows.every(row=>row.status==='durable')).toBe(true)
  const reconstructed=await store.pending([])
  expect(reconstructed).toHaveLength(snapshot.rows.length)
  expect(await store.pending(snapshot.rows)).toEqual([])
  const conflicting=snapshot.rows.map(row=>[...row]);conflicting[0]![2]=`${conflicting[0]![2]}corrupt`
  await expect(store.pending(conflicting)).rejects.toThrow('Envelope ID exists with different bytes.')
})})

describe('immutable envelope write authority',()=>{it('uses the verified envelope head after the revision cache is deleted',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw)
  await db.putRecord(db.LOCAL_STORES.painEntries,pain('parent-source'))
  const beforeTx=raw.transaction(db.__localDatabaseTesting.STORES.envelopes,'readonly'),before=await new Promise<Array<{envelopeId:string;iv:string;ciphertext:string;bytesHash:string;localSeq:number}>>((resolve,reject)=>{const request=beforeTx.objectStore(db.__localDatabaseTesting.STORES.envelopes).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),prior=before.sort((a,b)=>a.localSeq-b.localSeq).at(-1)!
  const clear=raw.transaction(db.__localDatabaseTesting.STORES.revisions,'readwrite');clear.objectStore(db.__localDatabaseTesting.STORES.revisions).clear();await new Promise<void>((resolve,reject)=>{clear.oncomplete=()=>resolve();clear.onerror=()=>reject(clear.error)})
  await db.putRecord(db.LOCAL_STORES.painEntries,{...pain('parent-source'),note:'updated synthetic fixture'})
  const afterTx=raw.transaction(db.__localDatabaseTesting.STORES.envelopes,'readonly'),after=await new Promise<Array<{envelopeId:string;iv:string;ciphertext:string;bytesHash:string;localSeq:number}>>((resolve,reject)=>{const request=afterTx.objectStore(db.__localDatabaseTesting.STORES.envelopes).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),revision=await openEnvelope(active.rootKey,active.epochSalt,{diaryId:active.context.diaryId,epochId:active.context.epochId},after.sort((a,b)=>a.localSeq-b.localSeq).at(-1)!)
  const parent=await openEnvelope(active.rootKey,active.epochSalt,{diaryId:active.context.diaryId,epochId:active.context.epochId},prior)
  expect(revision.parent_revision_ids).toEqual([parent.revision_id])
})

it('abandons one-shot rotation IDs after reservation or encryption crashes and reuses persisted bytes',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw),material=await new db.IndexedDbRotationRepository().verifiedActiveEpoch(),template=material.revisions.find(item=>item.record_status==='active')!
  const revision={...template,revision_id:base64Url(randomBytes(32)),parent_revision_ids:[]}
  const attempts:Array<{point:string;id:string;iv?:string}>=[];let crash='after-reservation'
  const repository=new db.IndexedDbRotationRepository((point,id,iv)=>{attempts.push({point,id,iv});if(point===crash){crash='';throw new Error(`crash:${point}`)}})
  await expect(repository.prepareRotationEnvelope('one-shot',active.context,revision)).rejects.toThrow('crash:after-reservation')
  crash='after-encryption'
  await expect(repository.prepareRotationEnvelope('one-shot',active.context,revision)).rejects.toThrow('crash:after-encryption')
  const persisted=await repository.prepareRotationEnvelope('one-shot',active.context,revision),resumed=await new db.IndexedDbRotationRepository().prepareRotationEnvelope('one-shot',active.context,revision)
  expect(resumed).toEqual(persisted)
  const encrypted=attempts.filter(item=>item.point==='after-encryption')
  expect(new Set(attempts.filter(item=>item.point==='after-reservation').map(item=>item.id)).size).toBe(3)
  expect(new Set(encrypted.map(item=>`${item.id}:${item.iv}`)).size).toBe(encrypted.length)
  expect(encrypted.map(item=>item.id)).not.toContain(attempts[0]!.id)
  expect(await repository.successorEnvelopes(active.context.epochId)).toContainEqual(persisted)
})})
