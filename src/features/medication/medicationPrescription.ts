export type MedicationPrescriptionStatus = 'active' | 'deleted'

export interface MedicationPrescription {
  id: string
  medicationName: string
  prescribedOn: string
  prescriber: string
  reason: string
  status: MedicationPrescriptionStatus
  createdAt: string
  updatedAt: string
}

export interface NewMedicationPrescription {
  medicationName: string
  prescribedOn: string
  prescriber?: string
  reason?: string
}
