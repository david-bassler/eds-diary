import { expect, test } from '@playwright/test'

test('stores pain entries in IndexedDB across reloads', async ({ page }) => {
  await page.goto('/')

  const createdId = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    const entry = await repository.createPainEntry({
      startedAt: '2026-01-15T10:00:00.000Z',
      endedAt: '2026-01-15T10:30:00.000Z',
      locations: [{ view: 'front', regionId: 'left-knee' }],
      intensity: 6,
      qualities: ['ziehend'],
      note: 'synthetischer Testeintrag',
    })
    return entry.id
  })

  await page.reload()

  const storedEntry = await page.evaluate(async (id) => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return repository.getPainEntry(id)
  }, createdId)

  expect(storedEntry).toMatchObject({
    id: createdId,
    intensity: 6,
    locations: [{ view: 'front', regionId: 'left-knee' }],
    qualities: ['ziehend'],
    note: 'synthetischer Testeintrag',
    status: 'active',
  })
})

test('normalizes a Google Sheets URL to its spreadsheet id', async ({ page }) => {
  await page.goto('/')

  const saved = await page.evaluate(async () => {
    const google = await import('/src/data/googleSheets.ts')
    return google.setGoogleConfig({
      clientId: 'example.apps.googleusercontent.com',
      sheetId: 'https://docs.google.com/spreadsheets/d/test-sheet-id_123/edit#gid=0',
    })
  })

  expect(saved).toEqual({
    clientId: 'example.apps.googleusercontent.com',
    sheetId: 'test-sheet-id_123',
  })
})
