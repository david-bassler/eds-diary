# Transferable Single Writer v2 – Implementation Audit Trail

Stand: 24.09.2026

Status: **NON-NORMATIVE IMPLEMENTATION REVIEW LOG**.

Normative behavior remains defined by
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`. Architectural rationale
and anti-churn decisions remain in
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_DECISIONS.md`.

This file records implementation findings so later adversarial reviews can tell
the difference between:

- a new protocol/design issue;
- an already-fixed implementation mismatch;
- an intentionally deferred implementation layer;
- and a previously reviewed trade-off that must not be reopened without new
  evidence.

## Review scope

Reviewed implementation slices:

- V2-01 – types, strict validators, pure crypto and EnvelopeV6 primitives;
- V2-02 – RemoteAnchorV2 hashing and the canonical transferable-writer replay
  verifier, including the operation-bound `rotation_resume` path;
- V2-03 – EpochLocalSecurityStateV6, WriterDeviceKeyV2 persistence, semantic
  coordinator persistence and the fail-closed normal-domain write gate;
- V2-04 – ManifestV6, strict Google v2 profile/storage, RecoveryArtifactV6,
  RecoveryTakeoverStagingV2 and SyncBackupV6;
- V2-05 – productive crash-resumable v1→v2 profile upgrade, staged/activated
  Recovery+Backup gates, activation lineage and irreversible local cutover;
- V2-06 – Recovery-family-based second-device bootstrap, historical activation
  lineage verification and atomic local active/read-only Join.

Primary review sources:

- Exact Protocol §§4–14, 16a–16b, 18–18.2, 22–24;
- inherited v1 wrapper/graph rules explicitly retained by v2 §5;
- D-001…D-010;
- the frozen machine-readable v2 schema registry.

## Review rounds

### 2026-09-22 adversarial pass after V2-02 green CI

Re-reviewed the current V2-01/V2-02 stack against Exact Protocol §§4–13,
16a–16b, inherited v1 wrapper/graph rules and D-001…D-010. New findings from
this pass are IA-017 and IA-018. Both are implementation mismatches; neither
changes the threat model or any D-001…D-010 decision. Earlier IA-001…IA-016
were rechecked against the current branch before adding these entries.

### 2026-09-23 V2-03 implementation/review pass

Implemented and adversarially reviewed StateV6 persistence, WriterDeviceKeyV2,
normal domain-write preparation and semantic CoordinatorStore behavior. New
findings from this pass are IA-019…IA-029. They are implementation mismatches/
hardening findings, not changes to D-001…D-010.


### 2026-09-23 four-slice stack review after V2-04

Re-reviewed V2-01…V2-04 as one composed security stack rather than as isolated
PRs. The pure V2-01 and replay-core V2-02 rules did not yield a new standalone
wire/verifier defect in this pass. New findings IA-031…IA-034 are cross-layer
contract failures or incomplete wiring at the V2-02↔V2-04 and V2-03↔V2-04
boundaries. They were first recorded open, then closed explicitly in the
follow-up implementation pass with dedicated regression coverage; no D-xxx
decision changed.

### 2026-09-23 V2-05 profile-upgrade implementation/review pass

Implemented the productive crash-resumable v1→v2 profile-upgrade path and reviewed it against Architecture §18 / Exact Protocol §21.1. New findings IA-035 and IA-036 were implementation mismatches found during this pass and are fixed with productive regression/fault coverage. No D-001…D-010 decision changed.

### 2026-09-24 V2-06 read-only Join implementation/review pass

Implemented the productive second-device read-only Join and reviewed it against
Architecture §11 and the Exact Protocol's canonical-full/Recovery bootstrap
rules. New findings IA-039…IA-043 were implementation mismatches found
during this pass and are fixed in the same slice. Neither changes D-001…D-010.

### 2026-09-24 full-stack pre-merge re-audit

Rechecked the composed V2-01…V2-06 stack against the frozen §24 roadmap and
the exact profile-upgrade activation rules before bottom-up merge. IA-045 and
IA-046 were recorded **OPEN before remediation**; follow-up inspection added
IA-047, IA-048 and IA-049, also recorded OPEN before code changes. IA-045 was a real
protocol regression introduced by the prior IA-044 hardening; IA-046 was the
missing productive assurance coverage that allowed it to remain green. All five
were subsequently remediated with productive regression coverage.

### 2026-09-24 implementation inventory re-audit after IA-049

Rechecked the current V2-01…V2-06 heads, the §24 implementation order, the
production release gates and the composed V2-05/V2-06 code after IA-045…IA-049.
No additional protocol/authority implementation mismatch was identified in this
pass before documentation cleanup.

Current implementation boundary:
- §24 steps 1–9 are implemented and internally validated;
- Cooperative Handoff and productive Forced Takeover orchestration remain open;
- stale-writer quarantine mechanics already exist in verifier/StateV6 persistence,
  but they do not constitute the missing Forced Takeover ceremony;
- native v2→v2 Rotation and the two-phase Recovery-Rekey orchestration remain open;
- normal App/Settings/domain-materialization/UI wiring remains open;
- the Live-Google Parallel-Append-Gate and external release gates remain open.

All six current V2 PR heads have a successful complete Security Validation run.
The fact that the PRs are currently Draft is process state, not evidence of an
unresolved implementation finding.

### 2026-09-24 V2-07 cooperative Writer Handoff implementation/review pass

Recomposed the previously implemented productive crash-resumable A→B Writer
Handoff on the current V2-06 head and reviewed it against Exact Protocol
§§7, 8, 13, 14 and 15. Rebase findings IA-050 and IA-051 were recorded OPEN
in PR #56 before remediation. The earlier V2-07 findings are retained as
IA-052…IA-056 to preserve the global audit namespace. No D-001…D-010 decision
changed.

## Findings and disposition

| ID | Area | Finding | Disposition |
| --- | --- | --- | --- |
| IA-001 | V2-01 / EnvelopeV6 | The first V2-01 cut had the v6 AAD/ciphertext Golden Vector but no reusable EnvelopeV6 seal/open primitive. That made the nominal “types & pure crypto” gate incomplete even though product persistence was correctly deferred. | **Fixed.** `src/security/v2/envelopes.ts` now owns pure framing/seal/open and exact v6 AAD/bucket handling. Reservation/journal persistence remains V2-03. |
| IA-002 | V2-01 / timestamps | `protocol_created_at` used regex + `Date.parse`. JavaScript can normalize impossible calendar dates, so syntactically canonical-looking but non-existent dates could pass. | **Fixed in PR #49 and propagated to PR #50.** Validation now requires a string matching the exact format and `new Date(value).toISOString() === value`. Regression vector: non-leap `2026-02-29T12:00:00.000Z`. |
| IA-003 | V2-02 / stale rows | A stale writer-authored domain row could previously reach stale classification before full domain-schema validation. “Stale” must not become an escape hatch for malformed record payloads. | **Fixed.** Domain payload validation runs before authority disposition; only semantically valid payloads can become `stale_writer_rejected`. |
| IA-004 | V2-02 / migration scope | A native v2 epoch could structurally accept an `EpochMigrationV2` even though migrations exist only for non-native epochs. | **Fixed.** Native epochs now reject Migration-Control. |
| IA-005 | V2-02 / remote bounds | Remote Base64URL cells were decoded before enforcing the canonical row-size bound, allowing attacker-controlled decode allocation before the verifier rejected the row. | **Fixed.** Exact ASCII/JCS row length is bounded before Base64URL decode, with the post-canonicalization bound retained as defense in depth. |
| IA-006 | V2-02 / error classification | A manifest-bound Writer public-key/key-ID mismatch was initially surfaced under a recovery-key error category. | **Fixed.** It is classified as a manifest/start-authority mismatch. No protocol rule changed. |
| IA-007 | V2-02 / revision identity | Replay enforced duplicate `revision_id` only inside the accepted domain graph. v2 §5 explicitly inherits the v1 rule that one `revision_id` must not occur in multiple different envelopes in the same epoch; control and stale rows were therefore insufficiently covered. | **Fixed.** Replay now reserves every unique RevisionV2 `revision_id` after wrapper validation and before semantic classification. Reuse from another envelope is fatal `revision_id_collision`; byte-identical retry rows remain the sole no-op repetition. |
| IA-008 | V2-02 / complexity | Historical writer lookup scanned `authority_history_by_prefix` linearly. With the 100,000-row protocol bound, many stale rows could force quadratic verifier work. | **Fixed.** Prefix history remains for anchor reproduction, but a separate tuple-keyed authority index provides O(1) historical Writer lookup. This is availability hardening, not a wire/protocol change. |
| IA-009 | V2-02 / rotation_resume | `rotation_resume` could return `staged_migration_present` even if another physical/semantic row followed the accepted Migration-Control. The `copying -> successor_verified` staging boundary requires the Migration row followed only by byte-identical retries of that same Migration envelope. | **Fixed.** The verifier records the accepted Migration envelope/row and rejects any other suffix in `rotation_resume` as `successor_staging_mismatch`. |
| IA-010 | V2-02 / result authority | A non-native `canonical_full` result may contain replayed Writer/Recovery state while its activation state is only `staged_confirmation_missing` or `cross_epoch_evidence_present`. Those fields describe verified log state; they are not themselves an active-epoch grant. | **Intentional boundary.** Cross-epoch activation must separately validate Source/ActivationLineage/Announcement/Confirmation evidence. V2-03/V2-04 adapters must never turn these states directly into writer/recovery authority. |
| IA-011 | V2-02 / manifest trust root | `VerifiedManifestTrustRootV2` was initially only an input contract; V2-02 defensively rechecked key/ID/history shape but could not prove protected-manifest provenance. | **Deferred layer completed in V2-04.** `openManifestTrustRootV6` decrypts and validates the exact ManifestV6 cells and brands the resulting trust root; the production verifier rejects unbranded structural roots. The profile codec and backup verifier use only that provenance-preserving path. |
| IA-012 | V2-02 / rollback floors | Replay computes RemoteAnchorV2 but does not itself reconcile a persisted local/backup/recovery freshness floor. | **Deferred layer now partially completed in V2-03.** StateV6 reconciliation rejects rollback/same-height replacement against the persisted local RemoteAnchorV2 and reproduces the exact final snapshot anchor. Backup/RecoveryArtifact freshness floors remain later-layer work. |
| IA-013 | V2-01 / one-shot persistence | The pure EnvelopeV6 primitive accepts caller-supplied envelope ID and IV; by itself it cannot prove persistent pre-reservation or cross-crash one-shot use. | **Deferred layer completed for normal V2-03 domain writes.** Envelope ID/IV are persisted as a one-shot reservation before encryption; sealed bytes and the v6 journal/state update are then persisted atomically. Rotation/Recovery operation-specific one-shot state remains with their later services. |
| IA-014 | V2-02 / historical rotation | Historical RotationAnnouncements were classified stale before validating rotation-kind / recovery-transition binding against the Recovery state at their own anchor. A claim already invalid at its historical decision prefix must not be laundered into a non-fatal stale result. | **Fixed.** Rotation/rekey mode is now validated against the historical anchor Recovery snapshot first; only an otherwise valid claim may become `stale_rotation_announcement_rejected`. |
| IA-015 | V2-02 / duplicate exactness | Duplicate-envelope detection stored only SHA-256 of the canonical row and treated equal hashes as byte identity. Collision resistance is strong but the protocol requires exact row equality and no hash indirection is needed. | **Fixed.** The verifier stores the exact three canonical Base64URL strings for the first envelope occurrence and compares them directly. |
| IA-016 | V2-02 / snapshot complexity | Migration semantic-snapshot sorting recomputed JCS bytes inside every sort comparison, multiplying serialization work under large valid head sets. | **Fixed.** Sort bytes are precomputed once per semantic head entry, then compared lexicographically; normative ordering and final hash bytes are unchanged. |
| IA-017 | V2-01 / migration_origin | `validateMigrationOrigin` did not implement the inherited v1 canonical wrapper rules: it allowed up to 4096 Sources and 4096 source revision IDs, did not require Sources to be unique/byte-sorted, and did not require each `source_revision_ids` list to be byte-sorted. v2 §5 explicitly inherits the v1 migration-origin semantics (1..8 Sources; 1..8 unique revision IDs per Source; canonical decoded-byte ordering). | **Fixed in PR #49 and propagated to PR #50.** Runtime validation now enforces the 8/8 bounds, Source uniqueness, Source ordering by decoded `(source_epoch_id, source_record_id)` bytes, and decoded-byte ordering of `source_revision_ids`. Negative vectors cover oversize, duplicate and unsorted forms. |
| IA-018 | V2-02 / per-record bounds | The replay verifier enforced the inherited 4096-revisions-per-`record_id` limit only inside the accepted domain graph. Unique stale-writer/stale-grant/control revisions could therefore bypass the per-record bound even though v2 §5 inherits the v1 common-wrapper/graph limit and byte-identical retry rows are the only repetition that should be a semantic no-op. | **Fixed.** Replay now counts every unique validated RevisionV2 by `record_id` before authority/control disposition, so stale/control rows cannot evade the 4096 bound; physical byte-identical retries still bypass semantic counting as intended. |
| IA-019 | V2-03 / sealed local writer state | StateV6 reconciliation could preserve/promote `writer_active` when the freshly verified Source was already sealed. §13/§18 require ordinary Writer authority only for an unsealed active epoch. | **Fixed.** `sameLocalWriter` now requires `source_epoch_sealed=false`; canonical reconciliation of a sealed Source persists `read_only` and clears local writer generation/grant. Pending-Rekey remains a separate maintenance-only case and is still blocked by the normal domain gate rather than forcibly erasing Writer identity. |
| IA-020 | V2-03 / exact push binding | `verifyBeforePush` authenticated only the persisted outbox authority selected by `envelope_id`; it did not prove that the concrete IV/ciphertext/bytesHash supplied to the push gate were the immutable locally persisted bytes for that ID. | **Fixed.** The local persistence lookup now loads the immutable envelope and requires exact `envelope_id`, IV, ciphertext and `bytesHash` equality before returning its authenticated Writer provenance. A mismatch is security-blocking, not stale quarantine. |
| IA-021 | V2-03 / unusable WriterDeviceKey | The normal prepare path loaded/validated WriterDeviceKeyV2 before StateV6 reconciliation; a missing or corrupt/non-usable local key could therefore throw before the authenticated state was downgraded to read-only. | **Fixed.** Normal domain preparation treats a missing/unusable WriterDeviceKeyV2 as `keyUsable=false`, persists read-only reconciliation, and never silently regenerates the key. The frozen §18.2 four-field key-store entry is unchanged. |
| IA-022 | V2-03 / WriteAuthority identity | The v2 WriteAuthority compared local/remote writer tuples and anchors but did not independently bind the supplied canonical state to local `diary_id`, `epoch_id` and `manifest_fingerprint`. Correct production call order already reconciled those identities first, but the security adapter itself was not fail-closed when called directly with a canonical state from another epoch instance. | **Fixed.** Every access/push decision now requires exact local/remote diary, epoch and manifest identity equality before any Writer authority can be granted. Regression vectors cover all three mismatches. |
| IA-023 | V2-03 / pull-time stale quarantine | A prepared local envelope that was still absent remotely could remain `prepared/pending` after canonical pull proved that its Writer authority had advanced (or Source seal/Pending-Rekey had activated). Because the shared coordinator returns immediately in read-only state, that envelope might never reach `verifyBeforePush` and therefore never enter `stale_writer_pending`. | **Fixed.** The semantic disposition commit now also compares every non-durable local outbox authority with the freshly verified current Writer and fences. Missing remote envelopes are quarantined atomically when authority advanced, Source sealed or Pending-Rekey is active. |
| IA-024 | V2-03 / remote-local envelope identity | Pull disposition reconciliation matched local envelopes to verifier sets by `envelope_id` only. A remote row using a locally known ID with different IV/ciphertext could therefore be marked durable/stale before the later coordinator byte comparison ever ran. §4 requires this collision to be fatal. | **Fixed.** Before any disposition/state mutation, every remote row whose ID exists locally is compared byte-for-byte against immutable local IV/ciphertext. Any mismatch is security-blocking. |
| IA-025 | V2-03 / one-shot IV anomaly | Local EnvelopeV6 reservation generated IVs without checking already reserved local IVs or the freshly verified remote IV history. §4 requires same-IV/different-envelope reuse to block new encryption fail-closed. | **Fixed.** Reservations now use a unique per-epoch IV index, never retry a detected RNG collision, compare the candidate IV against the verified remote rows before encryption, and journal-integrity verification also requires every sealed envelope to retain its matching sealed reservation. |
| IA-026 | V2-03 / outbox completeness | Outbox MACs authenticated individual entries but not set completeness. Deleting a valid entry left the immutable envelope journal valid; subsequent reconciliation could silently omit the pending/quarantined envelope and even recalculate a smaller authenticated stale count. | **Fixed.** Local integrity verification now enforces a one-to-one authenticated EnvelopeV6↔outbox mapping and exact `stale_writer_pending_count`; verified-pull and status mutation paths run this check before changing StateV6. Missing entries are security-blocking. |
| IA-027 | V2-03 / encrypted Writer provenance | The outbox Writer tuple was authenticated locally but not cryptographically checked against the `writer_context` inside the encrypted RevisionV2. An inconsistent internal caller could therefore ask the pre-push gate to authorize bytes under unrelated current-authority metadata. | **Fixed.** Envelope commit and pre-push authority lookup decrypt/validate the immutable RevisionV2 and require exact Writer-context equality with the authenticated outbox authority. |
| IA-028 | V2-03 / terminal local states | The storage adapter validated StateV6 snapshots individually but did not enforce transition terminality. In particular, a direct `orphaned -> active` replacement or `stale_writer_pending -> pending` outbox transition was structurally possible even though both are terminal protocol states. | **Fixed.** State replacement/disposition paths reject any exit from `orphaned`; outbox transitions enforce `durable` and `stale_writer_pending` terminality. |
| IA-029 | V2-03 / Web Locks worker boundary | The Web-Lock helper failed closed only when `window` existed. A browser Worker/ServiceWorker context without LockManager could therefore take the non-browser fallback and execute a v2 mutation unlocked. | **Fixed.** Missing LockManager now fails closed in both Window and WorkerGlobalScope contexts; only genuine non-browser test/server runtimes may use the fallback. |
| IA-030 | V2-04 / creation resume intent | The shared creation state machine resumed a persisted creation record without byte-for-byte checking that the newly supplied immutable Manifest cells/fingerprint and bound diary/epoch/key/properties were the same planned resource. Under crash-resume, a reused locator record could therefore continue with stale one-shot intent instead of failing closed. | **Fixed.** Resume now compares the persisted immutable creation intent against the current request before any discovery or remote mutation; mismatched manifest bytes/fingerprint/context are rejected. Regression coverage pins a changed ManifestV6 resume attempt. |
| IA-031 | V2-03↔V2-04 / fresh domain-write reconciliation | `V2DomainWritePreparer.prepareAndPersist()` performed its mandatory fresh canonical verify but persisted only StateV6, bypassing the Coordinator's semantic disposition/quarantine commit. An old pending envelope could therefore remain non-quarantined when the next write attempt discovered Writer advancement. | **Fixed.** The prepare path now uses the same `commitVerifiedDispositions` primitive as verified pull before deciding write access. It then requires the local operation generation to remain unchanged while acquiring the write lock; any intervening local mutation forces a new full-verify attempt. Regression coverage proves Writer advancement both rejects the new write and moves the old pending envelope to `stale_writer_pending`. |
| IA-032 | V2-04 / verified capability branding | `VerifiedRecoveryTakeoverStagingV2` and `VerifiedPersistedRecoveryArtifactV6` could be directly constructed and thereby self-register in their WeakSet brands without the mandated verification/persistence path. | **Fixed.** Both constructors now require module-private runtime tokens; forged construction with any external token throws before branding. Only successful AEAD/keypair verification or persistent/readback verification possesses the token. Negative runtime tests pin both capabilities. |
| IA-033 | V2-02↔V2-04 / Manifest trust-root provenance | `manifestTrustRootV6(cells,payload)` accepted independently supplied cells and protected payload, so the security API itself did not prove that the authority payload had been decrypted from those exact cells. | **Fixed.** The independent pairing API is removed from production use. `openManifestTrustRootV6` performs decrypt+validation+fingerprint+trust-root creation in one provenance-preserving operation and registers the result in a module-private WeakSet. `TransferableSingleWriterV2Verifier` rejects any unbranded structural trust root. The only synthetic branding seam is test-only and runtime-disabled outside `NODE_ENV=test`; architecture tests prohibit production use. |
| IA-034 | V2-03↔V2-04 / FreshCanonicalV2Source wiring | V2-03 deliberately left `FreshCanonicalV2Source.verifyNow()` for V2-04, but the first V2-04 cut had only transport/codec/provider primitives and no production fresh-source adapter. | **Fixed.** The authenticated Google v2 provider session now exposes `freshCanonicalSource(...)`. Every `verifyNow()` creates a newly authenticated epoch transport, performs a new strict `transport.read(remoteId)`, and immediately passes that snapshot to the v2 codec's `canonical_full` verifier; no snapshot or `VerifiedRemoteState` is accepted from the caller or cached. Regression coverage calls it twice and proves two independent provider reads/auth bindings. |
| IA-035 | V2-05 / staged Recovery gate | The first productive profile-upgrade cut marked `recovery_artifact_verified` after persistent publish/readback only. §18 step 6 requires a real staged Recovery test before the staged Backup: recover RK/takeover authority from URS, re-verify the frozen v1 Source prefix and the exact staged v2 migration prefix/provenance. | **Fixed.** Before the state machine may enter `recovery_artifact_verified`, the published artifact is opened with URS, recovered RK/identity/lineage are compared to the successor plan, the v1 Source is re-verified at the frozen anchor, and the Successor is canonical-full verified at the staging anchor with full profile-upgrade migration integrity. |
| IA-036 | V2-05 / activation preparation crash-resume | `prepareActivation()` persisted the immutable ActivationArtifact before `announcement_prepared`, but on resume it returned the still-null OperationState fields instead of deriving them from that artifact. A crash in that narrow interval therefore made the otherwise one-shot cutover non-resumable. | **Fixed.** Resume derives announcement/confirmation rows, evidence/lineage hashes, artifact ID/locator/hash directly from the immutable ActivationArtifact. A dedicated `after-activation-artifact` productive faultpoint is included in the crash matrix. |
| IA-037 | V2-05 / final local Source freeze race | The first productive freeze flow computed the final v1 snapshot/anchor and only afterwards persisted `source_frozen_verified`. A local Fachwrite could race into that interval: the later operation state would freeze an already stale snapshot even though no remote cross-device race was involved. | **Fixed.** The freeze commit carries the exact authenticated v1 `operation_generation` observed after the final full verify. `persistProfileUpgradeSourceOperationV2` rechecks it under the diary lock and rejects any intervening local mutation, forcing a fresh full verify. A productive regression injects a real write in that window and proves the first attempt aborts while a new verified attempt succeeds. |
| IA-038 | V2-05 / v1 operation persistence transition gate | The v1-side persistence helper authenticated the resulting `rotation_state_ref` but originally accepted any individually valid `RotationOperationStateV2` snapshot for the same operation ID. An internal caller could therefore skip closed stages or replace once-set fields and have the invalid transition MAC-bound into v1 local state without going through the orchestrator's `advanceRotationOperationStateV2` check. | **Fixed.** The persistence boundary now loads and validates the previously authenticated operation record/ref under the diary lock and requires `advanceRotationOperationStateV2(prior,next)` before writing; only a brand-new `source_frozen_verified` state may initialize the record. A regression calls the persistence helper directly with `source_frozen_verified -> successor_bound` and requires rejection. |

| IA-039 | V2-06 / fresh-profile admission | The first Join preflight treated any non-null v1 `migration_state_ref` as evidence of an existing local diary. On a genuinely fresh install, `ready()` itself runs and authenticates an empty legacy migration through `legacy-v1/cutover`, so a valid new-device Join would be blocked after the application's own bootstrap. | **Fixed.** Join now permits only the exact authenticated, verified `legacy-v1` cutover whose source/completed key sets are both empty and whose state-record hash matches the local MAC-bound ref. Any non-empty, non-terminal or mismatched migration evidence remains a hard overwrite block. |
| IA-040 | V2-06 / profile-upgrade activation evidence | The first Join lineage review correctly identified that the frozen Source prefix must bind directly to the prepared profile-upgrade Announcement, but its remediation incorrectly required the entire physical Source suffix to contain exactly one row. | **Superseded/corrected by IA-045.** Join now requires the immediate first post-freeze physical row to equal the immutable Announcement bytes while permitting byte-identical retry rows and any later source rows that still pass the full v1 verifier. |
| IA-041 | V2-06 / crash-resume authority binding | The persisted read-only Join plan lives in the generic immutable-operation store, whose SHA-256 is not a secret MAC. Resume used the plan's `local_writer_device_id` / `local_writer_key_id` to select a WriterDeviceKeyV2 without rebinding those IDs to MAC-authenticated StateV6, and the recorded immutable RecoveryArtifact SHA-256 was not compared to freshly discovered Recovery bytes. A storage rewrite that recomputed the plain artifact hash could therefore steer resume metadata away from the authenticated local identity contract. The same resume path also failed to re-open the persisted RootWrapV6 or re-verify a referenced ActivationLineageCacheV2 before selecting v2. | **Fixed.** Resume/final-switch validation now binds plan diary/epoch/key/manifest/provider/account/remote ID and local Writer IDs back to authenticated StateV6, loads the key only through StateV6's Writer identity, requires the exact freshly discovered immutable RecoveryArtifact SHA-256, verifies that the originally recorded Join anchor is still extended, re-opens RootWrapV6 to the freshly verified remote root key, and re-verifies any referenced ActivationLineageCacheV2. Regression tests rewrite the plain operation artifact and recompute its SHA-256; Writer-ID and RecoveryArtifact-hash substitutions fail closed, and a missing crash-persisted RootWrap blocks local selection. |
| IA-042 | V2-06 / final local switch freshness | The first normal Join path switched the fresh local placeholder immediately after its initial Recovery-family discovery and canonical_full. Crash-resume performed a new discovery/verify before switching, making the no-crash path weaker and leaving a wider interval in which the selected leaf could become sealed/obsolete before local activation. | **Fixed.** Every local Join switch now performs a second Recovery-family discovery and full activation/canonical verification after the local Join bundle is durable and immediately before the v1→v2 local selection transaction. A changed/sealed leaf, changed immutable RecoveryArtifact or different epoch fails closed; a regression seals the leaf between the first verify and the final switch. |
| IA-043 | V2-06 / Join-only read-only invariant | Resume reconciled StateV6 with `writerKeyUsable=true`. If the freshly canonical Writer authority happened to match the newly generated local key, `stateAfterCanonicalVerifyV6` could persist `writer_active` before the service's later read-only assertion threw. Join itself must never grant Writer authority; promotion belongs to a subsequent verified Writer-Grant path. | **Fixed.** The final Join reconciliation always passes `writerKeyUsable=false`, persists the freshest verified Writer tuple only as read-only metadata, and requires `writer_generation` / `writer_grant_id` to remain null before local switch. A regression injects a canonical Writer tuple matching the local key and proves Join still completes read-only. |
| IA-044 | V2-05 / one-shot cutover physical rows | The pre-merge pass correctly re-focused review on physical cutover ordering, but its remediation incorrectly equated one-shot prepared bytes with “exactly one physical row”, rejecting protocol-permitted byte-identical retry duplicates. | **Superseded/corrected by IA-045.** The durable decision row is one-shot in bytes and must be the immediate first row after the bound prefix; byte-identical physical retries of those same bytes remain permitted semantic no-ops. The Successor activation anchor includes leading Confirmation retries exactly as frozen by §21. |
| IA-045 | V2-05/V2-06 / activation-boundary retry and post-activation suffix semantics | The IA-044 hardening changed the productive profile-upgrade cutover to require exactly one physical Source Announcement and exactly one physical Successor Confirmation. That contradicts the frozen protocol's general byte-identical retry rule and §21 step 20, which explicitly includes immediately following byte-identical Confirmation retries in successor_activation_anchor and permits a fully valid post-activation suffix. The current helper therefore rejects legitimate Unknown-Outcome retries and any valid Fachrow/WriterGrant appended after Confirmation; V2-06 Join also rejects a profile-upgrade Source containing a byte-identical Announcement retry. | **Fixed after being recorded OPEN.** V2-05 restores immediate-decision-row semantics, counts leading byte-identical retries, includes Confirmation retries in `successor_activation_anchor`, and canonical-full verifies later suffix rows. V2-06 requires only the immediate historical Announcement row and the composed Join integration now replays both v1 Announcement and v2 Confirmation retry duplicates successfully. |
| IA-046 | V2-05 / productive assurance coverage | The state-machine harness covered abstract `post_activation_superseded` outcomes, but the productive profile-upgrade integration suite lacked end-to-end vectors for §21/§23 post-activation Fachrow/WriterGrant continuation, RecoveryAuthorityTransition/seal supersession, or Confirmation retry duplicates. | **Fixed after being recorded OPEN.** Productive tests now cover duplicate Announcement/Confirmation retries, ActivationAnchor expansion, allowed post-activation Fachrows, allowed post-activation Handoff WriterGrant with final local read-only derivation, RecoveryTransition supersession, valid Successor seal supersession, and the V2-06 second-device Join over retry-bearing activation history. |
| IA-047 | V2-05 / split-read activation freshness | `verifyActivationBoundary(verified,result)` performed another fresh Successor read/`canonical_full`, but callers continued using the older snapshot for Recovery-supersession and activated-Backup decisions. | **Fixed after being recorded OPEN.** Activation verification returns the fresher verified/result pair, proves it extends the caller anchor, and all supersession/commit/Backup decisions use it. A race regression advances Recovery between the two reads and proves no activated Backup is persisted. |
| IA-048 | V2-05 / historical migration proof vs post-activation graph | `verifyProfileUpgradeMigrationIntegrityV2()` derived Successor provenance from final current domain heads, so a valid post-activation Fachrow could retroactively break the historical migration proof. | **Fixed after being recorded OPEN.** The canonical verifier proves the migration snapshot at the Migration row; the cross-epoch check now identifies immutable accepted migration-copy revisions by `migration_origin` to the v1 Source and proves that historical bijection independently of later current heads. |
| IA-049 | V2-05 / fresh Confirmation-retry activation anchor | After IA-047, activation verification intentionally performs a fresher Successor read and uses its canonical state. `publishOrReconcileConfirmation()` still returned `successor.activationAnchor` from the older first read. If an additional byte-identical Confirmation retry became visible between those reads, the service had observed the longer retry prefix but would persist a shorter `successor_activation_anchor`, contradicting §21 step 20. | **Fixed after being recorded OPEN.** The activation-boundary result carries the activation anchor computed from the same freshest read used for canonical commit/supersession, and `confirmation_durable` persists that anchor. A race regression injects a Confirmation retry between the reads and proves the stored anchor expands through both retry rows. |
| IA-050 | V2-07 / audit namespace recomposition | The pre-existing V2-07 branch used IA-044…IA-048 locally, but the current V2-01…V2-06 base already owns IA-044…IA-049. Keeping both histories would make findings ambiguous. | **Fixed after being recorded OPEN in PR #56.** V2-07 findings were renumbered without changing their substance or regression coverage; IA-050/IA-051 describe the recomposition itself and the prior Handoff findings continue as IA-052…IA-056. |
| IA-051 | V2-07 / stale stacked base | The pre-existing V2-07 head was 41 commits behind the current PR #55 head. Its green CI therefore proved only the older composition and could not establish compatibility with the current IA-045…IA-049 V2-05/V2-06 base. | **Fixed after being recorded OPEN in PR #56.** The branch was recomposed on the exact current #55 head, preserving only V2-07-specific code/tests/audit deltas, and must pass the complete Security Validation on the recomposed head before the review is current. |
| IA-052 | V2-07 / terminal operation refs | The first Handoff persistence cut treated any existing rotation/recovery/writer operation ref as a blocker. V2-05 legitimately leaves a terminal `rotation_state_ref="switched"`, so the first productive Handoff after profile upgrade was rejected even though §13 blocks only non-terminal security operations. The same issue would have prevented a later Handoff after a prior terminal WriterGrant operation. | **Fixed.** Handoff gating now classifies the frozen terminal sets explicitly: rotation `switched/stale/cutover_race/post_activation_superseded`, WriterGrant `durable/stale`, and Recovery `completed/stale/superseded` do not block a new Handoff. A new descriptor supersedes the StateV6 reference to a prior terminal WriterGrant operation; resume without a descriptor still reports that terminal operation. The full productive v1→v2→Handoff fixture pins this path. |
| IA-053 | V2-07 / persistence authority boundary | The initial service validated fresh source authority before constructing the Grant, but the storage primitive that atomically persisted EnvelopeV6 + WriterGrantOperationStateV2 + StateV6 ref only proved that the encrypted row was structurally a WriterGrant. A direct internal caller could therefore attempt to persist a prepared Handoff whose anchor, predecessor generation/grant, recovery generation or authorization did not match the MAC-authenticated current StateV6. | **Fixed.** The persistence boundary decrypts the exact prepared Grant before commit and independently requires `operation_kind=handoff`, direct g+1 predecessor binding to authenticated StateV6, exact current RemoteAnchorV2, current Recovery generation, expected operation generation/grant IDs, and a valid `writer_handoff` authorization signature against the authenticated local WriterDeviceKeyV2. These checks execute before the atomic reservation/envelope/outbox/operation/state transaction. |
| IA-054 | V2-07 / durable Handoff completion | The first readback logic required an accepted A→B Grant to still equal the final `current_writer`. If B had already canonically issued a later g+2 Grant before A's readback, A's exact Grant was nevertheless durably accepted, but the service would throw instead of completing the original Handoff and reconciling A read-only to the newer authority. | **Fixed.** Handoff durability is based on canonical acceptance of the exact persisted Grant envelope at its row, not on that Grant remaining the latest authority forever. A later accepted grant does not undo the completed A→B transfer; A reconciles to the freshest current authority (normally read-only after A→B; writer-active only if a later valid Grant has independently returned authority to A), while B's own adoption still requires that B itself is the current canonical Writer at its fresh verify. |
| IA-055 | V2-07 / descriptor API state transition | The first production `createTransferDescriptor()` implementation performed fresh reconciliation with `writerKeyUsable=false` before checking that the caller was locally read-only. Invoking the descriptor action accidentally on the current Writer would therefore persist a local read-only downgrade and only then reject because the same device was already canonical Writer. Descriptor creation must not itself mutate valid Writer authority. | **Fixed.** The production descriptor entry point now requires authenticated local `writer_status="read_only"` before any fresh reconciliation. A regression invokes descriptor creation on the current Writer and proves the call rejects while local Writer status, generation and grant remain unchanged. |
| IA-056 | V2-07 / generic Coordinator ownership | WriterGrant control envelopes are persisted in the shared immutable envelope/outbox journal with `authority=null` because they deliberately have no RevisionV2 `writer_context`. The generic v2 Coordinator initially returned those entries from `pending()`. During a non-terminal Handoff, generic WriteAuthority would then classify that ceremony-owned control as non-pushable/stale and could move it to `stale_writer_pending`, preventing the specialized Handoff readback from later marking the accepted Grant durable. | **Fixed.** `IndexedDbV2CoordinatorStore.pending()` excludes `authority=null` entries entirely. Such WriterGrant controls are owned exclusively by WriterHandoff/ForcedTakeover operation state; canonical pull may still mark an accepted control durable through semantic disposition reconciliation. The productive crash test stops at `prepared` and proves the exact Handoff envelope is absent from the generic Coordinator pending set. |
| IA-057 | V2-07 / stale Handoff control quarantine | When a prepared Handoff Grant becomes terminal `stale`, the operation state transitioned correctly but its ceremony-owned outbox entry (`authority=null`) remained `prepared`. The generic Coordinator intentionally ignores such controls, so nothing later reclassified it. A future BackupV6 could therefore treat the row as pending even though the ceremony was terminal stale. | **Fixed after being recorded OPEN.** The WriterGrant operation transition to `stale` now atomically MAC-rewrites its exact ceremony outbox entry to `stale_writer_pending`, updates `stale_writer_pending_count`, and persists the terminal operation/StateV6 ref in the same IndexedDB transaction. Regressions cover both a physically present `stale_grant_rejected` Grant after an intervening row and an absent prepared Grant made stale before resume. |
| IA-058 | V2-07 / Handoff pending-envelope gate | `noPendingDomainEnvelopes()` initially rejected every non-durable domain outbox entry, including terminal `stale_writer_pending` rows. §15 forbids unresolved non-durable Pending-Envelopes from A; quarantined stale rows are already resolved historical material and must not permanently prevent a later cooperative transfer. | **Fixed after being recorded OPEN.** The gate now blocks only current Writer envelopes in `prepared` or `pending`; terminal stale quarantine does not block transfer. A regression proves the same locally persisted domain row blocks Handoff while unresolved and allows Handoff after explicit terminal quarantine, while remaining quarantined afterward. |
| IA-059 | V2-07 / stale-transition outbox integrity | The IA-057 atomic stale transition computed the new `stale_writer_pending_count` from all epoch outbox entries but initially verified only the ceremony entry MAC. A direct persistence caller could therefore cause a new MAC-authenticated StateV6 count to be derived from a sibling outbox record whose status/tag pair had not first passed the existing full journal-integrity check. | **Fixed after being recorded OPEN.** Every WriterGrant operation transition now runs the complete EnvelopeV6/outbox/reservation journal-integrity verification before reading aggregate outbox status or changing the operation/StateV6 binding. A direct-storage regression corrupts a sibling outbox status without its MAC and proves the stale transition rejects before either operation or StateV6 advances. |


## Reviewed points that are not findings

The following were explicitly rechecked and should not be repeatedly reported as
new defects unless their assumptions change:

1. **Control-ID reservation before signature/authority classification is
   intentional.** §12 reserves a structurally/schema-valid semantic control ID
   before later semantic disposition. Invalid cryptographic authority then
   blocks the whole verification rather than freeing the ID for reinterpretation.
2. **Stale Writer signatures use historical public keys, not the current key.**
   The accepted authority history is the trust source for historical verification.
3. **Diary-wide Recovery freshness is based on accepted credential history.**
   A stale RecoveryTransition does not itself append credentials to
   `recovery_credential_history`; accepted transitions do.
4. **Control payloads use explicit strict validators in addition to the frozen
   schema registry.** The reviewed hand validators reject unknown properties,
   enforce Base64URL byte lengths and implement the protocol cross-field rules
   that go beyond JSON Schema.
5. **Registry sorting uses JavaScript string order, but the frozen wire schema
   identifiers are ASCII.** For this exact allowlist that is byte-identical to
   the required UTF-8 lexicographic order. Introducing non-ASCII schema IDs
   would require revisiting this implementation.
6. **Cross-epoch Source/Migration/Confirmation provenance is not fully provable
   from Successor replay alone.** The local verifier checks the locally available
   structure/state; the activation layer must re-read and verify the direct
   Source and bind predecessor, source snapshots, activation proof and exact
   announcement bytes before declaring the Successor active.
7. **The generic `migration_origin` wrapper remains 1..8 Sources by inherited v1 semantics.** This is not a relaxation of the v2 migration-copy rule. §16a.0/§16a.1 separately requires each copied Successor head to carry exactly one Source with exactly one Source revision and proves the full Source↔Successor bijection during cross-epoch activation. Tightening the generic wrapper itself to exactly one would silently remove inherited wrapper expressiveness rather than enforce the activation rule at the correct layer.
8. **Do not add `diary_id` to the WriterDeviceKeyV2 store entry.** §18.2 freezes that IndexedDB entry to exactly `{writer_signing_key_id, writer_device_id, writer_public_key, private_key}`. The broader architecture rule against global device/key reuse is an enrollment/identity-lifecycle invariant for V2-05/V2-06+; adding a fifth persisted field in V2-03 would itself violate the Exact Protocol. The load-time keypair challenge remains diary/epoch/device-bound as specified.
9. **SyncBackupV6 offline test-restore is not, by itself, an activation grant.** The current V2-04 restore returns `access="read_only"` even when the encrypted backup manifest says `activation_state="activated"`. Full external ActivationLineage/source-history verification remains mandatory before any later service may promote the epoch to remote-active Writer authority. Treating successful offline test-restore as that promotion would violate §10c/§20.

10. **V2-05 immutable operation-artifact SHA-256 is not a standalone authority MAC.** The generic `operationArtifactsV2` store detects accidental/collision changes and enforces one-shot byte reuse, while authorization comes from stronger bindings: RotationOperationStateV2 is referenced by MAC-authenticated local state; Manifest/RootWrap/Recovery artifacts are AEAD-bound; prepared controls are signed/encrypted and their hashes/rows become immutable state fields before remote cutover. Review deliberately did not add a parallel artifact-MAC format because callers must revalidate those cryptographic/state bindings before using an artifact as authority. A future artifact type that is not independently bound this way would require its own authenticated binding and must not rely on the plain SHA-256 alone.
11. **The residual provider race after the final Join verify is the existing no-CAS freshness boundary, not a Join authority grant.** V2-06 now performs a second Recovery-family discovery/canonical verification immediately before local selection, but Google provides no atomic compare-and-switch across that read and the local IndexedDB commit. Join remains read-only, persists the final verified anchor as a freshness floor, and every later mutation still requires a fresh canonical verify; a later provider rollback without any retained newer evidence remains the explicit §25 non-guarantee.



## Required regression coverage

Later changes must retain explicit vectors for at least:

- H0/H1/Hn RemoteAnchorV2;
- EnvelopeV6 exact AAD/ciphertext and tamper rejection;
- impossible/non-canonical `protocol_created_at`;
- `migration_origin` 8/8 bounds, Source uniqueness and decoded-byte canonical ordering;
- byte-identical physical retry rows as semantic no-ops but physical Prefix
  members;
- same `envelope_id` with different bytes;
- IV reuse across different envelope IDs;
- same `revision_id` across different envelopes, including otherwise-stale
  controls;
- 4096-revisions-per-`record_id` bound across accepted, stale and control rows;
- concurrent g+1 grants and historical Writer signatures;
- cross-type Control-ID collision;
- Pending-Rekey fence plus Forced-Takeover exception;
- native-Epoch Migration rejection;
- `canonical_full` vs `rotation_resume` type/result separation;
- `rotation_resume` rejection when any non-Migration-retry row extends the
  Migration staging prefix;
- StateV6 MAC/rollback detection and exact verifier-anchor reproduction;
- WriterDeviceKeyV2 key-ID/keypair challenge validation and StateV6 device-ID binding;
- one fresh canonical verify invocation for every normal domain-write attempt;
- prepared-envelope Writer provenance mismatch => pre-push quarantine;
- accepted vs stale-writer semantic durability and authenticated stale quarantine;
- outbox provenance/status MAC tamper rejection;
- no WebCrypto/long async gaps inside v2 IndexedDB readwrite transactions;
- persisted EnvelopeV6 journal tamper detection before normal prepare/push;
- domain RevisionV2 parent existence/record binding against the fresh accepted graph;
- active StateV6 requires remote binding/anchor plus complete verified Writer authority;
- sealed canonical Source reconciliation => local `read_only`;
- exact prepared-envelope bytes must match immutable local persistence before push authorization;
- unusable/missing WriterDeviceKeyV2 downgrades the normal domain path to read-only without silent regeneration;
- WriteAuthority binds canonical state to exact local diary/epoch/manifest identity;
- pull-time authority loss/seal/Pending-Rekey quarantines locally prepared missing envelopes;
- remote/local envelope-ID collisions compare exact row bytes before semantic status mutation;
- new EnvelopeV6 IVs are unique against local reservations and freshly verified remote history;
- envelope journal, sealed reservations and authenticated outbox remain a complete local bijection;
- authenticated outbox Writer provenance equals the encrypted RevisionV2 writer_context;
- orphaned epochs and stale/durable outbox terminal states cannot be reopened;
- browser Window and Worker mutation paths require Web Locks.
- next domain-write prepare after remote Writer advancement quarantines all old local pending envelopes before returning read-only;
- verified Recovery staging/artifact capabilities cannot be directly constructed or forged;
- ManifestV6 trust-root creation cryptographically binds the exact decrypted payload to the exact public cells/fingerprint;
- provider-bound FreshCanonicalV2Source performs a new remote read + canonical_full on every call and has no snapshot cache;
- read-only Join permits only the exact empty authenticated legacy-cutover marker on a fresh placeholder profile and refuses any unrelated local diary persistence;
- profile-upgrade Join requires exactly one physical v1 Announcement row after the frozen Source prefix; byte-identical duplicate physical rows are rejected at activation-lineage verification;
- Join crash-resume plan fields that influence local Writer identity are rebound to MAC-authenticated StateV6 and the exact immutable RecoveryArtifact hash before use;
- every Join local switch repeats Recovery-family discovery + canonical/activation verification after durable local bundle persistence;
- Join final reconciliation remains read_only even when the freshest canonical Writer tuple matches the newly generated local WriterDeviceKeyV2;


- profile-upgrade decision rows must be immediate after their bound prefixes; byte-identical physical retries remain semantic no-ops, Confirmation retries extend `successor_activation_anchor`, and later valid post-activation suffix rows are canonical-full verified;

- TransferDescriptorV2 PoP, diary/epoch/key-ID binding and distinct target identity are verified before any Handoff Grant is persisted;
- WriterGrantOperationStateV2 prepared/append_unknown/durable/stale transitions remain closed and once-set Grant bytes/anchor/expected IDs are immutable;
- cooperative Handoff preparation requires a fresh exact current source Writer/Recovery/Anchor and no non-durable source domain envelopes;
- WriterGrant Unknown Outcome retries reuse exact persisted bytes, re-verify the exact authority anchor before every retry and stop without a blind third append;
- any intervening physical row after the Handoff authority anchor makes the prepared Grant stale and leaves the source Writer active;
- source becomes read_only only after canonical acceptance of the exact persisted Handoff Grant; target becomes writer_active only after its own fresh Full Verify and exact local device/key/public-key match;
- terminal prior security-operation refs do not block a later Handoff, while non-terminal refs remain hard blockers;
- descriptor creation on a current Writer rejects before reconciliation and cannot demote valid local Writer authority;
- ceremony-owned WriterGrant controls (`authority=null`) never enter the generic Coordinator pending/push/quarantine path;

- terminal stale WriterGrant operation and its ceremony-owned outbox row transition together to the authenticated stale quarantine; generic sync never owns the ceremony row;
- cooperative Handoff blocks unresolved current-Writer `prepared/pending` domain rows but does not treat terminal `stale_writer_pending` history as unresolved work;

- WriterGrant operation transitions authenticate the complete local envelope/outbox/reservation journal before deriving stale aggregates or mutating StateV6;

## Anti-churn rule for later reviews

When a later review touches an entry above, classify it explicitly:

- **regression:** an already-fixed IA invariant was lost;
- **new evidence:** an assumption in Exact Protocol or D-001…D-010 changed;
- **deferred-layer completion:** a V2-03/V2-04+ responsibility is now being
  implemented;
- **same boundary:** no change required.

Do not turn an IA entry into a new D-xxx decision unless the architecture or
threat model actually changes.
