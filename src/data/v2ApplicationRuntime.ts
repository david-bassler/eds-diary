import type { TransferableWriterV2RuntimeSession } from '../sync/core/provider'
import { activeProtocolSelectionV2 } from './localDatabase'
import { TransferableSingleWriterV2SyncService } from './transferableSingleWriterV2SyncService'

let service:TransferableSingleWriterV2SyncService|null=null
let session:TransferableWriterV2RuntimeSession|null=null
// The generation is bumped *before* every asynchronous install/disconnect.
// A provider capability obtained after logout must never resurrect the runtime.
let sessionGeneration=0

export async function installAuthenticatedV2RemoteSession(value:TransferableWriterV2RuntimeSession):Promise<TransferableSingleWriterV2SyncService>{
  const generation=++sessionGeneration
  if(!await activeProtocolSelectionV2())throw new Error('Cannot install a v2 provider session without an active v2 selection.')
  if(generation!==sessionGeneration)throw new Error('V2 provider session changed during installation.')
  if(session===value&&service)return service
  const next=await TransferableSingleWriterV2SyncService.createAuthenticated(value)
  if(generation!==sessionGeneration){
    // A newer installation may reuse the very same provider session. Discard
    // only this abandoned coordinator; never disconnect its newer owner.
    await next.close(session!==value)
    throw new Error('V2 provider session changed during installation.')
  }
  const prior=service
  service=next
  session=value
  if(prior&&prior!==next)await prior.close()
  if(generation!==sessionGeneration||service!==next)throw new Error('V2 provider session changed during installation.')
  return next
}

export async function disconnectAuthenticatedV2RemoteSession():Promise<void>{
  sessionGeneration+=1
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
  reset():void{sessionGeneration+=1;service=null;session=null},
}
