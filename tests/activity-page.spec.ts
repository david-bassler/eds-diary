import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Aktivitäten' })
    .click()
})

async function closeRangeDetails(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.getByRole('button', { name: 'Details schließen' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()
}

async function applyNewRangeDetails(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()
}

async function addRange(
  page: import('@playwright/test').Page,
  startHour: number,
  endHour: number,
  closeDetails = true,
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

  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).toBeVisible()

  if (closeDetails) await closeRangeDetails(page)
}

async function openRangeDetails(
  page: import('@playwright/test').Page,
  index: number,
): Promise<void> {
  const selection = page.locator('.timerange__selection').nth(index)
  const bounds = await selection.boundingBox()
  if (!bounds) throw new Error('Zeitraum ist nicht sichtbar.')

  await page.mouse.click(
    bounds.x + bounds.width * 0.75,
    bounds.y + bounds.height / 2,
  )

  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).toBeVisible()
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
  await expect.poll(async () => {
    const bounds = await page.locator('#activity-day-start').boundingBox()
    return bounds?.y ?? Number.POSITIVE_INFINITY
  }).toBeLessThan(2)

  const workspaceBounds = await page.locator('.timerange__workspace').boundingBox()
  const navigationBounds = await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .boundingBox()
  const viewport = page.viewportSize()
  if (!workspaceBounds || !navigationBounds || !viewport) {
    throw new Error('Zeitachse, Navigation oder Viewport ist nicht messbar.')
  }
  expect(
    Math.abs(workspaceBounds.height - (viewport.height - navigationBounds.height)),
  ).toBeLessThan(2)

  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()
})


test('does not create an activity range while scrolling on touch', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch scrolling is covered in the mobile project.')

  const surface = page.getByTestId('time-range-surface')
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Zeitpicker ist nicht sichtbar.')

  const x = bounds.x + bounds.width / 2
  const startY = bounds.y + bounds.height * 0.55
  const endY = startY - 120
  const scrollBefore = await page.evaluate(() => window.scrollY)

  await surface.dispatchEvent('pointerdown', {
    pointerId: 31,
    pointerType: 'touch',
    clientX: x,
    clientY: startY,
  })
  await surface.dispatchEvent('pointermove', {
    pointerId: 31,
    pointerType: 'touch',
    clientX: x + 3,
    clientY: endY,
  })
  await surface.dispatchEvent('pointerup', {
    pointerId: 31,
    pointerType: 'touch',
    clientX: x + 3,
    clientY: endY,
  })

  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.scrollY)).not.toBe(
    scrollBefore,
  )
})

test('does not create an activity range from a quick touch tap', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch tapping is covered in the mobile project.')

  const surface = page.getByTestId('time-range-surface')
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Zeitpicker ist nicht sichtbar.')

  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height * 0.4

  await surface.dispatchEvent('pointerdown', {
    pointerId: 32,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
  await surface.dispatchEvent('pointerup', {
    pointerId: 32,
    pointerType: 'touch',
    clientX: x + 2,
    clientY: y + 2,
  })

  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()
})

test('creates an activity range after holding and then dragging on touch', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch hold-and-drag is covered in the mobile project.')

  const surface = page.getByTestId('time-range-surface')
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Zeitpicker ist nicht sichtbar.')

  const x = bounds.x + bounds.width / 2
  const startY = bounds.y + bounds.height * 0.35
  const endY = bounds.y + bounds.height * 0.48

  await surface.dispatchEvent('pointerdown', {
    pointerId: 33,
    pointerType: 'touch',
    clientX: x,
    clientY: startY,
  })
  await page.waitForTimeout(350)
  await expect(surface).toHaveClass(/timerange__surface--touch-create/)

  await surface.dispatchEvent('pointermove', {
    pointerId: 33,
    pointerType: 'touch',
    clientX: x + 2,
    clientY: endY,
  })
  await surface.dispatchEvent('pointerup', {
    pointerId: 33,
    pointerType: 'touch',
    clientX: x + 2,
    clientY: endY,
  })

  await expect(page.locator('.timerange__selection')).toHaveCount(1)
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).toBeVisible()
})

test('opens details after creation and from the right half of a range', async ({
  page,
  isMobile,
}) => {
  await addRange(page, 8, 10, false)

  const dialog = page.getByRole('dialog', { name: 'Aktivität eintragen' })
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toBeVisible()

  const dialogBounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  if (!dialogBounds || !viewport) {
    throw new Error('Dialog oder Viewport ist nicht messbar.')
  }

  if (isMobile) {
    expect(Math.abs(dialogBounds.width - viewport.width)).toBeLessThan(2)
    expect(Math.abs(dialogBounds.height - viewport.height)).toBeLessThan(2)
  } else {
    expect(dialogBounds.width).toBeLessThan(viewport.width)
    expect(dialogBounds.height).toBeLessThan(viewport.height)
  }

  await closeRangeDetails(page)
  await openRangeDetails(page, 0)
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toBeVisible()
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
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).not.toBeVisible()

  await openRangeDetails(page, 1)
  await expect(page.getByLabel('Aktivität für Zeitraum 2')).toBeVisible()
})


test('shows the activity name inside a range when there is enough room', async ({
  page,
}) => {
  await addRange(page, 8, 11, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Spaziergang')
  await applyNewRangeDetails(page)

  await expect(
    page.locator('.timerange__selectionlabel', { hasText: 'Spaziergang' }),
  ).toBeVisible()

  await addRange(page, 13, 14, false)
  await page.getByLabel('Aktivität für Zeitraum 2').fill('Kurzer Termin')
  await applyNewRangeDetails(page)

  await expect(
    page.locator('.timerange__selectionlabel', { hasText: 'Kurzer Termin' }),
  ).toHaveCount(0)
})

test('stores activity and note separately for each selected range', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')

  await addRange(page, 8, 10, false)
  await page
    .getByLabel('Aktivität für Zeitraum 1')
    .fill('Spaziergang')
  await page
    .getByLabel('Notiz für Zeitraum 1')
    .fill('synthetische Notiz eins')
  await applyNewRangeDetails(page)

  await addRange(page, 12, 13, false)
  await page
    .getByLabel('Aktivität für Zeitraum 2')
    .fill('Physiotherapie')
  await page
    .getByLabel('Notiz für Zeitraum 2')
    .fill('synthetische Notiz zwei')
  await applyNewRangeDetails(page)

  await expect(page.locator('.timerange__selection')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Aktivitäten speichern' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()

  await page.getByLabel('Datum').fill('2026-09-08')
  await expect(page.locator('.timerange__selection')).toHaveCount(0)

  await page.getByLabel('Datum').fill('2026-09-07')
  await expect(page.locator('.timerange__selection')).toHaveCount(2)
  await openRangeDetails(page, 0)
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toHaveValue(
    'Spaziergang',
  )

  const activityCombobox = page.getByRole('combobox', {
    name: 'Aktivität für Zeitraum 1',
  })
  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'true')
  const activityOptions = page.getByRole('listbox', {
    name: 'Gespeicherte Aktivitäten',
  })
  await expect(activityOptions).toBeVisible()
  await expect(
    activityOptions.getByRole('option', { name: 'Spaziergang' }),
  ).toBeVisible()
  await expect(
    activityOptions.getByRole('option', { name: 'Physiotherapie' }),
  ).toBeVisible()

  await page
    .getByRole('button', { name: 'Gespeicherte Aktivitäten anzeigen' })
    .click()
  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'false')
  await expect(activityOptions).not.toBeVisible()
  await closeRangeDetails(page)

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

})

test('automatically saves new activities and supports undo and redo', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')

  const undo = page.getByRole('button', { name: 'Undo' })
  const redo = page.getByRole('button', { name: 'Redo' })

  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  await addRange(page, 8, 9, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Spaziergang')
  await applyNewRangeDetails(page)

  await expect(page.locator('.timerange__selection')).toHaveCount(1)
  await expect(page.getByText('Aktivität gespeichert.')).toBeVisible()
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  let entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return (await repository.listActivityEntries()).filter(
      (entry) => entry.date === '2026-09-07',
    )
  })
  expect(entries).toHaveLength(1)

  await undo.click()
  await expect(page.getByText('Letzte Änderung rückgängig gemacht.')).toBeVisible()
  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await expect(redo).toBeEnabled()

  entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return (await repository.listActivityEntries()).filter(
      (entry) => entry.date === '2026-09-07',
    )
  })
  expect(entries).toHaveLength(0)

  await redo.click()
  await expect(page.getByText('Änderung wiederhergestellt.')).toBeVisible()
  await expect(page.locator('.timerange__selection')).toHaveCount(1)
  await expect(undo).toBeEnabled()

  entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return (await repository.listActivityEntries()).filter(
      (entry) => entry.date === '2026-09-07',
    )
  })
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    startTime: '08:00',
    endTime: '09:00',
    activityName: 'Spaziergang',
  })
})

test('offers an automatically saved activity again immediately', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')

  await addRange(page, 8, 9, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Morgenroutine')
  await applyNewRangeDetails(page)

  await expect(page.getByText('Aktivität gespeichert.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Aktivität speichern' }),
  ).toHaveCount(0)

  await addRange(page, 10, 11, false)

  const options = page.getByRole('listbox', {
    name: 'Gespeicherte Aktivitäten',
  })
  await expect(
    options.getByRole('option', { name: 'Morgenroutine' }),
  ).toBeVisible()

  await options.getByRole('option', { name: 'Morgenroutine' }).click()
  await expect(page.getByLabel('Aktivität für Zeitraum 2')).toHaveValue(
    'Morgenroutine',
  )
})

test('assigns pastel colors by activity type and lets them be changed', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')

  await addRange(page, 8, 9, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Spaziergang')
  await applyNewRangeDetails(page)

  await addRange(page, 10, 11, false)
  await page.getByLabel('Aktivität für Zeitraum 2').fill('Physiotherapie')
  await applyNewRangeDetails(page)

  const selections = page.locator('.timerange__selection')
  const colors = await selections.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-range-color')),
  )
  expect(colors[0]).toBeTruthy()
  expect(colors[1]).toBeTruthy()
  expect(colors[0]).not.toBe(colors[1])

  await openRangeDetails(page, 0)
  await page.getByRole('button', { name: 'Pastellfarbe 1' }).click()
  await expect(page.locator('.timerange__selection--active')).toHaveAttribute(
    'data-range-color',
    '#f6cbd0',
  )
  await applyNewRangeDetails(page)

  await expect(selections.nth(0)).toHaveAttribute(
    'data-range-color',
    '#f6cbd0',
  )
})

test('edits start and end in the dialog with preview and persistence', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')
  await addRange(page, 8, 10, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Spaziergang')

  await page.getByLabel('Beginn').fill('08:30')
  await page.getByLabel('Ende').fill('09:45')

  const activeSelection = page.locator('.timerange__selection--active')
  await expect(activeSelection).toContainText('08:30')
  await expect(activeSelection).toContainText('09:45')
  await expect(page.getByText('1 h 15 min')).toBeVisible()

  await closeRangeDetails(page)
  await expect(page.locator('.timerange__selection').first()).toContainText(
    '08:00',
  )
  await expect(page.locator('.timerange__selection').first()).toContainText(
    '10:00',
  )

  await openRangeDetails(page, 0)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Spaziergang')
  await page.getByRole('button', { name: 'Beginn 15 Minuten später' }).click()
  await page.getByRole('button', { name: 'Ende 15 Minuten früher' }).click()
  await expect(page.getByLabel('Beginn')).toHaveValue('08:15')
  await expect(page.getByLabel('Ende')).toHaveValue('09:45')
  await applyNewRangeDetails(page)

  await expect(page.getByText('Aktivität gespeichert.')).toBeVisible()
  await expect(page.locator('.timerange__selection')).toContainText('08:15')
  await expect(page.locator('.timerange__selection')).toContainText('09:45')

  await openRangeDetails(page, 0)
  await page.getByLabel('Beginn').fill('08:30')
  await page.getByLabel('Ende').fill('09:30')
  await page
    .getByRole('button', { name: 'Änderungen speichern' })
    .click()
  await expect(page.getByText('Aktivität aktualisiert.')).toBeVisible()

  await page.getByLabel('Datum').fill('2026-09-08')
  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await page.getByLabel('Datum').fill('2026-09-07')
  await expect(page.locator('.timerange__selection')).toContainText('08:30')
  await expect(page.locator('.timerange__selection')).toContainText('09:30')

  const entries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return repository.listActivityEntries()
  })

  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        date: '2026-09-07',
        startTime: '08:30',
        endTime: '09:30',
        activityName: 'Spaziergang',
      }),
    ]),
  )
})

test('copies selected activities from the previous day and supports cancel', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-08')

  await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    await repository.createActivityEntries([
      {
        date: '2026-09-07',
        startTime: '08:00',
        endTime: '09:00',
        activityName: 'Spaziergang',
        note: 'synthetisch eins',
      },
      {
        date: '2026-09-07',
        startTime: '12:00',
        endTime: '13:30',
        activityName: 'Ruhepause',
        note: 'synthetisch zwei',
      },
    ])
  })

  await page.getByRole('button', { name: 'Tag kopieren' }).click()

  const dialog = page.getByRole('dialog', { name: 'Tag kopieren' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Einträge von')).toHaveValue('2026-09-07')
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog.getByRole('checkbox').nth(0)).toBeChecked()
  await expect(dialog.getByRole('checkbox').nth(1)).toBeChecked()

  await dialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(dialog).not.toBeVisible()

  let targetEntries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return (await repository.listActivityEntries()).filter(
      (entry) => entry.date === '2026-09-08',
    )
  })
  expect(targetEntries).toHaveLength(0)

  await page.getByRole('button', { name: 'Tag kopieren' }).click()
  await dialog.getByRole('checkbox').nth(1).uncheck()
  await dialog.getByRole('button', { name: 'OK' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByText('1 Aktivität wurde auf den aktuellen Tag übernommen.'),
  ).toBeVisible()
  await expect(page.locator('.timerange__selection')).toHaveCount(1)

  targetEntries = await page.evaluate(async () => {
    const repository = await import(
      '/src/features/activity/activityRepository.ts'
    )
    return (await repository.listActivityEntries()).filter(
      (entry) => entry.date === '2026-09-08',
    )
  })

  expect(targetEntries).toHaveLength(1)
  expect(targetEntries[0]).toMatchObject({
    startTime: '08:00',
    endTime: '09:00',
    activityName: 'Spaziergang',
    note: 'synthetisch eins',
  })
})

test('can remove a saved range without it returning for the date', async ({
  page,
}) => {
  await page.getByLabel('Datum').fill('2026-09-07')

  await addRange(page, 8, 10, false)
  await page.getByLabel('Aktivität für Zeitraum 1').fill('Erste Aktivität')
  await applyNewRangeDetails(page)

  await addRange(page, 12, 13, false)
  await page.getByLabel('Aktivität für Zeitraum 2').fill('Zweite Aktivität')
  await applyNewRangeDetails(page)

  await expect(page.locator('.timerange__selection')).toHaveCount(2)

  await openRangeDetails(page, 0)
  await page.getByRole('button', { name: 'Zeitraum entfernen' }).click()

  await expect(page.locator('.timerange__selection')).toHaveCount(1)
  await expect(
    page.getByRole('dialog', { name: 'Aktivität eintragen' }),
  ).not.toBeVisible()

  await page.getByLabel('Datum').fill('2026-09-08')
  await expect(page.locator('.timerange__selection')).toHaveCount(0)
  await page.getByLabel('Datum').fill('2026-09-07')
  await expect(page.locator('.timerange__selection')).toHaveCount(1)

  await openRangeDetails(page, 0)
  await expect(page.getByLabel('Aktivität für Zeitraum 1')).toHaveValue(
    'Zweite Aktivität',
  )
})
