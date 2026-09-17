import { base64Url } from './crypto/bytes'
import { canonicalBytes } from './crypto/canonical'
import { sha256 } from './crypto/core'

export const ROTATION_STEPS=['prepared','root_wrap_verified','source_frozen_verified','recovery_secret_verified','successor_planned','successor_bound','copying','successor_verified','recovery_verified','backup_verified','announcement_pending','announcement_durable','switched']as const
export type RotationStep=typeof ROTATION_STEPS[number]
export interface RotationState {rotationId:string;oldEpochId:string;newEpochId:string;step:RotationStep;copiedEnvelopeIds:string[];sourceAnchor?:unknown}
export interface RotationPersistence {read():Promise<RotationState|null>;write(state:RotationState,hash:string):Promise<void>;readBack():Promise<{state:RotationState;hash:string}>}
export async function rotationStateHash(state:RotationState):Promise<string>{return base64Url(await sha256(canonicalBytes(state as never)))}
export function advanceRotation(state:RotationState,next:RotationStep):RotationState {if(ROTATION_STEPS.indexOf(next)!==ROTATION_STEPS.indexOf(state.step)+1)throw new Error('Rotation steps must be persisted in order.');return{...state,step:next}}
export async function persistRotationStep(store:RotationPersistence,state:RotationState,next:RotationStep):Promise<RotationState>{const advanced=advanceRotation(state,next),hash=await rotationStateHash(advanced);await store.write(advanced,hash);const read=await store.readBack();if(read.hash!==hash||await rotationStateHash(read.state)!==hash)throw new Error('Rotation state readback failed.');return advanced}
export function maySwitchRotation(state:RotationState):boolean{return state.step==='announcement_durable'}
/** Mutations freeze before the final source snapshot and stay frozen across crashes. */
export function oldEpochWritable(state:RotationState|null):boolean{return state===null||state.step==='prepared'||state.step==='root_wrap_verified'}
export function mayAbortRotation(state:RotationState):boolean{return ROTATION_STEPS.indexOf(state.step)<ROTATION_STEPS.indexOf('announcement_durable')}

export interface RotationArtifacts {
  sourceAnchor?:unknown;sourceSemanticSnapshot?:string;sourceLineageSnapshot?:string
  successorSemanticSnapshot?:string;recoveryArtifactId?:string;backupId?:string
}
export interface ProductiveRotationState extends RotationState,RotationArtifacts {}
export interface RotationOrchestratorDependencies {
  persistence:RotationPersistence
  /** Pulls and fully verifies the source, or verifies the immutable local source
   * for an explicit local-offline remote-enablement migration. */
  verifyAndFreezeSource(state:ProductiveRotationState):Promise<{anchor:unknown;semanticSnapshot:string;lineageSnapshot:string}>
  createAndVerifyRootWrap(state:ProductiveRotationState):Promise<void>
  verifyRecoverySecret(state:ProductiveRotationState):Promise<void>
  planSuccessor(state:ProductiveRotationState):Promise<void>
  createOrReconcileSuccessor(state:ProductiveRotationState):Promise<void>
  copySemanticHeadsAndMigration(state:ProductiveRotationState):Promise<void>
  fullVerifySuccessor(state:ProductiveRotationState):Promise<{semanticSnapshot:string}>
  createAndBootstrapRecovery(state:ProductiveRotationState):Promise<string>
  createAndTestRestoreBackup(state:ProductiveRotationState):Promise<string>
  prepareAnnouncementEnvelope(state:ProductiveRotationState):Promise<void>
  appendReadbackAndFullVerifyAnnouncement(state:ProductiveRotationState):Promise<void>
  atomicSwitchAndRetireSource(state:ProductiveRotationState):Promise<void>
}

async function saveNext(deps:RotationOrchestratorDependencies,state:ProductiveRotationState,next:RotationStep,extra:Partial<ProductiveRotationState>={}):Promise<ProductiveRotationState>{const updated={...state,...extra};return persistRotationStep(deps.persistence,updated,next) as Promise<ProductiveRotationState>}

/** End-to-end resumable rotation/migration. Side-effecting dependency operations
 * reconcile/read back their outcome and are called again after a crash. */
export async function runRotation(deps:RotationOrchestratorDependencies,initial:ProductiveRotationState):Promise<ProductiveRotationState>{
  let state=await deps.persistence.read() as ProductiveRotationState|null
  if(!state){if(initial.step!=='prepared'||!initial.rotationId||!initial.oldEpochId||!initial.newEpochId||initial.oldEpochId===initial.newEpochId)throw new Error('Invalid initial rotation state.');const hash=await rotationStateHash(initial);await deps.persistence.write(initial,hash);const read=await deps.persistence.readBack();if(read.hash!==hash||await rotationStateHash(read.state)!==hash)throw new Error('Initial rotation state readback failed.');state=initial}
  if(state.step==='prepared'){await deps.createAndVerifyRootWrap(state);state=await saveNext(deps,state,'root_wrap_verified')}
  if(state.step==='root_wrap_verified'){
    state=await saveNext(deps,state,'source_frozen_verified')
    const source=await deps.verifyAndFreezeSource(state)
    state={...state,sourceAnchor:source.anchor,sourceSemanticSnapshot:source.semanticSnapshot,sourceLineageSnapshot:source.lineageSnapshot}
    const hash=await rotationStateHash(state);await deps.persistence.write(state,hash);const read=await deps.persistence.readBack();if(read.hash!==hash||await rotationStateHash(read.state)!==hash)throw new Error('Frozen source snapshot readback failed.')
  }
  const hasSourceAnchor=Object.prototype.hasOwnProperty.call(state,'sourceAnchor')
  if(state.step==='source_frozen_verified'&&(!hasSourceAnchor||!state.sourceSemanticSnapshot||!state.sourceLineageSnapshot)){
    const source=await deps.verifyAndFreezeSource(state);state={...state,sourceAnchor:source.anchor,sourceSemanticSnapshot:source.semanticSnapshot,sourceLineageSnapshot:source.lineageSnapshot}
    const hash=await rotationStateHash(state);await deps.persistence.write(state,hash);const read=await deps.persistence.readBack();if(read.hash!==hash||await rotationStateHash(read.state)!==hash)throw new Error('Frozen source snapshot readback failed.')
  }
  if(state.step==='source_frozen_verified'){await deps.verifyRecoverySecret(state);state=await saveNext(deps,state,'recovery_secret_verified')}
  if(state.step==='recovery_secret_verified'){await deps.planSuccessor(state);state=await saveNext(deps,state,'successor_planned')}
  if(state.step==='successor_planned'){await deps.createOrReconcileSuccessor(state);state=await saveNext(deps,state,'successor_bound')}
  if(state.step==='successor_bound')state=await saveNext(deps,state,'copying')
  if(state.step==='copying'){await deps.copySemanticHeadsAndMigration(state);const verified=await deps.fullVerifySuccessor(state);if(verified.semanticSnapshot!==state.sourceSemanticSnapshot)throw new Error('Migration changed the semantic snapshot.');state=await saveNext(deps,state,'successor_verified',{successorSemanticSnapshot:verified.semanticSnapshot})}
  if(state.step==='successor_verified'){state=await saveNext(deps,state,'recovery_verified',{recoveryArtifactId:await deps.createAndBootstrapRecovery(state)})}
  if(state.step==='recovery_verified'){state=await saveNext(deps,state,'backup_verified',{backupId:await deps.createAndTestRestoreBackup(state)})}
  if(state.step==='backup_verified'){await deps.prepareAnnouncementEnvelope(state);state=await saveNext(deps,state,'announcement_pending')}
  if(state.step==='announcement_pending'){await deps.appendReadbackAndFullVerifyAnnouncement(state);state=await saveNext(deps,state,'announcement_durable')}
  if(state.step==='announcement_durable'){await deps.fullVerifySuccessor(state);await deps.atomicSwitchAndRetireSource(state);state=await saveNext(deps,state,'switched')}
  return state
}

export interface EpochMigrationData {migration_id:string;migration_kind:'normal'|'local_rotation'|'remote_enablement'|'emergency';source:{source_epoch_id:string;source_manifest_fingerprint:string;source_anchor:unknown;source_lineage_snapshot_hash:string;source_semantic_snapshot_hash:string};result_semantic_snapshot_hash:string;active_head_count:number;tombstone_head_count:number}
export function createEpochMigrationData(data:EpochMigrationData):EpochMigrationData{if((data.migration_kind==='normal'||data.migration_kind==='remote_enablement'||data.migration_kind==='local_rotation')&&data.result_semantic_snapshot_hash!==data.source.source_semantic_snapshot_hash)throw new Error('Unchanged migration cannot change semantics.');if(!Number.isSafeInteger(data.active_head_count)||data.active_head_count<0||!Number.isSafeInteger(data.tombstone_head_count)||data.tombstone_head_count<0)throw new Error('Invalid migration head counts.');return structuredClone(data)}
