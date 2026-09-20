import { manifestFingerprint, parseManifestCells } from '../../security/manifest'
import { SINGLE_WRITER_V1_PROFILE, type RemoteSnapshot, type VerifiedRemoteState } from '../core/contracts'

/** Explicit non-production verifier for coordinator fault-injection tests. */
export class TestRemoteVerifier {
  readonly profileId = SINGLE_WRITER_V1_PROFILE
  async verify(snapshot: RemoteSnapshot): Promise<VerifiedRemoteState> {
    const verifiedEnvelopeIds=new Set(snapshot.rows.map((row)=>row[0]));return { profileId:SINGLE_WRITER_V1_PROFILE, profileState:null, snapshot, manifestFingerprint: await manifestFingerprint(parseManifestCells(snapshot.manifest)), retired: false, verifiedEnvelopeIds, acceptedEnvelopeIds:new Set(verifiedEnvelopeIds), staleWriterEnvelopeIds:new Set<string>() }
  }
}
