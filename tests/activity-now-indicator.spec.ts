import { expect, test } from '@playwright/test'

function localDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('shows a JETZT line only for today on the activity timeline', async ({
  page,
}) => {
  await page.goto('/aktivitaeten')

  const indicator = page.getByTestId('activity-now-indicator')
  await expect(indicator).toBeVisible()
  await expect(indicator).toContainText('JETZT')
  await expect(indicator).toHaveAttribute('aria-label', /^Jetzt \d{2}:\d{2}$/)

  const surface = page.getByTestId('time-range-surface')
  const [indicatorBox, surfaceBox] = await Promise.all([
    indicator.boundingBox(),
    surface.boundingBox(),
  ])
  if (!indicatorBox || !surfaceBox) throw new Error('Zeitachse ist nicht sichtbar.')
  expect(indicatorBox.y).toBeGreaterThanOrEqual(surfaceBox.y - 2)
  expect(indicatorBox.y).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height + 2)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page.getByLabel('Datum').fill(localDate(yesterday))
  await expect(indicator).toHaveCount(0)

  await page.getByLabel('Datum').fill(localDate(new Date()))
  await expect(indicator).toBeVisible()
})
