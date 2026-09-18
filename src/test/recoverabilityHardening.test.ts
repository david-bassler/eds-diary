import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import { recoveryArtifactLocator, type RecoveryArtifact } from '../security/recovery'
import { assertOriginMigrationBundle, createOriginMigrationBundle } from '../security/originMigration'
import type { SyncBackupV5 } from '../security/backup'
import { __localDatabaseTesting, activeRemoteDurabilityStatus, LOCAL_STORES, putRecord } from '../data/localDatabase'

const b=(length:number,value:number)=>base64Url(new Uint8Array(length).fill(value))

function deleteDatabase():Promise<void>{return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('eds-diary');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Test database deletion was blocked.'))})}

describe('recoverability hardening',()=>{
  beforeEach(async()=>{await __localDatabaseTesting.resetForTesting();await deleteDatabase()})

  it('derives an opaque stable locator only from the recovery secret',async()=>{
    const first=new Uint8Array(32).fill(1),second=new Uint8Array(32).fill(2),a=await recoveryArtifactLocator(first),again=await recoveryArtifactLocator(first),bValue=await recoveryArtifactLocator(second)
    expect(a).toBe(again)
    expect(a).not.toBe(bValue)
    expect(fromBase64Url(a)).toHaveLength(16)
    await expect(recoveryArtifactLocator(new Uint8Array(31))).rejects.toThrow('32 bytes')
  })

  it('reports local-only envelopes from persistent outbox state after reload-safe writes',async()=>{
    await putRecord(LOCAL_STORES.painEntries,{id:'durability-fixture',startedAt:'2026-09-18T08:00:00.000Z',endedAt:'',locations:[],intensity:3,qualities:[],cause:'',occursWhen:'',note:'synthetic',createdAt:'2026-09-18T08:00:00.000Z',updatedAt:'2026-09-18T08:00:00.000Z'})
    const status=await activeRemoteDurabilityStatus()
    expect(status.remoteBound).toBe(false)
    expect(status.totalEnvelopeCount).toBe(1)
    expect(status.pendingEnvelopeCount).toBe(1)
  })

  it('packages recovery and backup for an explicit origin handoff without the recovery secret',()=>{
    const recovery:RecoveryArtifact={format:'sync-recovery-v5',version:5,recovery_artifact_id:b(16,1),kdf_profile_id:'recovery-hkdf-v5-1',salt:b(32,2),wrap_iv:b(12,3),wrapped_payload:b(16,4)}
    const backup={format:'sync-backup-v5',backup_format_version:5,backup_id:b(32,5),backup_manifest_iv:b(12,6),backup_manifest_ciphertext:b(16,7),epoch_manifest_public:['a','b','c','d'],record_rows:[],pending_outbox_rows:[]} as SyncBackupV5
    const bundle=createOriginMigrationBundle(recovery,backup,'https://old.example.test','2026-09-18T09:00:00.000Z')
    expect(bundle.recovery).toBe(recovery)
    expect(bundle.backup).toBe(backup)
    expect(JSON.stringify(bundle)).not.toContain('recovery-secret')
    expect(()=>assertOriginMigrationBundle(bundle)).not.toThrow()
    expect(()=>createOriginMigrationBundle(recovery,backup,'https://old.example.test/path')).toThrow('exact browser origin')
  })
})
