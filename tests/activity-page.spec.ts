import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Aktivitäten' })
    .click()
})

async function addRange(
  page: import('@playwright/test').Page,
  startHour: number,
  endHour: number,
): Promise<void> {
  const surface = page.getByTestId('time-range-surface')
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Zeitpicker ist nicht sichtbar.')

  const x = bounds.x + bounds.width / 2
  const y = (hour: number) => bounds.y + bounds.height * (hour / 24)

  await page.mouse.move(x, y(startHour))
  await page.mouse.down()
  await page.mouse.move(x, y(endHour))
  await page.mouse.up()
}

test('shows date and the time range picker on the activity page', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aktivitäten' }),
  ).toBeVisible()
  await expect(page.getByLabel('Datum')).not.toHaveValue('')
  await expect(
    page.getByRole('heading', { level: 2, name: 'Aktivitätszeiträume' }),
  ).toBeVisible()
  await expect(page.getByTestId('time-range-surface')).toBeVisible()
  await expect(page.locator('.timerange__selection')).toHaveCount(0)
})

test('keeps multiple ranges and lays overlapping ranges out equally', async ({
  page,
}) => {
  await addRange(page, 8, 10)
  await addRange(page, 9, 11)

  const selections = page.locator('.timerange__selection')
  await expect(selections).toHaveCount(2)

  const widths = await selections.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).style.width),
  )
  expect(widths).toEqual([
    'calc(50% - 4px)',
    'calc(50% - 4px)',
  ])

  await expect(page.locator('input[type="range"]')).toHaveCount(0)
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toBeVisible()
  await expect(page.getByLabel('Aktivität für Zeitraum 2')).toBeVisible()
})

test('stores activity and note separately for each selected range', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')
  await addRange(page, 8, 10)
  await addRange(page, 12, 13)

  await page
    .getByLabel('Aktivität für Zeitraum 1')
    .fill('Spaziergang')
  await page
    .getByLabel('Notiz für Zeitraum 1')
    .fill('synthetische Notiz eins')
  await page
    .getByLabel('Aktivität für Zeitraum 2')
    .fill('Physiotherapie')
  await page
    .getByLabel('Notiz für Zeitraum 2')
    .fill('synthetische Notiz zwei')

  await page.getByRole('button', { name: 'Aktivitäten speichern' }).click()
  await expect(page.getByText('Aktivitäten gespeichert.')).toBeVisible()

  const entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return repository.listActivityEntries()
  })

  expect(entries).toHaveLength(2)
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        date: '2026-09-07',
        startTime: '08:00',
        endTime: '10:00',
        activityName: 'Spaziergang',
        note: 'synthetische Notiz eins',
        status: 'active',
      }),
      expect.objectContaining({
        date: '2026-09-07',
        startTime: '12:00',
        endTime: '13:00',
        activityName: 'Physiotherapie',
        note: 'synthetische Notiz zwei',
        status: 'active',
      }),
    ]),
  )

  await expect(
    page.locator('datalist#activity-name-options option[value="Spaziergang"]'),
  ).toHaveCount(1)
  await expect(
    page.locator(
      'datalist#activity-name-options option[value="Physiotherapie"]',
    ),
  ).toHaveCount(1)
})

test('can remove one selected range together with its details', async ({
  page,
}) => {
  await addRange(page, 8, 10)
  await addRange(page, 12, 13)

  await page.getByLabel('Aktivität für Zeitraum 1').fill('Erste Aktivität')
  await page.getByLabel('Aktivität für Zeitraum 2').fill('Zweite Aktivität')

  await page
    .locator('.activity-page__range')
    .first()
    .getByRole('button', { name: 'Zeitraum entfernen' })
    .click()

  await expect(page.locator('.timerange__selection')).toHaveCount(1)
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toHaveValue(
    'Zweite Aktivität',
  )
})
