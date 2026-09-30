import type { TransferableWriterV2RuntimeSession } from '../sync/core/provider'
import { activeProtocolSelectionV2 } from './localDatabase'
import { TransferableSingleWriterV2SyncService } from './transferableSingleWriterV2SyncService'

let service:TransferableSingleWriterV2SyncService|null=null
let session:TransferableWriterV2RuntimeSession|null=null
let desiredSession:TransferableWriterV2RuntimeSession|null=null
// The generation is bumped *before* every asynchronous install/disconnect.
// A provider capability obtained after logout must never resurrect the runtime.
let sessionGeneration=0

function staleInstall():Error{return new Error('V2 provider session changed during installation.')}
function restoreDesiredAfterFailure(generation:number,value:TransferableWriterV2RuntimeSession):void{
  if(generation===sessionGeneration&&desiredSession===value)desiredSession=session
}
async function discardCandidate(
  candidate:TransferableSingleWriterV2SyncService,
  value:TransferableWriterV2RuntimeSession,
  generation:number,
):Promise<void>{
  // Only a *newer* install or an already-published runtime may own the exact
  // same provider. The current failing candidate still owns its provider and
  // must disconnect it (IA-140/141).
  const sharedWithNewer=(generation!==sessionGeneration&&desiredSession===value)||session===value
  await candidate.close(!sharedWithNewer)
}
async function disconnectUnownedProviderAfterConstructionFailure(
  generation:number,
  value:TransferableWriterV2RuntimeSession,
):Promise<void>{
  const newerSameInstall=generation!==sessionGeneration&&desiredSession===value
  const publishedSameSession=session===value
  if(!newerSameInstall&&!publishedSameSession)await value.disconnect()
}

export async function installAuthenticatedV2RemoteSession(value:TransferableWriterV2RuntimeSession):Promise<TransferableSingleWriterV2SyncService>{
  const generation=++sessionGeneration
  desiredSession=value
  let candidateCreated=false
  try{
    if(!await activeProtocolSelectionV2())throw new Error('Cannot install a v2 provider session without an active v2 selection.')
    if(generation!==sessionGeneration)throw staleInstall()

    if(session===value&&service){
      const current=service
      // Re-installation after ceremony/epoch change must perform the same fresh
      // full verification before reporting success. The already-published
      // runtime remains fail-closed if verification rejects.
      await current.refreshVerifiedReadModel()
      if(generation!==sessionGeneration||service!==current||session!==value)throw staleInstall()
      return current
    }

    const next=await TransferableSingleWriterV2SyncService.createAuthenticated(value)
    candidateCreated=true
    if(generation!==sessionGeneration){
      await discardCandidate(next,value,generation)
      throw staleInstall()
    }

    // Do not publish a candidate runtime until the first full provider read and
    // canonical verification has completed successfully (IA-140).
    try{
      await next.refreshVerifiedReadModel()
    }catch(error){
      await discardCandidate(next,value,generation)
      throw error
    }
    if(generation!==sessionGeneration){
      await discardCandidate(next,value,generation)
      throw staleInstall()
    }

    const prior=service
    if(prior&&prior!==next){
      try{
        await prior.close()
      }catch(error){
        // close() revokes the prior coordinator synchronously. If provider
        // teardown then fails, do not leave a closed runtime globally usable
        // and do not publish the candidate as a hidden partial success.
        if(service===prior){service=null;session=null}
        await discardCandidate(next,value,generation)
        throw error
      }
      if(generation!==sessionGeneration){
        await discardCandidate(next,value,generation)
        throw staleInstall()
      }
    }

    service=next
    session=value
    desiredSession=value
    return next
  }catch(error){
    // createAuthenticated() can reject before a service exists. In that case
    // the runtime has no coordinator whose close() can revoke the freshly
    // authenticated provider capability (IA-142).
    if(!candidateCreated){
      try{await disconnectUnownedProviderAfterConstructionFailure(generation,value)}
      catch{/* Never publish merely because provider teardown itself failed. */}
    }
    restoreDesiredAfterFailure(generation,value)
    throw error
  }
}

export async function disconnectAuthenticatedV2RemoteSession():Promise<void>{
  sessionGeneration+=1
  desiredSession=null
  const current=service
  service=null
  session=null
  if(current)await current.close()
}

export function activeV2SyncService():TransferableSingleWriterV2SyncService|null{return service}
export function activeV2ProviderSession():TransferableWriterV2RuntimeSession|null{return session}

export async function requireActiveV2SyncService():Promise<TransferableSingleWriterV2SyncService>{
  if(!await activeProtocolSelectionV2())throw new Error('No active v2 protocol selection exists.')
  if(!service)throw new Error('The active v2 diary requires an authenticated remote session for mutations.')
  return service
}

export async function synchronizeV2IfConnected():Promise<void>{
  if(service)await service.synchronize()
}

export const __v2ApplicationRuntimeTesting={
  reset():void{sessionGeneration+=1;desiredSession=null;service=null;session=null},
}
