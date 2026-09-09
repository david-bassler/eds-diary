import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})


test('swipes between front and back on mobile without treating the swipe as a tap', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Swipe navigation is only active in the mobile body map.')

  const frontTab = page.getByRole('button', { name: 'Vorne' })
  const backTab = page.getByRole('button', { name: 'Hinten' })

  await expect(frontTab).toHaveAttribute('aria-pressed', 'true')
  await expect(backTab).toHaveAttribute('aria-pressed', 'false')

  const frontCanvas = page
    .getByRole('region', { name: 'Vorderseite' })
    .locator('.body-map-selector__overlay')
  const frontBounds = await frontCanvas.boundingBox()
  if (!frontBounds) throw new Error('Vorderseite ist nicht sichtbar.')

  const y = frontBounds.y + frontBounds.height / 2
  await frontCanvas.dispatchEvent('pointerdown', {
    pointerId: 21,
    pointerType: 'touch',
    clientX: frontBounds.x + frontBounds.width * 0.8,
    clientY: y,
  })
  await frontCanvas.dispatchEvent('pointerup', {
    pointerId: 21,
    pointerType: 'touch',
    clientX: frontBounds.x + frontBounds.width * 0.2,
    clientY: y + 4,
  })

  await expect(backTab).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Noch keine Region ausgewählt')).toBeVisible()

  const backCanvas = page
    .getByRole('region', { name: 'Rückseite' })
    .locator('.body-map-selector__overlay')
  const backBounds = await backCanvas.boundingBox()
  if (!backBounds) throw new Error('Rückseite ist nicht sichtbar.')

  const backY = backBounds.y + backBounds.height / 2
  await backCanvas.dispatchEvent('pointerdown', {
    pointerId: 22,
    pointerType: 'touch',
    clientX: backBounds.x + backBounds.width * 0.2,
    clientY: backY,
  })
  await backCanvas.dispatchEvent('pointerup', {
    pointerId: 22,
    pointerType: 'touch',
    clientX: backBounds.x + backBounds.width * 0.8,
    clientY: backY + 3,
  })

  await expect(frontTab).toHaveAttribute('aria-pressed', 'true')
})


test('keeps short taps selectable on the body map', async ({ page }) => {
  const frontCanvas = page
    .getByRole('region', { name: 'Vorderseite' })
    .locator('.body-map-selector__overlay')

  await expect(frontCanvas).toHaveAttribute('data-hit-map-ready', 'true')
  const bounds = await frontCanvas.boundingBox()
  if (!bounds) throw new Error('Vorderseite ist nicht sichtbar.')

  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height * 0.35,
  )

  await expect(page.getByText('1 Region ausgewählt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vorne' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('scrolls instantly to the top when continuing to pain details', async ({
  page,
}) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(
    page.getByRole('heading', { level: 2, name: 'Schmerzdetails' }),
  ).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0)
})

test('creates a pain entry with multiple body regions and details', async ({
  page,
}) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()

  await page
    .getByRole('checkbox', { name: 'Linkes Knie', exact: true })
    .check()
  await page
    .getByRole('checkbox', { name: 'Unterer Rücken', exact: true })
    .check()

  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.getByRole('button', { name: 'Stechend' }).click()
  await page.getByLabel('Mögliche Ursache (optional)').fill('synthetische Ursache')
  await page.getByLabel('Tritt auf, wenn (optional)').fill('synthetischer Auslöser')
  await page.getByLabel('Notizen (optional)').fill('synthetische Notiz')

  await expect(page.getByLabel('Beginndatum')).not.toHaveValue('')
  await expect(page.getByLabel('Beginnzeit')).not.toHaveValue('')

  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Schmerzeintrag gespeichert.')).toBeVisible()

  const entries = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return repository.listPainEntries()
  })

  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    locations: [
      { view: 'front', regionId: 'left-knee' },
      { view: 'back', regionId: 'lower-back' },
    ],
    qualities: ['Stechend'],
    cause: 'synthetische Ursache',
    occursWhen: 'synthetischer Auslöser',
    note: 'synthetische Notiz',
  })
})

test('stores an optional explicit pain end time', async ({ page }) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Dumpf' }).click()

  await page.getByLabel('Beginndatum').fill('2026-09-08')
  await page.getByLabel('Beginnzeit').fill('08:00')
  await page.getByRole('checkbox', { name: 'Endzeitpunkt angeben' }).check()
  await page.getByLabel('Enddatum').fill('2026-09-08')
  await page.getByLabel('Endzeit').fill('10:30')

  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Schmerzeintrag gespeichert.')).toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })

  expect(entry.startedAt).toBe(new Date('2026-09-08T08:00').toISOString())
  expect(entry.endedAt).toBe(new Date('2026-09-08T10:30').toISOString())
})

test('asks about an ongoing pain entry older than one hour on app open', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    await repository.createPainEntry({
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      locations: [{ view: 'front', regionId: 'abdomen' }],
      qualities: ['Dumpf'],
      note: 'synthetischer offener Schmerz',
    })
  })

  await page.reload()

  const dialog = page.getByRole('dialog', {
    name: 'Sind diese Schmerzen noch aktuell?',
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Dumpf')).toBeVisible()
  await expect(dialog.getByText(/Wo:.*Vorne: Bauch/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Nein, beendet' }).click()
  await expect(dialog.getByLabel('Enddatum')).not.toHaveValue('')
  await expect(dialog.getByLabel('Endzeit')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Ende speichern' }).click()

  await expect(dialog).not.toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })
  expect(entry.endedAt).not.toBe('')

  await page.reload()
  await expect(dialog).not.toBeVisible()
})

test('appends a pain change to the existing note', async ({ page }) => {
  await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    await repository.createPainEntry({
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      locations: [{ view: 'front', regionId: 'abdomen' }],
      qualities: ['Dumpf'],
      note: 'Ausgangsnotiz',
    })
  })

  await page.reload()

  const dialog = page.getByRole('dialog', {
    name: 'Sind diese Schmerzen noch aktuell?',
  })
  await dialog.getByRole('button', { name: 'Verändert' }).click()

  const changeField = dialog.getByLabel('Veränderung der Schmerzen')
  await expect(changeField).toBeVisible()
  await changeField.fill('Stärker geworden und weiter nach rechts gezogen.')
  await dialog
    .getByRole('button', { name: 'Veränderung speichern' })
    .click()

  await expect(dialog).not.toBeVisible()

  const entry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries())[0]
  })

  expect(entry.endedAt).toBe('')
  expect(entry.note).toContain('Ausgangsnotiz')
  expect(entry.note).toContain('Veränderung am')
  expect(entry.note).toContain(
    'Stärker geworden und weiter nach rechts gezogen.',
  )
})

test('adds and keeps a custom pain type chip', async ({ page }) => {
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await page.getByLabel('Eigene Schmerzart').fill('Bohrend')
  await page.getByRole('button', { name: 'Hinzufügen' }).click()

  await expect(
    page.getByRole('button', { name: 'Bohrend' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await page.getByText('Regionen alternativ als Liste auswählen').click()
  await page.getByRole('checkbox', { name: 'Bauch', exact: true }).check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(page.getByRole('button', { name: 'Bohrend' })).toBeVisible()
})
