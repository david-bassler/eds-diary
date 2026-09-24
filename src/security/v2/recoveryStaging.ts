import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes } from '../crypto/core'
import {
  deriveRecoveryTakeoverStagingKeyV2,
  importRecoveryTakeoverSigningKeyV2,
  recoveryTakeoverKeyIdV2,
  verifyRecoveryTakeoverKeyPairV2,
} from './crypto'

export interface RecoveryTakeoverStagingV2 {
  format:'recovery-takeover-staging-v2'
  version:2
  diary_id:string
  epoch_id:string
  recovery_generation:number
  recovery_takeover_key_id:string
  recovery_takeover_public_key:string
  manifest_fingerprint:string
  salt:string
  iv:string
  ciphertext:string
}
const STAGING_KEYS=['format','version','diary_id','epoch_id','recovery_generation','recovery_takeover_key_id','recovery_takeover_public_key','manifest_fingerprint','salt','iv','ciphertext'] as const
const PLAINTEXT_KEYS=['recovery_takeover_private_key_pkcs8'] as const
const VERIFIED_STAGING=new WeakSet<VerifiedRecoveryTakeoverStagingV2>()
const VERIFIED_STAGING_TOKEN=Symbol('VerifiedRecoveryTakeoverStagingV2')

export class VerifiedRecoveryTakeoverStagingV2 {
  private readonly brand=true
  constructor(readonly staging:RecoveryTakeoverStagingV2,token:symbol){
    if(token!==VERIFIED_STAGING_TOKEN)throw new Error('VerifiedRecoveryTakeoverStagingV2 can only be created by the verifier.')
    VERIFIED_STAGING.add(this)
  }
  _brandForModule():boolean{return this.brand}
}
export function isVerifiedRecoveryTakeoverStagingV2(value:unknown):value is VerifiedRecoveryTakeoverStagingV2{
  return typeof value==='object'&&value!==null&&VERIFIED_STAGING.has(value as VerifiedRecoveryTakeoverStagingV2)
}
function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function aad(value:Omit<RecoveryTakeoverStagingV2,'ciphertext'>):Uint8Array{return canonicalBytes(value as never)}
function header(value:RecoveryTakeoverStagingV2):Omit<RecoveryTakeoverStagingV2,'ciphertext'>{
  const {ciphertext:_,...result}=value
  void _
  return result
}
export async function validateRecoveryTakeoverStagingV2(value:RecoveryTakeoverStagingV2):Promise<void>{
  if(!value||typeof value!=='object')throw new Error('RecoveryTakeoverStagingV2 schema mismatch.')
  exact(value,STAGING_KEYS,'RecoveryTakeoverStagingV2')
  if(value.format!=='recovery-takeover-staging-v2'||value.version!==2)throw new Error('RecoveryTakeoverStagingV2 profile mismatch.')
  fixedBase64Url(value.diary_id,16);fixedBase64Url(value.epoch_id,16)
  if(!Number.isSafeInteger(value.recovery_generation)||value.recovery_generation<0)throw new Error('RecoveryTakeoverStagingV2 generation mismatch.')
  fixedBase64Url(value.recovery_takeover_key_id,32)
  const publicKey=fixedBase64Url(value.recovery_takeover_public_key,32)
  if(await recoveryTakeoverKeyIdV2(publicKey)!==value.recovery_takeover_key_id)throw new Error('RecoveryTakeoverStagingV2 key-ID mismatch.')
  fixedBase64Url(value.manifest_fingerprint,32);fixedBase64Url(value.salt,32);fixedBase64Url(value.iv,12)
  if(fromBase64Url(value.ciphertext).byteLength<16||fromBase64Url(value.ciphertext).byteLength>16_384)throw new Error('RecoveryTakeoverStagingV2 ciphertext bound exceeded.')
}
export async function createRecoveryTakeoverStagingV2(args:{
  diaryId:string
  epochId:string
  recoveryGeneration:number
  recoveryTakeoverKeyId:string
  recoveryTakeoverPublicKey:string
  recoveryTakeoverPrivateKeyPkcs8:Uint8Array
  manifestFingerprint:string
  urs:Uint8Array
  salt?:Uint8Array
  iv?:Uint8Array
}):Promise<RecoveryTakeoverStagingV2>{
  const salt=args.salt??randomBytes(32),iv=args.iv??randomBytes(12)
  const base={
    format:'recovery-takeover-staging-v2' as const,
    version:2 as const,
    diary_id:args.diaryId,
    epoch_id:args.epochId,
    recovery_generation:args.recoveryGeneration,
    recovery_takeover_key_id:args.recoveryTakeoverKeyId,
    recovery_takeover_public_key:args.recoveryTakeoverPublicKey,
    manifest_fingerprint:args.manifestFingerprint,
    salt:base64Url(salt),
    iv:base64Url(iv),
  }
  const plaintext={recovery_takeover_private_key_pkcs8:base64Url(args.recoveryTakeoverPrivateKeyPkcs8)}
  const encrypted=await aesGcmEncrypt(await deriveRecoveryTakeoverStagingKeyV2(args.urs,salt),canonicalBytes(plaintext as never),aad(base),iv)
  const staging={...base,ciphertext:base64Url(encrypted.ciphertext)}
  await validateRecoveryTakeoverStagingV2(staging)
  return staging
}
export async function openRecoveryTakeoverStagingV2(staging:RecoveryTakeoverStagingV2,urs:Uint8Array):Promise<{verified:VerifiedRecoveryTakeoverStagingV2;privateKeyPkcs8:Uint8Array}>{
  await validateRecoveryTakeoverStagingV2(staging)
  const plain=await aesGcmDecrypt(
    await deriveRecoveryTakeoverStagingKeyV2(urs,fixedBase64Url(staging.salt,32)),
    fromBase64Url(staging.ciphertext),
    aad(header(staging)),
    fixedBase64Url(staging.iv,12),
  )
  const payload=parseCanonicalJson(plain) as unknown as {recovery_takeover_private_key_pkcs8:string}
  if(!payload||typeof payload!=='object')throw new Error('RecoveryTakeoverStagingV2 plaintext schema mismatch.')
  exact(payload,PLAINTEXT_KEYS,'RecoveryTakeoverStagingV2 plaintext')
  const privateKeyPkcs8=fromBase64Url(payload.recovery_takeover_private_key_pkcs8)
  const privateKey=await importRecoveryTakeoverSigningKeyV2(privateKeyPkcs8)
  if(!await verifyRecoveryTakeoverKeyPairV2(
    privateKey,
    fixedBase64Url(staging.recovery_takeover_public_key,32),
    staging.diary_id,
    staging.epoch_id,
    staging.recovery_generation,
  ))throw new Error('RecoveryTakeoverStagingV2 keypair check failed.')
  return{verified:new VerifiedRecoveryTakeoverStagingV2(structuredClone(staging),VERIFIED_STAGING_TOKEN),privateKeyPkcs8:new Uint8Array(privateKeyPkcs8)}
}
export async function verifyRecoveryTakeoverStagingV2(staging:RecoveryTakeoverStagingV2,urs:Uint8Array):Promise<VerifiedRecoveryTakeoverStagingV2>{
  return(await openRecoveryTakeoverStagingV2(staging,urs)).verified
}
