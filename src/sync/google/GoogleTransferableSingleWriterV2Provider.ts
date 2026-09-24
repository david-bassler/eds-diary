import { GOOGLE_DRIVE_SHEETS_PROVIDER, SINGLE_WRITER_V2_PROFILE, type RemoteTransport } from '../core/contracts'
import { runCreationStateMachine, type CreationPersistence, type CreationState } from '../core/creation'
import { GoogleAuthProvider, isAuthenticatedGoogleApiClient } from './GoogleAuthProvider'
import {
  epochLocatorV2,
  GoogleSheetsTransferableSingleWriterV2Transport,
  isAuthenticatedGoogleV2Transport,
  type GoogleApiClient,
} from './GoogleSheetsTransferableSingleWriterV2Transport'
import { GoogleSheetsTransferableSingleWriterV2ProfileCodec } from './GoogleSheetsTransferableSingleWriterV2ProfileCodec'
import { GoogleRecoveryArtifactStoreV6, type DiscoveredRecoveryArtifactV6 } from './GoogleRecoveryArtifactStoreV6'
import { deriveEpochSaltV2 } from '../../security/v2/crypto'
import { fixedBase64Url } from '../../security/crypto/bytes'
import {
  manifestCellsArrayV6,
  manifestFingerprintV6,
  openManifestV6,
  parseManifestCellsV6,
  type ManifestCellsV6,
} from '../../security/v2/manifest'
import type { RecoveryArtifactV6 } from '../../security/v2/recovery'
import { isVerifiedRecoveryTakeoverStagingV2, type VerifiedRecoveryTakeoverStagingV2 } from '../../security/v2/recoveryStaging'
import type { VerifiedPersistedRecoveryArtifactV6 } from '../../security/v2/localPersistence'
import type { FreshCanonicalV2Source } from '../../security/v2/domainWrite'

export interface TransferableSingleWriterV2ProviderSession {
  readonly providerId:typeof GOOGLE_DRIVE_SHEETS_PROVIDER
  readonly profileId:typeof SINGLE_WRITER_V2_PROFILE
  transportForEpoch(diaryId:string,epochId:string):Promise<GoogleSheetsTransferableSingleWriterV2Transport>
  remoteIdentityBinding(transport:RemoteTransport):Promise<string>
  codecForEpoch(diaryId:string,epochId:string,rootKey:Uint8Array,transport:RemoteTransport):Promise<GoogleSheetsTransferableSingleWriterV2ProfileCodec>
  freshCanonicalSource(diaryId:string,epochId:string,rootKey:Uint8Array,remoteId:string):FreshCanonicalV2Source
  creationProperties(diaryId:string,epochId:string):Promise<Readonly<Record<string,string>>>
  createOrReconcileEpoch(args:{
    diaryId:string
    epochId:string
    rootKey:Uint8Array
    creationLocator:string
    manifest:ManifestCellsV6
    transport:GoogleSheetsTransferableSingleWriterV2Transport
    persistence:CreationPersistence
    recoveryStaging:VerifiedRecoveryTakeoverStagingV2
  }):Promise<CreationState>
  publishRecoveryArtifact(urs:Uint8Array,artifact:VerifiedPersistedRecoveryArtifactV6):Promise<string>
  discoverRecoveryFamilyArtifacts(urs:Uint8Array):Promise<readonly DiscoveredRecoveryArtifactV6[]>
  findRecoveryArtifact(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6|null>
  loadRecoveryArtifact(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6>
  disconnect():Promise<void>
}

class GoogleTransferableSingleWriterV2ProviderSession implements TransferableSingleWriterV2ProviderSession {
  readonly providerId=GOOGLE_DRIVE_SHEETS_PROVIDER
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  constructor(private readonly api:GoogleApiClient,private readonly closeSession:()=>Promise<void>){
    if(!isAuthenticatedGoogleApiClient(api))throw new Error('Google v2 provider session requires an authenticated API capability.')
  }
  transportForEpoch(diaryId:string,epochId:string):Promise<GoogleSheetsTransferableSingleWriterV2Transport>{
    return GoogleSheetsTransferableSingleWriterV2Transport.fromAuthenticatedSession(this.api,diaryId,epochId)
  }
  async remoteIdentityBinding(transport:RemoteTransport):Promise<string>{
    if(!isAuthenticatedGoogleV2Transport(transport))throw new Error('Google v2 identity binding requires the authenticated v2 transport.')
    return transport.authenticatedAccountBinding()
  }
  async codecForEpoch(diaryId:string,epochId:string,rootKey:Uint8Array,transport:RemoteTransport):Promise<GoogleSheetsTransferableSingleWriterV2ProfileCodec>{
    if(!isAuthenticatedGoogleV2Transport(transport)||transport.profileId!==SINGLE_WRITER_V2_PROFILE)throw new Error('Google v2 codec requires the authenticated v2 transport.')
    return new GoogleSheetsTransferableSingleWriterV2ProfileCodec(diaryId,epochId,rootKey,await transport.authenticatedAccountBinding())
  }
  freshCanonicalSource(diaryId:string,epochId:string,rootKey:Uint8Array,remoteId:string):FreshCanonicalV2Source{
    fixedBase64Url(diaryId,16,'diary_id')
    fixedBase64Url(epochId,16,'epoch_id')
    if(rootKey.byteLength!==32)throw new Error('V2 fresh canonical source requires a 32-byte root key.')
    if(!remoteId)throw new Error('V2 fresh canonical source requires a bound remote resource ID.')
    return Object.freeze({
      verifyNow:async()=>{
        const transport=await this.transportForEpoch(diaryId,epochId)
        const codec=await this.codecForEpoch(diaryId,epochId,rootKey,transport)
        return codec.verifyRemote(await transport.read(remoteId))
      },
    })
  }
  async creationProperties(diaryId:string,epochId:string):Promise<Readonly<Record<string,string>>>{
    return{app_format:'sync-v6',epoch_locator:await epochLocatorV2(diaryId,epochId)}
  }
  async createOrReconcileEpoch(args:{
    diaryId:string;epochId:string;rootKey:Uint8Array;creationLocator:string;manifest:ManifestCellsV6;transport:GoogleSheetsTransferableSingleWriterV2Transport;persistence:CreationPersistence;recoveryStaging:VerifiedRecoveryTakeoverStagingV2
  }):Promise<CreationState>{
    fixedBase64Url(args.creationLocator,16,'creation_locator')
    const epochSalt=await deriveEpochSaltV2(fixedBase64Url(args.diaryId,16),fixedBase64Url(args.epochId,16))
    const payload=await openManifestV6(args.rootKey,epochSalt,{diaryId:args.diaryId,epochId:args.epochId},args.manifest)
    const fingerprint=await manifestFingerprintV6(args.manifest)
    if(!isVerifiedRecoveryTakeoverStagingV2(args.recoveryStaging))throw new Error('Verified persistent RecoveryTakeoverStagingV2 is required before remote creation.')
    const staging=args.recoveryStaging.staging
    if(staging.diary_id!==args.diaryId
      ||staging.epoch_id!==args.epochId
      ||staging.manifest_fingerprint!==fingerprint
      ||staging.recovery_generation!==payload.recovery_generation
      ||staging.recovery_takeover_key_id!==payload.recovery_takeover_key_id
      ||staging.recovery_takeover_public_key!==payload.recovery_takeover_public_key)throw new Error('RecoveryTakeoverStagingV2 does not bind the planned ManifestV6.')
    if(payload.creation_locator!==args.creationLocator)throw new Error('Creation locator does not match protected ManifestV6.')
    if(payload.google_account_binding!==await args.transport.authenticatedAccountBinding())throw new Error('Creation ManifestV6 Google account binding mismatch.')
    const codec=await this.codecForEpoch(args.diaryId,args.epochId,args.rootKey,args.transport)
    const cells=manifestCellsArrayV6(args.manifest)
    if(await manifestFingerprintV6(parseManifestCellsV6(cells))!==fingerprint)throw new Error('ManifestV6 fingerprint changed during creation preparation.')
    const initial:CreationState={
      locator:args.creationLocator,
      manifestFingerprint:fingerprint,
      status:'planned',
      remoteId:null,
      diaryId:args.diaryId,
      epochId:args.epochId,
      keyId:payload.key_id,
      expectedProperties:await this.creationProperties(args.diaryId,args.epochId),
      operationGeneration:0,
    }
    return runCreationStateMachine(initial,cells,args.transport,codec,args.persistence)
  }
  publishRecoveryArtifact(urs:Uint8Array,artifact:VerifiedPersistedRecoveryArtifactV6):Promise<string>{
    return new GoogleRecoveryArtifactStoreV6(this.api).publish(urs,artifact)
  }
  discoverRecoveryFamilyArtifacts(urs:Uint8Array):Promise<readonly DiscoveredRecoveryArtifactV6[]>{
    return new GoogleRecoveryArtifactStoreV6(this.api).discoverFamilyArtifacts(urs)
  }
  findRecoveryArtifact(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6|null>{
    return new GoogleRecoveryArtifactStoreV6(this.api).find(urs,diaryId,epochId)
  }
  loadRecoveryArtifact(urs:Uint8Array,diaryId:string,epochId:string):Promise<RecoveryArtifactV6>{
    return new GoogleRecoveryArtifactStoreV6(this.api).load(urs,diaryId,epochId)
  }
  disconnect():Promise<void>{return this.closeSession()}
}

export function googleV2ProviderSessionFromAuthenticatedClient(api:GoogleApiClient,disconnect:()=>Promise<void>=async()=>{}):TransferableSingleWriterV2ProviderSession{
  return new GoogleTransferableSingleWriterV2ProviderSession(api,disconnect)
}

export class GoogleTransferableSingleWriterV2Provider {
  readonly providerId=GOOGLE_DRIVE_SHEETS_PROVIDER
  readonly profileId=SINGLE_WRITER_V2_PROFILE
  constructor(private readonly authUrl:string){}
  async authenticate(actionId:string):Promise<TransferableSingleWriterV2ProviderSession>{
    const auth=new GoogleAuthProvider(this.authUrl)
    await auth.authenticate(actionId)
    return googleV2ProviderSessionFromAuthenticatedClient(auth.getApiClient(),()=>auth.disconnect())
  }
}
