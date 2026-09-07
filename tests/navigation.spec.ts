import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('shows the four primary app sections in a fixed bottom navigation', async ({
  page,
}) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })

  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('link')).toHaveCount(4)

  for (const name of [
    'Schmerzen',
    'Medikamente',
    'Aktivitäten',
    'Konfiguration',
  ]) {
    await expect(
      navigation.getByRole('link', { name }),
    ).toBeVisible()
  }

  await expect(
    navigation.getByRole('link', { name: 'Schmerzen' }),
  ).toHaveAttribute('aria-current', 'page')
})

test('switches between the primary app sections', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })

  await navigation.getByRole('link', { name: 'Medikamente' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Medikamente' }),
  ).toBeVisible()

  await navigation.getByRole('link', { name: 'Aktivitäten' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()

  await navigation.getByRole('link', { name: 'Konfiguration' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Konfiguration' }),
  ).toBeVisible()
  await expect(page.getByText('Datenspeicherung', { exact: true })).toBeVisible()

  await expect(
    navigation.getByRole('link', { name: 'Konfiguration' }),
  ).toHaveAttribute('aria-current', 'page')
})


test('uses browser history for primary navigation', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })

  await expect(page).toHaveURL(/\/schmerzen$/)

  await navigation.getByRole('link', { name: 'Medikamente' }).click()
  await expect(page).toHaveURL(/\/medikamente$/)

  await navigation.getByRole('link', { name: 'Aktivitäten' }).click()
  await expect(page).toHaveURL(/\/aktivitaeten$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/medikamente$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Medikamente' }),
  ).toBeVisible()

  await page.goForward()
  await expect(page).toHaveURL(/\/aktivitaeten$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()
})

test('opens a section directly from its route', async ({ page }) => {
  await page.goto('/aktivitaeten')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Aktivitäten' }),
  ).toHaveAttribute('aria-current', 'page')
})
