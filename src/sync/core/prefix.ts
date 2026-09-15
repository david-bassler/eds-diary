import { base64Url, concatBytes, uint64be, utf8 } from '../../security/crypto/bytes'
import { canonicalBytes } from '../../security/crypto/canonical'
import { sha256 } from '../../security/crypto/core'

export interface RemoteAnchor { anchor_profile: 'google-sheets-single-writer-v1'; covered_row_count: number; prefix_hash: string }

export async function prefixHash(diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<string> {
  let state = await sha256(concatBytes(utf8('eds-diary/remote-prefix/v5'), new Uint8Array([0]), utf8(diaryId), new Uint8Array([0]), utf8(epochId)))
  for (let index = 0; index < rows.length; index += 1) state = await sha256(concatBytes(state, uint64be(index + 1), canonicalBytes(rows[index] as string[])))
  return base64Url(state)
}

export async function createAnchor(diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<RemoteAnchor> {
  return { anchor_profile: 'google-sheets-single-writer-v1', covered_row_count: rows.length, prefix_hash: await prefixHash(diaryId, epochId, rows) }
}

export async function assertExtendsAnchor(anchor: RemoteAnchor | null, diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<void> {
  if (!anchor) return
  if (rows.length < anchor.covered_row_count) throw new Error('Remote rollback: anchored rows are missing.')
  const hash = await prefixHash(diaryId, epochId, rows.slice(0, anchor.covered_row_count))
  if (hash !== anchor.prefix_hash) throw new Error('Remote rollback: anchored prefix changed.')
}
