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

replaceOnce(
  'src/data/localDatabase.ts',
  "function logicalAppId(revision:Revision,store:LocalStoreName):string{if(store===LOCAL_STORES.settings){if(revision.record_type==='activity_type_settings')return'activity-types';if(revision.record_type==='pain_type_settings')return'pain-types'}return revision.record_id}",
  "function logicalAppId(revision:Revision,store:LocalStoreName):string{if(store===LOCAL_STORES.settings){if(revision.record_type==='activity_type_settings')return'activity-types';if(revision.record_type==='pain_type_settings')return'custom-pain-types'}return revision.record_id}",
  'custom pain type logical id',
)

replaceOnce(
  'tests/activity-help.spec.ts',
  "  await expect(page.getByText('Zeiträume der Aktivität')).toBeVisible()",
  "  await expect(page.getByText('Zeiträume der Aktivität')).not.toBeVisible()",
  'activity help hidden heading',
)
replaceOnce(
  'tests/activity-help.spec.ts',
  "  await expect(page.locator('.activity-page__autosave-note')).toHaveText(\n    'Änderungen werden automatisch gespeichert.',\n  )",
  "  await expect(page.locator('.activity-page__autosave-note')).not.toBeVisible()",
  'activity help hidden autosave note',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "  await expect(\n    page.getByRole('heading', { level: 2, name: 'Zeiträume der Aktivität' }),\n  ).toBeVisible()",
  "  await expect(page.locator('.activity-page__intro')).not.toBeVisible()",
  'activity compact intro assertion',
)
replaceOnce(
  'tests/activity-page.spec.ts',
  "  await activityCombobox.focus()\n  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'true')\n  const activityOptions = page.getByRole('listbox', {",
  "  await activityCombobox.focus()\n  await expect(activityCombobox).toHaveAttribute('aria-expanded', 'true')\n  await activityCombobox.fill('')\n  const activityOptions = page.getByRole('listbox', {",
  'activity unfiltered saved types',
)
replaceAll(
  'tests/medication-entry.spec.ts',
  "intake(page).getByLabel('Medikament', { exact: true })",
  "intake(page).locator('input[list=\"medication-name-options\"]')",
  3,
  'medication name input locator',
)
replaceOnce(
  'tests/pain-entry-flow.spec.ts',
  "page.getByLabel('Endzeit').fill('10:30')",
  "page.getByLabel('Endzeit', { exact: true }).fill('10:30')",
  'exact pain end time locator',
)
replaceOnce(
  'tests/pain-entry-list.spec.ts',
  "page.getByText('Für diesen Filter gibt es keine Schmerzeinträge.')",
  "page.getByText('Für diesen Filter gibt es keine Einträge.')",
  'pain list empty filter copy',
)
