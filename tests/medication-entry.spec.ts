import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('button', { name: 'Medikamente' })
    .click()
})

test('stores a medication intake with current date and time defaults', async ({
  page,
}) => {
  await expect(page.getByLabel('Datum')).not.toHaveValue('')
  await expect(page.getByLabel('Uhrzeit')).not.toHaveValue('')

  await page.getByLabel('Medikament').fill('Testmedikament')
  await page.getByLabel('Dosis').fill('10 mg')
  await page.getByRole('button', { name: 'Einnahme speichern' }).click()

  await expect(
    page.getByText('Medikamenteneinnahme gespeichert.'),
  ).toBeVisible()

  const entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/medication/medicationRepository.ts'
    )
    return repository.listMedicationEntries()
  })

  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    medicationName: 'Testmedikament',
    dose: '10 mg',
    status: 'active',
  })
  expect(Number.isNaN(Date.parse(entries[0].takenAt))).toBe(false)
})

test('uses previously entered medication names as suggestions', async ({
  page,
}) => {
  await page.getByLabel('Medikament').fill('Eigenes Testpräparat')
  await page.getByLabel('Dosis').fill('1 Tablette')
  await page.getByRole('button', { name: 'Einnahme speichern' }).click()

  await expect(
    page.locator(
      'datalist#medication-name-options option[value="Eigenes Testpräparat"]',
    ),
  ).toHaveCount(1)

  await page.reload()
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('button', { name: 'Medikamente' })
    .click()

  await expect(
    page.locator(
      'datalist#medication-name-options option[value="Eigenes Testpräparat"]',
    ),
  ).toHaveCount(1)
})

test('stores medication prescription details', async ({ page }) => {
  const section = page.locator(
    'section[aria-labelledby="medication-prescription-form-title"]',
  )

  await expect(section.getByLabel('Datum der Verordnung')).not.toHaveValue('')
  await section.getByLabel('Medikament').fill('Verordnungs-Testmedikament')
  await section
    .getByLabel('Verschrieben von (optional)')
    .fill('Synthetische Testpraxis')
  await section
    .getByLabel('Grund / Anlass (optional)')
    .fill('synthetischer Verordnungsgrund')
  await section.getByRole('button', { name: 'Verordnung speichern' }).click()

  await expect(
    section.getByText('Medikamentenverordnung gespeichert.'),
  ).toBeVisible()

  const prescriptions = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/medication/medicationPrescriptionRepository.ts'
    )
    return repository.listMedicationPrescriptions()
  })

  expect(prescriptions).toHaveLength(1)
  expect(prescriptions[0]).toMatchObject({
    medicationName: 'Verordnungs-Testmedikament',
    prescriber: 'Synthetische Testpraxis',
    reason: 'synthetischer Verordnungsgrund',
    status: 'active',
  })
})
