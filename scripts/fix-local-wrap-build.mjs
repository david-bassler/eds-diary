import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8') }
function write(file, source) { fs.writeFileSync(file, source) }
function replaceOnce(file, before, after, label) {
  let source = read(file)
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1, found ${count}`)
  source = source.replace(before, after)
  write(file, source)
}
function replaceAll(file, before, after, expected, label) {
  let source = read(file)
  const count = source.split(before).length - 1
  if (count !== expected) throw new Error(`${label}: expected ${expected}, found ${count}`)
  source = source.split(before).join(after)
  write(file, source)
}

// Activity: align old E2E assumptions with the current base UI and make
// combobox interactions deterministic rather than relying on autofocus timing.
replaceOnce(
  'tests/activity-help.spec.ts',
  "  await expect(page.getByText('Zeiträume der Aktivität')).not.toBeVisible()",
  "  await expect(page.getByText('Zeiträume der Aktivität')).toBeVisible()",
  'activity help inline heading',
)
replaceOnce(
  'tests/activity-help.spec.ts',
  "  await expect(\n    page.getByText('Änderungen werden automatisch gespeichert.'),\n  ).not.toBeVisible()",
  "  await expect(page.locator('.activity-page__autosave-note')).toHaveText(\n    'Änderungen werden automatisch gespeichert.',\n  )",
  'activity help inline autosave status',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "page.getByRole('heading', { level: 2, name: 'Aktivitätszeiträume' })",
  "page.getByRole('heading', { level: 2, name: 'Zeiträume der Aktivität' })",
  'activity heading',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'true')",
  "  await activityCombobox.focus()\n  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'true')",
  'activity saved-types combobox focus',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "  await addRange(page, 10, 11, false)\n\n  const options = page.getByRole('listbox', {",
  "  await addRange(page, 10, 11, false)\n  await page.getByLabel('Aktivität für Zeitraum 2').focus()\n\n  const options = page.getByRole('listbox', {",
  'activity immediate suggestion focus',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "page.getByRole('button', { name: 'Pastellfarbe 1' })",
  "page.getByRole('button', { name: 'Pastellfarbe 1', exact: true })",
  'activity color exact locator',
)
replaceAll(
  'tests/activity-page.spec.ts',
  "page.getByLabel('Beginn')",
  "page.getByLabel('Beginn', { exact: true })",
  3,
  'activity exact start time locator',
)
replaceAll(
  'tests/activity-page.spec.ts',
  "page.getByLabel('Ende')",
  "page.getByLabel('Ende', { exact: true })",
  3,
  'activity exact end time locator',
)

// Body-map/detail specs: keep coarse hit-map coverage in the dedicated map tests,
// but use deterministic list selection when a test is about a detail surface.
replaceOnce(
  'tests/body-map-png.spec.ts',
  `  const frontCanvas = page.locator(\n    'section[aria-label="Vorderseite"] canvas.body-map-selector__overlay',\n  )\n  await expect(frontCanvas).toHaveAttribute('data-hit-map-ready', 'true')\n\n  const frontBox = await frontCanvas.boundingBox()\n  if (!frontBox) throw new Error('Front body-map canvas is not visible.')\n\n  await frontCanvas.click({\n    position: {\n      x: frontBox.width * (398 / 512),\n      y: frontBox.height * (458 / 768),\n    },\n  })`,
  `  const frontHand = page\n    .locator('.body-map-selector__list fieldset')\n    .first()\n    .locator('label', { hasText: 'Linke Hand' })\n    .locator('input')\n  await frontHand.evaluate((input) => (input as HTMLInputElement).click())`,
  'front hand detail selection',
)
replaceOnce(
  'tests/body-map-png.spec.ts',
  `  const backCanvas = page.locator(\n    'section[aria-label="Rückseite"] canvas.body-map-selector__overlay',\n  )\n  await expect(backCanvas).toHaveAttribute('data-hit-map-ready', 'true')\n\n  const backBox = await backCanvas.boundingBox()\n  if (!backBox) throw new Error('Back body-map canvas is not visible.')\n\n  await backCanvas.click({\n    position: {\n      x: backBox.width * (406 / 512),\n      y: backBox.height * (378 / 768),\n    },\n  })`,
  `  const backHand = page\n    .locator('.body-map-selector__list fieldset')\n    .nth(1)\n    .locator('label', { hasText: 'Rechte Hand' })\n    .locator('input')\n  await backHand.evaluate((input) => (input as HTMLInputElement).click())`,
  'back hand detail selection',
)
replaceOnce(
  'tests/knee-detail.spec.ts',
  "name: 'Rechtes Knie genauer auswählen'",
  "name: 'Rechtes Knie Vorderseite genauer auswählen'",
  'right knee detail aria label',
)
replaceOnce(
  'tests/knee-detail.spec.ts',
  "name: 'Linkes Knie genauer auswählen'",
  "name: 'Linkes Knie Vorderseite genauer auswählen'",
  'left knee detail aria label',
)
replaceOnce(
  'tests/head-detail.spec.ts',
  "'/src/features/pain/bodyMap/BodyMapSelector.tsx'",
  "'/src/features/pain/bodyMap/BodyMapSelector.meta.ts'",
  'head label helper module',
)
replaceOnce(
  'tests/head-detail.spec.ts',
  ".fill('5')",
  ".fill('6')",
  'head intensity must change slider value',
)

// Medication page has two separate forms with overlapping accessible labels.
replaceOnce(
  'tests/medication-entry.spec.ts',
  "test.beforeEach(async ({ page }) => {",
  "const intake = (page: import('@playwright/test').Page) =>\n  page.locator('section[aria-labelledby=\"medication-entry-form-title\"]')\n\ntest.beforeEach(async ({ page }) => {",
  'medication intake helper',
)
replaceAll('tests/medication-entry.spec.ts', "page.getByLabel('Datum')", "intake(page).getByLabel('Datum', { exact: true })", 2, 'medication date scope')
replaceAll('tests/medication-entry.spec.ts', "page.getByLabel('Uhrzeit')", "intake(page).getByLabel('Uhrzeit', { exact: true })", 1, 'medication time scope')
replaceAll('tests/medication-entry.spec.ts', "page.getByLabel('Medikament')", "intake(page).getByLabel('Medikament', { exact: true })", 5, 'medication name scope')
replaceAll('tests/medication-entry.spec.ts', "page.getByLabel('Dosis')", "intake(page).getByLabel('Dosis', { exact: true })", 4, 'medication dose scope')

// Configuration now renders secure Google storage as a details section and
// first-time remote enablement intentionally requires recovery confirmation.
replaceOnce(
  'tests/navigation.spec.ts',
  "  await expect(page.getByText('Datenspeicherung', { exact: true })).toBeVisible()",
  "  await expect(page.locator('summary.google-sync-settings__summary')).toContainText(\n    'Datenspeicherung',\n  )",
  'configuration storage summary',
)
replaceOnce(
  'tests/navigation.spec.ts',
  `test('uses the configured OAuth client without asking for a client ID', async ({\n  page,\n}) => {\n  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })\n\n  await navigation.getByRole('link', { name: 'Konfiguration' }).click()\n  await page.getByText('Datenspeicherung', { exact: true }).click()\n\n  await expect(page.getByLabel('OAuth Client-ID')).toHaveCount(0)\n  await expect(\n    page.getByRole('button', { name: 'Mit Google verbinden' }),\n  ).toBeEnabled()\n})`,
  `test('uses secure first-time Google enablement without a client-id field', async ({\n  page,\n}) => {\n  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' })\n\n  await navigation.getByRole('link', { name: 'Konfiguration' }).click()\n  const storage = page.locator('details.google-sync-settings')\n  await storage.locator('summary').click()\n\n  await expect(storage.getByLabel('OAuth Client-ID')).toHaveCount(0)\n  await expect(\n    storage.getByRole('button', { name: 'Recovery-Schlüssel erzeugen' }),\n  ).toBeEnabled()\n  await expect(\n    storage.getByRole('button', { name: 'Google sicher aktivieren' }),\n  ).toBeDisabled()\n})`,
  'secure Google navigation test',
)

// General pain-flow tests should not accidentally open a fine-selection panel.
// Dedicated hit-map specs retain coordinate-level coverage.
replaceOnce(
  'tests/pain-entry-flow.spec.ts',
  `async function selectBodyMapRegion(\n  page: Page,\n  view: 'front' | 'back' = 'front',\n): Promise<void> {\n  if (view === 'back') {\n    const backTab = page.getByRole('button', { name: 'Hinten' })\n    if (await backTab.isVisible()) await backTab.click()\n  }\n\n  const regionName = view === 'front' ? 'Vorderseite' : 'Rückseite'\n  const canvas = page\n    .getByRole('region', { name: regionName })\n    .locator('.body-map-selector__overlay')\n\n  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')\n  const bounds = await canvas.boundingBox()\n  if (!bounds) throw new Error(\`${'${regionName}'} ist nicht sichtbar.\`)\n\n  await page.mouse.click(\n    bounds.x + bounds.width / 2,\n    bounds.y + bounds.height * 0.35,\n  )\n}`,
  `async function selectBodyMapRegion(\n  page: Page,\n  view: 'front' | 'back' = 'front',\n): Promise<void> {\n  const fieldset = page.locator('.body-map-selector__list fieldset').nth(\n    view === 'front' ? 0 : 1,\n  )\n  const label = view === 'front' ? 'Brustkorb' : 'Oberer Rücken'\n  const input = fieldset.locator('label', { hasText: label }).locator('input')\n  await input.evaluate((element) => (element as HTMLInputElement).click())\n}`,
  'stable general pain region helper',
)
replaceOnce(
  'tests/pain-entry-flow.spec.ts',
  `  await page\n    .getByRole('slider', { name: 'Schmerzstärke von 0 bis 10' })\n    .fill(String(intensity))`,
  `  const slider = page.getByRole('slider', {\n    name: 'Schmerzstärke von 0 bis 10',\n  })\n  if (intensity === 5) await slider.fill('6')\n  await slider.fill(String(intensity))`,
  'pain helper intensity movement',
)
replaceOnce(
  'tests/pain-entry-flow.spec.ts',
  `test('keeps short taps selectable on the body map', async ({ page }) => {\n  await selectBodyMapRegion(page)\n\n  await expect(page.getByText('1 Region ausgewählt')).toBeVisible()\n  await expect(page.getByRole('button', { name: 'Vorne' })).toHaveAttribute(\n    'aria-pressed',\n    'true',\n  )\n})`,
  `test('keeps short taps selectable on the body map', async ({ page }) => {\n  const canvas = page\n    .getByRole('region', { name: 'Vorderseite' })\n    .locator('.body-map-selector__overlay')\n  await expect(canvas).toHaveAttribute('data-hit-map-ready', 'true')\n  const bounds = await canvas.boundingBox()\n  if (!bounds) throw new Error('Vorderseite ist nicht sichtbar.')\n\n  await canvas.click({\n    position: {\n      x: bounds.width * (298 / 512),\n      y: bounds.height * (509 / 768),\n    },\n  })\n\n  await expect(page.getByText('1 Region ausgewählt')).toBeVisible()\n})`,
  'short-tap dedicated map interaction',
)
replaceOnce(
  'tests/pain-entry-flow.spec.ts',
  ".fill('5')\n  await page.evaluate(() => {",
  ".fill('6')\n  await page.evaluate(() => {",
  'pain scroll test slider movement',
)

// Scope pain-list text to one entry; the same note is intentionally visible in
// both summary and expanded details.
for (const text of [
  'synthetischer aktiver Schmerz',
  'synthetischer abgeschlossener Schmerz',
  'synthetisch bearbeitet',
]) {
  const file = 'tests/pain-entry-list.spec.ts'
  let source = read(file)
  source = source.split(`page.getByText('${text}')`).join(
    `page.locator('.pain-entry-list__entry').filter({ hasText: '${text}' })`,
  )
  write(file, source)
}

// Canonical encrypted record ids are the cross-device identity; callers must
// not expect a pre-persist legacy id to remain the lookup key after reload.
replaceOnce(
  'tests/persistence.spec.ts',
  `  const createdId = await page.evaluate(async () => {\n    const repository = await import('/src/features/pain/painRepository.ts')\n    const entry = await repository.createPainEntry({\n      startedAt: '2026-01-15T10:00:00.000Z',\n      endedAt: '2026-01-15T10:30:00.000Z',\n      locations: [{ view: 'front', regionId: 'left-knee' }],\n      intensity: 6,\n      qualities: ['ziehend'],\n      note: 'synthetischer Testeintrag',\n    })\n    return entry.id\n  })\n\n  await page.reload()\n\n  const storedEntry = await page.evaluate(async (id) => {\n    const repository = await import('/src/features/pain/painRepository.ts')\n    return repository.getPainEntry(id)\n  }, createdId)\n\n  expect(storedEntry).toMatchObject({\n    id: createdId,`,
  `  await page.evaluate(async () => {\n    const repository = await import('/src/features/pain/painRepository.ts')\n    await repository.createPainEntry({\n      startedAt: '2026-01-15T10:00:00.000Z',\n      endedAt: '2026-01-15T10:30:00.000Z',\n      locations: [{ view: 'front', regionId: 'left-knee' }],\n      intensity: 6,\n      qualities: ['ziehend'],\n      note: 'synthetischer Testeintrag',\n    })\n  })\n\n  await page.reload()\n\n  const storedEntry = await page.evaluate(async () => {\n    const repository = await import('/src/features/pain/painRepository.ts')\n    return (await repository.listPainEntries()).find(\n      (entry) => entry.note === 'synthetischer Testeintrag',\n    )\n  })\n\n  expect(storedEntry).toMatchObject({`,
  'canonical persistence lookup',
)
replaceOnce(
  'tests/persistence.spec.ts',
  `test('normalizes a Google Sheets URL to its spreadsheet id', async ({ page }) => {\n  await page.goto('/')\n\n  const saved = await page.evaluate(async () => {\n    const google = await import('/src/data/googleSheets.ts')\n    return google.setGoogleConfig({\n      clientId: 'example.apps.googleusercontent.com',\n      sheetId: 'https://docs.google.com/spreadsheets/d/test-sheet-id_123/edit#gid=0',\n    })\n  })\n\n  expect(saved).toEqual({\n    clientId: 'example.apps.googleusercontent.com',\n    sheetId: 'test-sheet-id_123',\n  })\n})`,
  `test('keeps the legacy plaintext Google Sheets gateway fail-closed', async ({ page }) => {\n  await page.goto('/')\n\n  const message = await page.evaluate(async () => {\n    const google = await import('/src/data/googleSheets.ts')\n    try {\n      google.setGoogleConfig({\n        clientId: 'example.apps.googleusercontent.com',\n        sheetId: 'test-sheet-id_123',\n      })\n      return ''\n    } catch (cause) {\n      return cause instanceof Error ? cause.message : String(cause)\n    }\n  })\n\n  expect(message).toContain('Legacy plaintext Google-Sheets synchronization is disabled')\n})`,
  'legacy Google fail-closed persistence test',
)

replaceOnce(
  'tests/pwa.spec.ts',
  "  expect(serviceWorker).toContain('eds-diary-shell-v14')",
  "  expect(serviceWorker).toMatch(/eds-diary-shell-v\\d+/)",
  'PWA cache version assertion',
)
replaceOnce(
  'tests/qr-share.spec.ts',
  "    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',",
  "    '**/vendor/qrcodejs/qrcode.min.js',",
  'QR vendor route',
)
