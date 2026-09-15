import { fixedBase64Url, fromBase64Url } from '../../security/crypto/bytes'
import { parseManifestCells } from '../../security/manifest'
import { envelopeRow } from '../../security/envelopes'
import type { PreparedEnvelope } from '../../security/envelopes'
import { SINGLE_WRITER_PROFILE, type RemoteSnapshot, type TransportProfileCodec, type VerifiedRemoteState } from '../core/contracts'

const MAX_ROWS = 100_000
export class GoogleSheetsSingleWriterProfileCodec implements TransportProfileCodec {
  readonly profileId = SINGLE_WRITER_PROFILE
  constructor(
    private readonly verifier: { verify(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState> },
  ) {}
  validate(snapshot: RemoteSnapshot): void {
    parseManifestCells(snapshot.manifest)
    if (snapshot.rows.length > MAX_ROWS) throw new Error('Remote row bound exceeded.')
    let canonicalBytes = 0
    for (const row of snapshot.rows) {
      if (row.length !== 3 || row.some((cell) => typeof cell !== 'string' || !cell)) throw new Error('Invalid or incomplete _r row.')
      fixedBase64Url(row[0], 32, 'envelope_id'); fixedBase64Url(row[1], 12, 'iv')
      const ciphertext = fromBase64Url(row[2]); if (![1040,2064,4112,8208,16400].includes(ciphertext.byteLength)) throw new Error('Invalid ciphertext bucket.')
      canonicalBytes += row[0].length + row[1].length + row[2].length + 7
      if (canonicalBytes > 134_217_728) throw new Error('Remote canonical byte bound exceeded.')
    }
  }
  async verifyRemote(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState> {
    this.validate(snapshot)
    return this.verifier.verify(snapshot)
  }
  row(envelope: PreparedEnvelope): readonly [string, string, string] { return envelopeRow(envelope) }
}
