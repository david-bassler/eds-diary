import { expect, test } from '@playwright/test'

test('shows the existing time range picker on the activity page', async ({
  page,
}) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('button', { name: 'Aktivitäten' })
    .click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Aktivitätszeitraum' }),
  ).toBeVisible()
  await expect(page.getByTestId('time-range-surface')).toBeVisible()
  await expect(page.getByLabel('Beginn anpassen')).toHaveValue('540')
  await expect(page.getByLabel('Ende anpassen')).toHaveValue('600')
})
