import { expect, test } from '@playwright/test'

test('keeps activity explanations behind the help button', async ({ page }) => {
  await page.goto('/aktivitaeten')

  await expect(
    page.getByText('Aktivitäten und Belastungen werden hier dokumentiert.'),
  ).toHaveCount(0)
  await expect(page.getByText('Zeiträume der Aktivität')).not.toBeVisible()
  await expect(page.getByText(/Mit der Maus ziehst du senkrecht/)).not.toBeVisible()
  await expect(
    page.getByText('Änderungen werden automatisch gespeichert.'),
  ).not.toBeVisible()

  await page.getByRole('button', { name: 'Hilfe zu Aktivitäten' }).click()

  const dialog = page.getByRole('dialog', { name: 'Aktivitäten – Hilfe' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Auf dem Handy scrollt direktes Wischen/)).toBeVisible()
  await expect(dialog.getByText(/rechte Hälfte eines vorhandenen Zeitraums/)).toBeVisible()
  await expect(dialog.getByText(/Änderungen werden automatisch gespeichert/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Hilfe schließen' }).click()
  await expect(dialog).not.toBeVisible()
})
