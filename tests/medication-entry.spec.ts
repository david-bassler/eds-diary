import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Medikamente' })
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
    .getByRole('link', { name: 'Medikamente' })
    .click()

  await expect(
    page.locator(
      'datalist#medication-name-options option[value="Eigenes Testpräparat"]',
    ),
  ).toHaveCount(1)
})

test('copies selected medication intakes from the previous day', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-08')

  await page.evaluate(async () => {
    const repository = await import(
      '/src/features/medication/medicationRepository.ts'
    )
    await repository.createMedicationEntries([
      {
        medicationName: 'Testmittel morgens',
        dose: '10 mg',
        takenAt: new Date('2026-09-07T08:00:00').toISOString(),
      },
      {
        medicationName: 'Testmittel abends',
        dose: '20 mg',
        takenAt: new Date('2026-09-07T20:00:00').toISOString(),
      },
    ])
  })

  await page.getByRole('button', { name: 'Tag kopieren' }).click()

  const dialog = page.getByRole('dialog', { name: 'Tag kopieren' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Einträge von')).toHaveValue('2026-09-07')
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog.getByRole('checkbox').nth(0)).toBeChecked()
  await expect(dialog.getByRole('checkbox').nth(1)).toBeChecked()

  await dialog.getByRole('checkbox').nth(1).uncheck()
  await dialog.getByRole('button', { name: 'OK' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByText('1 Einnahme wurde auf den aktuellen Tag übernommen.'),
  ).toBeVisible()

  const copied = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/medication/medicationRepository.ts'
    )
    return (await repository.listMedicationEntries()).filter((entry) => {
      const takenAt = new Date(entry.takenAt)
      const localDate = [
        takenAt.getFullYear(),
        String(takenAt.getMonth() + 1).padStart(2, '0'),
        String(takenAt.getDate()).padStart(2, '0'),
      ].join('-')
      return localDate === '2026-09-08'
    })
  })

  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatchObject({
    medicationName: 'Testmittel morgens',
    dose: '10 mg',
  })
  expect(new Date(copied[0].takenAt).getHours()).toBe(8)
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
