import { fixedBase64Url } from './crypto/bytes'

export type RevisionStatus = 'active' | 'deleted' | 'control'
export interface MigrationOrigin { sources: Array<{ source_epoch_id: string; source_record_id: string; source_revision_ids: string[] }> }
export interface Revision<T = unknown> {
  record_type: string; record_schema: string; record_id: string; revision_id: string
  parent_revision_ids: string[]; record_status: RevisionStatus; record_data: T | null
  migration_origin: MigrationOrigin | null; protocol_created_at: string
}
export interface RevisionGraph<T = unknown> { revisions: Map<string, Revision<T>>; headsByRecord: Map<string, Set<string>> }
const MAX_PARENTS = 8, MAX_PER_RECORD = 4096
const FORBIDDEN = new Set(['remote-checkpoint/v1', 'rotation-fence/v1', 'rotation-abort/v1'])
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function validateRevision<T>(revision: Revision<T>): void {
  if (Object.keys(revision).sort().join(',') !== ['migration_origin','parent_revision_ids','protocol_created_at','record_data','record_id','record_schema','record_status','record_type','revision_id'].sort().join(',')) throw new Error('Record wrapper has unknown or missing properties.')
  fixedBase64Url(revision.record_id, 16, 'record_id'); fixedBase64Url(revision.revision_id, 32, 'revision_id')
  if (!CREATED_AT.test(revision.protocol_created_at) || Number.isNaN(Date.parse(revision.protocol_created_at))) throw new Error('Invalid protocol_created_at.')
  if (!revision.record_type || !revision.record_schema || FORBIDDEN.has(revision.record_schema)) throw new Error('Invalid or forbidden record schema.')
  if (!['active','deleted','control'].includes(revision.record_status)) throw new Error('Invalid record_status.')
  if (revision.record_status === 'deleted' && revision.record_data !== null) throw new Error('Tombstone data must be null.')
  if (revision.record_status === 'control' && (revision.parent_revision_ids.length || revision.migration_origin !== null)) throw new Error('Control wrapper invariants failed.')
  if (revision.parent_revision_ids.length > MAX_PARENTS || new Set(revision.parent_revision_ids).size !== revision.parent_revision_ids.length) throw new Error('Invalid revision parents.')
  revision.parent_revision_ids.forEach((id) => fixedBase64Url(id, 32, 'parent_revision_id'))
}
export function validateRevisionGraph<T>(input: readonly Revision<T>[]): RevisionGraph<T> {
  const revisions=new Map<string,Revision<T>>(), children=new Set<string>(), counts=new Map<string,number>()
  for (const revision of input) {
    validateRevision(revision)
    if (revisions.has(revision.revision_id)) throw new Error('Duplicate revision_id is an integrity failure.')
    const count=(counts.get(revision.record_id)??0)+1; if(count>MAX_PER_RECORD)throw new Error('Revision count bound exceeded.');counts.set(revision.record_id,count)
    for(const parentId of revision.parent_revision_ids){const parent=revisions.get(parentId);if(!parent)throw new Error('Parent must physically precede child.');if(parent.record_id!==revision.record_id||parent.record_type!==revision.record_type||parent.record_schema!==revision.record_schema)throw new Error('Cross-record, cross-type, or cross-schema parent.');children.add(parentId)}
    revisions.set(revision.revision_id,revision)
  }
  const headsByRecord=new Map<string,Set<string>>()
  for(const revision of input){if(revision.record_status==='control'||children.has(revision.revision_id))continue;const heads=headsByRecord.get(revision.record_id)??new Set<string>();heads.add(revision.revision_id);headsByRecord.set(revision.record_id,heads)}
  return {revisions,headsByRecord}
}
export function createMergeRevision<T>(revisionId:string,heads:readonly Revision<T>[],data:T,createdAt:string):Revision<T>{
  if(heads.length<2)throw new Error('A merge requires at least two heads.');const first=heads[0]
  if(!first||heads.some((head)=>head.record_id!==first.record_id||head.record_type!==first.record_type||head.record_schema!==first.record_schema))throw new Error('Merge heads must belong to one record, type and schema.')
  return {revision_id:revisionId,record_id:first.record_id,record_type:first.record_type,record_schema:first.record_schema,record_status:'active',parent_revision_ids:heads.map((head)=>head.revision_id),migration_origin:null,record_data:data,protocol_created_at:createdAt}
}
