import fs from 'node:fs'

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,value){fs.writeFileSync(path,value)}
function replaceOnce(source,before,after,label){const at=source.indexOf(before);if(at<0)throw new Error(`Missing ${label}`);if(source.indexOf(before,at+before.length)>=0)throw new Error(`Duplicate ${label}`);return source.slice(0,at)+after+source.slice(at+before.length)}

{
  const path='src/sync/core/remoteVerifier.ts'
  let source=read(path)
  source=replaceOnce(source,"import { deriveEpochSalt } from '../../security/crypto/core'","import { deriveEpochSalt, sha256 } from '../../security/crypto/core'",'remote verifier crypto import')
  source=replaceOnce(source,"import { fixedBase64Url } from '../../security/crypto/bytes'","import { base64Url, fixedBase64Url } from '../../security/crypto/bytes'\nimport { canonicalBytes } from '../../security/crypto/canonical'\nimport type { SyncBackupV5 } from '../../security/backup'",'remote verifier backup imports')
  const marker='/** Trust material that is deliberately unavailable in a RecoveryArtifact.'
  const at=source.indexOf(marker)
  if(at<0)throw new Error('Missing bootstrap authority tail')
  source=source.slice(0,at)+`/** Trust material that is deliberately unavailable in a RecoveryArtifact.
 * Remote authority is fixed by authenticated discovery. Backup authority is
 * fixed by an independently selected backup document whose exact bytes are
 * hashed at capability creation and rechecked before candidate verification. */
export type RecoveryRemoteBinding={provider_id:'google-sheets-single-writer-v1';remote_resource_id:string;remote_identity_binding:string}
export interface VerifiedRecoveryBootstrap {source:'authenticated-remote'|'verified-backup';verified:VerifiedRemoteState;remoteBinding:RecoveryRemoteBinding|null}
const TRUSTED_AUTHORITIES=new WeakSet<IndependentBootstrapAuthority>()
export class IndependentBootstrapAuthority {
  private constructor(readonly source:'authenticated-remote'|'verified-backup',readonly remoteResourceId:string|null,readonly authenticatedAccountBinding:string|null,private readonly transport:GoogleSheetsSingleWriterTransport|null,private readonly backup:SyncBackupV5|null,private readonly backupDigest:string|null){TRUSTED_AUTHORITIES.add(this)}
  static async fromAuthenticatedGoogleDiscovery(transport:GoogleSheetsSingleWriterTransport,locator:string,remoteResourceId:string):Promise<IndependentBootstrapAuthority>{if(!isAuthenticatedGoogleTransport(transport))throw new Error('Recovery authority requires the productive Google identity boundary.');const authenticatedAccountBinding=await transport.authenticatedAccountBinding();const candidates=await transport.discover(locator);if(!candidates.some(candidate=>candidate.remoteId===remoteResourceId))throw new Error('Recovery resource was not established by authenticated discovery.');return new IndependentBootstrapAuthority('authenticated-remote',remoteResourceId,authenticatedAccountBinding,transport,null,null)}
  static async fromIndependentBackup(backup:SyncBackupV5):Promise<IndependentBootstrapAuthority>{if(!backup||typeof backup!=='object'||backup.format!=='sync-backup-v5'||backup.backup_format_version!==5)throw new Error('Recovery backup authority requires a sync-backup-v5 document.');const bytes=canonicalBytes(backup as never);if(bytes.byteLength>256*1024*1024)throw new Error('Recovery backup exceeds the supported bound.');return new IndependentBootstrapAuthority('verified-backup',null,null,null,backup,base64Url(await sha256(bytes)))}
  async loadRemote():Promise<RemoteSnapshot>{if(this.source!=='authenticated-remote'||!this.transport||!this.remoteResourceId)throw new Error('Bootstrap authority is not a remote authority.');return this.transport.read(this.remoteResourceId)}
  async loadBackup():Promise<SyncBackupV5>{if(this.source!=='verified-backup'||!this.backup||!this.backupDigest)throw new Error('Bootstrap authority is not a backup authority.');const digest=base64Url(await sha256(canonicalBytes(this.backup as never)));if(digest!==this.backupDigest)throw new Error('Independently selected recovery backup changed after authority creation.');return this.backup}
}

export interface RecoveryBootstrapOptions {
  authority:IndependentBootstrapAuthority
  schemas:Readonly<Record<string,unknown>>
}

/** A recovery-specific verifier. Unlike FullRemoteVerifier, it has no caller
 * supplied trusted manifest fields. Candidate fields become usable only after
 * they have been checked against an independently fixed remote or backup. */
export class RecoveryBootstrapVerifier {
  constructor(private readonly options:RecoveryBootstrapOptions){if(!TRUSTED_AUTHORITIES.has(options.authority))throw new Error('Independent bootstrap authority is incomplete or forged.');if(options.authority.source==='authenticated-remote'&&(!options.authority.remoteResourceId||!options.authority.authenticatedAccountBinding))throw new Error('Independent remote authority is incomplete.')}
  async verifyCandidate(candidate:RecoveredRootCandidate):Promise<VerifiedRecoveryBootstrap>{
    const p=candidate.payload,authority=this.options.authority
    if(authority.source==='authenticated-remote'){
      if(p.google_account_binding!==authority.authenticatedAccountBinding)throw new Error('Recovery account binding was not independently authenticated.')
      if(p.remote_anchor===null)throw new Error('Remote recovery requires a non-null independently checked anchor.')
      const verifier=new FullRemoteVerifier({rootKey:candidate.rootKey,diaryId:p.diary_id,epochId:p.epoch_id,expectedManifestFingerprint:p.manifest_fingerprint,expectedKeyId:p.key_id,expectedRecoveryGeneration:p.recovery_generation,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:authority.authenticatedAccountBinding!,schemas:this.options.schemas,oldAnchor:p.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()}),verified=await verifier.verify(await authority.loadRemote())
      return{source:'authenticated-remote',verified,remoteBinding:{provider_id:'google-sheets-single-writer-v1',remote_resource_id:authority.remoteResourceId!,remote_identity_binding:authority.authenticatedAccountBinding!}}
    }
    const backup=await authority.loadBackup(),epochSalt=await deriveEpochSalt(fixedBase64Url(p.diary_id,16),fixedBase64Url(p.epoch_id,16)),verifier=new FullRemoteVerifier({rootKey:candidate.rootKey,diaryId:p.diary_id,epochId:p.epoch_id,expectedManifestFingerprint:p.manifest_fingerprint,expectedKeyId:p.key_id,expectedRecoveryGeneration:p.recovery_generation,expectedRecoveryCommitment:candidate.recoveryCommitment,expectedGoogleAccountBinding:p.google_account_binding,schemas:this.options.schemas,oldAnchor:p.remote_anchor,localEnvelopes:[],localHeadRevisionIds:new Set()}),backupModule=await import('../../security/backup'),rows=await backupModule.testRestoreBackup({rootKey:candidate.rootKey,epochSalt,diaryId:p.diary_id,epochId:p.epoch_id,keyId:p.key_id,manifestFingerprint:p.manifest_fingerprint},backup,verifier),verified=await verifier.verify({manifest:backup.epoch_manifest_public,rows})
    return{source:'verified-backup',verified,remoteBinding:null}
  }
}
`
  write(path,source)
}

{
  const path='src/security/recovery.ts'
  let source=read(path)
  source=replaceOnce(source,"import { RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'","import { RecoveryBootstrapVerifier, type VerifiedRecoveryBootstrap } from '../sync/core/remoteVerifier'",'recovery bootstrap import')
  const before=`export async function activateRecoveredRoot(candidate:RecoveredRootCandidate,verifier:RecoveryBootstrapVerifier,persistWrap:(rootKey:Uint8Array,payload:RecoveryPayload)=>Promise<void>):Promise<void>{
  if (!(verifier instanceof RecoveryBootstrapVerifier)) throw new Error('An independently authenticated bootstrap verifier is required.')
  const p=candidate.payload;validatePayload(p)
  const verified=await verifier.verifyCandidate(candidate)
  if(verified.manifestFingerprint!==p.manifest_fingerprint)throw new Error('Verified remote does not bind the recovery candidate.')
  await persistWrap(candidate.rootKey,p)
}`
  const after=`export interface RecoveryPersistenceProof {rootWrapReadback:true;stateMacVerified:true;envelopeJournalVerified:true}
export async function activateRecoveredRoot(candidate:RecoveredRootCandidate,verifier:RecoveryBootstrapVerifier,persistVerifiedProfile:(candidate:RecoveredRootCandidate,bootstrap:VerifiedRecoveryBootstrap)=>Promise<RecoveryPersistenceProof>):Promise<VerifiedRecoveryBootstrap>{
  if (!(verifier instanceof RecoveryBootstrapVerifier)) throw new Error('An independently authenticated bootstrap verifier is required.')
  const p=candidate.payload;validatePayload(p)
  const bootstrap=await verifier.verifyCandidate(candidate)
  if(bootstrap.verified.manifestFingerprint!==p.manifest_fingerprint)throw new Error('Verified bootstrap does not bind the recovery candidate.')
  const proof=await persistVerifiedProfile(candidate,bootstrap)
  if(!proof||proof.rootWrapReadback!==true||proof.stateMacVerified!==true||proof.envelopeJournalVerified!==true)throw new Error('Recovered root was not persistently wrapped and readback-verified.')
  return bootstrap
}`
  source=replaceOnce(source,before,after,'activate recovered root')
  write(path,source)
}

{
  const path='src/data/productiveRotationService.ts'
  let source=read(path)
  source=replaceOnce(source,"import { DOMAIN_SCHEMA_REGISTRY, IndexedDbCoordinatorStore, IndexedDbRotationRepository, indexedDbCreationPersistence, indexedDbRotationPersistence, type EpochContext, type VerifiedEpochMaterial } from './localDatabase'","import { DOMAIN_SCHEMA_REGISTRY, IndexedDbCoordinatorStore, IndexedDbRotationRepository, indexedDbCreationPersistence, indexedDbRotationPersistence, type EpochContext, type VerifiedEpochMaterial } from './localDatabase'\nimport { persistRecoveredProfile } from './recoveryProfile'",'productive recovery profile import')
  source=replaceOnce(source,"await activateRecoveredRoot(candidate,verifier,async()=>undefined);if(!stored)","await activateRecoveredRoot(candidate,verifier,(verifiedCandidate,bootstrap)=>persistRecoveredProfile(verifiedCandidate,bootstrap,DOMAIN_SCHEMA_REGISTRY,{databaseName:`eds-diary-recovery-gate-${state.rotationId}`,cleanupAfterVerify:true}));if(!stored)",'productive recovery persistence gate')
  write(path,source)
}

{
  const path='src/test/recovery-rotation.test.ts'
  let source=read(path)
  source=replaceOnce(source,"import { FullRemoteVerifier, IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'","import { FullRemoteVerifier, IndependentBootstrapAuthority, RecoveryBootstrapVerifier } from '../sync/core/remoteVerifier'\nimport { createBackup } from '../security/backup'",'recovery test backup import')
  source=replaceOnce(source,"await activateRecoveredRoot(candidate,verifier,async()=>{persisted=true});expect(persisted).toBe(true)","await activateRecoveredRoot(candidate,verifier,async()=>{persisted=true;return{rootWrapReadback:true,stateMacVerified:true,envelopeJournalVerified:true}});expect(persisted).toBe(true)",'recovery positive proof')
  source=replaceOnce(source,"await expect(activateRecoveredRoot(candidate,forged as unknown as RecoveryBootstrapVerifier,async()=>undefined)).rejects.toThrow('independently authenticated')","await expect(activateRecoveredRoot(candidate,forged as unknown as RecoveryBootstrapVerifier,async()=>({rootWrapReadback:true,stateMacVerified:true,envelopeJournalVerified:true}))).rejects.toThrow('independently authenticated')",'recovery forged proof')
  const insert=`
  it('accepts an independently selected fully verified backup as bootstrap authority',async()=>{
    const diary=b(51,16),epoch=b(52,16),keyId=b(53,16),root=randomBytes(32),urs=randomBytes(32),generation=2,account=b(54,32),commitment=await recoveryCommitment(urs,new Uint8Array(16).fill(51),generation),salt=await deriveEpochSalt(new Uint8Array(16).fill(51),new Uint8Array(16).fill(52)),protectedManifest={diary_id:diary,epoch_id:epoch,key_id:keyId,recovery_generation:generation,recovery_urs_commitment:commitment,diary_marker:'epoch-manifest-v5' as const,crypto_suite:'A256GCM-HKDF-SHA256-v5' as const,sync_profile:'google-sheets-single-writer-v1' as const,created_at:'2026-09-16T11:00:00.000Z',google_account_binding:account,predecessor_epochs:[],record_schema_allowlist:[...SCHEMA_ALLOWLIST],record_schema_registry_hash:await schemaRegistryHash(DOMAIN_SCHEMA_REGISTRY),protocol_limits:{max_payload_bytes:16380 as const,padding_buckets:[1024,2048,4096,8192,16384],max_unique_envelopes:100000 as const,max_unique_canonical_bytes:134217728 as const,max_remote_physical_rows:100000 as const,max_remote_physical_canonical_bytes:134217728 as const,max_canonical_row_bytes:21936 as const}},prepared=await prepareManifest(root,salt,{diaryId:diary,epochId:epoch},protectedManifest),fingerprint=await manifestFingerprint(prepared),manifest=[prepared.format,prepared.version,prepared.manifestIv,prepared.manifestCiphertext] as const,revision:Revision={record_type:'pain_type_settings',record_schema:'pain-type-settings/v1',record_id:await singletonRecordId(diary,'pain_type_settings'),revision_id:b(55,32),parent_revision_ids:[],record_status:'active',record_data:{values:['backup']},migration_origin:null,protocol_created_at:'2026-09-16T11:00:00.000Z'},envelope=await prepareEnvelope(root,salt,{diaryId:diary,epochId:epoch},revision,{reserve:async()=>undefined,persist:async()=>undefined}),rows=[envelopeRow(envelope)] as const,anchor=await createAnchor(diary,epoch,rows),artifact=await createRecovery({diary_id:diary,epoch_id:epoch,key_id:keyId,RK_epoch:base64Url(root),manifest_fingerprint:fingerprint,remote_anchor:anchor,google_account_binding:account,recovery_generation:generation,created_at:'2026-09-16T11:01:00.000Z'},urs),backup=await createBackup({rootKey:root,epochSalt:salt,diaryId:diary,epochId:epoch,keyId,manifestFingerprint:fingerprint,epochManifestPublic:manifest,remoteRows:rows,localEnvelopes:[envelope],remoteBound:true,createdAt:'2026-09-16T11:02:00.000Z'}),candidate=await recoverRootKeyCandidate(artifact,urs),authority=await IndependentBootstrapAuthority.fromIndependentBackup(backup),verifier=new RecoveryBootstrapVerifier({authority,schemas:DOMAIN_SCHEMA_REGISTRY})
    let persisted=false;const bootstrap=await activateRecoveredRoot(candidate,verifier,async()=>{persisted=true;return{rootWrapReadback:true,stateMacVerified:true,envelopeJournalVerified:true}});expect(persisted).toBe(true);expect(bootstrap.source).toBe('verified-backup');expect(bootstrap.remoteBinding).toBeNull();expect(bootstrap.verified.verifiedEnvelopeIds.has(envelope.envelopeId)).toBe(true)
  })
`
  const anchor=`  it('returns an untrusted candidate whose commitment still requires authenticated bootstrap verification', async () => {`
  source=replaceOnce(source,anchor,insert+anchor,'backup recovery test insertion')
  write(path,source)
}
