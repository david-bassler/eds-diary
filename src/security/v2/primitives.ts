import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import { fixedBase64Url } from '../crypto/bytes'

export const V2_CRYPTO_SUITE = 'A256GCM-HKDF-SHA256-ED25519-v6' as const

export interface RemoteAnchorV2 {
  anchor_profile: typeof SINGLE_WRITER_V2_PROFILE
  covered_row_count: number
  prefix_hash: string
}

export interface WriterContextV2 {
  writer_generation: number
  writer_grant_id: string
  writer_device_id: string
  writer_key_id: string
}

export interface WriterAuthorityV2 extends WriterContextV2 {
  writer_public_key: string
}

export interface TransferDescriptorCoreV2 {
  format: 'eds-writer-transfer-v2'
  version: 2
  sync_profile: typeof SINGLE_WRITER_V2_PROFILE
  diary_id: string
  epoch_id: string
  writer_device_id: string
  writer_key_id: string
  writer_public_key: string
  nonce: string
}

export interface TransferDescriptorV2 extends TransferDescriptorCoreV2 {
  possession_signature: string
}

function exactKeys(value:object,expected:readonly string[],name:string):void {
  const actual=Object.keys(value).sort(), wanted=[...expected].sort()
  if(actual.length!==wanted.length||actual.some((key,index)=>key!==wanted[index]))throw new Error(`${name} has unknown or missing properties.`)
}

export function validateProtocolIntegerV2(value:number,field:string,minimum=0):void {
  if(!Number.isSafeInteger(value)||value<minimum||value>Number.MAX_SAFE_INTEGER)throw new Error(`${field} must be a safe integer in the v2 protocol range.`)
}

export function validateRemoteAnchorV2(anchor:RemoteAnchorV2):void {
  exactKeys(anchor,['anchor_profile','covered_row_count','prefix_hash'],'RemoteAnchorV2')
  if(anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('RemoteAnchorV2 profile mismatch.')
  validateProtocolIntegerV2(anchor.covered_row_count,'covered_row_count')
  fixedBase64Url(anchor.prefix_hash,32,'prefix_hash')
}

export function validateWriterContextV2(context:WriterContextV2):void {
  exactKeys(context,['writer_generation','writer_grant_id','writer_device_id','writer_key_id'],'WriterContextV2')
  validateProtocolIntegerV2(context.writer_generation,'writer_generation',1)
  fixedBase64Url(context.writer_grant_id,32,'writer_grant_id')
  fixedBase64Url(context.writer_device_id,16,'writer_device_id')
  fixedBase64Url(context.writer_key_id,32,'writer_key_id')
}

export function validateWriterAuthorityV2(authority:WriterAuthorityV2):void {
  exactKeys(authority,['writer_generation','writer_grant_id','writer_device_id','writer_key_id','writer_public_key'],'WriterAuthorityV2')
  validateWriterContextV2({
    writer_generation:authority.writer_generation,
    writer_grant_id:authority.writer_grant_id,
    writer_device_id:authority.writer_device_id,
    writer_key_id:authority.writer_key_id,
  })
  fixedBase64Url(authority.writer_public_key,32,'writer_public_key')
}

export function validateTransferDescriptorCoreV2(descriptor:TransferDescriptorCoreV2):void {
  exactKeys(descriptor,['format','version','sync_profile','diary_id','epoch_id','writer_device_id','writer_key_id','writer_public_key','nonce'],'TransferDescriptorCoreV2')
  if(descriptor.format!=='eds-writer-transfer-v2'||descriptor.version!==2||descriptor.sync_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('TransferDescriptorV2 profile mismatch.')
  fixedBase64Url(descriptor.diary_id,16,'diary_id')
  fixedBase64Url(descriptor.epoch_id,16,'epoch_id')
  fixedBase64Url(descriptor.writer_device_id,16,'writer_device_id')
  fixedBase64Url(descriptor.writer_key_id,32,'writer_key_id')
  fixedBase64Url(descriptor.writer_public_key,32,'writer_public_key')
  fixedBase64Url(descriptor.nonce,32,'nonce')
}

export function validateTransferDescriptorV2(descriptor:TransferDescriptorV2):void {
  exactKeys(descriptor,['format','version','sync_profile','diary_id','epoch_id','writer_device_id','writer_key_id','writer_public_key','nonce','possession_signature'],'TransferDescriptorV2')
  validateTransferDescriptorCoreV2({
    format:descriptor.format,
    version:descriptor.version,
    sync_profile:descriptor.sync_profile,
    diary_id:descriptor.diary_id,
    epoch_id:descriptor.epoch_id,
    writer_device_id:descriptor.writer_device_id,
    writer_key_id:descriptor.writer_key_id,
    writer_public_key:descriptor.writer_public_key,
    nonce:descriptor.nonce,
  })
  fixedBase64Url(descriptor.possession_signature,64,'possession_signature')
}
