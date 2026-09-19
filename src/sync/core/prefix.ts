import { base64Url, concatBytes, fixedBase64Url, uint32be, uint64be, utf8 } from '../../security/crypto/bytes'
import { canonicalBytes } from '../../security/crypto/canonical'
import { sha256 } from '../../security/crypto/core'

export interface RemoteAnchorV1 { anchor_profile: 'google-sheets-single-writer-v1'; covered_row_count: number; prefix_hash: string }
/** Backwards-compatible alias for the current v1 anchor format. */
export type RemoteAnchor = RemoteAnchorV1

export async function prefixHash(diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<string> {
  let state = await sha256(concatBytes(utf8('eds-diary/remote-prefix/v5'), new Uint8Array([0]), fixedBase64Url(diaryId, 16, 'diary_id'), fixedBase64Url(epochId, 16, 'epoch_id')))
  for (let index = 0; index < rows.length; index += 1) {
    const row = canonicalBytes(rows[index] as string[])
    state = await sha256(concatBytes(state, uint64be(index + 1), uint32be(row.byteLength), row))
  }
  return base64Url(state)
}

export async function createAnchorV1(diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<RemoteAnchorV1> {
  return { anchor_profile: 'google-sheets-single-writer-v1', covered_row_count: rows.length, prefix_hash: await prefixHash(diaryId, epochId, rows) }
}

export async function assertExtendsAnchorV1(anchor: RemoteAnchorV1 | null, diaryId: string, epochId: string, rows: ReadonlyArray<readonly string[]>): Promise<void> {
  if (!anchor) return
  if (rows.length < anchor.covered_row_count) throw new Error('Remote rollback: anchored rows are missing.')
  const hash = await prefixHash(diaryId, epochId, rows.slice(0, anchor.covered_row_count))
  if (hash !== anchor.prefix_hash) throw new Error('Remote rollback: anchored prefix changed.')
}

/** Backwards-compatible aliases for existing v1 callers. */
export const createAnchor = createAnchorV1
export const assertExtendsAnchor = assertExtendsAnchorV1
