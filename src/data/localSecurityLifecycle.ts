import { lockActiveRoot } from './localDatabase'
import { clearAuthenticatedRemoteSession } from './initializeDataLayer'

/**
 * Invalidate the local root/factors and the authenticated provider capability
 * in the same event turn. Neither revocation may wait for provider teardown.
 * The local lock succeeds independently even when provider disconnect fails.
 */
export async function lockLocalRootAndDisconnectSession():Promise<void>{
  const disconnect=clearAuthenticatedRemoteSession()
  const lock=lockActiveRoot()
  const [local,remote]=await Promise.allSettled([lock,disconnect])
  if(local.status==='rejected')throw local.reason
  if(remote.status==='rejected'){
    throw new Error('Das lokale Tagebuch ist gesperrt, aber die Google-Verbindung konnte nicht vollständig getrennt werden.')
  }
}
