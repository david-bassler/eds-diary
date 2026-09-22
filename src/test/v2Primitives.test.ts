import { describe, expect, it } from 'vitest'
import { SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'
import { arrayBuffer, base64Url, concatBytes, utf8 } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { sha256 } from '../security/crypto/core'
import {
  deriveEpochSaltV2,
  generateRecoveryTakeoverKeyMaterialV2,
  generateWriterDeviceKeyV2,
  recoveryCommitmentV2,
  recoveryTakeoverKeyIdV2,
  recoveryUrsIdV2,
  revisionSigningBytesV2,
  signEd25519V2,
  transferDescriptorPopBytesV2,
  verifyEd25519V2,
  writerGrantSigningBytesV2,
  writerKeyIdV2,
} from '../security/v2/crypto'
import type { RevisionV2, TransferDescriptorV2, WriterGrantV2 } from '../security/v2/types'
import {
  validateRecoveryAuthorityTransitionV2,
  validateRevisionGraphV2,
  validateRevisionV2,
  validateTransferDescriptorV2,
  validateWriterGrantV2,
} from '../security/v2/validators'

const b=(fill:number,length:number)=>base64Url(new Uint8Array(length).fill(fill))
const anchor=(rows=0)=>({anchor_profile:SINGLE_WRITER_V2_PROFILE,covered_row_count:rows,prefix_hash:b(90+rows,32)} as const)
const zero=new Uint8Array([0])

describe('transferable single-writer v2 primitives',()=>{
  it('derives v2 identifiers and recovery commitment with the frozen domains',async()=>{
    const publicKey=new Uint8Array(32).fill(7),urs=new Uint8Array(32).fill(8),diary=new Uint8Array(16).fill(9),epoch=new Uint8Array(16).fill(10)
    const digest=async(label:string,value:Uint8Array)=>base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',arrayBuffer(concatBytes(utf8(label),zero,value)))))
    await expect(writerKeyIdV2(publicKey)).resolves.toBe(await digest('eds-diary/writer-key-id/v2',publicKey))
    await expect(recoveryTakeoverKeyIdV2(publicKey)).resolves.toBe(await digest('eds-diary/recovery-takeover-key-id/v2',publicKey))
    await expect(recoveryUrsIdV2(urs)).resolves.toBe(await digest('eds-diary/recovery-urs-id/v2',urs))
    await expect(deriveEpochSaltV2(diary,epoch)).resolves.toEqual(await sha256(concatBytes(utf8('eds-diary/hkdf-salt/v6'),zero,diary,epoch)))
    expect(await recoveryCommitmentV2(urs,diary,3)).toMatch(/^[A-Za-z0-9_-]{43}$/)
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
    await expect(validateWriterGrantV2({...grant,reason:'handoff'})).rejects.toThrow(/Initial WriterGrantV2/)
  })

  it('validates TransferDescriptorV2 structure and proof-of-possession bytes',async()=>{
    const writer=await generateWriterDeviceKeyV2()
    const core:Omit<TransferDescriptorV2,'possession_signature'>={format:'eds-writer-transfer-v2',version:2,sync_profile:SINGLE_WRITER_V2_PROFILE,diary_id:b(20,16),epoch_id:b(21,16),writer_device_id:b(22,16),writer_key_id:writer.writerKeyId,writer_public_key:base64Url(writer.publicKeyRaw),nonce:b(23,32)}
    const signature=await signEd25519V2(writer.privateKey,transferDescriptorPopBytesV2(core)),descriptor={...core,possession_signature:signature}
    expect(validateTransferDescriptorV2(descriptor)).toEqual(descriptor)
    await expect(verifyEd25519V2(writer.publicKeyRaw,signature,transferDescriptorPopBytesV2(core))).resolves.toBe(true)
    expect(()=>validateTransferDescriptorV2({...descriptor,nonce:b(1,16)})).toThrow(/nonce/)
  })

  it('validates RecoveryAuthorityTransitionV2 key IDs and generation step',async()=>{
    const takeover=await generateRecoveryTakeoverKeyMaterialV2()
    const transition={transition_id:b(30,32),transition_kind:'recovery_rekey' as const,from_recovery_generation:4,from_recovery_urs_id:b(31,32),from_recovery_takeover_key_id:b(32,32),to_recovery_generation:5,to_recovery_urs_commitment:b(33,32),to_recovery_urs_id:b(34,32),to_recovery_takeover_key_id:takeover.recoveryTakeoverKeyId,to_recovery_takeover_public_key:base64Url(takeover.publicKeyRaw),authority_anchor:anchor(7)}
    await expect(validateRecoveryAuthorityTransitionV2(transition)).resolves.toEqual(transition)
    await expect(validateRecoveryAuthorityTransitionV2({...transition,to_recovery_generation:6})).rejects.toThrow(/exactly by one/)
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
