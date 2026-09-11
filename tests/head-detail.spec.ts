import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('stores multiple head detail regions with the coarse head location', async ({
  page,
}) => {
  const frontHeadCheckbox = page
    .locator('.body-map-selector__list fieldset')
    .first()
    .locator('label', { hasText: 'Kopf' })
    .locator('input')
  await frontHeadCheckbox.evaluate((input) => (input as HTMLInputElement).click())

  const detail = page.getByRole('region', {
    name: 'Kopf Vorderseite genauer auswählen',
  })
  const canvas = detail.locator('.head-detail-selector__overlay')
  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')

  const box = await canvas.boundingBox()
  if (!box) throw new Error('Front head detail canvas is not visible.')

  for (const point of [
    { x: 708, y: 560 },
    { x: 843, y: 658 },
  ]) {
    await canvas.click({
      position: {
        x: box.width * (point.x / 1086),
        y: box.height * (point.y / 1448),
      },
    })
  }

  const selection = page.locator('.body-map-selector__selection')
  await expect(selection).toContainText('Vorne: Kopf')
  await expect(selection).toContainText('Linkes Auge')
  await expect(selection).toContainText('Linkes Kiefergelenk (TMJ)')

  await detail.getByRole('button', { name: 'Fertig' }).click()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page
    .getByRole('slider', { name: 'Schmerzstärke von 0 bis 10' })
    .fill('5')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Dumpf' }).click()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Schmerzeintrag gespeichert.')).toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })

  expect(entry.locations).toEqual([
    {
      view: 'front',
      regionId: 'head',
      detailRegionIds: ['left-eye', 'left-tmj'],
    },
  ])
})

test('keeps head locations without detail data compatible', async ({ page }) => {
  const label = await page.evaluate(async () => {
    const bodyMap = await import(
      '/src/features/pain/bodyMap/BodyMapSelector.tsx'
    )
    return bodyMap.painLocationLabel({ view: 'front', regionId: 'head' })
  })

  expect(label).toBe('Vorne: Kopf')
})
