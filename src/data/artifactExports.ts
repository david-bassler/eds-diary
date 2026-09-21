import { createBackup, testRestoreBackup, type SyncBackupV5 } from '../security/backup'
import type { RecoveryArtifact } from '../security/recovery'
import { SingleWriterV1RemoteVerifier } from '../sync/core/remoteVerifier'
import type { SingleWriterProviderSession } from '../sync/core/provider'
import { activeEpochSyncContext, activeEpochVerifierMaterial, DOMAIN_SCHEMA_REGISTRY, storedRotationArtifact } from './localDatabase'
import { storedRecoveredRecoveryArtifact } from './recoveryProfile'
import { deriveEpochSalt } from '../security/crypto/core'
import { fromBase64Url } from '../security/crypto/bytes'
import { createOriginMigrationBundle, type OriginMigrationBundleV1 } from '../security/originMigration'

export async function currentRecoveryArtifact():Promise<RecoveryArtifact>{const artifact=await storedRotationArtifact<RecoveryArtifact>('recovery')??await storedRecoveredRecoveryArtifact();if(!artifact)throw new Error('Für die aktive Epoche ist kein verifiziertes Recovery-Artefakt gespeichert.');return artifact}

export async function createCurrentVerifiedBackup(session:SingleWriterProviderSession):Promise<SyncBackupV5>{
  const active=await activeEpochSyncContext(),binding=active.state.remote_binding
  if(!binding)throw new Error('Ein aktuelles Backup für ein Remote-Profil erfordert eine authentifizierte Provider-Sitzung.')
  if(binding.provider_id!==session.profileId)throw new Error('Die authentifizierte Provider-Sitzung passt nicht zum gespeicherten Profil.')
  const transport=await session.transportForEpoch(active.diaryId,active.epochId),identityBinding=await session.remoteIdentityBinding(transport)
  if(identityBinding!==binding.remote_identity_binding)throw new Error('Die authentifizierte Provider-Identität stimmt nicht mit dem Profil überein.')
  const material=await activeEpochVerifierMaterial(),epochSalt=await deriveEpochSalt(fromBase64Url(active.diaryId),fromBase64Url(active.epochId)),verifier=new SingleWriterV1RemoteVerifier({rootKey:active.rootKey,diaryId:active.diaryId,epochId:active.epochId,expectedManifestFingerprint:active.state.manifest_fingerprint,expectedKeyId:active.state.key_id,expectedRecoveryGeneration:active.state.recovery_generation,expectedRecoveryCommitment:active.state.recovery_urs_commitment,expectedGoogleAccountBinding:identityBinding,schemas:DOMAIN_SCHEMA_REGISTRY,oldAnchor:active.state.remote_anchor,...material}),snapshot=await transport.read(binding.remote_resource_id)
  const verified=await verifier.verify(snapshot)
  if(verified.retired)throw new Error('A current backup cannot be exported from a retired epoch.')
  const backup=await createBackup({rootKey:active.rootKey,epochSalt,diaryId:active.diaryId,epochId:active.epochId,keyId:active.state.key_id,manifestFingerprint:active.state.manifest_fingerprint,epochManifestPublic:snapshot.manifest as readonly[string,string,string,string],remoteRows:snapshot.rows as ReadonlyArray<readonly[string,string,string]>,localEnvelopes:material.localEnvelopes,remoteBound:true,createdAt:new Date().toISOString()})
  await testRestoreBackup({rootKey:active.rootKey,epochSalt,diaryId:active.diaryId,epochId:active.epochId,keyId:active.state.key_id,manifestFingerprint:active.state.manifest_fingerprint},backup,verifier)
  return backup
}

export async function createCurrentOriginMigrationBundle(session:SingleWriterProviderSession,sourceOrigin=window.location.origin):Promise<OriginMigrationBundleV1>{
  const recovery=await currentRecoveryArtifact(),backup=await createCurrentVerifiedBackup(session)
  return createOriginMigrationBundle(recovery,backup,sourceOrigin)
}
