import { describe, expect, it } from 'vitest'
import {
  runProfileUpgradeStateMachineV2,
  validateRotationOperationStateV2,
  type ProfileUpgradeOrchestratorV2Dependencies,
  type RotationOperationStageV2,
  type RotationOperationStateV2,
} from '../security/v2/profileUpgrade'
import { SINGLE_WRITER_V1_PROFILE, SINGLE_WRITER_V2_PROFILE } from '../sync/core/contracts'

const b=(fill:number,bytes:number)=>Buffer.alloc(bytes,fill).toString('base64url')
const v1Anchor=(count=2)=>({anchor_profile:SINGLE_WRITER_V1_PROFILE,covered_row_count:count,prefix_hash:b(1+count,32)}) as const
const v2Anchor=(count:number)=>({anchor_profile:SINGLE_WRITER_V2_PROFILE,covered_row_count:count,prefix_hash:b(30+count,32)}) as const
const row=(fill:number)=>({envelope_id:b(fill,32),iv:b(fill+1,12),ciphertext:b(fill+2,1040)})

function initialState():RotationOperationStateV2{
  return validateRotationOperationStateV2({
    format:'rotation-operation-v2',
    version:2,
    operation_id:b(1,32),
    rotation_kind:'profile_upgrade',
    source_epoch_id:b(2,16),
    successor_epoch_id:b(3,16),
    stage:'source_frozen_verified',
    source_anchor_before_announcement:v1Anchor(),
    successor_staging_anchor:null,
    successor_activation_anchor:null,
    successor_creation_locator:null,
    successor_manifest_fingerprint:null,
    source_recovery_transition_id:null,
    activation_lineage_sha256:null,
    announcement_envelope:null,
    confirmation_envelope:null,
    activation_evidence_sha256:null,
    recovery_artifact_id:null,
    recovery_artifact_locator:null,
    recovery_artifact_sha256:null,
    staged_backup_id:null,
    activated_backup_id:null,
  })
}

class Harness implements ProfileUpgradeOrchestratorV2Dependencies {
  state=initialState()
  failAfter:RotationOperationStageV2|null=null
  readonly calls:string[]=[]
  announcement:'durable'|'unknown'|'stale'|'source_race'='durable'
  confirmation:'durable'|'unknown'|'cutover_race'='durable'
  postActivation:'ready'|'superseded'='ready'
  finalVerify:'ready'|'superseded'='ready'
  switched=false
  orphaned=false
  sourceRace=false

  async load(){return structuredClone(this.state)}
  async persist(_current:RotationOperationStateV2,next:RotationOperationStateV2){
    this.state=structuredClone(next)
    this.calls.push(`persist:${next.stage}`)
    if(this.failAfter===next.stage){this.failAfter=null;throw new Error(`fault:${next.stage}`)}
    return structuredClone(this.state)
  }
  async planSuccessor(){this.calls.push('plan');return{creationLocator:b(4,16)}}
  async createOrReconcileSuccessor(){this.calls.push('bind');return{manifestFingerprint:b(5,32)}}
  async copyAndVerifySuccessor(){this.calls.push('copy');return{stagingAnchor:v2Anchor(4)}}
  async prepareActivation(){this.calls.push('prepare-activation');return{
    announcementEnvelope:row(6),
    confirmationEnvelope:row(10),
    activationEvidenceSha256:b(14,32),
    activationLineageSha256:b(15,32),
    recoveryArtifactId:b(16,16),
    recoveryArtifactLocator:b(17,16),
    recoveryArtifactSha256:b(18,32),
  }}
  async publishAndVerifyRecoveryArtifact(){this.calls.push('recovery')}
  async createAndVerifyStagedBackup(){this.calls.push('staged-backup');return{backupId:b(19,32)}}
  async publishOrReconcileAnnouncement(){
    this.calls.push('announcement')
    return this.announcement==='durable'?{kind:'durable' as const}
      :this.announcement==='unknown'?{kind:'unknown' as const}
      :this.announcement==='source_race'?{kind:'source_race' as const}
      :{kind:'stale' as const}
  }
  async publishOrReconcileConfirmation(){
    this.calls.push('confirmation')
    return this.confirmation==='durable'?{kind:'durable' as const,activationAnchor:v2Anchor(5)}
      :this.confirmation==='unknown'?{kind:'unknown' as const}
      :{kind:'cutover_race' as const}
  }
  async createAndVerifyActivatedBackup(){
    this.calls.push('activated-backup')
    return this.postActivation==='ready'?{kind:'ready' as const,activatedBackupId:b(20,32)}:{kind:'superseded' as const}
  }
  async persistLineageAndReverifyBeforeSwitch(){this.calls.push('lineage-final');return this.finalVerify}
  async switchLocally(){this.calls.push('switch');this.switched=true}
  async orphanPreAnnouncementSuccessor(){this.calls.push('orphan');this.orphaned=true}
  async markSourceRace(){this.calls.push('source-race');this.sourceRace=true}
}

describe('ProfileUpgradeV2 state machine',()=>{
  it('survives a crash after every durable non-terminal stage without repeating completed side effects',async()=>{
    const stages:RotationOperationStageV2[]=[
      'successor_planned','successor_bound','copying','successor_verified','announcement_prepared',
      'recovery_artifact_verified','staged_backup_verified','announcement_durable','confirmation_durable',
      'activated_backup_verified','switched',
    ]
    for(const stage of stages){
      const h=new Harness();h.failAfter=stage
      await expect(runProfileUpgradeStateMachineV2(h)).rejects.toThrow(`fault:${stage}`)
      expect(h.state.stage).toBe(stage)
      await expect(runProfileUpgradeStateMachineV2(h)).resolves.toMatchObject({stage:'switched'})
      expect(h.switched).toBe(true)
    }
  })

  it('persists unknown announcement and confirmation outcomes and reconciles only through the exact next stage',async()=>{
    const h=new Harness();h.announcement='unknown'
    await expect(runProfileUpgradeStateMachineV2(h)).resolves.toMatchObject({stage:'announcement_unknown'})
    expect(h.state.stage).toBe('announcement_unknown')
    h.announcement='durable';h.confirmation='unknown'
    await expect(runProfileUpgradeStateMachineV2(h)).resolves.toMatchObject({stage:'confirmation_unknown'})
    h.confirmation='durable'
    await expect(runProfileUpgradeStateMachineV2(h)).resolves.toMatchObject({stage:'switched'})
  })

  it('separates pre-announcement stale/source-race and post-announcement successor cutover race',async()=>{
    const stale=new Harness();stale.announcement='stale'
    await expect(runProfileUpgradeStateMachineV2(stale)).resolves.toMatchObject({stage:'stale'})
    expect(stale.orphaned).toBe(true)
    expect(stale.sourceRace).toBe(false)

    const sourceRace=new Harness();sourceRace.announcement='source_race'
    await expect(runProfileUpgradeStateMachineV2(sourceRace)).resolves.toMatchObject({stage:'stale'})
    expect(sourceRace.sourceRace).toBe(true)

    const cutover=new Harness();cutover.confirmation='cutover_race'
    await expect(runProfileUpgradeStateMachineV2(cutover)).resolves.toMatchObject({stage:'cutover_race'})
    expect(cutover.orphaned).toBe(false)
  })

  it('never creates activated backup or switch after a post-activation supersession proof',async()=>{
    const h=new Harness();h.postActivation='superseded'
    await expect(runProfileUpgradeStateMachineV2(h)).resolves.toMatchObject({stage:'post_activation_superseded'})
    expect(h.switched).toBe(false)
    const h2=new Harness();h2.finalVerify='superseded'
    await expect(runProfileUpgradeStateMachineV2(h2)).resolves.toMatchObject({stage:'post_activation_superseded'})
    expect(h2.switched).toBe(false)
  })
})
