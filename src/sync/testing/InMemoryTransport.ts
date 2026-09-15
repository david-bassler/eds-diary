import type { RemoteCandidate, RemoteSnapshot, RemoteTransport } from '../core/contracts'
import { SINGLE_WRITER_PROFILE, TransportError } from '../core/contracts'

export class InMemoryTransport implements RemoteTransport {
  readonly profileId = SINGLE_WRITER_PROFILE
  readonly remotes = new Map<string, RemoteSnapshot>()
  appendAttempts: string[][] = []
  loseNextAppendResponse = false
  async discover(locator: string): Promise<readonly RemoteCandidate[]> { return [...this.remotes.keys()].filter((id) => id.includes(locator)).map((remoteId) => ({ remoteId, locator })) }
  async create(locator: string, manifest: readonly string[]): Promise<void> { if (!this.remotes.has(locator)) this.remotes.set(locator, { manifest, rows: [] }) }
  async read(remoteId: string): Promise<RemoteSnapshot> { const result = this.remotes.get(remoteId); if (!result) throw new TransportError('not_found', 'Remote not found.'); return structuredClone(result) }
  async append(remoteId: string, row: readonly [string, string, string]): Promise<void> {
    const current = this.remotes.get(remoteId); if (!current) throw new TransportError('not_found', 'Remote not found.')
    this.appendAttempts.push([...row]); this.remotes.set(remoteId, { ...current, rows: [...current.rows, row] })
    if (this.loseNextAppendResponse) { this.loseNextAppendResponse = false; throw new TransportError('unknown_outcome', 'Response lost.') }
  }
}
