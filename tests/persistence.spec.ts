import { expect, test } from '@playwright/test'

test('stores pain entries in IndexedDB across reloads', async ({ page }) => {
  await page.goto('/')

  await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    await repository.createPainEntry({
      startedAt: '2026-01-15T10:00:00.000Z',
      endedAt: '2026-01-15T10:30:00.000Z',
      locations: [{ view: 'front', regionId: 'left-knee' }],
      intensity: 6,
      qualities: ['ziehend'],
      note: 'synthetischer Testeintrag',
    })
  })

  await page.reload()

  const storedEntry = await page.evaluate(async () => {
    const repository = await import('/src/features/pain/painRepository.ts')
    return (await repository.listPainEntries()).find(
      (entry) => entry.note === 'synthetischer Testeintrag',
    )
  })

  expect(storedEntry).toMatchObject({
    intensity: 6,
    locations: [{ view: 'front', regionId: 'left-knee' }],
    qualities: ['ziehend'],
    note: 'synthetischer Testeintrag',
    status: 'active',
  })
})

test('keeps the legacy plaintext Google Sheets gateway fail-closed', async ({ page }) => {
  await page.goto('/')

  const message = await page.evaluate(async () => {
    const google = await import('/src/data/googleSheets.ts')
    try {
      google.setGoogleConfig({
        clientId: 'example.apps.googleusercontent.com',
        sheetId: 'test-sheet-id_123',
      })
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  })

  expect(message).toContain('Legacy plaintext Google-Sheets synchronization is disabled')
})
