import {
  SINGLE_WRITER_V2_PROFILE,
  TransportError,
  type RemoteCandidate,
  type RemoteSnapshot,
  type RemoteTransport,
  type TransportErrorCode,
} from '../core/contracts'

type ProtocolRow = readonly [string, string, string]
type Operation = 'create' | 'discover' | 'read' | 'append'

export type ProviderFault =
  | { kind: 'error'; code: Extract<TransportErrorCode, 'auth_required' | 'permission_denied' | 'rate_limited' | 'temporary_failure'> }
  | { kind: 'request_not_received' }
  | { kind: 'commit_then_response_lost' }
  | { kind: 'delay'; milliseconds: number }
  | { kind: 'duplicate_commit' }
  | { kind: 'external_append_before'; row: ProtocolRow }

interface Resource {
  readonly remoteId: string
  readonly locator: string
  readonly ownerAccountId: string
  manifest: string[]
  rows: ProtocolRow[]
  properties: Record<string, string>
  permissionRevoked: boolean
}

function cloneSnapshot(resource: Resource): RemoteSnapshot {
  return structuredClone({ manifest: resource.manifest, rows: resource.rows })
}

/** Shared deterministic provider state for browser contexts and protocol tests.
 * It models provider transport behavior only: callers must still pass returned
 * bytes through the productive verifier and authority boundary. */
export class ControlledProviderSimulator {
  private sequence = 0
  private readonly resources = new Map<string, Resource>()
  private readonly faults = new Map<Operation, ProviderFault[]>()

  connect(accountId: string): SimulatedProviderSession {
    if (!accountId) throw new Error('A simulated provider account is required.')
    return new SimulatedProviderSession(this, accountId)
  }

  enqueue(operation: Operation, fault: ProviderFault): void {
    const queued = this.faults.get(operation) ?? []
    queued.push(structuredClone(fault))
    this.faults.set(operation, queued)
  }

  revoke(remoteId: string): void { this.resource(remoteId).permissionRevoked = true }
  restore(remoteId: string): void { this.resource(remoteId).permissionRevoked = false }

  mutate(remoteId: string, mutation:
    | { kind: 'delete'; index: number }
    | { kind: 'duplicate'; index: number }
    | { kind: 'reorder'; from: number; to: number }
    | { kind: 'insert'; index: number; row: ProtocolRow }
    | { kind: 'replace'; index: number; row: ProtocolRow }
    | { kind: 'truncate'; length: number }
    | { kind: 'replace_manifest'; manifest: readonly string[] }
  ): void {
    const resource = this.resource(remoteId)
    if (mutation.kind === 'replace_manifest') { resource.manifest = [...mutation.manifest]; return }
    if (mutation.kind === 'truncate') { resource.rows = resource.rows.slice(0, mutation.length); return }
    if (mutation.kind === 'insert') { resource.rows.splice(mutation.index, 0, [...mutation.row]); return }
    if (mutation.kind === 'replace') { resource.rows.splice(mutation.index, 1, [...mutation.row]); return }
    const row = resource.rows[mutation.kind === 'reorder' ? mutation.from : mutation.index]
    if (!row) throw new Error('Simulator mutation row does not exist.')
    if (mutation.kind === 'delete') { resource.rows.splice(mutation.index, 1); return }
    if (mutation.kind === 'duplicate') { resource.rows.splice(mutation.index + 1, 0, [...row]); return }
    resource.rows.splice(mutation.from, 1)
    resource.rows.splice(mutation.to, 0, row)
  }

  snapshot(remoteId: string): RemoteSnapshot { return cloneSnapshot(this.resource(remoteId)) }

  create(accountId: string, locator: string, manifest: readonly string[]): string {
    const remoteId = `simulated-remote-${++this.sequence}`
    this.resources.set(remoteId, {
      remoteId, locator, ownerAccountId: accountId, manifest: [...manifest], rows: [], properties: {}, permissionRevoked: false,
    })
    return remoteId
  }

  candidates(accountId: string, locator: string): RemoteCandidate[] {
    return [...this.resources.values()]
      .filter((resource) => resource.ownerAccountId === accountId && resource.locator === locator && !resource.permissionRevoked)
      .map(({ remoteId }) => ({ remoteId, locator }))
  }

  owned(accountId: string, remoteId: string): Resource {
    const resource = this.resource(remoteId)
    if (resource.ownerAccountId !== accountId) throw new TransportError('permission_denied', 'The simulated resource belongs to another account.')
    if (resource.permissionRevoked) throw new TransportError('permission_denied', 'The simulated resource permission was revoked.')
    return resource
  }

  takeFault(operation: Operation): ProviderFault | undefined { return this.faults.get(operation)?.shift() }

  private resource(remoteId: string): Resource {
    const resource = this.resources.get(remoteId)
    if (!resource) throw new TransportError('not_found', 'Simulated remote resource was not found.')
    return resource
  }
}

export class SimulatedProviderSession implements RemoteTransport {
  readonly providerId = 'controlled-provider-simulator'
  readonly profileId = SINGLE_WRITER_V2_PROFILE

  constructor(private readonly provider: ControlledProviderSimulator, readonly accountId: string) {}

  async discover(locator: string): Promise<readonly RemoteCandidate[]> {
    await this.before('discover')
    return this.provider.candidates(this.accountId, locator)
  }

  async create(locator: string, manifest: readonly string[]): Promise<void> {
    await this.before('create')
    this.provider.create(this.accountId, locator, manifest)
  }

  async writeManifest(remoteId: string, manifest: readonly string[]): Promise<void> {
    this.provider.owned(this.accountId, remoteId).manifest = [...manifest]
  }

  async readProperties(remoteId: string): Promise<Readonly<Record<string, string>>> {
    return structuredClone(this.provider.owned(this.accountId, remoteId).properties)
  }

  async patchProperties(remoteId: string, properties: Readonly<Record<string, string>>): Promise<void> {
    this.provider.owned(this.accountId, remoteId).properties = { ...properties }
  }

  async read(remoteId: string): Promise<RemoteSnapshot> {
    await this.before('read')
    return cloneSnapshot(this.provider.owned(this.accountId, remoteId))
  }

  async append(remoteId: string, row: ProtocolRow): Promise<void> {
    const fault = await this.before('append', false)
    const resource = this.provider.owned(this.accountId, remoteId)
    if (fault?.kind === 'external_append_before') resource.rows.push([...fault.row])
    if (fault?.kind === 'request_not_received') throw new TransportError('unknown_outcome', 'The simulated request did not reach the provider.')
    resource.rows.push([...row])
    if (fault?.kind === 'duplicate_commit') resource.rows.push([...row])
    if (fault?.kind === 'commit_then_response_lost') throw new TransportError('unknown_outcome', 'The simulated response was lost after commit.')
  }

  private async before(operation: Operation, consumeSpecial = true): Promise<ProviderFault | undefined> {
    const fault = this.provider.takeFault(operation)
    if (!fault) return undefined
    if (fault.kind === 'error') throw new TransportError(fault.code, `Injected simulated provider error: ${fault.code}.`)
    if (fault.kind === 'delay') await new Promise((resolve) => setTimeout(resolve, fault.milliseconds))
    if (consumeSpecial && fault.kind === 'request_not_received') throw new TransportError('unknown_outcome', 'The simulated request did not reach the provider.')
    return fault
  }
}
