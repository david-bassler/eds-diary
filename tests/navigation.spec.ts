import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('shows the four primary app sections in a fixed bottom navigation', async ({
  page,
}) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })

  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('button')).toHaveCount(4)

  for (const name of [
    'Schmerzen',
    'Medikamente',
    'Aktivitäten',
    'Konfiguration',
  ]) {
    await expect(
      navigation.getByRole('button', { name }),
    ).toBeVisible()
  }

  await expect(
    navigation.getByRole('button', { name: 'Schmerzen' }),
  ).toHaveAttribute('aria-current', 'page')
})

test('switches between the primary app sections', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })

  await navigation.getByRole('button', { name: 'Medikamente' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Medikamente' }),
  ).toBeVisible()

  await navigation.getByRole('button', { name: 'Aktivitäten' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()

  await navigation.getByRole('button', { name: 'Konfiguration' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Konfiguration' }),
  ).toBeVisible()
  await expect(page.getByText('Datenspeicherung', { exact: true })).toBeVisible()

  await expect(
    navigation.getByRole('button', { name: 'Konfiguration' }),
  ).toHaveAttribute('aria-current', 'page')
})
