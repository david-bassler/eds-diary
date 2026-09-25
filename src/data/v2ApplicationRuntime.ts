import type { TransferableSingleWriterV2ProviderSession } from '../sync/google/GoogleTransferableSingleWriterV2Provider'
import { activeProtocolSelectionV2 } from './localDatabase'
import { TransferableSingleWriterV2SyncService } from './transferableSingleWriterV2SyncService'

let service:TransferableSingleWriterV2SyncService|null=null
let session:TransferableSingleWriterV2ProviderSession|null=null

export async function installAuthenticatedV2RemoteSession(value:TransferableSingleWriterV2ProviderSession):Promise<void>{
  if(!await activeProtocolSelectionV2())throw new Error('Cannot install a v2 provider session without an active v2 selection.')
  const next=await TransferableSingleWriterV2SyncService.createAuthenticated(value)
  const prior=service
  service=next
  session=value
  if(prior&&prior!==next)await prior.close()
}

export async function disconnectAuthenticatedV2RemoteSession():Promise<void>{
  const current=service
  service=null
  session=null
  if(current)await current.close()
}

export function activeV2SyncService():TransferableSingleWriterV2SyncService|null{return service}
export function activeV2ProviderSession():TransferableSingleWriterV2ProviderSession|null{return session}

export async function requireActiveV2SyncService():Promise<TransferableSingleWriterV2SyncService>{
  if(!await activeProtocolSelectionV2())throw new Error('No active v2 protocol selection exists.')
  if(!service)throw new Error('The active v2 diary requires an authenticated remote session for mutations.')
  return service
}

export async function synchronizeV2IfConnected():Promise<void>{
  if(service)await service.synchronize()
}

export const __v2ApplicationRuntimeTesting={
  reset():void{service=null;session=null},
}
