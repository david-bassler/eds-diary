import { aesGcmDecrypt, aesGcmEncrypt, hkdfSha256, randomBytes, sha256 } from './crypto/core'
import { base64Url, concatBytes, fixedBase64Url, fromBase64Url, utf8 } from './crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from './crypto/canonical'
import type { PreparedEnvelope } from './envelopes'
import { createAnchor, prefixHash, type RemoteAnchor } from '../sync/core/prefix'
import { FullRemoteVerifier } from '../sync/core/remoteVerifier'

export const MAX_BACKUP_BYTES=256*1024*1024,MAX_UNION_COUNT=100_000,MAX_CANONICAL_ROWS=128*1024*1024
type Row=readonly[string,string,string]
export interface BackupManifest {backup_id:string;diary_id:string;epoch_id:string;key_id:string;manifest_fingerprint:string;remote_anchor_at_export:RemoteAnchor|null;record_row_count:number;record_rows_canonical_bytes:number;record_prefix_hash:string;epoch_manifest_public_sha256:string;record_rows_jcs_sha256:string;pending_outbox_count:number;pending_outbox_rows_canonical_bytes:number;pending_outbox_rows_jcs_sha256:string;unique_union_count:number;unique_union_canonical_bytes:number;created_at:string}
export interface SyncBackupV5 {format:'sync-backup-v5';backup_format_version:5;backup_id:string;backup_manifest_iv:string;backup_manifest_ciphertext:string;epoch_manifest_public:readonly[string,string,string,string];record_rows:readonly Row[];pending_outbox_rows:readonly Row[]}
export interface BackupContext {rootKey:Uint8Array;epochSalt:Uint8Array;diaryId:string;epochId:string;keyId:string;manifestFingerprint:string;epochManifestPublic:readonly[string,string,string,string];remoteRows:readonly Row[];localEnvelopes:readonly PreparedEnvelope[];remoteBound:boolean;createdAt:string}
const aad=(id:string)=>canonicalBytes({format:'sync-backup-v5',backup_format_version:5,backup_id:id})
const bytes=(rows:readonly Row[])=>rows.reduce((sum,row)=>sum+canonicalBytes([...row]).byteLength,0)
const digest=async(value:unknown)=>base64Url(await sha256(canonicalBytes(value as never)))
const key=(context:BackupContext,id:Uint8Array)=>hkdfSha256(context.rootKey,context.epochSalt,concatBytes(utf8('eds-diary/backup-manifest/v5'),new Uint8Array([0]),id))
export async function createBackup(context:BackupContext,id=randomBytes(32),iv=randomBytes(12)):Promise<SyncBackupV5>{
  const backup_id=base64Url(id),remote=context.remoteRows,remoteSet=new Set(remote.map((row)=>JSON.stringify(row))),pending=context.localEnvelopes.map((e)=>[e.envelopeId,e.iv,e.ciphertext]as const).filter((row)=>!remoteSet.has(JSON.stringify(row))),union=new Set([...remote,...pending].map((row)=>JSON.stringify(row)))
  const recordBytes=bytes(remote),pendingBytes=bytes(pending),unionBytes=[...union].reduce((sum,row)=>sum+utf8(row).byteLength,0)
  if(union.size>MAX_UNION_COUNT||recordBytes+pendingBytes>MAX_CANONICAL_ROWS||unionBytes>MAX_CANONICAL_ROWS)throw new Error('Backup envelope bounds exceeded.')
  if(!context.remoteBound&&remote.length)throw new Error('Offline backup cannot contain remote rows.')
  const anchor=context.remoteBound?await createAnchor(context.diaryId,context.epochId,remote):null
  const manifest:BackupManifest={backup_id,diary_id:context.diaryId,epoch_id:context.epochId,key_id:context.keyId,manifest_fingerprint:context.manifestFingerprint,remote_anchor_at_export:anchor,record_row_count:remote.length,record_rows_canonical_bytes:recordBytes,record_prefix_hash:await prefixHash(context.diaryId,context.epochId,remote),epoch_manifest_public_sha256:await digest(context.epochManifestPublic),record_rows_jcs_sha256:await digest(remote),pending_outbox_count:pending.length,pending_outbox_rows_canonical_bytes:pendingBytes,pending_outbox_rows_jcs_sha256:await digest(pending),unique_union_count:union.size,unique_union_canonical_bytes:unionBytes,created_at:context.createdAt}
  const encrypted=await aesGcmEncrypt(await key(context,id),canonicalBytes(manifest as never),aad(backup_id),iv)
  const backup:SyncBackupV5={format:'sync-backup-v5',backup_format_version:5,backup_id,backup_manifest_iv:base64Url(encrypted.iv),backup_manifest_ciphertext:base64Url(encrypted.ciphertext),epoch_manifest_public:context.epochManifestPublic,record_rows:remote,pending_outbox_rows:pending}
  if(canonicalBytes(backup as never).byteLength>MAX_BACKUP_BYTES)throw new Error('Backup size bound exceeded.');return backup
}
function exactKeys(value: object, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error(`${label} schema mismatch.`)
}
function validateRows(rows: unknown, label: string): asserts rows is readonly Row[] {
  if (!Array.isArray(rows) || rows.length > MAX_UNION_COUNT) throw new Error(`${label} count bound exceeded.`)
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3 || row.some((cell) => typeof cell !== 'string')) throw new Error(`${label} row schema mismatch.`)
    fixedBase64Url(row[0], 32); fixedBase64Url(row[1], 12)
    const cipherLength = fromBase64Url(row[2]).byteLength
    if (![1040, 2064, 4112, 8208, 16400].includes(cipherLength)) throw new Error(`${label} ciphertext bucket mismatch.`)
  }
}
const BACKUP_KEYS=['format','backup_format_version','backup_id','backup_manifest_iv','backup_manifest_ciphertext','epoch_manifest_public','record_rows','pending_outbox_rows'] as const
const MANIFEST_KEYS=['backup_id','diary_id','epoch_id','key_id','manifest_fingerprint','remote_anchor_at_export','record_row_count','record_rows_canonical_bytes','record_prefix_hash','epoch_manifest_public_sha256','record_rows_jcs_sha256','pending_outbox_count','pending_outbox_rows_canonical_bytes','pending_outbox_rows_jcs_sha256','unique_union_count','unique_union_canonical_bytes','created_at'] as const
/** A test restore accepts only the concrete production full verifier. Callers cannot
 * replace the trust boundary with an always-successful callback. */
export async function testRestoreBackup(context:Pick<BackupContext,'rootKey'|'epochSalt'|'diaryId'|'epochId'|'keyId'|'manifestFingerprint'>,backup:SyncBackupV5,verifier:FullRemoteVerifier):Promise<readonly Row[]>{
  if (!(verifier instanceof FullRemoteVerifier)) throw new Error('A production full verifier is required.')
  if (!backup || typeof backup !== 'object') throw new Error('Invalid backup document.')
  exactKeys(backup, BACKUP_KEYS, 'Backup')
  if(backup.format!=='sync-backup-v5'||backup.backup_format_version!==5)throw new Error('Invalid backup format.')
  const encodedSize=canonicalBytes(backup as never).byteLength
  if(encodedSize>MAX_BACKUP_BYTES)throw new Error('Backup bound exceeded.')
  const id=fixedBase64Url(backup.backup_id,32),iv=fixedBase64Url(backup.backup_manifest_iv,12)
  if(fromBase64Url(backup.backup_manifest_ciphertext).byteLength>65_536)throw new Error('Backup manifest ciphertext bound exceeded.')
  if(!Array.isArray(backup.epoch_manifest_public)||backup.epoch_manifest_public.length!==4||backup.epoch_manifest_public.some((cell)=>typeof cell!=='string'))throw new Error('Embedded epoch manifest schema mismatch.')
  validateRows(backup.record_rows,'record_rows');validateRows(backup.pending_outbox_rows,'pending_outbox_rows')
  if(backup.record_rows.length+backup.pending_outbox_rows.length>MAX_UNION_COUNT)throw new Error('Backup union count bound exceeded.')
  const full={...context,epochManifestPublic:backup.epoch_manifest_public,remoteRows:backup.record_rows,localEnvelopes:[],remoteBound:Boolean(backup.record_rows.length),createdAt:''}
  const plain=await aesGcmDecrypt(await key(full,id),fromBase64Url(backup.backup_manifest_ciphertext),aad(backup.backup_id),iv)
  const manifest=parseCanonicalJson(plain) as unknown as BackupManifest
  if(!manifest||typeof manifest!=='object')throw new Error('Backup manifest schema mismatch.');exactKeys(manifest,MANIFEST_KEYS,'Backup manifest')
  if(manifest.backup_id!==backup.backup_id||manifest.diary_id!==context.diaryId||manifest.epoch_id!==context.epochId||manifest.key_id!==context.keyId||manifest.manifest_fingerprint!==context.manifestFingerprint)throw new Error('Backup binding mismatch.')
  if(manifest.record_row_count!==backup.record_rows.length||manifest.pending_outbox_count!==backup.pending_outbox_rows.length||manifest.record_rows_canonical_bytes!==bytes(backup.record_rows)||manifest.pending_outbox_rows_canonical_bytes!==bytes(backup.pending_outbox_rows)||manifest.record_rows_jcs_sha256!==await digest(backup.record_rows)||manifest.pending_outbox_rows_jcs_sha256!==await digest(backup.pending_outbox_rows)||manifest.epoch_manifest_public_sha256!==await digest(backup.epoch_manifest_public))throw new Error('Backup hashes or counts mismatch.')
  if(manifest.record_prefix_hash!==await prefixHash(context.diaryId,context.epochId,backup.record_rows))throw new Error('Backup prefix mismatch.')
  const expectedAnchor=backup.record_rows.length?await createAnchor(context.diaryId,context.epochId,backup.record_rows):null
  if(JSON.stringify(manifest.remote_anchor_at_export)!==JSON.stringify(expectedAnchor))throw new Error('Backup anchor mismatch.')
  const byId=new Map<string,string>(),union=[...backup.record_rows,...backup.pending_outbox_rows]
  for(const row of union){const encoded=JSON.stringify(row),prior=byId.get(row[0]);if(prior!==undefined&&prior!==encoded)throw new Error('Duplicate envelope_id has different bytes.');byId.set(row[0],encoded)}
  const uniqueRows=[...byId.values()]
  const uniqueBytes=uniqueRows.reduce((sum,row)=>sum+utf8(row).byteLength,0)
  if(manifest.unique_union_count!==byId.size||manifest.unique_union_canonical_bytes!==uniqueBytes||uniqueBytes>MAX_CANONICAL_ROWS)throw new Error('Backup union binding mismatch.')
  await verifier.verify({manifest:backup.epoch_manifest_public,rows:union})
  return union
}
