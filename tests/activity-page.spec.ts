import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('button', { name: 'Aktivitäten' })
    .click()
})

test('shows the time range picker on the activity page', async ({ page }) => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Aktivitätszeiträume' }),
  ).toBeVisible()
  await expect(page.getByTestId('time-range-surface')).toBeVisible()
  await expect(page.locator('.timerange__selection')).toHaveCount(0)
})

test('keeps multiple ranges and lays overlapping ranges out equally', async ({
  page,
}) => {
  const surface = page.getByTestId('time-range-surface')
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Zeitpicker ist nicht sichtbar.')

  const x = bounds.x + bounds.width / 2
  const y = (hour: number) => bounds.y + bounds.height * (hour / 24)

  await page.mouse.move(x, y(8))
  await page.mouse.down()
  await page.mouse.move(x, y(10))
  await page.mouse.up()

  await page.mouse.move(x, y(9))
  await page.mouse.down()
  await page.mouse.move(x, y(11))
  await page.mouse.up()

  const selections = page.locator('.timerange__selection')
  await expect(selections).toHaveCount(2)

  const widths = await selections.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).style.width),
  )
  expect(widths).toEqual([
    'calc(50% - 4px)',
    'calc(50% - 4px)',
  ])

  await expect(page.getByLabel('Beginn Zeitraum 1 anpassen')).toBeVisible()
  await expect(page.getByLabel('Beginn Zeitraum 2 anpassen')).toBeVisible()
})
