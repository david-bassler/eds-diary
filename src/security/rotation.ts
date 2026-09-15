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
