import { canonicalBytes } from '../../security/crypto/canonical'
import { base64Url } from '../../security/crypto/bytes'
import { sha256 } from '../../security/crypto/core'
import { envelopeRow } from '../../security/envelopes'
import type { PreparedEnvelope } from '../../security/envelopes'
import { SINGLE_WRITER_PROFILE, type RemoteSnapshot, type TransportProfileCodec } from '../core/contracts'

const MAX_ROWS = 100_000
export class GoogleSheetsSingleWriterProfileCodec implements TransportProfileCodec {
  readonly profileId = SINGLE_WRITER_PROFILE
  constructor(
    private readonly verifyManifestAead: (
      manifest: readonly string[],
    ) => Promise<void>,
  ) {}
  validate(snapshot: RemoteSnapshot): void {
    if (snapshot.manifest.length !== 4 || snapshot.manifest[0] !== 'sync-v5' || snapshot.manifest[1] !== '5' || snapshot.manifest.some((cell) => typeof cell !== 'string')) throw new Error('Invalid immutable _m manifest.')
    if (snapshot.rows.length > MAX_ROWS) throw new Error('Remote row bound exceeded.')
    for (const row of snapshot.rows) if (row.length !== 3 || row.some((cell) => typeof cell !== 'string' || !cell)) throw new Error('Invalid or incomplete _r row.')
  }
  async authenticateManifest(snapshot: RemoteSnapshot): Promise<string> {
    this.validate(snapshot)
    await this.verifyManifestAead(snapshot.manifest)
    return base64Url(await sha256(canonicalBytes([...snapshot.manifest])))
  }
  row(envelope: PreparedEnvelope): readonly [string, string, string] { return envelopeRow(envelope) }
}
