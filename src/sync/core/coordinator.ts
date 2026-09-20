import type { PreparedEnvelope } from '../../security/envelopes'
import { envelopeRow } from '../../security/envelopes'
import { TransportError, type RemoteAnchorState, type RemoteTransport, type TransportProfileCodec, type VerifiedRemoteState, type WriteAuthority } from './contracts'

export type CoordinatorState = 'local_locked' | 'local_only' | 'authenticated' | 'remote_verifying' | 'remote_verified' | 'writer_active' | 'syncing' | 'synced' | 'conflict' | 'security_blocked' | 'error'
export interface CoordinatorStore {
  readAnchor(): Promise<RemoteAnchorState | null>
  /** Pending reconciliation is profile-semantic: physical row presence alone is
   * insufficient for v2 because a present envelope can be stale_writer_rejected. */
  pending(verified: VerifiedRemoteState): Promise<readonly PreparedEnvelope[]>
  generation(): Promise<number>
  markPending?(envelopeId: string, expectedGeneration: number): Promise<number>
  /** Used when a prepared local envelope became stale before a safe retry and is
   * therefore absent remotely. v2 stores persist it in stale_writer_pending. */
  quarantineStaleWriter?(envelopeId: string, expectedGeneration: number): Promise<number>
  /** Commits a fully verified snapshot and its semantic envelope dispositions.
   * Implementations must mark only accepted envelopes durable and must quarantine
   * staleWriterEnvelopeIds instead of inferring durability from row presence. */
  commitVerifiedPull(verified: VerifiedRemoteState, anchor: RemoteAnchorState, expectedGeneration: number): Promise<number>
}

export class SingleWriterCoordinator {
  state: CoordinatorState = 'local_only'
  private verifiedGeneration: number | null = null
  private verifiedRemote: VerifiedRemoteState | null = null
  constructor(private readonly diaryId: string, private readonly epochId: string, private readonly remoteId: string, private readonly transport: RemoteTransport, private readonly codec: TransportProfileCodec, private readonly store: CoordinatorStore,private readonly allowRetirement=false,private readonly writeAuthority:WriteAuthority) {
    if (transport.profileId !== codec.profileId || transport.profileId !== writeAuthority.profileId) throw new Error('Transport profile mismatch.')
  }

  connected(): void { this.state = 'authenticated'; this.verifiedGeneration = null; this.verifiedRemote = null }
  online(): void { if (this.state === 'synced' || this.state === 'writer_active' || this.state === 'remote_verified') { this.state = 'authenticated'; this.verifiedGeneration = null; this.verifiedRemote = null } }

  private assertVerifiedProfile(verified:VerifiedRemoteState):void{
    if(verified.profileId!==this.codec.profileId)throw new Error('Verified remote profile mismatch.')
    if(verified.retired&&!this.allowRetirement)throw new Error('A rotation announcement retired this epoch.')
  }

  private async quarantine(envelopeId:string,expectedGeneration:number):Promise<number>{
    if(!this.store.quarantineStaleWriter)throw new Error('The active profile requires stale-writer quarantine, but the coordinator store does not support it.')
    return this.store.quarantineStaleWriter(envelopeId,expectedGeneration)
  }

  async pullVerify(): Promise<void> {
    this.state = 'remote_verifying'
    try {
      const snapshot = await this.transport.read(this.remoteId)
      this.codec.validate(snapshot)
      const verified = await this.codec.verifyRemote(snapshot)
      this.assertVerifiedProfile(verified)
      await this.codec.assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      const generation = await this.store.generation()
      const anchor = await this.codec.createAnchor(this.diaryId, this.epochId, snapshot.rows)
      this.verifiedGeneration = await this.store.commitVerifiedPull(verified, anchor, generation)
      const access = await this.writeAuthority.accessAfterPull(verified)
      this.verifiedRemote = verified
      this.state = access === 'writer' ? 'writer_active' : 'remote_verified'
    } catch (error) {
      this.verifiedGeneration = null
      this.verifiedRemote = null
      this.state = 'security_blocked'
      throw error
    }
  }

  async pushPending(): Promise<void> {
    if (this.state === 'remote_verified') return
    if (this.state !== 'writer_active' || this.verifiedGeneration === null || this.verifiedRemote === null) throw new Error('Pull and verify is required before push.')
    this.state = 'syncing'
    for (const envelope of await this.store.pending(this.verifiedRemote)) {
      let expectedGeneration = await this.store.generation()
      if (this.verifiedGeneration !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Local security generation changed during sync.') }

      let decision
      try { decision = await this.writeAuthority.verifyBeforePush(envelope,this.verifiedRemote,'initial') } catch (error) { this.state = 'security_blocked'; throw error }
      if(decision==='quarantine_stale_writer'){
        expectedGeneration=await this.quarantine(envelope.envelopeId,expectedGeneration)
        this.verifiedGeneration=expectedGeneration
        this.state='remote_verified'
        return
      }

      if(this.store.markPending) expectedGeneration=await this.store.markPending(envelope.envelopeId,expectedGeneration)
      if (await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Local security generation changed during sync.') }

      const row = envelopeRow(envelope)
      const prior=this.verifiedRemote.snapshot.rows.filter(remoteRow=>remoteRow[0]===row[0])
      if(prior.some(remoteRow=>remoteRow.length!==3||remoteRow.some((cell,index)=>cell!==row[index]))){this.state='security_blocked';throw new Error('Envelope ID exists with different bytes.')}
      if(!prior.some(remoteRow=>remoteRow.length===3&&remoteRow.every((cell,index)=>cell===row[index]))){
        try { await this.transport.append(this.remoteId, row) } catch (error) {
          if (!(error instanceof TransportError) || error.code !== 'unknown_outcome') { this.state = 'error'; throw error }
        }
      }

      let snapshot = await this.transport.read(this.remoteId)
      this.codec.validate(snapshot)
      let matching = snapshot.rows.filter((remoteRow) => remoteRow[0] === row[0])
      if (matching.some((remoteRow) => remoteRow.length !== 3 || remoteRow.some((cell, index) => cell !== row[index]))) { this.state = 'security_blocked'; throw new Error('Envelope ID exists with different bytes.') }

      if (!matching.length) {
        // Unknown outcome is resolved by a *new full verification* before any
        // retry. This is required for v2 authority/fence/anchor semantics.
        await this.codec.assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
        const retryVerified=await this.codec.verifyRemote(snapshot)
        this.assertVerifiedProfile(retryVerified)
        if(await this.store.generation()!==expectedGeneration){this.state='security_blocked';throw new Error('Local security generation changed during unknown-outcome reconciliation.')}
        const retryAnchor=await this.codec.createAnchor(this.diaryId,this.epochId,snapshot.rows)
        expectedGeneration=await this.store.commitVerifiedPull(retryVerified,retryAnchor,expectedGeneration)
        this.verifiedGeneration=expectedGeneration
        this.verifiedRemote=retryVerified

        let retryDecision
        try { retryDecision=await this.writeAuthority.verifyBeforePush(envelope,retryVerified,'unknown_outcome_retry') } catch(error){this.state='security_blocked';throw error}
        if(retryDecision==='quarantine_stale_writer'){
          expectedGeneration=await this.quarantine(envelope.envelopeId,expectedGeneration)
          this.verifiedGeneration=expectedGeneration
          this.state='remote_verified'
          return
        }

        await this.transport.append(this.remoteId, row)
        snapshot = await this.transport.read(this.remoteId)
        this.codec.validate(snapshot)
        matching = snapshot.rows.filter((remoteRow) => remoteRow[0] === row[0])
        if (matching.some((remoteRow) => remoteRow.length !== 3 || remoteRow.some((cell, index) => cell !== row[index]))) { this.state = 'security_blocked'; throw new Error('Envelope ID exists with different bytes.') }
      }

      if (!matching.some((remoteRow) => remoteRow.length === 3 && remoteRow.every((cell, index) => cell === row[index]))) { this.state = 'error'; throw new Error('Append could not be reconciled.') }

      await this.codec.assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      const finalVerified = await this.codec.verifyRemote(snapshot)
      this.assertVerifiedProfile(finalVerified)
      if (await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Final verification or generation check failed.') }
      const finalAnchor=await this.codec.createAnchor(this.diaryId,this.epochId,snapshot.rows)
      expectedGeneration=await this.store.commitVerifiedPull(finalVerified,finalAnchor,expectedGeneration)
      this.verifiedGeneration=expectedGeneration
      this.verifiedRemote=finalVerified

      if(finalVerified.staleWriterEnvelopeIds.has(envelope.envelopeId)){
        this.state='remote_verified'
        return
      }
      if(!finalVerified.acceptedEnvelopeIds.has(envelope.envelopeId)){
        this.state='security_blocked'
        throw new Error('Remote contains the prepared envelope, but the verifier did not accept it as durable or stale-writer quarantine.')
      }

      let access
      try { access = await this.writeAuthority.accessAfterReadback(finalVerified) } catch (error) { this.state = 'security_blocked'; throw error }
      if (access !== 'writer') {
        this.state='remote_verified'
        return
      }
    }
    this.state = 'synced'
  }
}
