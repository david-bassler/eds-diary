import { describe, expect, it } from 'vitest'
import { createMergeRevision, validateRevisionGraph, type Revision } from '../security/revisions'
const revision = (id: string, parents: string[] = []): Revision => ({ revision_id: id, record_id: 'record', record_type: 'pain', record_schema: 1, record_status: 'active', parent_revision_ids: parents, migration_origin: null, record_data: {} })
describe('revision graph', () => {
  it('preserves offline heads and merges explicitly', () => { const a = revision('a'); const b = revision('b', ['a']); const c = revision('c', ['a']); const graph = validateRevisionGraph([a,b,c]); expect([...graph.headsByRecord.get('record')!].sort()).toEqual(['b','c']); const merge = createMergeRevision('m',[b,c],{}); expect([...validateRevisionGraph([a,b,c,merge]).headsByRecord.get('record')!]).toEqual(['m']) })
  it('rejects cycles and hostile parents', () => { expect(() => validateRevisionGraph([revision('a',['b']), revision('b',['a'])])).toThrow(/cycle/); expect(() => validateRevisionGraph([{...revision('a'), parent_revision_ids: Array.from({length:9},(_,i)=>`x${i}`)}])).toThrow() })
})
