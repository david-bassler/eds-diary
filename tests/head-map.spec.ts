import { expect, test } from '@playwright/test'

test('opens front head detail and keeps left and right head regions separate', async ({
  page,
}) => {
  await page.goto('/')

  const frontHeadCheckbox = page
    .locator('.body-map-selector__list fieldset')
    .first()
    .locator('label', { hasText: 'Kopf' })
    .locator('input')
  await frontHeadCheckbox.evaluate((input) => (input as HTMLInputElement).click())

  const selection = page.locator('.body-map-selector__selection')
  await expect(selection).toContainText('Vorne: Kopf')
  await expect(selection).not.toContainText('→')

  const detail = page.getByRole('region', {
    name: 'Kopf Vorderseite genauer auswählen',
  })
  await expect(detail).toBeVisible()
  await expect(detail).toHaveAttribute('data-surface', 'front')
  await expect(detail.locator('.head-detail-selector__image')).toHaveAttribute(
    'src',
    /head-front-hitmap\.png\?v=1$/,
  )

  const detailCanvas = detail.locator('.head-detail-selector__overlay')
  await expect(detailCanvas).toHaveAttribute('data-hit-map-ready', 'true')
  const box = await detailCanvas.boundingBox()
  if (!box) throw new Error('Front head detail canvas is not visible.')

  const points = [
    { x: 708, y: 560, label: 'Linkes Auge' },
    { x: 375, y: 560, label: 'Rechtes Auge' },
    { x: 906, y: 614, label: 'Linkes Ohr' },
    { x: 178, y: 615, label: 'Rechtes Ohr' },
    { x: 843, y: 658, label: 'Linkes Kiefergelenk (TMJ)' },
    { x: 242, y: 660, label: 'Rechtes Kiefergelenk (TMJ)' },
  ]

  for (const point of points) {
    await detailCanvas.click({
      position: {
        x: box.width * (point.x / 1086),
        y: box.height * (point.y / 1448),
      },
    })
    await expect(selection).toContainText(point.label)
  }

  await expect(selection).toContainText('Linkes Auge')
  await expect(selection).toContainText('Rechtes Auge')
  await expect(selection).toContainText('Linkes Kiefergelenk (TMJ)')
  await expect(selection).toContainText('Rechtes Kiefergelenk (TMJ)')
})

test('opens back head detail and keeps neck separate from both ears', async ({
  page,
}) => {
  await page.goto('/')

  const backHeadCheckbox = page
    .locator('.body-map-selector__list fieldset')
    .nth(1)
    .locator('label', { hasText: 'Hinterkopf' })
    .locator('input')
  await backHeadCheckbox.evaluate((input) => (input as HTMLInputElement).click())

  const detail = page.getByRole('region', {
    name: 'Kopf Rückseite genauer auswählen',
  })
  await expect(detail).toBeVisible()
  await expect(detail).toHaveAttribute('data-surface', 'back')
  await expect(detail.locator('.head-detail-selector__image')).toHaveAttribute(
    'src',
    /head-back-hitmap\.png\?v=1$/,
  )

  const detailCanvas = detail.locator('.head-detail-selector__overlay')
  await expect(detailCanvas).toHaveAttribute('data-hit-map-ready', 'true')
  const box = await detailCanvas.boundingBox()
  if (!box) throw new Error('Back head detail canvas is not visible.')

  for (const point of [
    { x: 185, y: 596, label: 'Linkes Ohr' },
    { x: 900, y: 595, label: 'Rechtes Ohr' },
    { x: 540, y: 1050, label: 'Nacken' },
    { x: 812, y: 455, label: 'Rechter seitlicher Hinterkopf' },
  ]) {
    await detailCanvas.click({
      position: {
        x: box.width * (point.x / 1122),
        y: box.height * (point.y / 1402),
      },
    })
    await expect(page.locator('.body-map-selector__selection')).toContainText(
      point.label,
    )
  }
})
