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

/** Main-page side of the Google auth handoff. The popup performs the
 * user-visible OAuth ceremony, then hands the bearer token directly to a
 * long-lived auth-origin bridge frame. The diary origin retains only an RPC
 * MessagePort and never receives the bearer credential. */
export class GoogleAuthProvider implements AuthProvider {
  private binding: IdentityBinding | null = null
  private client: AuthOriginGoogleApiClient | null = null
  private bridgeFrame: HTMLIFrameElement | null = null

  constructor(private readonly authUrl: string) {}

  async authenticate(actionId: string): Promise<IdentityBinding> {
    if (!this.authUrl) throw new Error('Google auth URL is not configured.')
    const popupUrl = new URL(this.authUrl, window.location.href)
    if (popupUrl.protocol !== 'https:' && popupUrl.protocol !== 'http:') {
      throw new Error('Google auth URL must use HTTP or HTTPS.')
    }
    const authOrigin = popupUrl.origin
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(actionId)) throw new Error('Invalid auth action binding.')
    await this.disconnect()

    popupUrl.searchParams.set('action_id', actionId)
    popupUrl.searchParams.set('return_origin', window.location.origin)
    popupUrl.searchParams.delete('mode')
    const popup = window.open(popupUrl, 'eds-diary-google-auth', 'popup,width=520,height=720')
    if (!popup) throw new Error('Google authentication popup was blocked.')

    const bridgeUrl = new URL(popupUrl)
    bridgeUrl.searchParams.set('mode', 'bridge')
    const bridge = document.createElement('iframe')
    bridge.hidden = true
    bridge.setAttribute('aria-hidden', 'true')
    bridge.tabIndex = -1
    this.bridgeFrame = bridge

    const client = await new Promise<AuthOriginGoogleApiClient>((resolve, reject) => {
      let settled = false
      let poll = 0
      let timeout = 0
      let popupReady = false
      let bridgeReady = false
      let bindingStarted = false
      let rpcPort: MessagePort | null = null
      let onRpcMessage: ((event: MessageEvent<unknown>) => void) | null = null

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
        bridge.remove()
        if (this.bridgeFrame === bridge) this.bridgeFrame = null
        rpcPort?.close()
        reject(error)
      }
      const complete = (permissionId: string) => {
        if (!permissionId || permissionId.length > 256) {
          fail(new Error('Google auth origin returned an invalid provider identity.'))
          return
        }
        if (settled || !rpcPort) return
        settled = true
        cleanup()
        if (onRpcMessage) rpcPort.removeEventListener('message', onRpcMessage)
        resolve(new AuthOriginGoogleApiClient(rpcPort, permissionId))
      }
      const maybeBind = () => {
        if (bindingStarted || !popupReady || !bridgeReady || !bridge.contentWindow) return
        bindingStarted = true
        const tokenChannel = new MessageChannel()
        const rpcChannel = new MessageChannel()
        rpcPort = rpcChannel.port1
        onRpcMessage = (portEvent: MessageEvent<unknown>) => {
          if (!portEvent.data || typeof portEvent.data !== 'object') return
          const bound = portEvent.data as Record<string, unknown>
          if (bound.type !== 'eds-diary/google-auth-bound/v2' || bound.action_id !== actionId) return
          complete(typeof bound.permission_id === 'string' ? bound.permission_id : '')
        }
        rpcPort.addEventListener('message', onRpcMessage)
        rpcPort.start()

        popup.postMessage({
          type: 'eds-diary/google-auth-popup-bind/v2',
          action_id: actionId,
          return_origin: window.location.origin,
        }, authOrigin, [tokenChannel.port1])

        bridge.contentWindow.postMessage({
          type: 'eds-diary/google-auth-bridge-bind/v2',
          action_id: actionId,
          return_origin: window.location.origin,
        }, authOrigin, [tokenChannel.port2, rpcChannel.port2])
      }
      const onWindowMessage = (event: MessageEvent<unknown>) => {
        if (event.origin !== authOrigin || !event.data || typeof event.data !== 'object') return
        const message = event.data as Record<string, unknown>
        if (message.action_id !== actionId) return
        if (event.source === popup && message.type === 'eds-diary/google-auth-ready/v2') {
          popupReady = true
          maybeBind()
          return
        }
        if (event.source === bridge.contentWindow && message.type === 'eds-diary/google-auth-bridge-ready/v2') {
          bridgeReady = true
          maybeBind()
        }
      }

      window.addEventListener('message', onWindowMessage)
      bridge.src = bridgeUrl.toString()
      document.body.append(bridge)
      poll = window.setInterval(() => {
        if (popup.closed && !bindingStarted) fail(new Error('Google authentication window was closed before the secure handoff started.'))
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
    this.bridgeFrame?.remove()
    this.bridgeFrame = null
  }
}
