import type { AuthProvider, IdentityBinding } from '../core/contracts'
import type { GoogleApiClient } from './GoogleSheetsSingleWriterTransport'

const AUTHENTICATED_CLIENTS=new WeakSet<GoogleApiClient>()
export function isAuthenticatedGoogleApiClient(client:GoogleApiClient):boolean{return AUTHENTICATED_CLIENTS.has(client)}
/** Local architecture-test seam. It is fail-closed in every production build. */
export function issueControlledTestGoogleClient(client:GoogleApiClient):GoogleApiClient{
  if(import.meta.env.MODE!=='test')throw new Error('Test provider identities are unavailable in production.')
  AUTHENTICATED_CLIENTS.add(client);return client
}

/** Main-origin side of the isolated auth handoff. It deliberately accepts no tokens. */
export class GoogleAuthProvider implements AuthProvider {
  private binding: IdentityBinding | null = null
  constructor(private readonly authOrigin: string) {}
  async authenticate(actionId: string): Promise<IdentityBinding> {
    if (!this.authOrigin || new URL(this.authOrigin).origin === window.location.origin) throw new Error('Google auth requires a separately configured static auth origin.')
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(actionId)) throw new Error('Invalid auth action binding.')
    throw new Error('Google auth handoff is release-blocked until the separate auth origin is deployed.')
  }
  getIdentityBinding(): IdentityBinding | null { return this.binding }
  async disconnect(): Promise<void> { this.binding = null }
}
