export type RotationStep = 'prepared' | 'root_wrapped' | 'successor_pending' | 'successor_bound' | 'copying' | 'successor_verified' | 'recovery_verified' | 'backup_restored' | 'announcement_durable' | 'switched'
const ORDER: RotationStep[] = ['prepared', 'root_wrapped', 'successor_pending', 'successor_bound', 'copying', 'successor_verified', 'recovery_verified', 'backup_restored', 'announcement_durable', 'switched']
export interface RotationState { rotationId: string; oldEpochId: string; newEpochId: string; step: RotationStep; copiedEnvelopeIds: string[] }
export function advanceRotation(state: RotationState, next: RotationStep): RotationState {
  const currentIndex = ORDER.indexOf(state.step); const nextIndex = ORDER.indexOf(next)
  if (nextIndex !== currentIndex + 1) throw new Error('Rotation steps must be persisted in order.')
  return { ...state, step: next }
}
export function maySwitchRotation(state: RotationState): boolean { return state.step === 'announcement_durable' }
export function oldEpochWritable(state: RotationState | null): boolean { return state?.step !== 'announcement_durable' && state?.step !== 'switched' }
