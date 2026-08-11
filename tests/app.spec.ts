import { expect, test } from '@playwright/test'

test('shows the project welcome screen', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Dein neues React-Projekt ist bereit.' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /Storybook ansehen/i })).toBeVisible()
})
