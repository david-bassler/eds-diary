import { base64Url, fixedBase64Url, fromBase64Url } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes, sha256 } from '../crypto/core'
import { deriveActivationLineageCacheKeyV2 } from './crypto'
import { validateActivationLineageV2, type ActivationLineageV2 } from './recovery'

export interface ActivationLineageCacheV2 {
  format:'activation-lineage-cache-v2'
  version:2
  cache_id:string
  diary_id:string
  epoch_id:string
  manifest_fingerprint:string
  iv:string
  ciphertext:string
}
const KEYS=['format','version','cache_id','diary_id','epoch_id','manifest_fingerprint','iv','ciphertext'] as const
const PLAIN_KEYS=['activation_lineage'] as const
function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
function header(cache:ActivationLineageCacheV2):Omit<ActivationLineageCacheV2,'ciphertext'>{
  const {ciphertext:_,...result}=cache
  void _
  return result
}
function aad(value:Omit<ActivationLineageCacheV2,'ciphertext'>):Uint8Array{return canonicalBytes(value as never)}

export function validateActivationLineageCacheV2(cache:ActivationLineageCacheV2):void{
  if(!cache||typeof cache!=='object')throw new Error('ActivationLineageCacheV2 schema mismatch.')
  exact(cache,KEYS,'ActivationLineageCacheV2')
  if(cache.format!=='activation-lineage-cache-v2'||cache.version!==2)throw new Error('ActivationLineageCacheV2 profile mismatch.')
  fixedBase64Url(cache.cache_id,16,'cache_id');fixedBase64Url(cache.diary_id,16,'diary_id');fixedBase64Url(cache.epoch_id,16,'epoch_id');fixedBase64Url(cache.manifest_fingerprint,32,'manifest_fingerprint');fixedBase64Url(cache.iv,12,'iv')
  if(fromBase64Url(cache.ciphertext).byteLength<16||fromBase64Url(cache.ciphertext).byteLength>1_048_576)throw new Error('ActivationLineageCacheV2 ciphertext bound exceeded.')
}

export async function createActivationLineageCacheV2(args:{
  rootKey:Uint8Array
  epochSalt:Uint8Array
  diaryId:string
  epochId:string
  manifestFingerprint:string
  activationLineage:ActivationLineageV2
  cacheId?:Uint8Array
  iv?:Uint8Array
}):Promise<ActivationLineageCacheV2>{
  if(args.rootKey.byteLength!==32||args.epochSalt.byteLength!==32)throw new Error('ActivationLineageCacheV2 key material is invalid.')
  const cacheId=args.cacheId??randomBytes(16),iv=args.iv??randomBytes(12)
  const base={
    format:'activation-lineage-cache-v2' as const,
    version:2 as const,
    cache_id:base64Url(cacheId),
    diary_id:args.diaryId,
    epoch_id:args.epochId,
    manifest_fingerprint:args.manifestFingerprint,
    iv:base64Url(iv),
  }
  validateActivationLineageV2(args.activationLineage,{epoch_id:args.epochId,manifest_fingerprint:args.manifestFingerprint,RK_epoch:base64Url(args.rootKey)})
  const encrypted=await aesGcmEncrypt(
    await deriveActivationLineageCacheKeyV2(args.rootKey,args.epochSalt),
    canonicalBytes({activation_lineage:args.activationLineage} as never),
    aad(base),
    iv,
  )
  const cache={...base,ciphertext:base64Url(encrypted.ciphertext)}
  validateActivationLineageCacheV2(cache)
  return cache
}
export async function openActivationLineageCacheV2(args:{
  cache:ActivationLineageCacheV2
  rootKey:Uint8Array
  epochSalt:Uint8Array
  diaryId:string
  epochId:string
  manifestFingerprint:string
}):Promise<ActivationLineageV2>{
  validateActivationLineageCacheV2(args.cache)
  if(args.cache.diary_id!==args.diaryId||args.cache.epoch_id!==args.epochId||args.cache.manifest_fingerprint!==args.manifestFingerprint)throw new Error('ActivationLineageCacheV2 context mismatch.')
  const plain=await aesGcmDecrypt(
    await deriveActivationLineageCacheKeyV2(args.rootKey,args.epochSalt),
    fromBase64Url(args.cache.ciphertext),
    aad(header(args.cache)),
    fixedBase64Url(args.cache.iv,12,'iv'),
  )
  const payload=parseCanonicalJson(plain) as unknown as {activation_lineage:ActivationLineageV2}
  if(!payload||typeof payload!=='object')throw new Error('ActivationLineageCacheV2 plaintext schema mismatch.')
  exact(payload,PLAIN_KEYS,'ActivationLineageCacheV2 plaintext')
  validateActivationLineageV2(payload.activation_lineage,{epoch_id:args.epochId,manifest_fingerprint:args.manifestFingerprint,RK_epoch:base64Url(args.rootKey)})
  return structuredClone(payload.activation_lineage)
}
export async function activationLineageCacheHashV2(cache:ActivationLineageCacheV2):Promise<string>{
  validateActivationLineageCacheV2(cache)
  return base64Url(await sha256(canonicalBytes(cache as never)))
}
