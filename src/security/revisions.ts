export type RevisionStatus = 'active' | 'deleted'

export interface Revision<T = unknown> {
  revision_id: string
  record_id: string
  record_type: string
  record_schema: number
  record_status: RevisionStatus
  parent_revision_ids: string[]
  migration_origin: string | null
  record_data: T | null
}

export interface RevisionGraph<T = unknown> {
  revisions: Map<string, Revision<T>>
  headsByRecord: Map<string, Set<string>>
}

const MAX_PARENTS = 8
const MAX_PER_RECORD = 4096

export function validateRevisionGraph<T>(input: readonly Revision<T>[]): RevisionGraph<T> {
  const revisions = new Map<string, Revision<T>>()
  const perRecord = new Map<string, number>()
  for (const revision of input) {
    if (!revision.revision_id || !revision.record_id || !revision.record_type || !Number.isSafeInteger(revision.record_schema) || revision.record_schema < 1) throw new Error('Invalid revision fields.')
    if (revisions.has(revision.revision_id)) throw new Error('Duplicate revision_id is an integrity failure.')
    if (revision.parent_revision_ids.length > MAX_PARENTS || new Set(revision.parent_revision_ids).size !== revision.parent_revision_ids.length || revision.parent_revision_ids.includes(revision.revision_id)) throw new Error('Invalid revision parents.')
    const count = (perRecord.get(revision.record_id) ?? 0) + 1
    if (count > MAX_PER_RECORD) throw new Error('Revision count bound exceeded.')
    perRecord.set(revision.record_id, count)
    revisions.set(revision.revision_id, revision)
  }

  const children = new Set<string>()
  const depth = new Map<string, number>()
  for (const root of input) {
    const visiting = new Set<string>()
    const stack: Array<{ id: string; exit: boolean }> = [{ id: root.revision_id, exit: false }]
    while (stack.length) {
      const frame = stack.pop()
      if (!frame) break
      if (frame.exit) {
        visiting.delete(frame.id)
        const revision = revisions.get(frame.id)
        const currentDepth = 1 + Math.max(0, ...(revision?.parent_revision_ids.map((id) => depth.get(id) ?? 0) ?? []))
        if (currentDepth > MAX_PER_RECORD) throw new Error('Revision depth bound exceeded.')
        depth.set(frame.id, currentDepth)
        continue
      }
      if (depth.has(frame.id)) continue
      if (visiting.has(frame.id)) throw new Error('Revision cycle detected.')
      const revision = revisions.get(frame.id)
      if (!revision) throw new Error('Missing revision.')
      visiting.add(frame.id)
      stack.push({ id: frame.id, exit: true })
      for (const parentId of revision.parent_revision_ids) {
        const parent = revisions.get(parentId)
        if (!parent || parent.record_id !== revision.record_id || parent.record_type !== revision.record_type) throw new Error('Cross-record, cross-type, or missing parent.')
        children.add(parentId)
        stack.push({ id: parentId, exit: false })
      }
    }
  }

  const headsByRecord = new Map<string, Set<string>>()
  for (const revision of input) {
    if (children.has(revision.revision_id)) continue
    const heads = headsByRecord.get(revision.record_id) ?? new Set<string>()
    heads.add(revision.revision_id)
    headsByRecord.set(revision.record_id, heads)
  }
  return { revisions, headsByRecord }
}

export function createMergeRevision<T>(revisionId: string, heads: readonly Revision<T>[], data: T): Revision<T> {
  if (heads.length < 2) throw new Error('A merge requires at least two heads.')
  const [first] = heads
  if (!first || heads.some((head) => head.record_id !== first.record_id || head.record_type !== first.record_type)) throw new Error('Merge heads must belong to one record and type.')
  return { revision_id: revisionId, record_id: first.record_id, record_type: first.record_type, record_schema: first.record_schema, record_status: 'active', parent_revision_ids: heads.map((head) => head.revision_id), migration_origin: null, record_data: data }
}
