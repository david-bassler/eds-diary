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
    { x: 219, y: 411, label: 'Hinten: Rechte Gesäß- / Hüftregion' },
    { x: 293, y: 411, label: 'Hinten: Linke Gesäß- / Hüftregion' },
    { x: 178, y: 190, label: 'Hinten: Rechte Schulter' },
    { x: 334, y: 190, label: 'Hinten: Linke Schulter' },
    { x: 165, y: 240, label: 'Hinten: Rechter Oberarm' },
    { x: 347, y: 240, label: 'Hinten: Linker Oberarm' },
    { x: 143, y: 307, label: 'Hinten: Rechter Ellenbogen' },
    { x: 369, y: 307, label: 'Hinten: Linker Ellenbogen' },
    { x: 135, y: 360, label: 'Hinten: Rechter Unterarm' },
    { x: 377, y: 360, label: 'Hinten: Linker Unterarm' },
    { x: 114, y: 458, label: 'Hinten: Rechte Hand' },
    { x: 398, y: 458, label: 'Hinten: Linke Hand' },
    { x: 218, y: 480, label: 'Hinten: Rechter hinterer Oberschenkel' },
    { x: 294, y: 480, label: 'Hinten: Linker hinterer Oberschenkel' },
    { x: 207, y: 558, label: 'Hinten: Rechte Kniekehle' },
    { x: 305, y: 558, label: 'Hinten: Linke Kniekehle' },
    { x: 206, y: 625, label: 'Hinten: Rechte Wade' },
    { x: 306, y: 625, label: 'Hinten: Linke Wade' },
    { x: 198, y: 690, label: 'Hinten: Rechtes Sprunggelenk' },
    { x: 314, y: 690, label: 'Hinten: Linkes Sprunggelenk' },
    { x: 189, y: 733, label: 'Hinten: Rechter Fuß' },
    { x: 323, y: 733, label: 'Hinten: Linker Fuß' },
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
