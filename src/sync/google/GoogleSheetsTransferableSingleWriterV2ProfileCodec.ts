import { SINGLE_WRITER_V2_PROFILE, type RemoteAnchorState, type RemoteSnapshot, type TransportProfileCodec, type VerifiedRemoteState } from '../core/contracts'
import type { PreparedEnvelope } from '../../security/envelopes'
import { envelopeRowV2, V2_PADDING_BUCKETS } from '../../security/v2/envelopes'
import { createAnchorV2, assertExtendsAnchorV2 } from '../../security/v2/prefix'
import { deriveEpochSaltV2 } from '../../security/v2/crypto'
import { manifestFingerprintV6, openManifestTrustRootV6, openManifestV6, parseManifestCellsV6 } from '../../security/v2/manifest'
import { TransferableSingleWriterV2Verifier } from '../../security/v2/verifier'
import { canonicalBytes } from '../../security/crypto/canonical'
import { fixedBase64Url, fromBase64Url } from '../../security/crypto/bytes'
import type { RemoteAnchorV2 } from '../../security/v2/types'

const MAX_ROWS=100_000
const MAX_CANONICAL_BYTES=134_217_728
const MAX_ROW_BYTES=21_936

export class GoogleSheetsTransferableSingleWriterV2ProfileCodec implements TransportProfileCodec {
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  private readonly epochSalt:Promise<Uint8Array>
  constructor(
    private readonly diaryId:string,
    private readonly epochId:string,
    private readonly rootKey:Uint8Array,
    private readonly expectedGoogleAccountBinding:string,
    private readonly verifier=new TransferableSingleWriterV2Verifier(),
  ){
    fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id')
    if(rootKey.byteLength!==32)throw new Error('V2 codec root key must contain 32 bytes.')
    fixedBase64Url(expectedGoogleAccountBinding,32,'google_account_binding')
    if(verifier.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 verifier profile mismatch.')
    this.epochSalt=deriveEpochSaltV2(fixedBase64Url(diaryId,16),fixedBase64Url(epochId,16))
  }
  validate(snapshot:RemoteSnapshot):void{
    parseManifestCellsV6(snapshot.manifest)
    if(snapshot.rows.length>MAX_ROWS)throw new Error('Remote row bound exceeded.')
    let total=0
    for(const row of snapshot.rows){
      if(row.length!==3||row.some(cell=>typeof cell!=='string'||cell.length===0))throw new Error('Invalid or incomplete v2 _r row.')
      if(row[0]!.length+row[1]!.length+row[2]!.length+10>MAX_ROW_BYTES)throw new Error('Canonical v2 row bound exceeded.')
      fixedBase64Url(row[0]!,32,'envelope_id');fixedBase64Url(row[1]!,12,'iv')
      const cipher=fromBase64Url(row[2]!),bucket=cipher.byteLength-16
      if(!V2_PADDING_BUCKETS.includes(bucket as (typeof V2_PADDING_BUCKETS)[number]))throw new Error('Invalid v2 ciphertext bucket.')
      const size=canonicalBytes([...row]).byteLength
      if(size>MAX_ROW_BYTES)throw new Error('Canonical v2 row bound exceeded.')
      total+=size
      if(total>MAX_CANONICAL_BYTES)throw new Error('Remote v2 canonical byte bound exceeded.')
    }
  }
  async verifyCreationCandidate(snapshot:RemoteSnapshot):Promise<{manifestFingerprint:string}>{
    this.validate(snapshot)
    if(snapshot.rows.length!==0)throw new Error('V2 creation candidate must not contain record rows.')
    const cells=parseManifestCellsV6(snapshot.manifest)
    const payload=await openManifestV6(this.rootKey,await this.epochSalt,{diaryId:this.diaryId,epochId:this.epochId},cells)
    if(payload.google_account_binding!==this.expectedGoogleAccountBinding)throw new Error('ManifestV6 Google account binding mismatch.')
    return{manifestFingerprint:await manifestFingerprintV6(cells)}
  }
  async verifyRemote(snapshot:RemoteSnapshot):Promise<VerifiedRemoteState>{
    this.validate(snapshot)
    const cells=parseManifestCellsV6(snapshot.manifest)
    const opened=await openManifestTrustRootV6(this.rootKey,await this.epochSalt,{diaryId:this.diaryId,epochId:this.epochId},cells)
    if(opened.payload.google_account_binding!==this.expectedGoogleAccountBinding)throw new Error('ManifestV6 Google account binding mismatch.')
    const trustRoot=opened.trustRoot
    const result=await this.verifier.verifyCanonicalFull(trustRoot,this.rootKey,snapshot.rows)
    const fingerprint=await manifestFingerprintV6(cells)
    if(result.manifest_fingerprint!==fingerprint)throw new Error('V2 verifier manifest fingerprint mismatch.')
    return{
      profileId:SINGLE_WRITER_V2_PROFILE,
      profileState:result,
      snapshot,
      manifestFingerprint:fingerprint,
      retired:result.source_epoch_sealed,
      verifiedEnvelopeIds:new Set(result.verified_envelope_ids),
      acceptedEnvelopeIds:new Set(result.accepted_envelope_ids),
      staleWriterEnvelopeIds:new Set(result.stale_writer_envelope_ids),
    }
  }
  row(envelope:PreparedEnvelope):readonly[string,string,string]{return envelopeRowV2(envelope)}
  createAnchor(diaryId:string,epochId:string,rows:ReadonlyArray<readonly string[]>):Promise<RemoteAnchorV2>{
    if(diaryId!==this.diaryId||epochId!==this.epochId)throw new Error('V2 codec anchor context mismatch.')
    return createAnchorV2(diaryId,epochId,rows)
  }
  assertExtendsAnchor(anchor:RemoteAnchorState|null,diaryId:string,epochId:string,rows:ReadonlyArray<readonly string[]>):Promise<void>{
    if(diaryId!==this.diaryId||epochId!==this.epochId)throw new Error('V2 codec anchor context mismatch.')
    if(anchor!==null&&anchor.anchor_profile!==SINGLE_WRITER_V2_PROFILE)throw new Error('V2 anchor profile mismatch.')
    return assertExtendsAnchorV2(anchor as RemoteAnchorV2|null,diaryId,epochId,rows)
  }
}
