import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { SingleWriterCoordinator } from '../sync/core/coordinator'
import { singleWriterV1WriteAuthority } from '../sync/core/writeAuthority'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import { TestRemoteVerifier } from '../sync/testing/TestRemoteVerifier'
import { openEnvelope } from '../security/envelopes'
import { base64Url, randomBytes } from '../security/crypto/bytes'
import { stateTag } from '../security/localState'
import { SINGLE_WRITER_V1_PROFILE, type VerifiedRemoteState } from '../sync/core/contracts'

const pain=(id:string)=>({id,startedAt:'2026-09-15T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'synthetic fixture',createdAt:'2026-09-15T10:00:00.000Z',updatedAt:'2026-09-15T10:00:00.000Z'})
const verifiedV1=(rows:ReadonlyArray<readonly string[]>):VerifiedRemoteState=>{const ids=new Set(rows.map(row=>row[0]??''));return{profileId:SINGLE_WRITER_V1_PROFILE,profileState:null,snapshot:{manifest:[],rows},manifestFingerprint:'',retired:false,verifiedEnvelopeIds:ids,acceptedEnvelopeIds:new Set(ids),staleWriterEnvelopeIds:new Set<string>()}}
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('eds-diary',5);request.onupgradeneeded=()=>{for(const name of ['painEntries','medicationEntries','medicationPrescriptions','activityEntries','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});request.transaction!.objectStore('painEntries').put(pain('legacy-1'));};request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)})})
describe('legacy secure migration',()=>{it('reads migrated data and removes the plaintext legacy schema after verified cutover',async()=>{const db=await import('../data/localDatabase');const migrated=await db.getAllRecords<{id:string;note:string}>(db.LOCAL_STORES.painEntries),legacy=migrated.find(value=>value.note==='synthetic fixture');expect(legacy?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(legacy?.id).not.toBe('legacy-1');const schema=await db.__localDatabaseTesting.openDatabase();expect(schema.version).toBeGreaterThanOrEqual(9);expect(schema.objectStoreNames.contains('painEntries')).toBe(false);expect(schema.objectStoreNames.contains('activityEntries')).toBe(false);await expect(new Promise<void>((resolve,reject)=>{const request=indexedDB.open('eds-diary',8);request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)})).rejects.toMatchObject({name:'VersionError'});await db.putRecord(db.LOCAL_STORES.painEntries,{...pain('new-1'),note:'new synthetic fixture'});const created=(await db.getAllRecords<{id:string;note:string}>(db.LOCAL_STORES.painEntries)).find(value=>value.note==='new synthetic fixture');expect(created?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(created?.id).not.toBe('new-1');expect(await db.getRecord(db.LOCAL_STORES.painEntries,created!.id)).toMatchObject({id:created!.id,note:'new synthetic fixture'});await expect(db.verifyLocalIntegrity()).resolves.toBeUndefined()})
it('rejects invalid domain data before reserving an envelope',async()=>{const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase();await expect(db.putRecord(db.LOCAL_STORES.painEntries,{id:'invalid',note:'incomplete'})).rejects.toThrow('required');const tx=raw.transaction([db.__localDatabaseTesting.STORES.reservations,db.__localDatabaseTesting.STORES.envelopes],'readonly'),reservations=await new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.reservations).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),envelopes=await new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.envelopes).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});expect(reservations).toHaveLength(2);expect(envelopes).toHaveLength(2)})
it('detects journal and authenticated-state manipulation',async()=>{const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),epoch=await db.__localDatabaseTesting.loadEpoch(raw),tx=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite'),request=tx.objectStore(db.__localDatabaseTesting.STORES.state).get(epoch.context.epochId),stored=await new Promise<{id:string;state:typeof epoch.state;tag:string}>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});const authentic=structuredClone(stored);stored.state={...stored.state,local_journal_count:stored.state.local_journal_count+1};const write=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite');write.objectStore(db.__localDatabaseTesting.STORES.state).put(stored);await new Promise<void>((resolve,reject)=>{write.oncomplete=()=>resolve();write.onerror=()=>reject(write.error)});await expect(db.__localDatabaseTesting.loadEpoch(raw)).rejects.toThrow('MAC');const restore=raw.transaction(db.__localDatabaseTesting.STORES.state,'readwrite');restore.objectStore(db.__localDatabaseTesting.STORES.state).put(authentic);await new Promise<void>((resolve,reject)=>{restore.oncomplete=()=>resolve();restore.onerror=()=>reject(restore.error)})})})

describe('productive IndexedDB coordinator store',()=>{it('persists a verified pure-pull anchor before any push',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw),store=new db.IndexedDbCoordinatorStore(active.context.epochId),transport=new InMemoryTransport(),remoteId='pure-pull-idb',manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA'];transport.remotes.set(remoteId,{manifest,rows:[]});const coordinator=new SingleWriterCoordinator(active.context.diaryId,active.context.epochId,remoteId,transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),store,false,singleWriterV1WriteAuthority());coordinator.connected();await coordinator.pullVerify();expect((await db.__localDatabaseTesting.loadEpoch(raw)).state.remote_anchor?.covered_row_count).toBe(0)
})

it('persists every envelope durable and reconstructs an empty outbox after reload',async()=>{
  indexedDB.deleteDatabase('eds-diary-coordinator-unused')
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw)
  await db.putRecords(db.LOCAL_STORES.painEntries,[pain('sync-1'),pain('sync-2'),pain('sync-3')])
  const transport=new InMemoryTransport(),remoteId='real-idb-remote',manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA'];transport.remotes.set(remoteId,{manifest,rows:[]})
  const coordinator=new SingleWriterCoordinator(active.context.diaryId,active.context.epochId,remoteId,transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),new db.IndexedDbCoordinatorStore(active.context.epochId),false,singleWriterV1WriteAuthority())
  coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
  const snapshot=await transport.read(remoteId),store=new db.IndexedDbCoordinatorStore(active.context.epochId)
  expect(snapshot.rows.length).toBeGreaterThanOrEqual(3);expect(await store.pending(verifiedV1(snapshot.rows))).toEqual([])
  const tx=raw.transaction(db.__localDatabaseTesting.STORES.outbox,'readonly'),rows=await new Promise<Array<{status:string}>>((resolve,reject)=>{const request=tx.objectStore(db.__localDatabaseTesting.STORES.outbox).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  expect(rows.every(row=>row.status==='durable')).toBe(true)
  const reconstructed=await store.pending(verifiedV1([]))
  expect(reconstructed).toHaveLength(snapshot.rows.length)
  expect(await store.pending(verifiedV1(snapshot.rows))).toEqual([])
  const conflicting=snapshot.rows.map(row=>[...row]);conflicting[0]![2]=`${conflicting[0]![2]}corrupt`
  await expect(store.pending(verifiedV1(conflicting))).rejects.toThrow('Envelope ID exists with different bytes.')
})

it('reconciles remote-present prepared, pending, remote_seen and stale durable rows without another append',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw),stores=db.__localDatabaseTesting.STORES
  const envelopeTx=raw.transaction(stores.envelopes,'readonly'),envelopes=await new Promise<Array<{envelopeId:string;iv:string;ciphertext:string;localSeq:number}>>((resolve,reject)=>{const request=envelopeTx.objectStore(stores.envelopes).index('byEpoch').getAll(active.context.epochId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  const remoteRows=envelopes.sort((a,b)=>a.localSeq-b.localSeq).map(item=>[item.envelopeId,item.iv,item.ciphertext]),target=envelopes.at(-1);if(!target)throw new Error('Expected a local immutable envelope.')
  const readOutbox=async()=>{const tx=raw.transaction(stores.outbox,'readonly'),item=await new Promise<{id:string;epochId:string;envelopeId:string;rowBytes:string;status:'prepared'|'pending'|'remote_seen'|'durable'}>((resolve,reject)=>{const request=tx.objectStore(stores.outbox).get(target.envelopeId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return item}
  const setOutbox=async(status:'prepared'|'pending'|'remote_seen'|'durable')=>{const item=await readOutbox(),tx=raw.transaction(stores.outbox,'readwrite');tx.objectStore(stores.outbox).put({...item,status});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
  const clearAnchor=async()=>{const loaded=await db.__localDatabaseTesting.loadEpoch(raw),state={...loaded.state,remote_anchor:null},tag=await stateTag(loaded.rootKey,loaded.epochSalt,state),tx=raw.transaction(stores.state,'readwrite');tx.objectStore(stores.state).put({id:loaded.context.epochId,state,tag});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
  const transport=new InMemoryTransport(),remoteId='reconcile-existing-remote',manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA'],store=new db.IndexedDbCoordinatorStore(active.context.epochId)
  for(const status of ['prepared','pending','remote_seen','durable'] as const){await clearAnchor();await setOutbox(status);transport.remotes.set(remoteId,{manifest,rows:remoteRows});transport.appendAttempts=[];const coordinator=new SingleWriterCoordinator(active.context.diaryId,active.context.epochId,remoteId,transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),store,false,singleWriterV1WriteAuthority());coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending();expect(transport.appendAttempts).toHaveLength(0);expect((await readOutbox()).status).toBe('durable');expect((await db.__localDatabaseTesting.loadEpoch(raw)).state.remote_anchor?.covered_row_count).toBe(remoteRows.length)}
  expect(await store.pending(verifiedV1(remoteRows))).toEqual([])
  await clearAnchor();await setOutbox('durable');const missingTarget=remoteRows.filter(row=>row[0]!==target.envelopeId);expect((await store.pending(verifiedV1(missingTarget))).map(item=>item.envelopeId)).toContain(target.envelopeId)
  const conflicting=remoteRows.map(row=>[...row]);const targetRow=conflicting.find(row=>row[0]===target.envelopeId)!;targetRow[2]=`${targetRow[2]}corrupt`;await expect(store.pending(verifiedV1(conflicting))).rejects.toThrow('Envelope ID exists with different bytes.')
})})

describe('immutable envelope write authority',()=>{it('uses the verified envelope head without a plaintext revision cache',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase(),active=await db.__localDatabaseTesting.loadEpoch(raw)
  await db.putRecord(db.LOCAL_STORES.painEntries,pain('parent-source'))
  const beforeTx=raw.transaction(db.__localDatabaseTesting.STORES.envelopes,'readonly'),before=await new Promise<Array<{envelopeId:string;iv:string;ciphertext:string;bytesHash:string;localSeq:number}>>((resolve,reject)=>{const request=beforeTx.objectStore(db.__localDatabaseTesting.STORES.envelopes).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),prior=before.sort((a,b)=>a.localSeq-b.localSeq).at(-1)!
  expect(raw.objectStoreNames.contains('revisions')).toBe(false)
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
