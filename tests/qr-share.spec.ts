import { expect, test } from '@playwright/test'

test('shows the current page URL as a QR code', async ({ page }) => {
  await page.route(
    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.QRCode = class QRCode {
            static CorrectLevel = { M: 0 }

            constructor(target) {
              const canvas = document.createElement('canvas')
              canvas.setAttribute('data-testid', 'rendered-qr-code')
              target.appendChild(canvas)
            }
          }
        `,
      })
    },
  )

  await page.goto('/aktivitaeten')

  await page
    .getByRole('button', { name: 'Aktuelle URL als QR-Code anzeigen' })
    .click()

  const dialog = page.getByRole('dialog', { name: 'QR-Code' })

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(page.url(), { exact: true })).toBeVisible()
  await expect(dialog.locator('[data-testid="rendered-qr-code"]')).toBeVisible()

  await dialog.getByRole('button', { name: 'Schließen' }).click()
  await expect(dialog).not.toBeVisible()
})
