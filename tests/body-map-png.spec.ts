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

test('opens the hand detail hit map and selects a finger joint', async ({
  page,
}) => {
  await page.goto('/')

  const canvas = page.locator(
    'section[aria-label="Rückseite"] canvas.body-map-selector__overlay',
  )
  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')

  const box = await canvas.boundingBox()
  if (!box) throw new Error('Back body-map canvas is not visible.')

  await canvas.click({
    position: {
      x: box.width * (106 / 512),
      y: box.height * (378 / 768),
    },
  })

  const detail = page.getByRole('region', {
    name: 'Linke Hand genauer auswählen',
  })
  await expect(detail).toBeVisible()

  const detailCanvas = detail.locator('.hand-detail-selector__overlay')
  await expect(detailCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const detailBox = await detailCanvas.boundingBox()
  if (!detailBox) throw new Error('Hand detail canvas is not visible.')

  await detailCanvas.click({
    position: {
      x: detailBox.width * (203 / 560),
      y: detailBox.height * (215 / 1028),
    },
  })

  await expect(page.locator('.body-map-selector__selection')).toContainText(
    'Hinten: Linke Hand → Zeigefinger: Mittelgelenk',
  )
})

test('uses palm detail in front view and dorsal detail in back view', async ({
  page,
}) => {
  await page.goto('/')

  const frontCanvas = page.locator(
    'section[aria-label="Vorderseite"] canvas.body-map-selector__overlay',
  )
  await expect(frontCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const frontBox = await frontCanvas.boundingBox()
  if (!frontBox) throw new Error('Front body-map canvas is not visible.')

  await frontCanvas.click({
    position: {
      x: frontBox.width * (398 / 512),
      y: frontBox.height * (458 / 768),
    },
  })

  const detail = page.locator('.hand-detail-selector')
  await expect(detail).toHaveAttribute('data-surface', 'front')
  await expect(detail.locator('.hand-detail-selector__image')).toHaveAttribute(
    'src',
    /hand-palm-hitmap\.png$/,
  )
  await expect(detail).toContainText('Handfläche')
  await detail.getByRole('button', { name: 'Fertig' }).click()

  const backCanvas = page.locator(
    'section[aria-label="Rückseite"] canvas.body-map-selector__overlay',
  )
  await expect(backCanvas).toHaveAttribute('data-hit-map-ready', 'true')

  const backBox = await backCanvas.boundingBox()
  if (!backBox) throw new Error('Back body-map canvas is not visible.')

  await backCanvas.click({
    position: {
      x: backBox.width * (106 / 512),
      y: backBox.height * (378 / 768),
    },
  })

  await expect(detail).toHaveAttribute('data-surface', 'back')
  await expect(detail.locator('.hand-detail-selector__image')).toHaveAttribute(
    'src',
    /hand-top-hitmap\.png$/,
  )
  await expect(detail).toContainText('Handrücken')
})

test('uses anatomical left and right for all paired regions in the back view', async ({
  page,
}) => {
  await page.goto('/')

  const canvas = page.locator(
    'section[aria-label="Rückseite"] canvas.body-map-selector__overlay',
  )
  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')

  const box = await canvas.boundingBox()
  if (!box) throw new Error('Back body-map canvas is not visible.')

  const pairedRegionChecks = [
    { x: 214, y: 357, label: 'Hinten: Linke Gesäß- / Hüftregion' },
    { x: 297, y: 357, label: 'Hinten: Rechte Gesäß- / Hüftregion' },
    { x: 184, y: 171, label: 'Hinten: Linke Schulter' },
    { x: 327, y: 171, label: 'Hinten: Rechte Schulter' },
    { x: 172, y: 221, label: 'Hinten: Linker Oberarm' },
    { x: 339, y: 222, label: 'Hinten: Rechter Oberarm' },
    { x: 157, y: 263, label: 'Hinten: Linker Ellenbogen' },
    { x: 354, y: 263, label: 'Hinten: Rechter Ellenbogen' },
    { x: 139, y: 303, label: 'Hinten: Linker Unterarm' },
    { x: 372, y: 303, label: 'Hinten: Rechter Unterarm' },
    { x: 106, y: 378, label: 'Hinten: Linke Hand' },
    { x: 406, y: 378, label: 'Hinten: Rechte Hand' },
    { x: 215, y: 436, label: 'Hinten: Linker hinterer Oberschenkel' },
    { x: 296, y: 436, label: 'Hinten: Rechter hinterer Oberschenkel' },
    { x: 214, y: 503, label: 'Hinten: Linke Kniekehle' },
    { x: 297, y: 503, label: 'Hinten: Rechte Kniekehle' },
    { x: 205, y: 570, label: 'Hinten: Linke Wade' },
    { x: 306, y: 570, label: 'Hinten: Rechte Wade' },
    { x: 203, y: 641, label: 'Hinten: Linkes Sprunggelenk' },
    { x: 308, y: 641, label: 'Hinten: Rechtes Sprunggelenk' },
    { x: 201, y: 677, label: 'Hinten: Linker Fuß' },
    { x: 310, y: 677, label: 'Hinten: Rechter Fuß' },
  ]

  for (const region of pairedRegionChecks) {
    const position = {
      x: box.width * (region.x / 512),
      y: box.height * (region.y / 768),
    }

    await canvas.click({ position })
    await expect(page.locator('.body-map-selector__selection')).toContainText(
      region.label,
    )
    await canvas.click({ position })
    await expect(page.locator('.body-map-selector__selection')).toContainText(
      'Noch keine Region ausgewählt',
    )
  }
})
