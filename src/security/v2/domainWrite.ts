import type { VerifiedRemoteState } from '../../sync/core/contracts'
import { base64Url, fixedBase64Url, randomBytes } from '../crypto/bytes'
import { withDiaryLock } from '../localState'
import { openRevisionEnvelopeV2, sealRevisionEnvelopeV2 } from './envelopes'
import { buildSignedDomainRevisionV2, type DomainRevisionDraftV2 } from './revisionBuilder'
import { assertExtendsAnchorV2, createAnchorV2 } from './prefix'
import { canonicalV2ProfileState, reconcileLocalStateFromCanonicalV2, TransferableWriterAuthorityV2 } from './writeAuthority'
import type { RevisionV2 } from './types'
import type { IndexedDbV2LocalSecurityStore } from '../../data/v2LocalSecurityStore'
import { deriveEpochSaltV2 } from './crypto'

export interface V2UnlockedRoot {
  rootKey:Uint8Array
}

export interface V2DomainWriteDependencies {
  store:IndexedDbV2LocalSecurityStore
  requireUnlockedRoot():Promise<V2UnlockedRoot>
  providerSessionActive():Promise<boolean>|boolean
  freshCanonicalVerify():Promise<VerifiedRemoteState>
}

export interface PreparedDomainWriteV2<T=unknown> {
  revision:RevisionV2<T>
  envelope:{envelopeId:string;iv:string;ciphertext:string;bytesHash:string}
  verified:VerifiedRemoteState
  operationGeneration:number
}

export class V2DomainWriteService {
  constructor(private readonly diaryId:string,private readonly epochId:string,private readonly dependencies:V2DomainWriteDependencies){
    fixedBase64Url(diaryId,16,'diary_id');fixedBase64Url(epochId,16,'epoch_id')
  }

  async prepareDomainWrite<T>(draft:DomainRevisionDraftV2<T>):Promise<PreparedDomainWriteV2<T>>{
    return withDiaryLock(this.diaryId,async()=>{
      const {rootKey}=await this.dependencies.requireUnlockedRoot()
      if(rootKey.byteLength!==32)throw new Error('Unlocked v2 root key must contain exactly 32 bytes.')

      const existing=await this.dependencies.store.readState(rootKey,this.epochId)
      if(!existing||existing.diary_id!==this.diaryId)throw new Error('Authenticated EpochLocalSecurityStateV6 is missing.')
      if(!await this.dependencies.providerSessionActive())throw new Error('Authenticated provider session is required before a v2 domain write.')

      const verified=await this.dependencies.freshCanonicalVerify()
      const canonical=canonicalV2ProfileState(verified)
      if(canonical.diary_id!==this.diaryId||canonical.epoch_id!==this.epochId)throw new Error('Fresh canonical verification returned another epoch.')
      if(verified.manifestFingerprint!==canonical.manifest_fingerprint)throw new Error('Verified remote manifest fingerprint mismatch.')
      await assertExtendsAnchorV2(existing.remote_anchor,this.diaryId,this.epochId,verified.snapshot.rows)
      const recomputedAnchor=await createAnchorV2(this.diaryId,this.epochId,verified.snapshot.rows)
      if(recomputedAnchor.covered_row_count!==canonical.remote_anchor.covered_row_count||recomputedAnchor.prefix_hash!==canonical.remote_anchor.prefix_hash)throw new Error('Canonical verifier anchor does not match the verified physical snapshot.')

      const writerKey=await this.dependencies.store.loadAndVerifyWriterKey(
        this.diaryId,
        this.epochId,
        existing.writer_device_id,
        existing.writer_signing_key_id,
      )
      const reconciled=await reconcileLocalStateFromCanonicalV2(existing,verified,writerKey!==null)
      await this.dependencies.store.replaceStateIfGeneration(rootKey,reconciled,existing.operation_generation)
      if(!writerKey)throw new Error('Local WriterDeviceKeyV2 is unavailable; this device is read_only.')

      const epochSalt=await deriveEpochSaltV2(fixedBase64Url(this.diaryId,16),fixedBase64Url(this.epochId,16))
      const authority=new TransferableWriterAuthorityV2({
        readLocalState:async()=>{
          const state=await this.dependencies.store.readState(rootKey,this.epochId)
          if(!state)throw new Error('EpochLocalSecurityStateV6 disappeared.')
          return state
        },
        inspectPreparedRevision:async envelope=>openRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:this.diaryId,epochId:this.epochId},envelope),
      })
      if(await authority.canPrepareDomainWrite(verified)!=='writer')throw new Error('Fresh canonical v2 authority does not permit a domain write.')

      const state=await this.dependencies.store.readState(rootKey,this.epochId)
      if(!state||state.writer_status!=='writer_active'||state.writer_generation===null||state.writer_grant_id===null)throw new Error('Local StateV6 lost writer authority before RevisionV2 preparation.')
      const revision=await buildSignedDomainRevisionV2({
        diaryId:this.diaryId,
        epochId:this.epochId,
        draft,
        privateKey:writerKey.private_key,
        writerContext:{
          writer_generation:state.writer_generation,
          writer_grant_id:state.writer_grant_id,
          writer_device_id:state.writer_device_id,
          writer_key_id:state.writer_signing_key_id,
        },
      })

      const envelopeIdBytes=randomBytes(32),iv=randomBytes(12),envelopeId=base64Url(envelopeIdBytes)
      await this.dependencies.store.reserveEnvelope(this.epochId,envelopeId)
      const envelope=await sealRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:this.diaryId,epochId:this.epochId},revision,envelopeIdBytes,iv)
      const generation=await this.dependencies.store.persistPreparedEnvelope(rootKey,this.epochId,envelope,state.operation_generation)
      return{revision,envelope,verified,operationGeneration:generation}
    })
  }
}
