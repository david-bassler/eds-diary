import 'fake-indexeddb/auto'
import { beforeEach,describe,expect,it,vi } from 'vitest'

const pain=(id:string,note:string)=>({id,startedAt:'2026-09-15T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note,createdAt:'2026-09-15T10:00:00.000Z',updatedAt:'2026-09-15T10:00:00.000Z'})
async function remove(name:string){await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('delete blocked'))})}
async function seed(){await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('eds-diary',5);request.onupgradeneeded=()=>{for(const name of ['painEntries','medicationEntries','medicationPrescriptions','activityEntries','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});request.transaction!.objectStore('painEntries').put(pain('legacy-1','before'))};request.onsuccess=()=>{request.result.close();resolve()};request.onerror=()=>reject(request.error)})}

describe('legacy migration catch-up',()=>{beforeEach(async()=>{vi.resetModules();await remove('eds-diary');await seed()})
it('re-inventories until a concurrent legacy update and insert are encrypted',async()=>{const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase();let injected=false;db.__localDatabaseTesting.setLegacyMigrationHook(async()=>{if(injected)return;injected=true;const tx=raw.transaction('painEntries','readwrite');tx.objectStore('painEntries').put(pain('legacy-1','changed-during-backfill'));tx.objectStore('painEntries').put(pain('legacy-2','inserted-during-backfill'));await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})});const migrated=await db.getAllRecords<{id:string;note:string}>(db.LOCAL_STORES.painEntries);expect(migrated.find(value=>value.note==='changed-during-backfill')?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(migrated.find(value=>value.note==='inserted-during-backfill')?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);const stores=db.__localDatabaseTesting.STORES,tx=raw.transaction([stores.migration,stores.envelopes],'readonly'),migration=await new Promise<{phase:string;verified:boolean;stablePasses:number;legacyDirtyGeneration:number}>((resolve,reject)=>{const req=tx.objectStore(stores.migration).get('legacy-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}),envelopes=await new Promise<unknown[]>((resolve,reject)=>{const req=tx.objectStore(stores.envelopes).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});expect(migration).toMatchObject({phase:'cutover',verified:true,stablePasses:2});expect(migration.legacyDirtyGeneration).toBeGreaterThanOrEqual(1);expect(envelopes.length).toBeGreaterThanOrEqual(3);raw.close()})
it('verifies a legacy deletion against the migrated visible record id',async()=>{
  const db=await import('../data/localDatabase'),raw=await db.__localDatabaseTesting.openDatabase()
  let injected=false
  db.__localDatabaseTesting.setLegacyMigrationHook(async()=>{
    if(injected)return
    injected=true
    const tx=raw.transaction('painEntries','readwrite')
    tx.objectStore('painEntries').delete('legacy-1')
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
  })
  const migrated=await db.getAllRecords<{id:string;status?:string}>(db.LOCAL_STORES.painEntries)
  expect(migrated.some(value=>value.status==='deleted'&&/^[A-Za-z0-9_-]{22}$/.test(value.id))).toBe(true)
  raw.close()
})
})
