import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url, randomBytes } from '../security/crypto/bytes'
import { __localDatabaseTesting, enrollActivePassphraseRootWrap, enrollActivePrfRootWrap, getAllRecords, getRecord, LOCAL_STORES, localRootWrapStatus, lockActiveRoot, putRecord, unlockActiveRootWithPassphrase, unlockActiveRootWithPrf } from '../data/localDatabase'

const pain=(id:string)=>({id,startedAt:'2026-09-16T10:00:00.000Z',endedAt:'',locations:[],intensity:4,qualities:[],cause:'',occursWhen:'',note:'local wrap fixture',createdAt:'2026-09-16T10:00:00.000Z',updatedAt:'2026-09-16T10:00:00.000Z'})
async function deleteDatabase(){await __localDatabaseTesting.resetForTesting();await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('eds-diary');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('blocked'))})}

describe('strong local root wraps',()=>{
  beforeEach(deleteDatabase)
  it('enrolls, locks and unlocks an Argon2id passphrase wrap',async()=>{
    await putRecord(LOCAL_STORES.painEntries,pain('passphrase'))
    const stored=(await getAllRecords<{id:string}>(LOCAL_STORES.painEntries))[0]!
    const passphrase='correct horse battery staple 2026'
    await enrollActivePassphraseRootWrap(passphrase)
    expect((await localRootWrapStatus()).mode).toBe('passphrase')
    await lockActiveRoot()
    expect((await localRootWrapStatus()).locked).toBe(true)
    await expect(getAllRecords(LOCAL_STORES.painEntries)).rejects.toThrow(/passphrase unlock/)
    await expect(unlockActiveRootWithPassphrase('incorrect passphrase long enough')).rejects.toThrow()
    await unlockActiveRootWithPassphrase(passphrase)
    expect((await localRootWrapStatus()).locked).toBe(false)
    expect(await getRecord<{id:string}>(LOCAL_STORES.painEntries,stored.id)).toMatchObject({id:stored.id})
  },30_000)

  it('enrolls and byte-binds a WebAuthn PRF wrap',async()=>{
    await putRecord(LOCAL_STORES.painEntries,pain('prf'))
    const stored=(await getAllRecords<{id:string}>(LOCAL_STORES.painEntries))[0]!
    const material={credentialId:randomBytes(32),prfEvalInput:randomBytes(32),prfOutput:randomBytes(32),rpId:'example.test'}
    await enrollActivePrfRootWrap(material)
    const status=await localRootWrapStatus();expect(status.mode).toBe('prf');expect(status.credentialId).toBe(base64Url(material.credentialId))
    await lockActiveRoot()
    await expect(unlockActiveRootWithPrf(randomBytes(32),material.prfOutput)).rejects.toThrow(/credential/)
    await unlockActiveRootWithPrf(material.credentialId,material.prfOutput)
    expect(await getRecord<{id:string}>(LOCAL_STORES.painEntries,stored.id)).toMatchObject({id:stored.id})
  })

  for(const field of ['diaryId','epochId','keyId','manifestFingerprint','wrapId'] as const)it(`fails closed when unauthenticated EpochContext.${field} is changed`,async()=>{
    await putRecord(LOCAL_STORES.painEntries,pain(`context-${field}`))
    const db=await __localDatabaseTesting.openDatabase(),tx=db.transaction(__localDatabaseTesting.STORES.context,'readwrite'),store=tx.objectStore(__localDatabaseTesting.STORES.context),context=await new Promise<Record<string,unknown>>((resolve,reject)=>{const request=store.get('active');request.onsuccess=()=>resolve(request.result as Record<string,unknown>);request.onerror=()=>reject(request.error)})
    context[field]=base64Url(randomBytes(16));store.put(context);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})
    await expect(getAllRecords(LOCAL_STORES.painEntries)).rejects.toThrow(/context does not match|Incomplete local epoch/)
  })
})
