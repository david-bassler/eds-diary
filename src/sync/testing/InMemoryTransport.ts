import type { RemoteCandidate, RemoteSnapshot } from '../core/contracts'
import { SINGLE_WRITER_PROFILE, TransportError, type RemoteTransport } from '../core/contracts'

export class InMemoryTransport implements RemoteTransport {
  readonly providerId = 'in-memory-test-provider'
  readonly profileId = SINGLE_WRITER_PROFILE
  readonly remotes = new Map<string, RemoteSnapshot>()
  readonly properties = new Map<string,Readonly<Record<string,string>>>()
  appendAttempts: string[][] = []
  loseNextAppendResponse = false
  loseNextAppendBeforeCommit = false
  async discover(locator: string): Promise<readonly RemoteCandidate[]> { return [...this.remotes.keys()].filter((id) => id.includes(locator)).map((remoteId) => ({ remoteId, locator })) }
  async create(locator: string, manifest: readonly string[]): Promise<void> { if (!this.remotes.has(locator)) this.remotes.set(locator, { manifest, rows: [] }) }
  async writeManifest(remoteId:string,manifest:readonly string[]):Promise<void>{const current=this.remotes.get(remoteId);if(!current)throw new TransportError('not_found','Remote not found.');this.remotes.set(remoteId,{...current,manifest:[...manifest]})}
  async readProperties(remoteId:string){return this.properties.get(remoteId)??{}}
  async patchProperties(remoteId:string,properties:Readonly<Record<string,string>>){this.properties.set(remoteId,{...properties})}
  async orphanCandidates(remoteIds:readonly string[]){for(const id of remoteIds){this.remotes.delete(id);this.properties.delete(id)}}
  async read(remoteId: string): Promise<RemoteSnapshot> { const result = this.remotes.get(remoteId); if (!result) throw new TransportError('not_found', 'Remote not found.'); return structuredClone(result) }
  async append(remoteId: string, row: readonly [string, string, string]): Promise<void> {
    const current = this.remotes.get(remoteId); if (!current) throw new TransportError('not_found', 'Remote not found.')
    this.appendAttempts.push([...row])
    if (this.loseNextAppendBeforeCommit) { this.loseNextAppendBeforeCommit = false; throw new TransportError('unknown_outcome', 'Outcome lost before the test transport committed the row.') }
    this.remotes.set(remoteId, { ...current, rows: [...current.rows, row] })
    if (this.loseNextAppendResponse) { this.loseNextAppendResponse = false; throw new TransportError('unknown_outcome', 'Response lost.') }
  }
}
