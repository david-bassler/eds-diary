import type { SyncBackupV5 } from './backup'
import type { RecoveryArtifact } from './recovery'

export interface OriginMigrationBundleV1 {
  format:'eds-origin-migration-v1'
  version:1
  source_origin:string
  created_at:string
  recovery:RecoveryArtifact
  backup:SyncBackupV5
}

export function createOriginMigrationBundle(recovery:RecoveryArtifact,backup:SyncBackupV5,sourceOrigin:string,createdAt=new Date().toISOString()):OriginMigrationBundleV1{
  const origin=new URL(sourceOrigin).origin
  if(origin!==sourceOrigin)throw new Error('Origin migration source must be an exact browser origin.')
  if(!/^https?:\/\//u.test(origin))throw new Error('Origin migration source must use HTTP or HTTPS.')
  if(new Date(createdAt).toISOString()!==createdAt)throw new Error('Origin migration timestamp must be canonical UTC.')
  return{format:'eds-origin-migration-v1',version:1,source_origin:origin,created_at:createdAt,recovery,backup}
}

export function assertOriginMigrationBundle(value:unknown):asserts value is OriginMigrationBundleV1{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Origin migration bundle is invalid.')
  const bundle=value as Record<string,unknown>
  if(Object.keys(bundle).sort().join('\0')!==['backup','created_at','format','recovery','source_origin','version'].sort().join('\0')||bundle.format!=='eds-origin-migration-v1'||bundle.version!==1)throw new Error('Origin migration bundle schema mismatch.')
  if(typeof bundle.source_origin!=='string'||new URL(bundle.source_origin).origin!==bundle.source_origin)throw new Error('Origin migration source is invalid.')
  if(typeof bundle.created_at!=='string'||new Date(bundle.created_at).toISOString()!==bundle.created_at)throw new Error('Origin migration timestamp is invalid.')
  if(!bundle.recovery||typeof bundle.recovery!=='object'||!bundle.backup||typeof bundle.backup!=='object')throw new Error('Origin migration bundle is incomplete.')
}
