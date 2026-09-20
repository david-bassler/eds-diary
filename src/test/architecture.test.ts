import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
async function files(root:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(/\.tsx?$/.test(path))result.push(path)}return result}
describe('provider and leakage architecture',()=>{it('keeps Google wire details outside provider-neutral core',async()=>{for(const file of await files('src/sync/core'))expect(await readFile(file,'utf8'),file).not.toMatch(/googleapis|spreadsheetId|access_token|Sheets!/i)});it('forbids the Values append endpoint in the secure adapter',async()=>expect(await readFile('src/sync/google/GoogleSheetsSingleWriterTransport.ts','utf8')).not.toMatch(/values\/.+:append|values\.append/));it('has no health-data localStorage writer',async()=>{for(const file of await files('src'))expect(await readFile(file,'utf8'),file).not.toMatch(/localStorage\.setItem/)});it('loads no Google runtime script on the sensitive main origin',async()=>expect(await readFile('index.html','utf8')).not.toMatch(/accounts\.google\.com\/gsi/));it('keeps bearer credentials out of every main-origin provider module',async()=>{for(const file of ['src/sync/google/GoogleAuthProvider.ts','src/data/googleSheets.ts']){const source=await readFile(file,'utf8');expect(source,file).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]|access[_-]?token\s*[:=]|(?:headers\.)?set\(\s*['"`]authorization['"`]|['"`]Authorization['"`]\s*:/i)}expect(await readFile('src/sync/google/GoogleAuthProvider.ts','utf8')).toMatch(/MessageChannel/)});it('keeps the legacy table transport fail-closed',async()=>{const source=await readFile('src/data/googleSheets.ts','utf8');expect(source).toContain('Legacy plaintext Google-Sheets synchronization is disabled');expect(source).not.toMatch(/fetch\(|sheets\.googleapis\.com|docs\.google\.com/)})})
describe('google auth bridge architecture',()=>{it('moves the bearer credential from the popup into an auth-origin bridge instead of keeping the popup as the API proxy',async()=>{const main=await readFile('src/sync/google/GoogleAuthProvider.ts','utf8'),auth=await readFile('src/auth/googleAuthOrigin.ts','utf8');expect(main).toMatch(/mode', 'bridge'/);expect(main).toMatch(/google-auth-bridge-bind\/v2/);expect(main).not.toMatch(/access_token/);expect(auth).toMatch(/google-auth-token-transfer\/v2/);expect(auth).toMatch(/google-auth-bridge-ready\/v2/);expect(auth).toMatch(/Google-API-Bridge ist aktiv/)})})
describe('provider boundaries',()=>{it('keeps product data services independent of Google adapters',async()=>{for(const file of ['src/data/initializeDataLayer.ts','src/data/singleWriterSyncService.ts','src/data/artifactExports.ts','src/data/productiveRotationService.ts'])expect(await readFile(file,'utf8'),file).not.toMatch(/sync\/google|GoogleSheets|GoogleAuth|epochLocator|authenticatedAccountBinding/)});it('keeps rotation dependent only on provider-neutral session contracts',async()=>{const source=await readFile('src/data/productiveRotationService.ts','utf8');expect(source).toMatch(/SingleWriterProviderSession/);expect(source).toMatch(/RemoteTransport/);expect(source).not.toMatch(/GoogleSheetsSingleWriterTransport|GoogleSheetsSingleWriterProfileCodec|epochLocator/)})})
describe('protocol architecture',()=>{it('has one manifest fingerprint implementation',async()=>{const matches:string[]=[];for(const file of await files('src')){if(file.includes('/test/'))continue;const source=await readFile(file,'utf8');if(/function manifestFingerprint/.test(source))matches.push(file)}expect(matches).toEqual(['src/security/manifest.ts'])});it('keeps the test verifier explicitly outside production modules',async()=>expect(await readFile('src/sync/google/GoogleSheetsSingleWriterProfileCodec.ts','utf8')).not.toMatch(/TestRemoteVerifier|verifyCryptographicState/))})

describe('versioned protocol boundaries',()=>{it('keeps current persisted formats explicitly frozen as v1/v5',async()=>{const revisions=await readFile('src/security/revisions.ts','utf8'),state=await readFile('src/security/localState.ts','utf8'),manifest=await readFile('src/security/manifest.ts','utf8');expect(revisions).toMatch(/interface RevisionV1/);expect(revisions).toMatch(/validateRevisionV1/);expect(state).toMatch(/interface EpochLocalSecurityStateV5/);expect(state).toMatch(/local_state_version:5/);expect(manifest).toMatch(/interface ProtectedManifestV1/);expect(manifest).toMatch(/SINGLE_WRITER_V1_SCHEMA_ALLOWLIST/)})
it('keeps verifier and write authority profile-polymorphic while v1 remains explicit',async()=>{const contracts=await readFile('src/sync/core/contracts.ts','utf8'),verifier=await readFile('src/sync/core/remoteVerifier.ts','utf8'),coordinator=await readFile('src/sync/core/coordinator.ts','utf8'),provider=await readFile('src/sync/core/provider.ts','utf8');expect(contracts).toMatch(/interface RemoteProfileVerifier/);expect(contracts).toMatch(/interface WriteAuthority/);expect(verifier).toMatch(/class SingleWriterV1RemoteVerifier implements RemoteProfileVerifier/);expect(coordinator).toMatch(/writeAuthority:WriteAuthority/);expect(provider).not.toMatch(/WriteAuthority|writeAuthority\(/)})
it('does not let local persistence invent a provider profile binding',async()=>{const source=await readFile('src/data/localDatabase.ts','utf8');expect(source).toMatch(/bindRemote\(context:EpochContext,binding:RemoteBindingV1\)/);expect(source).not.toMatch(/provider_id:\s*['"]google-sheets-single-writer-v1['"]/)} )})

describe('v1 anchor boundary',()=>{it('freezes the persisted remote anchor as v1',async()=>{const prefix=await readFile('src/sync/core/prefix.ts','utf8'),state=await readFile('src/security/localState.ts','utf8');expect(prefix).toMatch(/interface RemoteAnchorV1/);expect(prefix).toMatch(/anchor_profile: 'google-sheets-single-writer-v1'/);expect(state).toMatch(/remote_anchor:RemoteAnchorV1\|null/)})})

describe('profile-neutral coordinator boundaries',()=>{it('delegates anchor semantics to the profile codec rather than importing v1 prefix helpers',async()=>{const coordinator=await readFile('src/sync/core/coordinator.ts','utf8'),contracts=await readFile('src/sync/core/contracts.ts','utf8'),codec=await readFile('src/sync/google/GoogleSheetsSingleWriterProfileCodec.ts','utf8');expect(coordinator).not.toMatch(/from '.\/prefix'/);expect(coordinator).not.toMatch(/singleWriterV1WriteAuthority/);expect(coordinator).toMatch(/codec\.assertExtendsAnchor/);expect(coordinator).toMatch(/codec\.createAnchor/);expect(contracts).toMatch(/interface RemoteAnchorState/);expect(contracts).toMatch(/createAnchor\(diaryId:string,epochId:string/);expect(contracts).toMatch(/assertExtendsAnchor\(anchor:RemoteAnchorState\|null/);expect(codec).toMatch(/createAnchorV1/);expect(codec).toMatch(/assertExtendsAnchorV1/)})})


describe('v2 pre-implementation hardening boundaries',()=>{
  it('keeps security rationale in an explicit anti-churn decision ledger',async()=>{
    const ledger=await readFile('docs/security/EDS_TRANSFERABLE_SINGLE_WRITER_V2_DECISIONS.md','utf8')
    for(const id of ['D-001','D-002','D-003','D-004','D-005','D-006','D-007','D-008'])expect(ledger).toContain(id)
    expect(ledger).toMatch(/Rejected alternative/)
    expect(ledger).toMatch(/Revisit only if/)
  })
  it('requires semantic envelope dispositions instead of physical-row durability inference',async()=>{
    const contracts=await readFile('src/sync/core/contracts.ts','utf8')
    const coordinator=await readFile('src/sync/core/coordinator.ts','utf8')
    const local=await readFile('src/data/localDatabase.ts','utf8')
    expect(contracts).toMatch(/acceptedEnvelopeIds/)
    expect(contracts).toMatch(/staleWriterEnvelopeIds/)
    expect(coordinator).toMatch(/commitVerifiedPull\(finalVerified/)
    expect(coordinator).toMatch(/staleWriterEnvelopeIds\.has\(envelope\.envelopeId\)/)
    expect(local).toMatch(/Physically present envelope is not semantically accepted/)
  })
  it('full-verifies before an unknown-outcome retry and binds the exact envelope to the authority decision',async()=>{
    const coordinator=await readFile('src/sync/core/coordinator.ts','utf8')
    const contracts=await readFile('src/sync/core/contracts.ts','utf8')
    const verifyIndex=coordinator.indexOf('const retryVerified=await this.codec.verifyRemote(snapshot)')
    const retryIndex=coordinator.indexOf("verifyBeforePush(envelope,retryVerified,'unknown_outcome_retry')")
    const appendIndex=coordinator.indexOf('await this.transport.append(this.remoteId, row)',retryIndex)
    expect(verifyIndex).toBeGreaterThan(-1)
    expect(retryIndex).toBeGreaterThan(verifyIndex)
    expect(appendIndex).toBeGreaterThan(retryIndex)
    expect(contracts).toMatch(/canPrepareDomainWrite/)
    expect(contracts).toMatch(/quarantine_stale_writer/)
  })
  it('separates storage-provider identity from sync-profile identity',async()=>{
    const contracts=await readFile('src/sync/core/contracts.ts','utf8')
    const transport=await readFile('src/sync/google/GoogleSheetsSingleWriterTransport.ts','utf8')
    const provider=await readFile('src/sync/google/GoogleSingleWriterProvider.ts','utf8')
    expect(contracts).toMatch(/GOOGLE_DRIVE_SHEETS_PROVIDER = 'google-drive-sheets-v1'/)
    expect(transport).toMatch(/providerId = GOOGLE_DRIVE_SHEETS_PROVIDER/)
    expect(transport).toMatch(/profileId = SINGLE_WRITER_V1_PROFILE/)
    expect(provider).toMatch(/providerId = GOOGLE_DRIVE_SHEETS_PROVIDER/)
    expect(provider).toMatch(/profileId = SINGLE_WRITER_V1_PROFILE/)
  })
})
