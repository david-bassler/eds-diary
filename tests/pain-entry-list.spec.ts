import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('lists, filters, ends, edits and deletes pain entries', async ({ page }) => {
  await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    const completedStart = new Date()
    completedStart.setDate(completedStart.getDate() - 1)
    completedStart.setHours(8, 0, 0, 0)
    const completedEnd = new Date(completedStart.getTime() + 2 * 60 * 60 * 1000)

    await repository.createPainEntry({
      startedAt: completedStart.toISOString(),
      endedAt: completedEnd.toISOString(),
      locations: [{ view: 'front', regionId: 'abdomen' }],
      intensity: 4,
      qualities: ['Dumpf'],
      note: 'synthetischer abgeschlossener Schmerz',
    })

    await repository.createPainEntry({
      startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      locations: [{ view: 'back', regionId: 'lower-back' }],
      intensity: 7,
      qualities: ['Ziehend'],
      note: 'synthetischer aktiver Schmerz',
    })
  })

  await page.getByRole('button', { name: 'Übersicht' }).click()

  await expect(page.getByText('synthetischer aktiver Schmerz')).toBeVisible()
  await expect(page.getByText('synthetischer abgeschlossener Schmerz')).toBeVisible()
  await expect(page.getByText('Hinten: Unterer Rücken')).toBeVisible()
  await expect(page.getByText('7/10')).toBeVisible()

  await page.getByRole('button', { name: 'Aktiv' }).click()
  await expect(page.getByText('synthetischer aktiver Schmerz')).toBeVisible()
  await expect(page.getByText('synthetischer abgeschlossener Schmerz')).toHaveCount(0)

  const activeEntry = page.locator(".pain-entry-list__entry[data-active='true']")
  await activeEntry.locator('summary').click()
  await activeEntry.getByRole('button', { name: 'Jetzt beenden' }).click()
  await expect(page.getByText('Für diesen Filter gibt es keine Schmerzeinträge.')).toBeVisible()

  await page.getByRole('button', { name: 'Alle' }).click()
  const completedEntry = page
    .locator('.pain-entry-list__entry')
    .filter({ hasText: 'synthetischer abgeschlossener Schmerz' })
  await completedEntry.locator('summary').click()
  await completedEntry.getByRole('button', { name: 'Bearbeiten' }).click()

  await expect(page.getByText('Schmerzeintrag bearbeiten')).toBeVisible()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByLabel('Notizen (optional)').fill('synthetisch bearbeitet')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()

  await expect(page.getByText('synthetisch bearbeitet')).toBeVisible()

  const editedEntry = page
    .locator('.pain-entry-list__entry')
    .filter({ hasText: 'synthetisch bearbeitet' })
  await editedEntry.locator('summary').click()
  page.once('dialog', (dialog) => void dialog.accept())
  await editedEntry.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByText('synthetisch bearbeitet')).toHaveCount(0)
})
