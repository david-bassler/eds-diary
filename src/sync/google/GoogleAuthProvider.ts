import type { AuthProvider, IdentityBinding } from '../core/contracts'
import type { GoogleApiClient } from './GoogleSheetsSingleWriterTransport'

const AUTHENTICATED_CLIENTS = new WeakSet<GoogleApiClient>()
const HANDOFF_TIMEOUT_MS = 120_000
const GOOGLE_API_ORIGINS = new Set([
  'https://www.googleapis.com',
  'https://sheets.googleapis.com',
])

interface GoogleRpcInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

interface GoogleRpcResponse {
  type: 'eds-diary/google-api-response/v1'
  request_id: string
  ok: boolean
  value?: unknown
  error?: { message?: string; status?: number }
}

function requestInit(init?: RequestInit): GoogleRpcInit | undefined {
  if (!init) return undefined
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new Error('Google RPC only permits string request bodies.')
  }
  const headers = new Headers(init.headers)
  if (headers.has('authorization')) throw new Error('Authorization headers must never enter the diary origin.')
  const copiedHeaders = Object.fromEntries(headers.entries())
  return {
    ...(init.method ? { method: init.method } : {}),
    ...(Object.keys(copiedHeaders).length ? { headers: copiedHeaders } : {}),
    ...(typeof init.body === 'string' ? { body: init.body } : {}),
  }
}

class AuthOriginGoogleApiClient implements GoogleApiClient {
  private sequence = 0
  private closed = false
  constructor(private readonly port: MessagePort, private readonly permissionId: string) {
    port.start()
  }

  identity(): string { return this.permissionId }

  async request<T>(url: string, init?: RequestInit): Promise<T> {
    if (this.closed) throw new Error('Google authentication session is closed.')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !GOOGLE_API_ORIGINS.has(parsed.origin)) {
      throw new Error('Google RPC target is outside the approved provider origins.')
    }
    const requestId = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    const response = await new Promise<GoogleRpcResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('Google API proxy request timed out.'))
      }, HANDOFF_TIMEOUT_MS)
      const onMessage = (event: MessageEvent<unknown>) => {
        const value = event.data
        if (!value || typeof value !== 'object') return
        const candidate = value as Partial<GoogleRpcResponse>
        if (candidate.type !== 'eds-diary/google-api-response/v1' || candidate.request_id !== requestId) return
        cleanup()
        resolve(candidate as GoogleRpcResponse)
      }
      const onError = () => {
        cleanup()
        reject(new Error('Google API proxy channel failed.'))
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        this.port.removeEventListener('message', onMessage)
        this.port.removeEventListener('messageerror', onError)
      }
      this.port.addEventListener('message', onMessage)
      this.port.addEventListener('messageerror', onError)
      this.port.postMessage({
        type: 'eds-diary/google-api-request/v1',
        request_id: requestId,
        url: parsed.toString(),
        init: requestInit(init),
      })
    })
    if (!response.ok) {
      const error = new Error(response.error?.message || 'Google provider request failed.') as Error & { status?: number }
      if (Number.isSafeInteger(response.error?.status)) error.status = response.error?.status
      throw error
    }
    return response.value as T
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.port.postMessage({ type: 'eds-diary/google-auth-disconnect/v1' })
    this.port.close()
  }
}

export function isAuthenticatedGoogleApiClient(client: GoogleApiClient): boolean {
  return AUTHENTICATED_CLIENTS.has(client)
}

/** Local architecture-test seam. It is fail-closed in every production build. */
export function issueControlledTestGoogleClient(client: GoogleApiClient): GoogleApiClient {
  if (import.meta.env.MODE !== 'test') throw new Error('Test provider identities are unavailable in production.')
  AUTHENTICATED_CLIENTS.add(client)
  return client
}

/** Main-origin side of the isolated auth handoff. Tokens and Google runtime code
 * remain on the separate auth origin; the diary receives only a bound RPC port. */
export class GoogleAuthProvider implements AuthProvider {
  private binding: IdentityBinding | null = null
  private client: AuthOriginGoogleApiClient | null = null

  constructor(private readonly authOrigin: string) {}

  async authenticate(actionId: string): Promise<IdentityBinding> {
    const authOrigin = new URL(this.authOrigin).origin
    if (!this.authOrigin || authOrigin === window.location.origin) {
      throw new Error('Google auth requires a separately configured static auth origin.')
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(actionId)) throw new Error('Invalid auth action binding.')
    await this.disconnect()

    const url = new URL('/google-auth/', authOrigin)
    url.searchParams.set('action_id', actionId)
    url.searchParams.set('return_origin', window.location.origin)
    const popup = window.open(url, 'eds-diary-google-auth', 'popup,width=520,height=720')
    if (!popup) throw new Error('Google authentication popup was blocked.')

    const client = await new Promise<AuthOriginGoogleApiClient>((resolve, reject) => {
      let settled = false
      let poll = 0
      let timeout = 0
      const cleanup = () => {
        window.removeEventListener('message', onWindowMessage)
        if (poll) window.clearInterval(poll)
        if (timeout) window.clearTimeout(timeout)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        try { popup.close() } catch { /* no-op */ }
        reject(error)
      }
      const onWindowMessage = (event: MessageEvent<unknown>) => {
        if (event.origin !== authOrigin || event.source !== popup || !event.data || typeof event.data !== 'object') return
        const message = event.data as Record<string, unknown>
        if (message.type !== 'eds-diary/google-auth-ready/v1' || message.action_id !== actionId) return
        const channel = new MessageChannel()
        const onPortMessage = (portEvent: MessageEvent<unknown>) => {
          if (!portEvent.data || typeof portEvent.data !== 'object') return
          const bound = portEvent.data as Record<string, unknown>
          if (bound.type !== 'eds-diary/google-auth-bound/v1' || bound.action_id !== actionId) return
          const permissionId = typeof bound.permission_id === 'string' ? bound.permission_id : ''
          if (!permissionId || permissionId.length > 256) {
            channel.port1.close()
            fail(new Error('Google auth origin returned an invalid provider identity.'))
            return
          }
          if (settled) return
          settled = true
          cleanup()
          channel.port1.removeEventListener('message', onPortMessage)
          resolve(new AuthOriginGoogleApiClient(channel.port1, permissionId))
        }
        channel.port1.addEventListener('message', onPortMessage)
        channel.port1.start()
        popup.postMessage({
          type: 'eds-diary/google-auth-bind/v1',
          action_id: actionId,
          return_origin: window.location.origin,
        }, authOrigin, [channel.port2])
      }
      window.addEventListener('message', onWindowMessage)
      poll = window.setInterval(() => {
        if (popup.closed) fail(new Error('Google authentication window was closed.'))
      }, 500)
      timeout = window.setTimeout(() => fail(new Error('Google authentication handoff timed out.')), HANDOFF_TIMEOUT_MS)
    })

    AUTHENTICATED_CLIENTS.add(client)
    this.client = client
    this.binding = { providerId: 'google-sheets-single-writer-v1', subject: client.identity() }
    return this.binding
  }

  getIdentityBinding(): IdentityBinding | null { return this.binding }

  getApiClient(): GoogleApiClient {
    if (!this.client || !this.binding || !AUTHENTICATED_CLIENTS.has(this.client)) {
      throw new Error('Google authentication session is not established.')
    }
    return this.client
  }

  async disconnect(): Promise<void> {
    this.client?.close()
    this.client = null
    this.binding = null
  }
}
