const DRIVE_ORIGIN = 'https://www.googleapis.com'
const SHEETS_ORIGIN = 'https://sheets.googleapis.com'

function exactMethod(method: string | undefined): string { return (method ?? 'GET').toUpperCase() }

/** Minimal URL/method policy for the capability exposed by the isolated Google
 * auth origin.  The diary origin can invoke only endpoints used by the strict
 * single-writer transport; arbitrary Google APIs are deliberately excluded. */
export function assertAllowedGoogleApiRequest(url: URL, methodInput?: string): void {
  const method = exactMethod(methodInput)
  const path = url.pathname
  let allowed = false

  if (url.protocol !== 'https:') throw new Error('API-Origin ist nicht erlaubt.')

  if (url.origin === DRIVE_ORIGIN) {
    if (path === '/drive/v3/about') allowed = method === 'GET'
    else if (path === '/drive/v3/files') allowed = method === 'GET'
    else if (/^\/drive\/v3\/files\/[^/]+$/u.test(path)) allowed = method === 'GET' || method === 'PATCH'
    else if (/^\/drive\/v3\/files\/[^/]+\/permissions$/u.test(path)) allowed = method === 'GET'
  } else if (url.origin === SHEETS_ORIGIN) {
    if (path === '/v4/spreadsheets') allowed = method === 'POST'
    else if (/^\/v4\/spreadsheets\/[^/:]+$/u.test(path)) allowed = method === 'GET'
    else if (/^\/v4\/spreadsheets\/[^/:]+:batchUpdate$/u.test(path)) allowed = method === 'POST'
  }

  if (!allowed) throw new Error('Google-API-Endpunkt oder HTTP-Methode ist nicht erlaubt.')
}
