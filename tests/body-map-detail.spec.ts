import { expect, test, type Page } from '@playwright/test'

async function clickBodyRegion(
  page: Page,
  view: 'front' | 'back',
  xRatio: number,
  yRatio: number,
): Promise<void> {
  if (view === 'back') {
    const backTab = page.getByRole('button', { name: 'Hinten' })
    if (await backTab.isVisible()) await backTab.click()
  }

  const regionName = view === 'front' ? 'Vorderseite' : 'Rückseite'
  const canvas = page
    .getByRole('region', { name: regionName })
    .locator('.body-map-selector__overlay')

  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error(`${regionName} ist nicht sichtbar.`)

  await page.mouse.click(
    bounds.x + bounds.width * xRatio,
    bounds.y + bounds.height * yRatio,
  )
}

test('selects the detailed wrist and SI body-map regions', async ({ page }) => {
  await page.goto('/')

  await clickBodyRegion(page, 'front', 395 / 512, 422 / 768)
  await expect(page.getByText(/Vorne: Linkes Handgelenk/)).toBeVisible()

  await clickBodyRegion(page, 'back', 256 / 512, 392 / 768)
  await expect(page.getByText(/Hinten: Kreuzbein \/ SI-Bereich/)).toBeVisible()
  await expect(page.getByText('2 Regionen ausgewählt')).toBeVisible()
})
