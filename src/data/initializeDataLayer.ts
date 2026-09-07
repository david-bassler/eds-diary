import { initializeMedicationSync } from '../features/medication/medicationSync'
import { initializePainSync } from '../features/pain/painSync'
import { initializeSyncManager } from './syncManager'

let initialized = false

export function initializeDataLayer(): void {
  if (initialized) return
  initialized = true

  initializePainSync()
  initializeMedicationSync()
  initializeSyncManager()
}
