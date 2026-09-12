import { expect, test } from '@playwright/test'

test('selects front knee detail regions from the normalized hit map', async ({
  page,
}) => {
  await page.goto('/')

  const bodyCanvas = page.locator(
    'section[aria-label="Vorderseite"] canvas.body-map-selector__overlay',
  )
  await expect(bodyCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const bodyBox = await bodyCanvas.boundingBox()
  if (!bodyBox) throw new Error('Front body-map canvas is not visible.')

  await bodyCanvas.click({
    position: {
      x: bodyBox.width * (214 / 512),
      y: bodyBox.height * (509 / 768),
    },
  })

  const detail = page.getByRole('region', {
    name: 'Rechtes Knie genauer auswählen',
  })
  await expect(detail).toBeVisible()
  await expect(detail.locator('.knee-detail-selector__artwork')).toHaveAttribute(
    'data-mirrored',
    'false',
  )

  const detailCanvas = detail.locator('.knee-detail-selector__overlay')
  await expect(detailCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const detailBox = await detailCanvas.boundingBox()
  if (!detailBox) throw new Error('Knee detail canvas is not visible.')

  await detailCanvas.click({
    position: {
      x: detailBox.width * (370 / 746),
      y: detailBox.height * (333 / 870),
    },
  })

  await expect(page.locator('.body-map-selector__selection')).toContainText(
    'Kniescheibe',
  )
})

test('mirrors the right-knee asset for the anatomical left knee', async ({
  page,
}) => {
  await page.goto('/')

  const bodyCanvas = page.locator(
    'section[aria-label="Vorderseite"] canvas.body-map-selector__overlay',
  )
  await expect(bodyCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const bodyBox = await bodyCanvas.boundingBox()
  if (!bodyBox) throw new Error('Front body-map canvas is not visible.')

  await bodyCanvas.click({
    position: {
      x: bodyBox.width * (298 / 512),
      y: bodyBox.height * (509 / 768),
    },
  })

  const detail = page.getByRole('region', {
    name: 'Linkes Knie genauer auswählen',
  })
  await expect(detail).toBeVisible()
  await expect(detail.locator('.knee-detail-selector__artwork')).toHaveAttribute(
    'data-mirrored',
    'true',
  )
})
