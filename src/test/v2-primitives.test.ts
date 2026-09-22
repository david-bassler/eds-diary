import { describe, expect, it } from 'vitest'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import { base64Url, fromBase64Url } from '../security/crypto/bytes'
import { sha256 } from '../security/crypto/core'
import {
  deriveActivationLineageCacheKeyV2,
  deriveBackupKeyV2,
  deriveEnvelopeKeyV2,
  deriveEpochSaltV2,
  deriveLocalStateMacKeyV2,
  deriveManifestKeyV2,
  deriveRecoveryKeyV2,
  deriveRecoveryTakeoverStagingKeyV2,
  generateWriterDeviceKeyV2,
  recoveryTakeoverKeyIdV2,
  recoveryUrsIdV2,
  signEd25519V2,
  transferDescriptorPopBytesV2,
  verifyEd25519V2,
  writerKeyIdV2,
} from '../security/v2/crypto'
import { validateRemoteAnchorV2, validateTransferDescriptorV2, verifyTransferDescriptorV2 } from '../security/v2/validators'
import type { TransferDescriptorV2 } from '../security/v2/types'

const bytes=(start:number,length:number)=>Uint8Array.from({length},(_,index)=>(start+index)&0xff)

describe('transferable single writer v2 primitive golden vectors',()=>{
  it('matches the frozen identifier and epoch-salt vectors',async()=>{
    const diary=bytes(0,16),epoch=bytes(16,16),writerPublic=bytes(0,32),urs=bytes(96,32)
    await expect(writerKeyIdV2(writerPublic)).resolves.toBe('rs-mRc1Y2AimOhGNuqlEpdew1LHwFZUMnfzYnP4rqL4')
    await expect(recoveryTakeoverKeyIdV2(writerPublic)).resolves.toBe('Ee6bA___q8Bdx7TjpDUQrl-Sky7_Dm0MDFJiva7YfOs')
    await expect(recoveryUrsIdV2(urs)).resolves.toBe('qLjDR1ig9ZkcyOHIAofhvyDGkmcIp0InxJDJ7ZkAgwY')
    await expect(deriveEpochSaltV2(diary,epoch).then(base64Url)).resolves.toBe('9pb0gDq3Z9WWfZg7NyYFnEj6o6BMoVluFiY39gPG-Lk')
  })

  it('matches all frozen v6/v2 HKDF domains',async()=>{
    const diary=bytes(0,16),epoch=bytes(16,16),root=bytes(128,32),envelopeId=bytes(160,32),backupId=bytes(192,32),urs=bytes(96,32),recoverySalt=bytes(224,32),stagingSalt=bytes(0,32),salt=await deriveEpochSaltV2(diary,epoch)
    await expect(deriveEnvelopeKeyV2(root,salt,envelopeId).then(base64Url)).resolves.toBe('A3SSM7F6RYtlwQsMM6XWePkPelmfMJtb8V9yUwcshd8')
    await expect(deriveManifestKeyV2(root,salt).then(base64Url)).resolves.toBe('j9433BmNz_-dziJCTeImnNi5xr8HBRObwwPOL0oR8ew')
    await expect(deriveLocalStateMacKeyV2(root,salt).then(base64Url)).resolves.toBe('Kbz1Ik2cKRycAfqfg4974XSmwdnUXIQRY2SJ8kHTTMA')
    await expect(deriveBackupKeyV2(root,salt,backupId).then(base64Url)).resolves.toBe('jlJVKyusA5k_-V9_iyED41GWWJtOUXeAib5jpDN2ZJ0')
    await expect(deriveRecoveryKeyV2(urs,recoverySalt).then(base64Url)).resolves.toBe('1MqWxcxbxZ0wLaI1_BwqIWzYfjTk1negA9Mu7-3KBkQ')
    await expect(deriveRecoveryTakeoverStagingKeyV2(urs,stagingSalt).then(base64Url)).resolves.toBe('iUUfiRXRSAb92qfWB0HiyUnR2kFKFZ0Cs8HCz_tWtj4')
    await expect(deriveActivationLineageCacheKeyV2(root,salt).then(base64Url)).resolves.toBe('mRGU5jw6jG8c4v1Mc_O1x_hD6J7uyGHm96sSrNBOmyc')
  })

  it('matches the frozen TransferDescriptorV2 PoP input',async()=>{
    const writerPublic=bytes(0,32),writerKeyId=await writerKeyIdV2(writerPublic)
    const descriptor={
      format:'eds-writer-transfer-v2' as const,
      version:2 as const,
      sync_profile:SINGLE_WRITER_V2_PROFILE,
      diary_id:'AAECAwQFBgcICQoLDA0ODw',
      epoch_id:'EBESExQVFhcYGRobHB0eHw',
      writer_device_id:'ICEiIyQlJicoKSorLC0uLw',
      writer_key_id:writerKeyId,
      writer_public_key:base64Url(writerPublic),
      nonce:'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',
    }
    const input=transferDescriptorPopBytesV2(descriptor)
    expect(base64Url(input)).toBe('ZWRzLWRpYXJ5L3RyYW5zZmVyLWRlc2NyaXB0b3ItcG9wL3YyAHsiZGlhcnlfaWQiOiJBQUVDQXdRRkJnY0lDUW9MREEwT0R3IiwiZXBvY2hfaWQiOiJFQkVTRXhRVkZoY1lHUm9iSEIwZUh3IiwiZm9ybWF0IjoiZWRzLXdyaXRlci10cmFuc2Zlci12MiIsIm5vbmNlIjoiUUVGQ1EwUkZSa2RJU1VwTFRFMU9UMUJSVWxOVVZWWlhXRmxhVzF4ZFhsOCIsInN5bmNfcHJvZmlsZSI6Imdvb2dsZS1zaGVldHMtdHJhbnNmZXJhYmxlLXNpbmdsZS13cml0ZXItdjIiLCJ2ZXJzaW9uIjoyLCJ3cml0ZXJfZGV2aWNlX2lkIjoiSUNFaUl5UWxKaWNvS1NvckxDMHVMdyIsIndyaXRlcl9rZXlfaWQiOiJycy1tUmMxWTJBaW1PaEdOdXFsRXBkZXcxTEh3RlpVTW5melluUDRycUw0Iiwid3JpdGVyX3B1YmxpY19rZXkiOiJBQUVDQXdRRkJnY0lDUW9MREEwT0R4QVJFaE1VRlJZWEdCa2FHeHdkSGg4In0')
    await expect(sha256(input).then(base64Url)).resolves.toBe('ZSQqmynmEjlPdgiw9DwX_vIptLoUOvPZAgZiQmkb_bo')
  })

  it('generates a non-extractable writer private key and verifies descriptor possession',async()=>{
    const key=await generateWriterDeviceKeyV2()
    expect(key.privateKey.extractable).toBe(false)
    expect(key.privateKey.usages).toEqual(['sign'])
    const core={
      format:'eds-writer-transfer-v2' as const,
      version:2 as const,
      sync_profile:SINGLE_WRITER_V2_PROFILE,
      diary_id:'AAECAwQFBgcICQoLDA0ODw',
      epoch_id:'EBESExQVFhcYGRobHB0eHw',
      writer_device_id:'ICEiIyQlJicoKSorLC0uLw',
      writer_key_id:key.writerKeyId,
      writer_public_key:base64Url(key.publicKeyRaw),
      nonce:'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',
    }
    const signature=await signEd25519V2(key.privateKey,transferDescriptorPopBytesV2(core)),descriptor:TransferDescriptorV2={...core,possession_signature:signature}
    await expect(verifyEd25519V2(key.publicKeyRaw,signature,transferDescriptorPopBytesV2(core))).resolves.toBe(true)
    await expect(verifyTransferDescriptorV2(descriptor)).resolves.toEqual(descriptor)
  })

  it('rejects non-canonical IDs and anchors outside the frozen profile',()=>{
    expect(()=>validateRemoteAnchorV2({anchor_profile:SINGLE_WRITER_V2_PROFILE,covered_row_count:0,prefix_hash:base64Url(bytes(0,32))})).not.toThrow()
    expect(()=>validateRemoteAnchorV2({anchor_profile:'google-sheets-single-writer-v1',covered_row_count:0,prefix_hash:base64Url(bytes(0,32))})).toThrow(/anchor_profile/)
    expect(()=>fromBase64Url('AA=')).toThrow(/Base64URL/)
    const bad={format:'eds-writer-transfer-v2',version:2,sync_profile:SINGLE_WRITER_V2_PROFILE,diary_id:'AA',epoch_id:'AA',writer_device_id:'AA',writer_key_id:'AA',writer_public_key:'AA',nonce:'AA',possession_signature:'AA'}
    expect(()=>validateTransferDescriptorV2(bad)).toThrow()
  })
})
