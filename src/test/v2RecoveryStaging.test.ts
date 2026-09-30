import { describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { randomBytes } from '../security/crypto/core'
import { generateRecoveryTakeoverKeyMaterialV2 } from '../security/v2/crypto'
import { createRecoveryTakeoverStagingV2, verifyRecoveryTakeoverStagingV2 } from '../security/v2/recoveryStaging'

describe('VerifiedRecoveryTakeoverStagingV2 capability',()=>{
  it('freezes verified staging fields so the WeakSet brand cannot outlive verified bytes',async()=>{
    const urs=randomBytes(32),pair=await generateRecoveryTakeoverKeyMaterialV2()
    const staging=await createRecoveryTakeoverStagingV2({
      diaryId:base64Url(new Uint8Array(16).fill(1)),
      epochId:base64Url(new Uint8Array(16).fill(2)),
      recoveryGeneration:3,
      recoveryTakeoverKeyId:pair.recoveryTakeoverKeyId,
      recoveryTakeoverPublicKey:base64Url(pair.publicKeyRaw),
      recoveryTakeoverPrivateKeyPkcs8:pair.privateKeyPkcs8,
      manifestFingerprint:base64Url(new Uint8Array(32).fill(4)),
      urs,
    })
    pair.privateKeyPkcs8.fill(0)
    const verified=await verifyRecoveryTakeoverStagingV2(staging,urs)
    const original=verified.staging.diary_id
    expect(Object.isFrozen(verified.staging)).toBe(true)
    expect(()=>{(verified.staging as {diary_id:string}).diary_id=base64Url(new Uint8Array(16).fill(9))}).toThrow()
    expect(verified.staging.diary_id).toBe(original)
  })
})
