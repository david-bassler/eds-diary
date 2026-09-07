import { MedicationEntryForm } from './MedicationEntryForm'
import { MedicationPrescriptionForm } from './MedicationPrescriptionForm'
import './MedicationPage.css'

export function MedicationPage() {
  return (
    <div className="medication-page">
      <MedicationEntryForm />
      <MedicationPrescriptionForm />
    </div>
  )
}
