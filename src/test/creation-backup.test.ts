import { describe,expect,it } from 'vitest'
import { createOrReconcile, reconcileCreation } from '../sync/core/creation'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import { createBackup,testRestoreBackup } from '../security/backup'
import { randomBytes } from '../security/crypto/core'
describe('create reconciliation',()=>{it('binds only one authenticated candidate and stops ambiguity',async()=>{const t=new InMemoryTransport(),c=new GoogleSheetsSingleWriterProfileCodec(async()=>({retired:false,verifiedEnvelopeIds:new Set()})),manifest=['sync-v5','5','iv','ct'];t.remotes.set('loc',{manifest,rows:[]});const fingerprint=(await c.verifyRemote({manifest,rows:[]})).manifestFingerprint;const base={locator:'loc',manifestFingerprint:fingerprint,status:'creation_pending' as const,remoteId:null};expect((await createOrReconcile(base,manifest,t,c)).status).toBe('bound');t.remotes.set('loc-copy',{manifest,rows:[]});expect((await reconcileCreation(base,t,c)).status).toBe('ambiguous')})})
describe('bounded encrypted backup',()=>{it('round trips the complete envelope set',async()=>{const key=randomBytes(32),values=[{envelopeId:'e',iv:'i',ciphertext:'c',bytesHash:'h'}];expect(await testRestoreBackup(key,await createBackup(key,values))).toEqual(values)})})
