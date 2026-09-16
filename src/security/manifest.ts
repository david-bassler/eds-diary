import { base64Url, fixedBase64Url, fromBase64Url } from './crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from './crypto/canonical'
import { aesGcmDecrypt, aesGcmEncrypt, deriveManifestKey, randomBytes, sha256 } from './crypto/core'

export const SCHEMA_ALLOWLIST = ['activity-entry/v1','activity-type-settings/v1','epoch-migration-sw-v1','medication-entry/v1','medication-prescription/v1','pain-entry/v1','pain-type-settings/v1','rotation-announcement-sw-v1'] as const
export interface ManifestContext { diaryId:string; epochId:string }
export interface ManifestCells { format:'sync-v5'; version:'5'; manifestIv:string; manifestCiphertext:string }
export interface ProtectedManifest {
  diary_id:string;epoch_id:string;key_id:string;recovery_generation:number;recovery_urs_commitment:string;diary_marker:'epoch-manifest-v5';crypto_suite:'A256GCM-HKDF-SHA256-v5';sync_profile:'google-sheets-single-writer-v1';created_at:string;google_account_binding:string;predecessor_epochs:Array<{epoch_id:string;manifest_fingerprint:string}>;record_schema_allowlist:string[];record_schema_registry_hash:string;protocol_limits:{max_payload_bytes:16380;padding_buckets:number[];max_unique_envelopes:100000;max_unique_canonical_bytes:134217728;max_remote_physical_rows:100000;max_remote_physical_canonical_bytes:134217728;max_canonical_row_bytes:21936}
}
const aad=(c:ManifestContext)=>canonicalBytes({format:'sync-v5',protocol_version:5,diary_id:c.diaryId,epoch_id:c.epochId})
export async function schemaRegistryHash(schemas:Readonly<Record<string,unknown>>):Promise<string>{const names=Object.keys(schemas).sort();if(names.join('\0')!==[...SCHEMA_ALLOWLIST].sort().join('\0'))throw new Error('Schema registry does not match the Single-Writer allowlist.');const entries=[];for(const record_schema of names)entries.push({record_schema,schema_sha256:base64Url(await sha256(canonicalBytes(schemas[record_schema] as never)))});return base64Url(await sha256(canonicalBytes(entries)))}
export async function prepareManifest(rootKey:Uint8Array,epochSalt:Uint8Array,context:ManifestContext,payload:ProtectedManifest,iv=randomBytes(12)):Promise<ManifestCells>{fixedBase64Url(context.diaryId,16);fixedBase64Url(context.epochId,16);validateManifest(payload,context);const key=await deriveManifestKey(rootKey,epochSalt),encrypted=await aesGcmEncrypt(key,canonicalBytes(payload as never),aad(context),iv);return{format:'sync-v5',version:'5',manifestIv:base64Url(encrypted.iv),manifestCiphertext:base64Url(encrypted.ciphertext)}}
export async function openManifest(rootKey:Uint8Array,epochSalt:Uint8Array,context:ManifestContext,cells:ManifestCells):Promise<ProtectedManifest>{if(cells.format!=='sync-v5'||cells.version!=='5')throw new Error('Invalid manifest header.');const key=await deriveManifestKey(rootKey,epochSalt),plain=await aesGcmDecrypt(key,fromBase64Url(cells.manifestCiphertext),aad(context),fixedBase64Url(cells.manifestIv,12));const payload=parseCanonicalJson(plain) as unknown as ProtectedManifest;validateManifest(payload,context);return payload}
export function parseManifestCells(cells: readonly string[]): ManifestCells {
  if (cells.length !== 4 || cells[0] !== 'sync-v5' || cells[1] !== '5') throw new Error('Invalid manifest header.')
  fixedBase64Url(cells[2], 12, 'manifest_iv')
  const ciphertext = fromBase64Url(cells[3])
  if (ciphertext.byteLength < 16 || ciphertext.byteLength > 65_536) throw new Error('Manifest ciphertext length is invalid.')
  return { format: 'sync-v5', version: '5', manifestIv: cells[2], manifestCiphertext: cells[3] }
}
export async function manifestFingerprint(cells:ManifestCells):Promise<string>{parseManifestCells([cells.format,cells.version,cells.manifestIv,cells.manifestCiphertext]);return base64Url(await sha256(canonicalBytes({format:'sync-v5',protocol_version:5,manifest_iv:cells.manifestIv,manifest_ciphertext:cells.manifestCiphertext})))}
function validateManifest(p:ProtectedManifest,c:ManifestContext):void{
  const keys=['created_at','crypto_suite','diary_id','diary_marker','epoch_id','google_account_binding','key_id','predecessor_epochs','protocol_limits','record_schema_allowlist','record_schema_registry_hash','recovery_generation','recovery_urs_commitment','sync_profile']
  if(!p||typeof p!=='object'||Object.keys(p).sort().join('\0')!==keys.sort().join('\0'))throw new Error('Manifest schema mismatch.')
  if(p.diary_id!==c.diaryId||p.epoch_id!==c.epochId||p.sync_profile!=='google-sheets-single-writer-v1'||p.diary_marker!=='epoch-manifest-v5'||p.crypto_suite!=='A256GCM-HKDF-SHA256-v5')throw new Error('Manifest context mismatch.')
  fixedBase64Url(p.key_id,16);fixedBase64Url(p.recovery_urs_commitment,32);fixedBase64Url(p.google_account_binding,32);fixedBase64Url(p.record_schema_registry_hash,32)
  if(!Number.isSafeInteger(p.recovery_generation)||p.recovery_generation<0||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.created_at))throw new Error('Manifest scalar mismatch.')
  if(!Array.isArray(p.record_schema_allowlist)||p.record_schema_allowlist.join('\0')!==SCHEMA_ALLOWLIST.join('\0'))throw new Error('Manifest allowlist mismatch.')
  if(!Array.isArray(p.predecessor_epochs)||p.predecessor_epochs.length>1)throw new Error('Manifest predecessors mismatch.')
  for(const predecessor of p.predecessor_epochs){if(Object.keys(predecessor).sort().join(',')!=='epoch_id,manifest_fingerprint')throw new Error('Manifest predecessor schema mismatch.');fixedBase64Url(predecessor.epoch_id,16);fixedBase64Url(predecessor.manifest_fingerprint,32)}
  const expected={max_payload_bytes:16380,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000,max_unique_canonical_bytes:134217728,max_remote_physical_rows:100000,max_remote_physical_canonical_bytes:134217728,max_canonical_row_bytes:21936}
  if(new TextDecoder().decode(canonicalBytes(p.protocol_limits as never))!==new TextDecoder().decode(canonicalBytes(expected)))throw new Error('Manifest limits mismatch.')
}
