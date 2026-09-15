import type { PreparedEnvelope } from '../../security/envelopes'
import { envelopeRow } from '../../security/envelopes'
import { createAnchor, assertExtendsAnchor, type RemoteAnchor } from './prefix'
import { TransportError, type RemoteTransport, type TransportProfileCodec } from './contracts'

export type CoordinatorState = 'local_locked' | 'local_only' | 'authenticated' | 'remote_verifying' | 'remote_verified' | 'writer_active' | 'syncing' | 'synced' | 'conflict' | 'security_blocked' | 'error'
export interface CoordinatorStore {
  readAnchor(): Promise<RemoteAnchor | null>
  pending(): Promise<readonly PreparedEnvelope[]>
  generation(): Promise<number>
  commitDurable(envelopeId: string, anchor: RemoteAnchor, expectedGeneration: number): Promise<void>
}

export class SingleWriterCoordinator {
  state: CoordinatorState = 'local_only'
  private verifiedGeneration: number | null = null
  constructor(private readonly diaryId: string, private readonly epochId: string, private readonly remoteId: string, private readonly transport: RemoteTransport, private readonly codec: TransportProfileCodec, private readonly store: CoordinatorStore) {
    if (transport.profileId !== codec.profileId) throw new Error('Transport profile mismatch.')
  }

  connected(): void { this.state = 'authenticated'; this.verifiedGeneration = null }
  online(): void { if (this.state === 'synced' || this.state === 'writer_active') { this.state = 'authenticated'; this.verifiedGeneration = null } }

  async pullVerify(): Promise<void> {
    this.state = 'remote_verifying'
    try {
      const snapshot = await this.transport.read(this.remoteId)
      this.codec.validate(snapshot)
      const verified = await this.codec.verifyRemote(snapshot)
      if (verified.retired) throw new Error('A rotation announcement retired this epoch.')
      await assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      this.verifiedGeneration = await this.store.generation()
      this.state = 'writer_active'
    } catch (error) {
      this.verifiedGeneration = null
      this.state = 'security_blocked'
      throw error
    }
  }

  async pushPending(): Promise<void> {
    if (this.state !== 'writer_active' || this.verifiedGeneration === null) throw new Error('Pull and verify is required before push.')
    this.state = 'syncing'
    const expectedGeneration = this.verifiedGeneration
    for (const envelope of await this.store.pending()) {
      if (await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Local security generation changed during sync.') }
      const row = envelopeRow(envelope)
      try { await this.transport.append(this.remoteId, row) } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'unknown_outcome') { this.state = 'error'; throw error }
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
      await assertExtendsAnchor(await this.store.readAnchor(), this.diaryId, this.epochId, snapshot.rows)
      const finalVerified = await this.codec.verifyRemote(snapshot)
      if (finalVerified.retired || await this.store.generation() !== expectedGeneration) { this.state = 'security_blocked'; throw new Error('Final verification or generation check failed.') }
      await this.store.commitDurable(envelope.envelopeId, await createAnchor(this.diaryId, this.epochId, snapshot.rows), expectedGeneration)
    }
    this.state = 'synced'
  }
}
