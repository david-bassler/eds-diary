import type { RemoteTransport, TransportProfileCodec } from './contracts'
export type CreationStatus = 'creation_pending' | 'bound' | 'ambiguous'
export interface CreationState { locator: string; manifestFingerprint: string; status: CreationStatus; remoteId: string | null }
export async function reconcileCreation(state: CreationState, transport: RemoteTransport, codec: TransportProfileCodec): Promise<CreationState> {
  if (state.status === 'bound') return state
  const authentic: string[] = []
  for (const candidate of await transport.discover(state.locator)) {
    try { const snapshot = await transport.read(candidate.remoteId); codec.validate(snapshot); if ((await codec.verifyRemote(snapshot)).manifestFingerprint === state.manifestFingerprint) authentic.push(candidate.remoteId) } catch { /* unauthenticated discovery candidates are ignored */ }
  }
  if (authentic.length > 1) return { ...state, status: 'ambiguous', remoteId: null }
  if (authentic.length === 1) return { ...state, status: 'bound', remoteId: authentic[0] }
  return state
}
export async function createOrReconcile(state: CreationState, manifest: readonly string[], transport: RemoteTransport, codec: TransportProfileCodec): Promise<CreationState> {
  const reconciled = await reconcileCreation(state, transport, codec); if (reconciled.status !== 'creation_pending') return reconciled
  try { await transport.create(state.locator, manifest) } catch { /* create has unknown outcome; readback decides */ }
  return reconcileCreation(state, transport, codec)
}
