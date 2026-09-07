export type MedicationEntryStatus = 'active' | 'deleted'

export interface MedicationEntry {
  id: string
  medicationName: string
  dose: string
  takenAt: string
  status: MedicationEntryStatus
  createdAt: string
  updatedAt: string
}

export interface NewMedicationEntry {
  medicationName: string
  dose: string
  takenAt?: string
}
