import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { parseStrictJson } from '../security/crypto/canonical'
import { base64Url, randomBytes, utf8 } from '../security/crypto/bytes'
import { assertAllowedGoogleApiRequest } from '../auth/googleAuthRpcPolicy'
import { persistRecoveredProfile, storedRecoveredRecoveryArtifact } from '../data/recoveryProfile'
import type { RecoveredRootCandidate, RecoveryArtifact } from '../security/recovery'
import type { VerifiedRecoveryBootstrap } from '../sync/core/remoteVerifier'
import type { EpochLocalSecurityState } from '../security/localState'

const b=(value:number,length:number)=>base64Url(new Uint8Array(length).fill(value))

function requestResult<T>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transactionDone(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}

describe('product integration hardening',()=>{
  it('accepts legacy pretty-printed JSON imports without weakening duplicate-key checks',()=>{
    const pretty=JSON.stringify({format:'legacy-export',nested:{value:1}},null,2)
    expect(parseStrictJson(utf8(pretty))).toEqual({format:'legacy-export',nested:{value:1}})
    expect(()=>parseStrictJson(utf8('{"a":1,"a":2}'))).toThrow('Duplicate JSON property')
  })

  it('limits auth-origin RPC to the exact Drive and Sheets endpoint families used by the transport',()=>{
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)'),'GET')).not.toThrow()
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://www.googleapis.com/drive/v3/files/abc/permissions?pageSize=100'),'GET')).not.toThrow()
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://www.googleapis.com/drive/v3/files/abc'),'PATCH')).not.toThrow()
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://sheets.googleapis.com/v4/spreadsheets'),'POST')).not.toThrow()
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://sheets.googleapis.com/v4/spreadsheets/abc:batchUpdate'),'POST')).not.toThrow()
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://www.googleapis.com/oauth2/v3/userinfo'),'GET')).toThrow('nicht erlaubt')
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://www.googleapis.com/drive/v3/files/abc/permissions'),'PATCH')).toThrow('nicht erlaubt')
    expect(()=>assertAllowedGoogleApiRequest(new URL('https://sheets.googleapis.com/v4/spreadsheets/abc'),'POST')).toThrow('nicht erlaubt')
  })

  it('keeps backup-restored profiles eligible for first remote enablement and preserves the recovery artifact after readback',async()=>{
    const databaseName=`eds-diary-recovery-regression-${base64Url(randomBytes(8))}`,diary=b(1,16),epoch=b(2,16),keyId=b(3,16),fingerprint=b(4,32)
    const candidate:RecoveredRootCandidate={rootKey:randomBytes(32),recoveryCommitment:b(5,32),payload:{recovery_artifact_id:b(6,16),diary_id:diary,epoch_id:epoch,key_id:keyId,RK_epoch:b(7,32),manifest_fingerprint:fingerprint,remote_anchor:null,google_account_binding:b(8,32),recovery_generation:1,created_at:'2026-09-17T12:00:00.000Z'}}
    const bootstrap={source:'verified-backup',verified:{snapshot:{manifest:[],rows:[]},manifestFingerprint:fingerprint,retired:false,verifiedEnvelopeIds:new Set<string>()},remoteBinding:null} as VerifiedRecoveryBootstrap
    const artifact:RecoveryArtifact={format:'sync-recovery-v5',version:5,recovery_artifact_id:candidate.payload.recovery_artifact_id,kdf_profile_id:'recovery-hkdf-v5-1',salt:b(9,32),wrap_iv:b(10,12),wrapped_payload:b(11,16)}
    await persistRecoveredProfile(candidate,bootstrap,{}, {databaseName,recoveryArtifact:artifact})
    const db=await requestResult(indexedDB.open(databaseName,8)),tx=db.transaction('epochSecurityState','readonly'),stored=await requestResult<{state:EpochLocalSecurityState}|undefined>(tx.objectStore('epochSecurityState').get(epoch));await transactionDone(tx);db.close()
    expect(stored?.state.epoch_status).toBe('local_offline')
    expect(stored?.state.remote_binding).toBeNull()
    expect(await storedRecoveredRecoveryArtifact(databaseName)).toEqual(artifact)
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})
  })
})
