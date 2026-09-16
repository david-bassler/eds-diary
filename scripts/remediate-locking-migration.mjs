import fs from 'node:fs'

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`)
  const next = source.replace(before, after)
  if (next.includes(before)) throw new Error(`Replacement for ${label} was not unique`)
  return next
}

const dbPath = 'src/data/localDatabase.ts'
let source = fs.readFileSync(dbPath, 'utf8')

source = replaceOnce(
  source,
  "const id=String(value.id??'');if(!id)throw new Error('Record id is required.');const revisions=await verifiedEnvelopeRevisions(db),profile=profileFor(store,id),recordId=revisions.some(revision=>revision.record_id===id&&revision.record_type===profile.recordType&&revision.record_schema===profile.recordSchema)?id:await recordIdentity(loaded.context,store,id);await rememberMapping(db,store,recordId,id)",
  "const id=String(value.id??'');if(!id)throw new Error('Record id is required.');const revisions=await verifiedEnvelopeRevisions(db),profile=profileFor(store,id),canonicalInput=revisions.some(revision=>revision.record_id===id&&revision.record_type===profile.recordType&&revision.record_schema===profile.recordSchema),recordId=canonicalInput?id:await recordIdentity(loaded.context,store,id);if(!canonicalInput)await rememberMapping(db,store,recordId,id)",
  'canonical-id write path',
)

source = replaceOnce(
  source,
  "async function readValues<T>(db:IDBDatabase,store:LocalStoreName):Promise<T[]>{",
  "function logicalAppId(revision:Revision,store:LocalStoreName):string{if(store===LOCAL_STORES.settings){if(revision.record_type==='activity_type_settings')return'activity-types';if(revision.record_type==='pain_type_settings')return'pain-types'}return revision.record_id}\nasync function readValues<T>(db:IDBDatabase,store:LocalStoreName):Promise<T[]>{",
  'logical app id helper insertion',
)

source = replaceOnce(
  source,
  "id:await legacyUiId(db,revision.record_id,store)",
  "id:logicalAppId(revision,store)",
  'read model id projection',
)

source = replaceOnce(
  source,
  "async function legacyUiId(db:IDBDatabase,recordId:string,store:LocalStoreName):Promise<string>{const tx=db.transaction(STORES.migration,'readonly'),mapping=await result<{id:string;legacyId:string}|undefined>(tx.objectStore(STORES.migration).get(`map:${store}:${recordId}`));await complete(tx);return mapping?.legacyId??recordId}\n",
  "",
  'legacy UI id mapper removal',
)

source = replaceOnce(
  source,
  "async function verifyLegacyTarget(db:IDBDatabase,item:LegacySource):Promise<void>{const values=await readValues<Record<string,unknown>>(db,item.store),target=values.find(value=>String(value.id)===String(item.value.id));if(!target)throw new Error('Legacy target verification failed.');if(item.value.status==='deleted'){if(target.status!=='deleted')throw new Error('Legacy tombstone target verification failed.');return}const expected={...item.value},actual={...target};if(!Object.prototype.hasOwnProperty.call(expected,'status'))delete actual.status;if(!sameCanonical(expected,actual))throw new Error('Legacy target bytes changed during migration.')}",
  "async function verifyLegacyTarget(db:IDBDatabase,item:LegacySource):Promise<void>{const context=(await loadEpoch(db)).context,legacyId=String(item.value.id),profile=profileFor(item.store,legacyId),recordId=await recordIdentity(context,item.store,legacyId),expectedId=item.store===LOCAL_STORES.settings?(profile.recordType==='activity_type_settings'?'activity-types':'pain-types'):recordId,values=await readValues<Record<string,unknown>>(db,item.store),target=values.find(value=>String(value.id)===expectedId);if(!target)throw new Error('Legacy target verification failed.');if(item.value.status==='deleted'){if(target.status!=='deleted')throw new Error('Legacy tombstone target verification failed.');return}const expected={...item.value,id:expectedId},actual={...target};if(!Object.prototype.hasOwnProperty.call(expected,'status'))delete actual.status;if(!sameCanonical(expected,actual))throw new Error('Legacy target bytes changed during migration.')}",
  'legacy verification id projection',
)

fs.writeFileSync(dbPath, source)

const localTestPath = 'src/test/localDatabase.test.ts'
let localTest = fs.readFileSync(localTestPath, 'utf8')
localTest = replaceOnce(
  localTest,
  "expect(await db.getRecord<{id:string;note:string}>(db.LOCAL_STORES.painEntries,'legacy-1')).toMatchObject({id:'legacy-1',note:'synthetic fixture'});await db.putRecord(db.LOCAL_STORES.painEntries,pain('new-1'));const raw=await new Promise<unknown>((resolve,reject)=>{const request=indexedDB.open('eds-diary');request.onsuccess=()=>{const tx=request.result.transaction('painEntries','readonly');const get=tx.objectStore('painEntries').get('new-1');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};request.onerror=()=>reject(request.error)});expect(raw).toBeUndefined();expect(await db.getRecord(db.LOCAL_STORES.painEntries,'new-1')).toMatchObject({id:'new-1',note:'synthetic fixture'});",
  "const migrated=await db.getAllRecords<{id:string;note:string}>(db.LOCAL_STORES.painEntries),legacy=migrated.find(value=>value.note==='synthetic fixture');expect(legacy?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(legacy?.id).not.toBe('legacy-1');await db.putRecord(db.LOCAL_STORES.painEntries,{...pain('new-1'),note:'new synthetic fixture'});const raw=await new Promise<unknown>((resolve,reject)=>{const request=indexedDB.open('eds-diary');request.onsuccess=()=>{const tx=request.result.transaction('painEntries','readonly');const get=tx.objectStore('painEntries').get('new-1');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};request.onerror=()=>reject(request.error)});expect(raw).toBeUndefined();const created=(await db.getAllRecords<{id:string;note:string}>(db.LOCAL_STORES.painEntries)).find(value=>value.note==='new synthetic fixture');expect(created?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(created?.id).not.toBe('new-1');expect(await db.getRecord(db.LOCAL_STORES.painEntries,created!.id)).toMatchObject({id:created!.id,note:'new synthetic fixture'});",
  'legacy migration expectations',
)
fs.writeFileSync(localTestPath, localTest)

const identityTest = `import 'fake-indexeddb/auto'\nimport { beforeEach, describe, expect, it, vi } from 'vitest'\n\nasync function removeDatabase():Promise<void>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('eds-diary');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('delete blocked'))})}\nasync function transactionDone(tx:IDBTransaction):Promise<void>{await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}\nasync function clearLegacyMappings(raw:IDBDatabase,storeName:string):Promise<void>{const tx=raw.transaction(storeName,'readwrite'),store=tx.objectStore(storeName),request=store.openCursor();await new Promise<void>((resolve,reject)=>{request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve();return}if(typeof cursor.key==='string'&&cursor.key.startsWith('map:'))cursor.delete();cursor.continue()};request.onerror=()=>reject(request.error)});await transactionDone(tx)}\nconst activity=(id:string,note='device A')=>({id,date:'2026-09-16',startTime:'10:00',endTime:'11:00',isOngoing:false,activityName:'Spaziergang',color:'#cbe7ca',note,createdAt:'2026-09-16T08:00:00.000Z',updatedAt:'2026-09-16T08:00:00.000Z'})\n\ndescribe('multi-device logical identities',()=>{beforeEach(async()=>{vi.resetModules();await removeDatabase()})\nit('uses the encrypted canonical record id without a device-local mapping',async()=>{const db=await import('../data/localDatabase');await db.putRecord(db.LOCAL_STORES.activityEntries,activity('activity-local-a'));const first=await db.getAllRecords<ReturnType<typeof activity>>(db.LOCAL_STORES.activityEntries);expect(first).toHaveLength(1);const canonicalId=first[0]!.id;expect(canonicalId).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(canonicalId).not.toBe('activity-local-a');const raw=await db.__localDatabaseTesting.openDatabase();await clearLegacyMappings(raw,db.__localDatabaseTesting.STORES.migration);expect(await db.getRecord<ReturnType<typeof activity>>(db.LOCAL_STORES.activityEntries,canonicalId)).toMatchObject({id:canonicalId,note:'device A'});await db.putRecord(db.LOCAL_STORES.activityEntries,{...first[0]!,note:'device B edit',updatedAt:'2026-09-16T09:00:00.000Z'});const after=await db.getAllRecords<ReturnType<typeof activity>>(db.LOCAL_STORES.activityEntries);expect(after).toHaveLength(1);expect(after[0]).toMatchObject({id:canonicalId,note:'device B edit'})})\nit('reconstructs both settings singleton ids without the local migration map',async()=>{const db=await import('../data/localDatabase');await db.putRecord(db.LOCAL_STORES.settings,{id:'activity-types',values:[{name:'Spaziergang',color:'#cbe7ca'}]});await db.putRecord(db.LOCAL_STORES.settings,{id:'pain-types',values:['Stechend']});const raw=await db.__localDatabaseTesting.openDatabase();await clearLegacyMappings(raw,db.__localDatabaseTesting.STORES.migration);expect(await db.getRecord<{id:string;values:unknown[]}>(db.LOCAL_STORES.settings,'activity-types')).toMatchObject({id:'activity-types'});expect(await db.getRecord<{id:string;values:unknown[]}>(db.LOCAL_STORES.settings,'pain-types')).toMatchObject({id:'pain-types'})})\n})\n`
fs.writeFileSync('src/test/multiDeviceIdentity.test.ts', identityTest)
