import { createBackup, testRestoreBackup, type SyncBackupV5 } from '../security/backup'
import type { RecoveryArtifact } from '../security/recovery'
import { FullRemoteVerifier } from '../sync/core/remoteVerifier'
import { GoogleSheetsSingleWriterTransport, type GoogleApiClient } from '../sync/google/GoogleSheetsSingleWriterTransport'
import { activeEpochSyncContext, activeEpochVerifierMaterial, DOMAIN_SCHEMA_REGISTRY, storedRotationArtifact } from './localDatabase'
import { storedRecoveredRecoveryArtifact } from './recoveryProfile'
import { deriveEpochSalt } from '../security/crypto/core'
import { fromBase64Url } from '../security/crypto/bytes'

export async function currentRecoveryArtifact():Promise<RecoveryArtifact>{const artifact=await storedRotationArtifact<RecoveryArtifact>('recovery')??await storedRecoveredRecoveryArtifact();if(!artifact)throw new Error('Für die aktive Epoche ist kein verifiziertes Recovery-Artefakt gespeichert.');return artifact}

export async function createCurrentVerifiedBackup(api:GoogleApiClient):Promise<SyncBackupV5>{
  const active=await activeEpochSyncContext(),binding=active.state.remote_binding
  if(!binding)throw new Error('Ein aktuelles Backup für ein Remote-Profil erfordert eine authentifizierte Google-Sitzung.')
  const transport=await GoogleSheetsSingleWriterTransport.fromAuthenticatedSession(api,active.diaryId,active.epochId),account=await transport.authenticatedAccountBinding()
  if(account!==binding.remote_identity_binding)throw new Error('Das authentifizierte Google-Konto stimmt nicht mit dem Profil überein.')
  const material=await activeEpochVerifierMaterial(),epochSalt=await deriveEpochSalt(fromBase64Url(active.diaryId),fromBase64Url(active.epochId)),verifier=new FullRemoteVerifier({rootKey:active.rootKey,diaryId:active.diaryId,epochId:active.epochId,expectedManifestFingerprint:active.state.manifest_fingerprint,expectedKeyId:active.state.key_id,expectedRecoveryGeneration:active.state.recovery_generation,expectedRecoveryCommitment:active.state.recovery_urs_commitment,expectedGoogleAccountBinding:account,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:active.state.remote_anchor,...material}),snapshot=await transport.read(binding.remote_resource_id)
  await verifier.verify(snapshot)
  const backup=await createBackup({rootKey:active.rootKey,epochSalt,diaryId:active.diaryId,epochId:active.epochId,keyId:active.state.key_id,manifestFingerprint:active.state.manifest_fingerprint,epochManifestPublic:snapshot.manifest as readonly[string,string,string,string],remoteRows:snapshot.rows as ReadonlyArray<readonly[string,string,string]>,localEnvelopes:material.localEnvelopes,remoteBound:true,createdAt:new Date().toISOString()})
  await testRestoreBackup({rootKey:active.rootKey,epochSalt,diaryId:active.diaryId,epochId:active.epochId,keyId:active.state.key_id,manifestFingerprint:active.state.manifest_fingerprint},backup,verifier)
  return backup
}
