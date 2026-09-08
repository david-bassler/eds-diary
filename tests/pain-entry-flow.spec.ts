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

  await expect(page.getByLabel('Beginndatum')).not.toHaveValue('')
  await expect(page.getByLabel('Beginnzeit')).not.toHaveValue('')

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

test('stores an optional explicit pain end time', async ({ page }) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Dumpf' }).click()

  await page.getByLabel('Beginndatum').fill('2026-09-08')
  await page.getByLabel('Beginnzeit').fill('08:00')
  await page.getByRole('checkbox', { name: 'Endzeitpunkt angeben' }).check()
  await page.getByLabel('Enddatum').fill('2026-09-08')
  await page.getByLabel('Endzeit').fill('10:30')

  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Schmerzeintrag gespeichert.')).toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })

  expect(entry.startedAt).toBe(new Date('2026-09-08T08:00').toISOString())
  expect(entry.endedAt).toBe(new Date('2026-09-08T10:30').toISOString())
})

test('asks about an ongoing pain entry older than one hour on app open', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    await repository.createPainEntry({
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      locations: [{ view: 'front', regionId: 'abdomen' }],
      qualities: ['Dumpf'],
      note: 'synthetischer offener Schmerz',
    })
  })

  await page.reload()

  const dialog = page.getByRole('dialog', {
    name: 'Sind diese Schmerzen noch aktuell?',
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Dumpf')).toBeVisible()

  await dialog.getByRole('button', { name: 'Nein, beendet' }).click()
  await expect(dialog.getByLabel('Enddatum')).not.toHaveValue('')
  await expect(dialog.getByLabel('Endzeit')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Ende speichern' }).click()

  await expect(dialog).not.toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })
  expect(entry.endedAt).not.toBe('')

  await page.reload()
  await expect(dialog).not.toBeVisible()
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
