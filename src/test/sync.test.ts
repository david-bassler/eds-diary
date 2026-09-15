import { describe, expect, it } from 'vitest'
import { SingleWriterCoordinator, type CoordinatorStore } from '../sync/core/coordinator'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import type { PreparedEnvelope } from '../security/envelopes'
import type { RemoteAnchor } from '../sync/core/prefix'
import { TestRemoteVerifier } from '../sync/testing/TestRemoteVerifier'

const manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA']
function setup(envelope: PreparedEnvelope) { let anchor: RemoteAnchor|null=null; let durable=''; const transport=new InMemoryTransport(); transport.remotes.set('remote',{manifest,rows:[]}); const store:CoordinatorStore={readAnchor:async()=>anchor,pending:async()=>[envelope],generation:async()=>1,commitDurable:async(id,next,generation)=>{expect(generation).toBe(1);durable=id;anchor=next}}; const coordinator=new SingleWriterCoordinator('AAECAwQFBgcICQoLDA0ODw','EBESExQVFhcYGRobHB0eHw','remote',transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),store); return {transport,coordinator,getDurable:()=>durable} }
const envelope={envelopeId:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',iv:'AAAAAAAAAAAAAAAA',ciphertext:'A'.repeat(1387),bytesHash:'hash'}
describe('single writer coordinator',()=>{
  it('blocks push until pull and full verification',async()=>{const {coordinator,transport}=setup(envelope);coordinator.connected();await expect(coordinator.pushPending()).rejects.toThrow(/Pull/);expect(transport.appendAttempts).toHaveLength(0);await coordinator.pullVerify();await coordinator.pushPending();expect(coordinator.state).toBe('synced')})
  it('reconciles unknown outcome using exactly the persisted bytes',async()=>{const {coordinator,transport,getDurable}=setup(envelope);transport.loseNextAppendResponse=true;coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending();expect(transport.appendAttempts).toEqual([[envelope.envelopeId,envelope.iv,envelope.ciphertext]]);expect(getDurable()).toBe(envelope.envelopeId)})
  it('fails closed on rollback and differing bytes',async()=>{const {coordinator,transport}=setup(envelope);coordinator.connected();await coordinator.pullVerify();transport.remotes.set('remote',{manifest,rows:[[envelope.envelopeId,'AQEBAQEBAQEBAQEB',envelope.ciphertext]]});await expect(coordinator.pushPending()).rejects.toThrow(/different bytes/);expect(coordinator.state).toBe('security_blocked')})
})
