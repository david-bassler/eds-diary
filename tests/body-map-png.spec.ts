import { expect, test } from '@playwright/test'

test('selects a pain region through the PNG hit map', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator(
    'section[aria-label="Vorderseite"] canvas.body-map-selector__overlay',
  )
  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')

  const box = await canvas.boundingBox()
  if (!box) throw new Error('Body-map canvas is not visible.')

  const kneePosition = {
    x: box.width * (298 / 512),
    y: box.height * (509 / 768),
  }

  await canvas.click({ position: kneePosition })
  await expect(page.locator('.body-map-selector__selection')).toContainText(
    'Vorne: Linkes Knie',
  )

  await canvas.click({ position: kneePosition })
  await expect(page.locator('.body-map-selector__selection')).toContainText(
    'Noch keine Region ausgewählt',
  )
})
