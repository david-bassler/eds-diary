import { expect, test } from '@playwright/test'

test('exposes an installable web app manifest', async ({ page, request }) => {
  await page.goto('/')

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute('href')
  expect(manifestHref).toBeTruthy()

  const manifestResponse = await request.get(manifestHref!)
  expect(manifestResponse.ok()).toBe(true)

  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({
    name: 'EDS Schmerztagebuch',
    short_name: 'EDS Tagebuch',
    display: 'standalone',
    start_url: './',
  })
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      }),
      expect.objectContaining({
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      }),
    ]),
  )

  const appleTouchHref = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute('href')
  expect(appleTouchHref).toBeTruthy()

  const appleTouchResponse = await request.get(appleTouchHref!)
  expect(appleTouchResponse.ok()).toBe(true)
})

test('offers the browser PWA install prompt from configuration', async ({
  page,
}) => {
  await page.goto('/')

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt')
    Object.defineProperty(event, 'prompt', {
      value: () => Promise.resolve(),
    })
    Object.defineProperty(event, 'userChoice', {
      value: Promise.resolve({
        outcome: 'accepted',
        platform: 'web',
      }),
    })
    window.dispatchEvent(event)
  })

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Konfiguration' })
    .click()

  const installButton = page.getByRole('button', { name: 'App installieren' })
  await expect(installButton).toBeVisible()
  await installButton.click()
  await expect(page.getByText('Installation wurde gestartet.')).toBeVisible()
})

test('serves the service worker', async ({ page, request }) => {
  await page.goto('/')

  const serviceWorkerUrl = new URL('sw.js', page.url()).toString()
  const serviceWorkerResponse = await request.get(serviceWorkerUrl)

  expect(serviceWorkerResponse.ok()).toBe(true)
  expect(await serviceWorkerResponse.text()).toContain('eds-diary-shell-v8')
})

test('serves generated PNG body maps', async ({ page, request }) => {
  await page.goto('/')

  for (const file of [
    'front-gray.png',
    'front-hitmap.png',
    'back-gray.png',
    'back-hitmap.png',
  ]) {
    const url = new URL(`body-map/${file}`, page.url()).toString()
    const response = await request.get(url)

    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/png')
  }
})
