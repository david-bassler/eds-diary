import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { arrayBuffer, base64Url, concatBytes, fixedBase64Url, uint64be, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { hkdfSha256, hmacSha256, randomBytes, sha256 } from '../crypto/core'
import type { RevisionV2, TransferDescriptorV2, WriterGrantV2 } from './types'

const ZERO = new Uint8Array([0])
const ED25519 = 'Ed25519'

function assert32(value:Uint8Array,label:string):void{if(value.byteLength!==32)throw new Error(`${label} must contain exactly 32 bytes.`)}
function assertEd25519Key(key:CryptoKey,type:'private'|'public',usage:'sign'|'verify'):void{
  if(key.type!==type||key.algorithm.name!==ED25519||!key.usages.includes(usage))throw new Error(`Invalid Ed25519 ${type} key.`)
}

export async function writerKeyIdV2(rawPublicKey:Uint8Array):Promise<string>{
  assert32(rawPublicKey,'Writer public key')
  return base64Url(await sha256(concatBytes(utf8('eds-diary/writer-key-id/v2'),ZERO,rawPublicKey)))
}

export async function recoveryTakeoverKeyIdV2(rawPublicKey:Uint8Array):Promise<string>{
  assert32(rawPublicKey,'Recovery takeover public key')
  return base64Url(await sha256(concatBytes(utf8('eds-diary/recovery-takeover-key-id/v2'),ZERO,rawPublicKey)))
}

export async function recoveryUrsIdV2(urs:Uint8Array):Promise<string>{
  assert32(urs,'URS')
  return base64Url(await sha256(concatBytes(utf8('eds-diary/recovery-urs-id/v2'),ZERO,urs)))
}

export async function recoveryCommitmentV2(urs:Uint8Array,diaryId:Uint8Array,generation:number|bigint):Promise<string>{
  assert32(urs,'URS')
  if(diaryId.byteLength!==16)throw new Error('Diary ID must contain exactly 16 bytes.')
  const value=BigInt(generation)
  if(value<0n||value>9007199254740991n)throw new Error('Recovery generation is outside the safe-integer protocol range.')
  return base64Url(await hmacSha256(urs,concatBytes(utf8('eds-diary/recovery-urs-commitment/v6'),ZERO,diaryId,uint64be(value))))
}

export async function deriveEpochSaltV2(diaryId:Uint8Array,epochId:Uint8Array):Promise<Uint8Array>{
  if(diaryId.byteLength!==16||epochId.byteLength!==16)throw new Error('Diary and epoch IDs require 16 bytes.')
  return sha256(concatBytes(utf8('eds-diary/hkdf-salt/v6'),ZERO,diaryId,epochId))
}

export async function deriveEnvelopeKeyV2(rootKey:Uint8Array,epochSalt:Uint8Array,envelopeId:Uint8Array):Promise<Uint8Array>{
  assert32(rootKey,'Root key');assert32(epochSalt,'Epoch salt');assert32(envelopeId,'Envelope ID')
  return hkdfSha256(rootKey,epochSalt,concatBytes(utf8('eds-diary/envelope-key/v6'),ZERO,envelopeId))
}

export async function deriveManifestKeyV2(rootKey:Uint8Array,epochSalt:Uint8Array):Promise<Uint8Array>{
  assert32(rootKey,'Root key');assert32(epochSalt,'Epoch salt')
  return hkdfSha256(rootKey,epochSalt,utf8('eds-diary/epoch-manifest/v6'))
}

export async function deriveLocalStateMacKeyV2(rootKey:Uint8Array,epochSalt:Uint8Array):Promise<Uint8Array>{
  assert32(rootKey,'Root key');assert32(epochSalt,'Epoch salt')
  return hkdfSha256(rootKey,epochSalt,utf8('eds-diary/local-state-mac/v6'))
}

export async function deriveBackupKeyV2(rootKey:Uint8Array,epochSalt:Uint8Array,backupId:Uint8Array):Promise<Uint8Array>{
  assert32(rootKey,'Root key');assert32(epochSalt,'Epoch salt');assert32(backupId,'Backup ID')
  return hkdfSha256(rootKey,epochSalt,concatBytes(utf8('eds-diary/backup-manifest/v6'),ZERO,backupId))
}

export async function deriveRecoveryKeyV2(urs:Uint8Array,recoverySalt:Uint8Array):Promise<Uint8Array>{
  assert32(urs,'URS');assert32(recoverySalt,'Recovery salt')
  return hkdfSha256(urs,recoverySalt,utf8('eds-diary/recovery-wrap/v6'))
}

export async function deriveRecoveryTakeoverStagingKeyV2(urs:Uint8Array,stagingSalt:Uint8Array):Promise<Uint8Array>{
  assert32(urs,'URS');assert32(stagingSalt,'Recovery staging salt')
  return hkdfSha256(urs,stagingSalt,utf8('eds-diary/recovery-takeover-staging/v2'))
}
export async function deriveActivationLineageCacheKeyV2(rootKey:Uint8Array,epochSalt:Uint8Array):Promise<Uint8Array>{
  assert32(rootKey,'Root key');assert32(epochSalt,'Epoch salt')
  return hkdfSha256(rootKey,epochSalt,utf8('eds-diary/activation-lineage-cache/v2'))
}

export function envelopeAadV2(diaryId:string,epochId:string,envelopeId:string,paddingBucket:1024|2048|4096|8192|16384):Uint8Array{
  fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id');fixedBase64Url(envelopeId,32,'envelope_id')
  if(![1024,2048,4096,8192,16384].includes(paddingBucket))throw new Error('Invalid v2 envelope padding bucket.')
  return canonicalBytes({
    protocol_version:6,
    crypto_suite:'A256GCM-HKDF-SHA256-ED25519-v6',
    sync_profile:SINGLE_WRITER_V2_PROFILE,
    diary_id:diaryId,
    epoch_id:epochId,
    envelope_id:envelopeId,
    padding_bucket:paddingBucket,
  })
}


export interface WriterDeviceKeyV2 {
  privateKey:CryptoKey
  publicKey:CryptoKey
  publicKeyRaw:Uint8Array
  writerKeyId:string
}

export async function generateWriterDeviceKeyV2():Promise<WriterDeviceKeyV2>{
  const pair=await crypto.subtle.generateKey({name:ED25519},false,['sign','verify']) as CryptoKeyPair
  assertEd25519Key(pair.privateKey,'private','sign');assertEd25519Key(pair.publicKey,'public','verify')
  if(pair.privateKey.extractable)throw new Error('Writer private key must be non-extractable.')
  const publicKeyRaw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))
  assert32(publicKeyRaw,'Writer public key')
  return{...pair,publicKeyRaw,writerKeyId:await writerKeyIdV2(publicKeyRaw)}
}

export interface RecoveryTakeoverKeyMaterialV2 {
  publicKeyRaw:Uint8Array
  privateKeyPkcs8:Uint8Array
  recoveryTakeoverKeyId:string
}

export async function generateRecoveryTakeoverKeyMaterialV2():Promise<RecoveryTakeoverKeyMaterialV2>{
  const pair=await crypto.subtle.generateKey({name:ED25519},true,['sign','verify']) as CryptoKeyPair
  assertEd25519Key(pair.privateKey,'private','sign');assertEd25519Key(pair.publicKey,'public','verify')
  const publicKeyRaw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKeyPkcs8=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))
  assert32(publicKeyRaw,'Recovery takeover public key')
  return{publicKeyRaw,privateKeyPkcs8,recoveryTakeoverKeyId:await recoveryTakeoverKeyIdV2(publicKeyRaw)}
}

export async function importRecoveryTakeoverSigningKeyV2(privateKeyPkcs8:Uint8Array):Promise<CryptoKey>{
  if(!privateKeyPkcs8.byteLength)throw new Error('Recovery takeover PKCS#8 is empty.')
  const key=await crypto.subtle.importKey('pkcs8',arrayBuffer(privateKeyPkcs8),{name:ED25519},false,['sign'])
  assertEd25519Key(key,'private','sign')
  if(key.extractable)throw new Error('Imported recovery takeover key must be non-extractable.')
  return key
}
export function recoveryTakeoverKeyCheckBytesV2(diaryId:string,epochId:string,recoveryGeneration:number,rawPublicKey:Uint8Array):Uint8Array{
  const diary=fixedBase64Url(diaryId,16,'diary_id'),epoch=fixedBase64Url(epochId,16,'epoch_id');assert32(rawPublicKey,'Recovery takeover public key')
  if(!Number.isSafeInteger(recoveryGeneration)||recoveryGeneration<0)throw new Error('Recovery generation is outside the safe-integer protocol range.')
  return concatBytes(utf8('eds-diary/recovery-takeover-key-check/v2'),ZERO,diary,epoch,uint64be(recoveryGeneration),rawPublicKey)
}

export async function verifyRecoveryTakeoverKeyPairV2(privateKey:CryptoKey,rawPublicKey:Uint8Array,diaryId:string,epochId:string,recoveryGeneration:number):Promise<boolean>{
  const input=recoveryTakeoverKeyCheckBytesV2(diaryId,epochId,recoveryGeneration,rawPublicKey),signature=await signEd25519V2(privateKey,input)
  return verifyEd25519V2(rawPublicKey,signature,input)
}


export function writerDeviceKeyCheckBytesV2(diaryId:string,epochId:string,writerDeviceId:string,rawPublicKey:Uint8Array):Uint8Array{
  const diary=fixedBase64Url(diaryId,16,'diary_id'),epoch=fixedBase64Url(epochId,16,'epoch_id'),device=fixedBase64Url(writerDeviceId,16,'writer_device_id')
  assert32(rawPublicKey,'Writer public key')
  return concatBytes(utf8('eds-diary/writer-device-key-check/v2'),ZERO,diary,epoch,device,rawPublicKey)
}

export async function verifyWriterDeviceKeyPairV2(privateKey:CryptoKey,rawPublicKey:Uint8Array,diaryId:string,epochId:string,writerDeviceId:string):Promise<boolean>{
  const input=writerDeviceKeyCheckBytesV2(diaryId,epochId,writerDeviceId,rawPublicKey),signature=await signEd25519V2(privateKey,input)
  return verifyEd25519V2(rawPublicKey,signature,input)
}

export async function signEd25519V2(privateKey:CryptoKey,message:Uint8Array):Promise<string>{
  assertEd25519Key(privateKey,'private','sign')
  return base64Url(new Uint8Array(await crypto.subtle.sign(ED25519,privateKey,arrayBuffer(message))))
}

export async function verifyEd25519V2(rawPublicKey:Uint8Array,signature:string,message:Uint8Array):Promise<boolean>{
  assert32(rawPublicKey,'Ed25519 public key')
  const signatureBytes=fixedBase64Url(signature,64,'Ed25519 signature')
  const key=await crypto.subtle.importKey('raw',arrayBuffer(rawPublicKey),{name:ED25519},false,['verify'])
  return crypto.subtle.verify(ED25519,key,arrayBuffer(signatureBytes),arrayBuffer(message))
}

export function revisionSigningBytesV2(diaryId:string,epochId:string,revision:RevisionV2):Uint8Array{
  fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id')
  if(revision.record_schema==='writer-grant-sw-v2')throw new Error('WriterGrantV2 uses grant authorization, not the normal RevisionV2 writer signature.')
  if(!revision.writer_context)throw new Error('Writer-signed revision requires writer_context.')
  const core={
    sync_profile:SINGLE_WRITER_V2_PROFILE,
    diary_id:diaryId,
    epoch_id:epochId,
    record_type:revision.record_type,
    record_schema:revision.record_schema,
    record_id:revision.record_id,
    revision_id:revision.revision_id,
    parent_revision_ids:revision.parent_revision_ids,
    record_status:revision.record_status,
    record_data:revision.record_data,
    migration_origin:revision.migration_origin,
    protocol_created_at:revision.protocol_created_at,
    writer_context:revision.writer_context,
  }
  return concatBytes(utf8('eds-diary/revision-signature/v2'),ZERO,canonicalBytes(core as never))
}

export function transferDescriptorPopBytesV2(descriptor:Omit<TransferDescriptorV2,'possession_signature'>):Uint8Array{
  fixedBase64Url(descriptor.diary_id,16,'diary_id');fixedBase64Url(descriptor.epoch_id,16,'epoch_id');fixedBase64Url(descriptor.writer_device_id,16,'writer_device_id');fixedBase64Url(descriptor.writer_key_id,32,'writer_key_id');fixedBase64Url(descriptor.writer_public_key,32,'writer_public_key');fixedBase64Url(descriptor.nonce,32,'nonce')
  if(descriptor.format!=='eds-writer-transfer-v2'||descriptor.version!==2||descriptor.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('Transfer descriptor profile mismatch.')
  return concatBytes(utf8('eds-diary/transfer-descriptor-pop/v2'),ZERO,canonicalBytes(descriptor as never))
}

export function writerGrantSigningBytesV2(diaryId:string,epochId:string,grant:WriterGrantV2):Uint8Array{
  const diary=fixedBase64Url(diaryId,16,'diary_id'),epoch=fixedBase64Url(epochId,16,'epoch_id')
  const core={grant_id:grant.grant_id,writer_generation:grant.writer_generation,writer_device_id:grant.writer_device_id,writer_key_id:grant.writer_key_id,writer_public_key:grant.writer_public_key,previous_grant_id:grant.previous_grant_id,previous_writer_generation:grant.previous_writer_generation,recovery_generation:grant.recovery_generation,reason:grant.reason,authority_anchor:grant.authority_anchor}
  return concatBytes(utf8('eds-diary/writer-grant/v2'),ZERO,diary,epoch,ZERO,canonicalBytes(core as never))
}

export function rawPublicKeyFromBase64V2(value:string,label='public_key'):Uint8Array{return fixedBase64Url(value,32,label)}
export function signatureFromBase64V2(value:string,label='signature'):Uint8Array{return fixedBase64Url(value,64,label)}
export function randomProtocolIdV2(bytes:16|32):string{return base64Url(randomBytes(bytes))}
export function decodeProtocolIdV2(value:string,bytes:16|32,label='id'):Uint8Array{return fixedBase64Url(value,bytes,label)}
