import { base64Url, concatBytes, fixedBase64Url, uint32be, uint64be, utf8 } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { SINGLE_WRITER_V2_PROFILE } from '../../sync/core/contracts'
import type { RemoteAnchorV2 } from './types'

const ZERO = new Uint8Array([0])

export async function initialPrefixHashV2(diaryId: string, epochId: string): Promise<Uint8Array> {
  return sha256(concatBytes(
    utf8('eds-diary/remote-prefix/v6'),
    ZERO,
    utf8(SINGLE_WRITER_V2_PROFILE),
    ZERO,
    fixedBase64Url(diaryId, 16, 'diary_id'),
    fixedBase64Url(epochId, 16, 'epoch_id'),
  ))
}

export async function advancePrefixHashV2(previous: Uint8Array, physicalRowIndex: number, row: readonly string[]): Promise<Uint8Array> {
  if (previous.byteLength !== 32) throw new Error('RemoteAnchorV2 prefix state must contain 32 bytes.')
  if (!Number.isSafeInteger(physicalRowIndex) || physicalRowIndex < 1) throw new Error('RemoteAnchorV2 row index is invalid.')
  const rowJcs = canonicalBytes(row as string[])
  return sha256(concatBytes(
    utf8('eds-diary/remote-prefix-step/v6'),
    ZERO,
    previous,
    uint64be(physicalRowIndex),
    uint32be(rowJcs.byteLength),
    rowJcs,
  ))
}

export async function prefixHashesV2(
  diaryId: string,
  epochId: string,
  rows: ReadonlyArray<readonly string[]>,
): Promise<readonly Uint8Array[]> {
  const hashes: Uint8Array[] = [await initialPrefixHashV2(diaryId, epochId)]
  for (let index = 0; index < rows.length; index += 1) {
    hashes.push(await advancePrefixHashV2(hashes[index]!, index + 1, rows[index]!))
  }
  return hashes
}

export async function createAnchorV2(
  diaryId: string,
  epochId: string,
  rows: ReadonlyArray<readonly string[]>,
): Promise<RemoteAnchorV2> {
  const hashes = await prefixHashesV2(diaryId, epochId, rows)
  return {
    anchor_profile: SINGLE_WRITER_V2_PROFILE,
    covered_row_count: rows.length,
    prefix_hash: base64Url(hashes[hashes.length - 1]!),
  }
}

export async function assertExtendsAnchorV2(
  anchor: RemoteAnchorV2 | null,
  diaryId: string,
  epochId: string,
  rows: ReadonlyArray<readonly string[]>,
): Promise<void> {
  if (!anchor) return
  if (anchor.anchor_profile !== SINGLE_WRITER_V2_PROFILE) throw new Error('RemoteAnchorV2 profile mismatch.')
  if (rows.length < anchor.covered_row_count) throw new Error('rollback_against_persisted_anchor')
  const hash = await createAnchorV2(diaryId, epochId, rows.slice(0, anchor.covered_row_count))
  if (hash.prefix_hash !== anchor.prefix_hash) throw new Error('rollback_against_persisted_anchor')
}
