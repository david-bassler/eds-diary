import { describe, expect, it } from 'vitest'
import { SingleWriterCoordinator, type CoordinatorStore } from '../sync/core/coordinator'
import { InMemoryTransport } from '../sync/testing/InMemoryTransport'
import { GoogleSheetsSingleWriterProfileCodec } from '../sync/google/GoogleSheetsSingleWriterProfileCodec'
import type { PreparedEnvelope } from '../security/envelopes'
import { TestRemoteVerifier } from '../sync/testing/TestRemoteVerifier'
import { base64Url } from '../security/crypto/bytes'
import { SINGLE_WRITER_V1_PROFILE, type RemoteAnchorState, type WriteAuthority } from '../sync/core/contracts'
import { singleWriterV1WriteAuthority } from '../sync/core/writeAuthority'

const manifest=['sync-v5','5','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA']
function setup(envelope: PreparedEnvelope|readonly PreparedEnvelope[],writeAuthority?:WriteAuthority) {
  let anchor: RemoteAnchorState|null=null
  const durable:string[]=[]
  const quarantined:string[]=[]
  let generation=1
  const transport=new InMemoryTransport()
  transport.remotes.set('remote',{manifest,rows:[]})
  const candidates=Array.isArray(envelope)?envelope:[envelope as PreparedEnvelope]
  const store:CoordinatorStore={
    readAnchor:async()=>anchor,
    pending:async()=>candidates,
    generation:async()=>generation,
    commitVerifiedPull:async(verified,next,expected)=>{
      expect(expected).toBe(generation)
      anchor=next
      for(const item of candidates)if(verified.acceptedEnvelopeIds.has(item.envelopeId)&&!durable.includes(item.envelopeId))durable.push(item.envelopeId)
      return ++generation
    },
    quarantineStaleWriter:async(id,expected)=>{
      expect(expected).toBe(generation)
      quarantined.push(id)
      return ++generation
    },
  }
  const coordinator=new SingleWriterCoordinator('AAECAwQFBgcICQoLDA0ODw','EBESExQVFhcYGRobHB0eHw','remote',transport,new GoogleSheetsSingleWriterProfileCodec(new TestRemoteVerifier()),store,false,writeAuthority??singleWriterV1WriteAuthority())
  return {transport,coordinator,getDurable:()=>durable.at(-1)??'',getDurables:()=>durable,getQuarantined:()=>quarantined,generation:()=>generation}
}
const envelope={envelopeId:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',iv:'AAAAAAAAAAAAAAAA',ciphertext:'A'.repeat(1387),bytesHash:'hash'}
describe('single writer coordinator',()=>{
  it('blocks push until pull and full verification',async()=>{const {coordinator,transport}=setup(envelope);coordinator.connected();await expect(coordinator.pushPending()).rejects.toThrow(/Pull/);expect(transport.appendAttempts).toHaveLength(0);await coordinator.pullVerify();await coordinator.pushPending();expect(coordinator.state).toBe('synced')})
  it('reconciles unknown outcome using exactly the persisted bytes',async()=>{const {coordinator,transport,getDurable}=setup(envelope);transport.loseNextAppendResponse=true;coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending();expect(transport.appendAttempts).toEqual([[envelope.envelopeId,envelope.iv,envelope.ciphertext]]);expect(getDurable()).toBe(envelope.envelopeId)})
  it('full-verifies a missing unknown outcome before deciding whether retry is still authorized',async()=>{
    const phases:string[]=[]
    const authority:WriteAuthority={
      profileId:SINGLE_WRITER_V1_PROFILE,
      accessAfterPull:()=> 'writer',
      canPrepareDomainWrite:()=> 'writer',
      verifyBeforePush:(_envelope,_verified,phase)=>{phases.push(phase);return phase==='unknown_outcome_retry'?'quarantine_stale_writer':'push'},
      accessAfterReadback:()=> 'writer',
    }
    const {coordinator,transport,getQuarantined}=setup(envelope,authority)
    transport.loseNextAppendBeforeCommit=true
    coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending()
    expect(phases).toEqual(['initial','unknown_outcome_retry'])
    expect(transport.appendAttempts).toHaveLength(1)
    expect(getQuarantined()).toEqual([envelope.envelopeId])
    expect(coordinator.state).toBe('remote_verified')
  })
  it('fails closed on rollback and differing bytes',async()=>{const {coordinator,transport}=setup(envelope);coordinator.connected();await coordinator.pullVerify();transport.remotes.set('remote',{manifest,rows:[[envelope.envelopeId,'AQEBAQEBAQEBAQEB',envelope.ciphertext]]});await expect(coordinator.pushPending()).rejects.toThrow(/different bytes/);expect(coordinator.state).toBe('security_blocked')})
  it('advances the generation independently for three pending envelopes',async()=>{const envelopes=[1,2,3].map(value=>({...envelope,envelopeId:baseId(value)}));const {coordinator,getDurables,generation}=setup(envelopes);coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending();expect(getDurables()).toEqual(envelopes.map(item=>item.envelopeId));expect(generation()).toBe(5)})
  it('persists a pure-pull anchor and rejects a later rollback',async()=>{const {coordinator,transport}=setup([]);const rows=[1,2,3].map(value=>[baseId(value),envelope.iv,envelope.ciphertext] as const);transport.remotes.set('remote',{manifest,rows});coordinator.connected();await coordinator.pullVerify();coordinator.connected();transport.remotes.set('remote',{manifest,rows:rows.slice(0,2)});await expect(coordinator.pullVerify()).rejects.toThrow(/rollback|prefix|shorter/i);expect(coordinator.state).toBe('security_blocked')})
  it('routes write permission through the injected authority policy',async()=>{const calls:string[]=[];const authority:WriteAuthority={profileId:SINGLE_WRITER_V1_PROFILE,accessAfterPull:()=>{calls.push('pull');return 'writer'},canPrepareDomainWrite:()=> 'writer',verifyBeforePush:()=>{calls.push('before-push');return 'push'},accessAfterReadback:()=>{calls.push('readback');return 'writer'}};const {coordinator}=setup(envelope,authority);coordinator.connected();await coordinator.pullVerify();await coordinator.pushPending();expect(calls).toEqual(['pull','before-push','readback'])})
  it('rejects a verifier from another protocol profile before use',()=>{expect(()=>new GoogleSheetsSingleWriterProfileCodec({profileId:'transferable-v2',verify:async()=>{throw new Error('must not run')}})).toThrow(/profile mismatch/i)})
  it('fails closed when write authority is lost before append',async()=>{const authority:WriteAuthority={profileId:SINGLE_WRITER_V1_PROFILE,accessAfterPull:()=> 'writer',canPrepareDomainWrite:()=> 'writer',verifyBeforePush:()=>{throw new Error('writer authority lost')},accessAfterReadback:()=> 'writer'};const {coordinator,transport}=setup(envelope,authority);coordinator.connected();await coordinator.pullVerify();await expect(coordinator.pushPending()).rejects.toThrow('writer authority lost');expect(coordinator.state).toBe('security_blocked');expect(transport.appendAttempts).toHaveLength(0)})
  it('allows verified read-only pull without granting writer state or appending',async()=>{const authority:WriteAuthority={profileId:SINGLE_WRITER_V1_PROFILE,accessAfterPull:()=> 'read_only',canPrepareDomainWrite:()=> 'read_only',verifyBeforePush:()=>{throw new Error('must not be called')},accessAfterReadback:()=> 'read_only'};const {coordinator,transport}=setup(envelope,authority);coordinator.connected();await coordinator.pullVerify();expect(coordinator.state).toBe('remote_verified');await coordinator.pushPending();expect(coordinator.state).toBe('remote_verified');expect(transport.appendAttempts).toHaveLength(0)})
})

function baseId(value:number):string{return base64Url(new Uint8Array(32).fill(value))}
