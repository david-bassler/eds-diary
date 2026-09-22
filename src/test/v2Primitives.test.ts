import { describe, expect, it } from 'vitest'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import { arrayBuffer, base64Url, concatBytes, fromBase64Url, utf8 } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { aesGcmEncrypt, hkdfSha256, sha256 } from '../security/crypto/core'
import {
  deriveActivationLineageCacheKeyV2,
  envelopeAadV2,
  deriveBackupKeyV2,
  deriveEnvelopeKeyV2,
  deriveEpochSaltV2,
  deriveLocalStateMacKeyV2,
  deriveManifestKeyV2,
  deriveRecoveryKeyV2,
  deriveRecoveryTakeoverStagingKeyV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  importRecoveryTakeoverSigningKeyV2,
  recoveryCommitmentV2,
  recoveryTakeoverKeyCheckBytesV2,
  recoveryTakeoverKeyIdV2,
  recoveryUrsIdV2,
  revisionSigningBytesV2,
  signEd25519V2,
  transferDescriptorPopBytesV2,
  verifyEd25519V2,
  verifyRecoveryTakeoverKeyPairV2,
  writerGrantSigningBytesV2,
  writerKeyIdV2,
} from '../security/v2/crypto'
import { schemaRegistryEntriesV2, schemaRegistryHashV2, V2_SCHEMA_REGISTRY } from '../security/v2/schemaRegistry'
import { SINGLE_WRITER_V2_SCHEMA_ALLOWLIST, type RevisionV2, type TransferDescriptorV2, type WriterGrantV2 } from '../security/v2/types'
import {
  validateEpochMigrationV2,
  validateRecoveryAuthorityTransitionV2,
  validateRotationAnnouncementV2,
  validateRevisionGraphV2,
  validateRevisionV2,
  validateTransferDescriptorV2,
  validateWriterGrantV2,
  verifyTransferDescriptorV2,
} from '../security/v2/validators'

const b=(fill:number,length:number)=>base64Url(new Uint8Array(length).fill(fill))
const anchor=(rows=0)=>({anchor_profile:SINGLE_WRITER_V2_PROFILE,covered_row_count:rows,prefix_hash:b(90+rows,32)} as const)
const zero=new Uint8Array([0])

describe('transferable single-writer v2 primitives',()=>{
  it('matches independent frozen golden vectors for IDs, KDFs and transfer PoP',async()=>{
    const bytes=(start:number,length:number)=>Uint8Array.from({length},(_,index)=>(start+index)&0xff),diary=bytes(0,16),epoch=bytes(16,16),writerPublic=bytes(0,32),urs=bytes(96,32),root=bytes(128,32),envelopeId=bytes(160,32),backupId=bytes(192,32),recoverySalt=bytes(224,32),stagingSalt=bytes(0,32)
    await expect(writerKeyIdV2(writerPublic)).resolves.toBe('rs-mRc1Y2AimOhGNuqlEpdew1LHwFZUMnfzYnP4rqL4')
    await expect(recoveryTakeoverKeyIdV2(writerPublic)).resolves.toBe('Ee6bA___q8Bdx7TjpDUQrl-Sky7_Dm0MDFJiva7YfOs')
    await expect(recoveryUrsIdV2(urs)).resolves.toBe('qLjDR1ig9ZkcyOHIAofhvyDGkmcIp0InxJDJ7ZkAgwY')
    const salt=await deriveEpochSaltV2(diary,epoch)
    expect(base64Url(salt)).toBe('9pb0gDq3Z9WWfZg7NyYFnEj6o6BMoVluFiY39gPG-Lk')
    await expect(deriveEnvelopeKeyV2(root,salt,envelopeId).then(base64Url)).resolves.toBe('A3SSM7F6RYtlwQsMM6XWePkPelmfMJtb8V9yUwcshd8')
    await expect(deriveManifestKeyV2(root,salt).then(base64Url)).resolves.toBe('j9433BmNz_-dziJCTeImnNi5xr8HBRObwwPOL0oR8ew')
    await expect(deriveLocalStateMacKeyV2(root,salt).then(base64Url)).resolves.toBe('Kbz1Ik2cKRycAfqfg4974XSmwdnUXIQRY2SJ8kHTTMA')
    await expect(deriveBackupKeyV2(root,salt,backupId).then(base64Url)).resolves.toBe('jlJVKyusA5k_-V9_iyED41GWWJtOUXeAib5jpDN2ZJ0')
    await expect(deriveRecoveryKeyV2(urs,recoverySalt).then(base64Url)).resolves.toBe('1MqWxcxbxZ0wLaI1_BwqIWzYfjTk1negA9Mu7-3KBkQ')
    await expect(deriveRecoveryTakeoverStagingKeyV2(urs,stagingSalt).then(base64Url)).resolves.toBe('iUUfiRXRSAb92qfWB0HiyUnR2kFKFZ0Cs8HCz_tWtj4')
    await expect(deriveActivationLineageCacheKeyV2(root,salt).then(base64Url)).resolves.toBe('mRGU5jw6jG8c4v1Mc_O1x_hD6J7uyGHm96sSrNBOmyc')
    const aad=envelopeAadV2('AAECAwQFBgcICQoLDA0ODw','EBESExQVFhcYGRobHB0eHw','oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8',1024)
    await expect(sha256(aad).then(base64Url)).resolves.toBe('POPVkTVrs33QOtHgijoo4BMflZ8PYMMjIQkuBPIsHe4')
    const payload=canonicalBytes({vector:'envelope-v6'}),frame=new Uint8Array(1024);new DataView(frame.buffer).setUint32(0,payload.byteLength);frame.set(payload,4)
    const encrypted=await aesGcmEncrypt(await deriveEnvelopeKeyV2(root,salt,envelopeId),frame,aad,bytes(240,12))
    expect(base64Url(encrypted.iv)).toBe('8PHy8_T19vf4-fr7')
    expect(base64Url(encrypted.ciphertext)).toBe('739rFf41rtP2xnXpYvVLesBeKZjreJzbpgrWx2NOryR4qmRYOQ2XUqHCsNwvWw0Qec_ELCtWfMaEX7yINS8QNJxdFcqnxXJt6HyrIrUYBz164LbIcsZtBv0BTMYGV7FaumAmwqCVZ5y_PxWCrDwjaJ7X4NKJ-Ca7UO5DCuErObWi7Y2k1fOL2Y0Ysd79DF9zRKCuORl7TtC1DoFZsGgGiiPiLDBaHulSP0i0_G6ZWkiKJqD2dzBJ4JVHjPTgkUyFQvcKLn7YpStyQBgZ634toVOLIzHmTc7c0s9DIpFTyBmBBQ6eOiIqkAOMrxoCiygG7jwR8fTqLWY0sqTJzAELKgjG0TrtPSgSIZmsyQIeGBuJe91HKZolWyg7tn5JNOxzLAq8WszZwj0m-bwDZUC3w0VstwAouF0cSVhIJgsn53ZstZJdpnPGYCSZYnMV2voba-Bss48OH0ZnexQ9m3sD85bfOu-AdDuLGtmG6BIaAPm55CJhvN0NeVDM1tDk5SwxX9szySZFnzfwmTByHMwTBd7p0bG5uHdCLtbNyPsni0R9zplKFcYsKB27VkOt8K2EojOZAkFUQxZYMr4dB2omlwUJnDUgZH_OeQ3KRkmO1rq9HBzkq0MWW9-R7R_De6otRn2SgCnmYHaxpBMyXsonATrQTWciumcLJwylz-AgDm11tvg4w1y-yyvlDeycwqUMyDK_yMPsjN8T6gIRqSrQtGr2eVG366Onv6FSEfIkQFUcleaMhVhXc5kyH_JvyGmXpFEvGVjV37S-HK_jl4eEg83tXwGhBafOrPnwma2qUDMsjbqRdQpHW1Wi9_Tu5ogdMUcVbBK2tOI9oefQa1jyexuq9fWZA8m0VYavC8r-DrmNe9PmZMbzPDsisbo0VqAKfHtxPtnbwvyUorz1r3pApPsCyhYPD7Cg6vM0GZI-MDpklvBmLNFFECheXMUlIS4HwBWLG8zfISMc5mcJsdR0FLfnE1XpE_kb88PHtjJLjstt0kkKzYrLKXN-6uSSgm4Yks8YId1Fj_Stdoc_TAGWm_C2RmL3t13wv0hor7qCKIpISulu5ydJmfWEFTyNWrbW1sphKSbLGupAePBLtinAEu-q0rREAp9SxzzA2JS9N33MUe2X590jc6IWi_U-lyl-W9rlvb77RzeANbD0rjCTPAiotmQGickypFv6oUoFj0h8TvbhjkhI6DOo4CQVv3IofzvfZ7ZzlUbu3dbOLwHRvyuGQoYkSAYGspH9pSf0hHyV2lD3OfAYdcJPoymmj5Dwb5bxqqIH54pSNxD1Xv3PiM6Zzm2sGPm2GntpLHhHF0VE_lMqv7f478HJCbD3ZCFnCVXRMfGxLsPObaXSfzyXZP6uUqkYUYFqVDrcUHliqKY')
    const fixedPkcs8=fromBase64Url('MC4CAQAwBQYDK2VwBCIEIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f'),fixedPrivate=await crypto.subtle.importKey('pkcs8',arrayBuffer(fixedPkcs8),{name:'Ed25519'},false,['sign'])
    const core:Omit<TransferDescriptorV2,'possession_signature'>={format:'eds-writer-transfer-v2',version:2,sync_profile:SINGLE_WRITER_V2_PROFILE,diary_id:'AAECAwQFBgcICQoLDA0ODw',epoch_id:'EBESExQVFhcYGRobHB0eHw',writer_device_id:'ICEiIyQlJicoKSorLC0uLw',writer_key_id:'IbAKQrU5ajH8cDsoIIq-VC3HCRlutysVDzNhL_Ax0Io',writer_public_key:'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg',nonce:'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8'}
    const pop=transferDescriptorPopBytesV2(core)
    await expect(sha256(pop).then(base64Url)).resolves.toBe('VpmWddwxf3KnIhbBVZ__1qNiLCim23OpZVXBwfnItmg')
    await expect(signEd25519V2(fixedPrivate,pop)).resolves.toBe('SeNfFM6EBX3-cJo-38OM9yBRXjJ9nCTMM7ZiQqXqqDGFpObYz7CV4mJXoaESRM-kjZYIGr7AvbBYusOXQ1XsCA')
    const revision:RevisionV2={record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(3,16),revision_id:b(4,32),parent_revision_ids:[],record_status:'active',record_data:{note:'hello'},migration_origin:null,protocol_created_at:'2026-09-22T12:00:00.000Z',writer_context:{writer_generation:1,writer_grant_id:b(5,32),writer_device_id:b(6,16),writer_key_id:core.writer_key_id},writer_signature:null}
    const revisionInput=revisionSigningBytesV2(b(1,16),b(2,16),revision)
    await expect(sha256(revisionInput).then(base64Url)).resolves.toBe('MpF2RREShzgcSNcoY1qvxEihM8rtWhlVyb013sCfak0')
    await expect(signEd25519V2(fixedPrivate,revisionInput)).resolves.toBe('0ffDcehUIBpVUyaWs1-Zzix59EjwHRob_uWPcxtVrbk_QkxJYayb3InrRbPt_ZEn7t8XluI1XUYgv9tRayvzBA')
  })

  it('freezes the exact v2 schema allowlist and reproducible registry',async()=>{
    expect(SINGLE_WRITER_V2_SCHEMA_ALLOWLIST).toEqual(['activity-entry/v1','activity-type-settings/v1','epoch-migration-sw-v2','medication-entry/v1','medication-prescription/v1','pain-entry/v1','pain-type-settings/v1','recovery-authority-transition-sw-v2','rotation-announcement-sw-v2','successor-activation-confirmation-sw-v2','writer-grant-sw-v2'])
    expect(Object.keys(V2_SCHEMA_REGISTRY).sort()).toEqual([...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST].sort())
    const entries=await schemaRegistryEntriesV2()
    expect(entries.map(({record_schema})=>record_schema)).toEqual([...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST].sort())
    expect(entries.every(({schema_sha256})=>/^[A-Za-z0-9_-]{43}$/.test(schema_sha256))).toBe(true)
    expect(await schemaRegistryHashV2()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('derives v2 identifiers and recovery commitment with the frozen domains',async()=>{
    const publicKey=new Uint8Array(32).fill(7),urs=new Uint8Array(32).fill(8),diary=new Uint8Array(16).fill(9),epoch=new Uint8Array(16).fill(10)
    const digest=async(label:string,value:Uint8Array)=>base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',arrayBuffer(concatBytes(utf8(label),zero,value)))))
    await expect(writerKeyIdV2(publicKey)).resolves.toBe(await digest('eds-diary/writer-key-id/v2',publicKey))
    await expect(recoveryTakeoverKeyIdV2(publicKey)).resolves.toBe(await digest('eds-diary/recovery-takeover-key-id/v2',publicKey))
    await expect(recoveryUrsIdV2(urs)).resolves.toBe(await digest('eds-diary/recovery-urs-id/v2',urs))
    await expect(deriveEpochSaltV2(diary,epoch)).resolves.toEqual(await sha256(concatBytes(utf8('eds-diary/hkdf-salt/v6'),zero,diary,epoch)))
    expect(await recoveryCommitmentV2(urs,diary,3)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('matches every frozen v2 KDF domain without reusing v5 labels',async()=>{
    const root=new Uint8Array(32).fill(1),urs=new Uint8Array(32).fill(2),diary=new Uint8Array(16).fill(3),epoch=new Uint8Array(16).fill(4),envelopeId=new Uint8Array(32).fill(5),backupId=new Uint8Array(32).fill(6),recoverySalt=new Uint8Array(32).fill(7),stagingSalt=new Uint8Array(32).fill(8),salt=await deriveEpochSaltV2(diary,epoch)
    await expect(deriveEnvelopeKeyV2(root,salt,envelopeId)).resolves.toEqual(await hkdfSha256(root,salt,concatBytes(utf8('eds-diary/envelope-key/v6'),zero,envelopeId)))
    await expect(deriveManifestKeyV2(root,salt)).resolves.toEqual(await hkdfSha256(root,salt,utf8('eds-diary/epoch-manifest/v6')))
    await expect(deriveLocalStateMacKeyV2(root,salt)).resolves.toEqual(await hkdfSha256(root,salt,utf8('eds-diary/local-state-mac/v6')))
    await expect(deriveBackupKeyV2(root,salt,backupId)).resolves.toEqual(await hkdfSha256(root,salt,concatBytes(utf8('eds-diary/backup-manifest/v6'),zero,backupId)))
    await expect(deriveRecoveryKeyV2(urs,recoverySalt)).resolves.toEqual(await hkdfSha256(urs,recoverySalt,utf8('eds-diary/recovery-wrap/v6')))
    await expect(deriveRecoveryTakeoverStagingKeyV2(urs,stagingSalt)).resolves.toEqual(await hkdfSha256(urs,stagingSalt,utf8('eds-diary/recovery-takeover-staging/v2')))
    await expect(deriveActivationLineageCacheKeyV2(root,salt)).resolves.toEqual(await hkdfSha256(root,salt,utf8('eds-diary/activation-lineage-cache/v2')))
    expect(base64Url(await deriveManifestKeyV2(root,salt))).not.toBe(base64Url(await hkdfSha256(root,salt,utf8('eds-diary/epoch-manifest/v5'))))
  })

  it('generates a non-extractable writer signing key and verifies Ed25519 signatures',async()=>{
    const generated=await generateWriterDeviceKeyV2()
    expect(generated.privateKey.extractable).toBe(false)
    expect(generated.privateKey.type).toBe('private')
    expect(generated.publicKeyRaw).toHaveLength(32)
    expect(generated.writerKeyId).toBe(await writerKeyIdV2(generated.publicKeyRaw))
    await expect(crypto.subtle.exportKey('pkcs8',generated.privateKey)).rejects.toBeTruthy()
    const message=utf8('v2 writer signature test'),signature=await signEd25519V2(generated.privateKey,message)
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/)
    await expect(verifyEd25519V2(generated.publicKeyRaw,signature,message)).resolves.toBe(true)
    await expect(verifyEd25519V2(generated.publicKeyRaw,signature,utf8('tampered'))).resolves.toBe(false)
  })

  it('exports recovery-takeover PKCS8 only from the explicit transient generator',async()=>{
    const generated=await generateRecoveryTakeoverKeyMaterialV2()
    expect(generated.publicKeyRaw).toHaveLength(32)
    expect(generated.privateKeyPkcs8.byteLength).toBeGreaterThan(32)
    expect(generated.recoveryTakeoverKeyId).toBe(await recoveryTakeoverKeyIdV2(generated.publicKeyRaw))
    const imported=await importRecoveryTakeoverSigningKeyV2(generated.privateKeyPkcs8)
    expect(imported.extractable).toBe(false)
    const diary=b(7,16),epoch=b(8,16),input=recoveryTakeoverKeyCheckBytesV2(diary,epoch,4,generated.publicKeyRaw)
    expect(input).toEqual(concatBytes(utf8('eds-diary/recovery-takeover-key-check/v2'),zero,new Uint8Array(16).fill(7),new Uint8Array(16).fill(8),new Uint8Array([0,0,0,0,0,0,0,4]),generated.publicKeyRaw))
    await expect(verifyRecoveryTakeoverKeyPairV2(imported,generated.publicKeyRaw,diary,epoch,4)).resolves.toBe(true)
    const other=await generateRecoveryTakeoverKeyMaterialV2()
    await expect(verifyRecoveryTakeoverKeyPairV2(imported,other.publicKeyRaw,diary,epoch,4)).resolves.toBe(false)
  })

  it('builds and validates an exact writer-signed RevisionV2',async()=>{
    const writer=await generateWriterDeviceKeyV2(),diary=b(1,16),epoch=b(2,16)
    const unsigned:RevisionV2<{note:string}>={
      record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(3,16),revision_id:b(4,32),
      parent_revision_ids:[],record_status:'active',record_data:{note:'hello'},migration_origin:null,
      protocol_created_at:'2026-09-22T12:00:00.000Z',
      writer_context:{writer_generation:1,writer_grant_id:b(5,32),writer_device_id:b(6,16),writer_key_id:writer.writerKeyId},
      writer_signature:b(0,64),
    }
    const signingBytes=revisionSigningBytesV2(diary,epoch,unsigned)
    const expectedCore={sync_profile:SINGLE_WRITER_V2_PROFILE,diary_id:diary,epoch_id:epoch,record_type:unsigned.record_type,record_schema:unsigned.record_schema,record_id:unsigned.record_id,revision_id:unsigned.revision_id,parent_revision_ids:[],record_status:'active',record_data:{note:'hello'},migration_origin:null,protocol_created_at:unsigned.protocol_created_at,writer_context:unsigned.writer_context}
    expect(signingBytes).toEqual(concatBytes(utf8('eds-diary/revision-signature/v2'),zero,canonicalBytes(expectedCore as never)))
    const revision={...unsigned,writer_signature:await signEd25519V2(writer.privateKey,signingBytes)}
    await expect(validateRevisionV2(revision)).resolves.toBeUndefined()
    await expect(verifyEd25519V2(writer.publicKeyRaw,revision.writer_signature,revisionSigningBytesV2(diary,epoch,revision))).resolves.toBe(true)
    await expect(validateRevisionV2({...revision,unexpected:true} as unknown as RevisionV2)).rejects.toThrow(/unknown or missing/)
    await expect(validateRevisionV2({...revision,writer_context:null})).rejects.toThrow(/writer_context/)
  })

  it('rejects structurally impossible v2 rotation/signing inputs before verifier state',async()=>{
    const epoch=b(60,16),rotation={rotation_id:b(61,32),from_epoch_id:epoch,successor_epoch_id:epoch,successor_creation_locator:b(62,16),successor_manifest_fingerprint:b(63,32),rotation_kind:'normal' as const,source_writer_generation:1,source_writer_grant_id:b(64,32),successor_recovery_generation:0,source_anchor_before_announcement:anchor(1),successor_staging_anchor:anchor(2),recovery_transition_id:null}
    expect(()=>validateRotationAnnouncementV2(rotation)).toThrow(/differ from source/)
    const writer=await generateWriterDeviceKeyV2(),grant:WriterGrantV2={grant_id:b(65,32),writer_generation:1,writer_device_id:b(66,16),writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),previous_grant_id:null,previous_writer_generation:0,recovery_generation:0,reason:'initial',authority_anchor:anchor(),authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null}}
    const revision:RevisionV2<WriterGrantV2>={record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:b(67,16),revision_id:b(68,32),parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:'2026-09-22T12:15:00.000Z',writer_context:null,writer_signature:null}
    expect(()=>revisionSigningBytesV2(b(1,16),b(2,16),revision)).toThrow(/grant authorization/)
    expect(()=>envelopeAadV2(b(1,16),b(2,16),b(3,32),999 as 1024)).toThrow(/padding bucket/)
    const rotationData={...rotation,successor_epoch_id:b(69,16)}
    const rotationRevision:RevisionV2<typeof rotationData>={record_type:'rotation_announcement',record_schema:'rotation-announcement-sw-v2',record_id:b(70,16),revision_id:b(71,32),parent_revision_ids:[],record_status:'control',record_data:rotationData,migration_origin:null,protocol_created_at:'2026-09-22T12:16:00.000Z',writer_context:{writer_generation:2,writer_grant_id:b(72,32),writer_device_id:b(73,16),writer_key_id:b(74,32)},writer_signature:b(75,64)}
    await expect(validateRevisionV2(rotationRevision)).rejects.toThrow(/must match writer_context/)
  })

  it('validates genesis WriterGrantV2 and its exact signing core',async()=>{
    const writer=await generateWriterDeviceKeyV2(),diary=b(10,16),epoch=b(11,16)
    const grant:WriterGrantV2={
      grant_id:b(12,32),writer_generation:1,writer_device_id:b(13,16),writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),
      previous_grant_id:null,previous_writer_generation:0,recovery_generation:0,reason:'initial',authority_anchor:anchor(),
      authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null},
    }
    await expect(validateWriterGrantV2(grant)).resolves.toEqual(grant)
    const core={grant_id:grant.grant_id,writer_generation:grant.writer_generation,writer_device_id:grant.writer_device_id,writer_key_id:grant.writer_key_id,writer_public_key:grant.writer_public_key,previous_grant_id:grant.previous_grant_id,previous_writer_generation:grant.previous_writer_generation,recovery_generation:grant.recovery_generation,reason:grant.reason,authority_anchor:grant.authority_anchor}
    expect(writerGrantSigningBytesV2(diary,epoch,grant)).toEqual(concatBytes(utf8('eds-diary/writer-grant/v2'),zero,new Uint8Array(16).fill(10),new Uint8Array(16).fill(11),zero,canonicalBytes(core as never)))
    await expect(validateWriterGrantV2({...grant,writer_key_id:b(14,32)})).rejects.toThrow(/does not match/)
    await expect(validateWriterGrantV2({...grant,authority_anchor:anchor(1)})).rejects.toThrow(/Initial WriterGrantV2/)
    await expect(validateWriterGrantV2({...grant,reason:'handoff'})).rejects.toThrow(/WriterGrantV2 .*invariants/)
  })

  it('validates TransferDescriptorV2 structure and proof-of-possession bytes',async()=>{
    const writer=await generateWriterDeviceKeyV2()
    const core:Omit<TransferDescriptorV2,'possession_signature'>={format:'eds-writer-transfer-v2',version:2,sync_profile:SINGLE_WRITER_V2_PROFILE,diary_id:b(20,16),epoch_id:b(21,16),writer_device_id:b(22,16),writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),nonce:b(23,32)}
    const signature=await signEd25519V2(writer.privateKey,transferDescriptorPopBytesV2(core)),descriptor={...core,possession_signature:signature}
    expect(validateTransferDescriptorV2(descriptor)).toEqual(descriptor)
    await expect(verifyTransferDescriptorV2(descriptor)).resolves.toEqual(descriptor)
    await expect(verifyEd25519V2(writer.publicKeyRaw,signature,transferDescriptorPopBytesV2(core))).resolves.toBe(true)
    await expect(verifyTransferDescriptorV2({...descriptor,writer_key_id:b(24,32)})).rejects.toThrow(/does not match/)
    const tampered={...descriptor,nonce:b(25,32)}
    await expect(verifyTransferDescriptorV2(tampered)).rejects.toThrow(/possession signature/)
    expect(()=>validateTransferDescriptorV2({...descriptor,nonce:b(1,16)})).toThrow(/nonce/)
  })

  it('rejects a migration whose copied semantic snapshot changes',()=>{
    const hash=b(29,32),migration={migration_id:b(26,32),migration_kind:'profile_upgrade' as const,source:{source_epoch_id:b(27,16),source_manifest_fingerprint:b(28,32),source_anchor:{anchor_profile:'google-sheets-single-writer-v1',covered_row_count:4,prefix_hash:b(30,32)},source_lineage_snapshot_hash:b(31,32),source_semantic_snapshot_hash:hash},result_semantic_snapshot_hash:hash,active_head_count:2,tombstone_head_count:1,source_writer_authority:null,source_recovery_transition_id:null}
    expect(validateEpochMigrationV2(migration)).toEqual(migration)
    expect(()=>validateEpochMigrationV2({...migration,result_semantic_snapshot_hash:b(32,32)})).toThrow(/changed the semantic snapshot/)
  })

  it('validates RecoveryAuthorityTransitionV2 key IDs and generation step',async()=>{
    const takeover=await generateRecoveryTakeoverKeyMaterialV2()
    const transition={transition_id:b(30,32),transition_kind:'recovery_rekey' as const,from_recovery_generation:4,from_recovery_urs_id:b(31,32),from_recovery_takeover_key_id:b(32,32),to_recovery_generation:5,to_recovery_urs_commitment:b(33,32),to_recovery_urs_id:b(34,32),to_recovery_takeover_key_id:takeover.recoveryTakeoverKeyId,to_recovery_takeover_public_key:base64Url(takeover.publicKeyRaw),authority_anchor:anchor(7)}
    await expect(validateRecoveryAuthorityTransitionV2(transition)).resolves.toEqual(transition)
    await expect(validateRecoveryAuthorityTransitionV2({...transition,to_recovery_generation:6})).rejects.toThrow(/exactly by one/)
    await expect(validateRecoveryAuthorityTransitionV2({...transition,to_recovery_urs_id:transition.from_recovery_urs_id})).rejects.toThrow(/fresh URS/)
    await expect(validateRecoveryAuthorityTransitionV2({...transition,to_recovery_takeover_key_id:transition.from_recovery_takeover_key_id,to_recovery_takeover_public_key:b(32,32)})).rejects.toThrow(/fresh URS and takeover/)
  })

  it('keeps WriterGrantV2 wrapper unsigned while other v2 revisions require writer signatures',async()=>{
    const writer=await generateWriterDeviceKeyV2(),grant:WriterGrantV2={grant_id:b(40,32),writer_generation:1,writer_device_id:b(41,16),writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),previous_grant_id:null,previous_writer_generation:0,recovery_generation:0,reason:'initial',authority_anchor:anchor(),authorization:{kind:'manifest_genesis',signer_key_id:null,signature:null}}
    const revision:RevisionV2<WriterGrantV2>={record_type:'writer_grant',record_schema:'writer-grant-sw-v2',record_id:b(42,16),revision_id:b(43,32),parent_revision_ids:[],record_status:'control',record_data:grant,migration_origin:null,protocol_created_at:'2026-09-22T12:30:00.000Z',writer_context:null,writer_signature:null}
    await expect(validateRevisionV2(revision)).resolves.toBeUndefined()
    await expect(validateRevisionV2({...revision,writer_signature:b(44,64)})).rejects.toThrow(/must not carry/)
  })

  it('preserves parent-before-child graph rules for RevisionV2',async()=>{
    const writer=await generateWriterDeviceKeyV2(),context={writer_generation:1,writer_grant_id:b(50,32),writer_device_id:b(51,16),writer_key_id:writer.writerKeyId}
    const make=(revisionId:string,parents:string[]):RevisionV2=>({record_type:'pain_entry',record_schema:'pain-entry/v1',record_id:b(52,16),revision_id:revisionId,parent_revision_ids:parents,record_status:'active',record_data:{value:1},migration_origin:null,protocol_created_at:'2026-09-22T13:00:00.000Z',writer_context:context,writer_signature:b(53,64)})
    const parent=make(b(54,32),[]),child=make(b(55,32),[parent.revision_id])
    await expect(validateRevisionGraphV2([parent,child])).resolves.toMatchObject({revisions:expect.any(Map),headsByRecord:expect.any(Map)})
    await expect(validateRevisionGraphV2([child,parent])).rejects.toThrow(/physically precede/)
  })
})
