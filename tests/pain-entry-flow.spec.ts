import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('creates a pain entry with multiple body regions and details', async ({
  page,
}) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()

  await page
    .getByRole('checkbox', { name: 'Linkes Knie', exact: true })
    .check()
  await page
    .getByRole('checkbox', { name: 'Unterer Rücken', exact: true })
    .check()

  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.getByRole('button', { name: 'Stechend' }).click()
  await page.getByLabel('Mögliche Ursache (optional)').fill('synthetische Ursache')
  await page.getByLabel('Tritt auf, wenn (optional)').fill('synthetischer Auslöser')
  await page.getByLabel('Notizen (optional)').fill('synthetische Notiz')

  await expect(page.getByLabel('Datum')).not.toHaveValue('')
  await expect(page.getByLabel('Uhrzeit')).not.toHaveValue('')

  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Schmerzeintrag gespeichert.')).toBeVisible()

  const entries = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return repository.listPainEntries()
  })

  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    locations: [
      { view: 'front', regionId: 'left-knee' },
      { view: 'back', regionId: 'lower-back' },
    ],
    qualities: ['Stechend'],
    cause: 'synthetische Ursache',
    occursWhen: 'synthetischer Auslöser',
    note: 'synthetische Notiz',
  })
})

test('adds and keeps a custom pain type chip', async ({ page }) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.getByLabel('Eigene Schmerzart').fill('Bohrend')
  await page.getByRole('button', { name: 'Hinzufügen' }).click()

  await expect(
    page.getByRole('button', { name: 'Bohrend' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(page.getByRole('button', { name: 'Bohrend' })).toBeVisible()
})
