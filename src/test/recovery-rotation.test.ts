import { describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { recoveryCommitment, randomBytes } from '../security/crypto/core'
import { activateRecoveredRoot, createRecovery, recoverRootKeyCandidate } from '../security/recovery'
import { advanceRotation, maySwitchRotation, oldEpochWritable, runRotation, type ProductiveRotationState, type RotationState } from '../security/rotation'
import { FullRemoteVerifier, IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'

const b = (n: number, length: number) => base64Url(new Uint8Array(length).fill(n))

describe('recovery continuity', () => {
  it('returns an untrusted candidate whose commitment still requires authenticated bootstrap verification', async () => {
    const urs = randomBytes(32)
    const root = randomBytes(32)
    const payload = {
      diary_id: b(1, 16), epoch_id: b(2, 16), key_id: b(3, 16), RK_epoch: base64Url(root),
      manifest_fingerprint: b(4, 32), remote_anchor: { anchor_profile: 'google-sheets-single-writer-v1' as const, covered_row_count: 0, prefix_hash: b(0, 32) },
      google_account_binding: b(5, 32), recovery_generation: 1, created_at: '2026-09-15T12:00:00.000Z',
    }
    const artifact = await createRecovery(payload, urs)
    const candidate = await recoverRootKeyCandidate(artifact, urs)
    expect(candidate.rootKey).toEqual(root)
    expect(candidate.recoveryCommitment).toBe(await recoveryCommitment(urs, new Uint8Array(16).fill(1), 1))
    await expect(recoverRootKeyCandidate(artifact, randomBytes(32))).rejects.toThrow()
  })
  it('rejects self-confirmation through a caller-assembled epoch verifier', async()=>{
    const urs=randomBytes(32),root=randomBytes(32),payload={diary_id:b(1,16),epoch_id:b(2,16),key_id:b(3,16),RK_epoch:base64Url(root),manifest_fingerprint:b(4,32),remote_anchor:{anchor_profile:'google-sheets-single-writer-v1' as const,covered_row_count:0,prefix_hash:b(0,32)},google_account_binding:b(5,32),recovery_generation:1,created_at:'2026-09-15T12:00:00.000Z'},candidate=await recoverRootKeyCandidate(await createRecovery(payload,urs),urs)
    const forged=new FullRemoteVerifier({rootKey:candidate.rootKey,diaryId:payload.diary_id,epochId:payload.epoch_id,expectedManifestFingerprint:payload.manifest_fingerprint,expectedKeyId:payload.key_id,expectedRecoveryGeneration:1,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:payload.google_account_binding,schemas:{},oldAnchor:payload.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()})
    await expect(activateRecoveredRoot(candidate,forged as unknown as RecoveryBootstrapVerifier,async()=>undefined)).rejects.toThrow('independently authenticated')
    const forgedAuthority={source:'authenticated-remote',remoteResourceId:'independently-discovered-file',authenticatedAccountBinding:payload.google_account_binding,load:async()=>({manifest:[],rows:[]})}
    expect(()=>new RecoveryBootstrapVerifier({authority:forgedAuthority as never,schemas:{}})).toThrow('forged')
    const transport=new InMemoryTransport();transport.remotes.set('locator-resource',{manifest:[],rows:[]})
    await expect(IndependentBootstrapAuthority.fromAuthenticatedGoogleDiscovery(transport as never,'locator','locator-resource')).rejects.toThrow('productive Google identity boundary')
  })
})

describe('productive rotation orchestration',()=>{it('persists and executes every irreversible gate in order',async()=>{let persisted:ProductiveRotationState|null=null;let hash='';const calls:string[]=[];const initial:ProductiveRotationState={rotationId:'r',oldEpochId:'o',newEpochId:'n',step:'prepared',copiedEnvelopeIds:[]};const state=await runRotation({persistence:{read:async()=>persisted,write:async(value,nextHash)=>{persisted=structuredClone(value) as ProductiveRotationState;hash=nextHash},readBack:async()=>({state:persisted!,hash})},verifyAndFreezeSource:async()=>({anchor:{},semanticSnapshot:'semantic',lineageSnapshot:'lineage'}),createAndVerifyRootWrap:async()=>{calls.push('wrap')},verifyRecoverySecret:async()=>undefined,planSuccessor:async()=>undefined,createOrReconcileSuccessor:async()=>undefined,copySemanticHeadsAndMigration:async()=>{calls.push('copy')},fullVerifySuccessor:async()=>({semanticSnapshot:'semantic'}),createAndBootstrapRecovery:async()=>{calls.push('recovery');return'a'},createAndTestRestoreBackup:async()=>{calls.push('backup');return'b'},prepareAnnouncementEnvelope:async()=>{calls.push('announcement')},appendReadbackAndFullVerifyAnnouncement:async()=>{calls.push('durable')},atomicSwitchAndRetireSource:async()=>{calls.push('switch')}},initial);expect(state.step).toBe('switched');expect(calls).toEqual(['wrap','copy','recovery','backup','announcement','durable','switch'])})})

describe('rotation gates', () => {
  it('freezes before source snapshot and switches only after durable announcement', () => {
    let state: RotationState = { rotationId: 'r', oldEpochId: 'o', newEpochId: 'n', step: 'prepared', copiedEnvelopeIds: [] }
    for (const step of ['root_wrap_verified', 'source_frozen_verified', 'recovery_secret_verified', 'successor_planned', 'successor_bound', 'copying', 'successor_verified', 'recovery_verified', 'backup_verified', 'announcement_pending', 'announcement_durable'] as const) {
      state = advanceRotation(state, step)
      if (step === 'source_frozen_verified') expect(oldEpochWritable(state)).toBe(false)
    }
    expect(maySwitchRotation(state)).toBe(true)
    expect(oldEpochWritable(state)).toBe(false)
  })
})
