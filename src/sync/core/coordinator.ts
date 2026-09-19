import type { PreparedEnvelope } from '../../security/envelopes'
import { envelopeRow } from '../../security/envelopes'
import { TransportError, type RemoteAnchorState, type RemoteTransport, type TransportProfileCodec, type WriteAuthority } from './contracts'
import { singleWriterV1WriteAuthority } from './writeAuthority'

export type CoordinatorState = 'local_locked' | 'local_only' | 'authenticated' | 'remote_verifying' | 'remote_verified' | 'writer_active' | 'syncing' | 'synced' | 'conflict' | 'security_blocked' | 'error'
export interface CoordinatorStore {
  readAnchor(): Promise<RemoteAnchorState | null>
  pending(remoteRows: ReadonlyArray<readonly string[]>): Promise<readonly PreparedEnvelope[]>
  generation(): Promise<number>
  markPending?(envelopeId: string, expectedGeneration: number): Promise<number>
  markRemoteSeen?(envelopeId: string, expectedGeneration: number): Promise<number>
  commitVerifiedPull?(rows: ReadonlyArray<readonly string[]>, anchor: RemoteAnchorState, expectedGeneration: number): Promise<number>
  commitDurable(envelopeId: string, anchor: RemoteAnchorState, expectedGeneration: number): Promise<void>
}

export class SingleWriterCoordinator {
  state: CoordinatorState = 'local_only'
  private verifiedGeneration: number | null = null
  private verifiedRows: ReadonlyArray<readonly string[]> | null = null
  constructor(private readonly diaryId: string, private readonly epochId: string, private readonly remoteId: string, private readonly transport: RemoteTransport, private readonly codec: TransportProfileCodec, private readonly store: CoordinatorStore,private readonly allowRetirement=false,private readonly writeAuthority:WriteAuthority=singleWriterV1WriteAuthority()) {
    if (transport.profileId !== codec.profileId || transport.profileId !== writeAuthority.profileId) throw new Error('Transport profile mismatch.')
  }

  connected(): void { this.state = 'authenticated'; this.verifiedGeneration = null; this.verifiedRows = null }
  online(): void { if (this.state === 'synced' || this.state === 'writer_active' || this.state === 'remote_verified') { this.state = 'authenticated'; this.verifiedGeneration = null; this.verifiedRows = null } }

  async pullVerify(): Promise<void> {
    this.state = 'remote_verifying'
    try {
      const snapshot = await this.transport.read(this.remoteId)
      this.codec.validate(snapshot)
      const verified = await this.codec.verifyRemote(snapshot)
      if (verified.profileId!==this.codec.profileId) throw new Error('Verified remote profile mismatch.')
      if (verified.retired&&!this.allowRetirement) throw new Error('A rotation announcement retired this epoch.')
      await this.codec.assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      const generation = await this.store.generation()
      const anchor = await this.codec.createAnchor(this.diaryId, this.epochId, snapshot.rows)
      this.verifiedGeneration = this.store.commitVerifiedPull
        ? await this.store.commitVerifiedPull(snapshot.rows, anchor, generation)
        : generation
      const access = await this.writeAuthority.accessAfterPull(verified)
      this.verifiedRows = snapshot.rows
      this.state = access === 'writer' ? 'writer_active' : 'remote_verified'
    } catch (error) {
      this.verifiedGeneration = null
      this.state = 'security_blocked'
      throw error
    }
  }

  async pushPending(): Promise<void> {
    if (this.state === 'remote_verified') return
    if (this.state !== 'writer_active' || this.verifiedGeneration === null || this.verifiedRows === null) throw new Error('Pull and verify is required before push.')
    this.state = 'syncing'
    for (const envelope of await this.store.pending(this.verifiedRows)) {
      try { await this.writeAuthority.assertBeforePush() } catch (error) { this.state = 'security_blocked'; throw error }
      let expectedGeneration = await this.store.generation()
      if (this.verifiedGeneration !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Local security generation changed during sync.') }
      if(this.store.markPending) expectedGeneration=await this.store.markPending(envelope.envelopeId,expectedGeneration)
      if (await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Local security generation changed during sync.') }
      const row = envelopeRow(envelope)
      const prior=this.verifiedRows.filter(remoteRow=>remoteRow[0]===row[0])
      if(prior.some(remoteRow=>remoteRow.length!==3||remoteRow.some((cell,index)=>cell!==row[index]))){this.state='security_blocked';throw new Error('Envelope ID exists with different bytes.')}
      if(!prior.some(remoteRow=>remoteRow.length===3&&remoteRow.every((cell,index)=>cell===row[index]))){
        try { await this.transport.append(this.remoteId, row) } catch (error) {
          if (!(error instanceof TransportError) || error.code !== 'unknown_outcome') { this.state = 'error'; throw error }
        }
      }
      let snapshot = await this.transport.read(this.remoteId)
      this.codec.validate(snapshot)
      const matching = snapshot.rows.filter((remoteRow) => remoteRow[0] === row[0])
      if (matching.some((remoteRow) => remoteRow.length !== 3 || remoteRow.some((cell, index) => cell !== row[index]))) { this.state = 'security_blocked'; throw new Error('Envelope ID exists with different bytes.') }
      if (!matching.length) {
        await this.transport.append(this.remoteId, row)
        snapshot = await this.transport.read(this.remoteId)
        this.codec.validate(snapshot)
      }
      if (!snapshot.rows.some((remoteRow) => remoteRow.length === 3 && remoteRow.every((cell, index) => cell === row[index]))) { this.state = 'error'; throw new Error('Append could not be reconciled.') }
      if(this.store.markRemoteSeen) expectedGeneration=await this.store.markRemoteSeen(envelope.envelopeId,expectedGeneration)
      await this.codec.assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      const finalVerified = await this.codec.verifyRemote(snapshot)
      if (finalVerified.profileId!==this.codec.profileId) { this.state='security_blocked'; throw new Error('Verified remote profile mismatch.') }
      if ((finalVerified.retired&&!this.allowRetirement) || await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Final verification or generation check failed.') }
      let access
      try { access = await this.writeAuthority.accessAfterReadback(finalVerified) } catch (error) { this.state = 'security_blocked'; throw error }
      if (access !== 'writer') {
        this.verifiedGeneration=await this.store.generation()
        this.verifiedRows=snapshot.rows
        this.state='remote_verified'
        return
      }
      await this.store.commitDurable(envelope.envelopeId, await this.codec.createAnchor(this.diaryId, this.epochId, snapshot.rows), expectedGeneration)
      this.verifiedGeneration=await this.store.generation()
      this.verifiedRows=snapshot.rows
    }
    this.state = 'synced'
  }
}
