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

### 2026-09-24 full-stack re-audit after V2-07

Re-reviewed the complete current V2-01…V2-07 stack on the exact PR heads below,
rather than relying on earlier review SHAs:

- V2-01 / PR #49: `c7e2621cf05da539a0b58e9d0d9f93387bd78e19`
- V2-02 / PR #50: `db0a0f68dcec8b3282a953d00fbc3325c4d25e3c`
- V2-03 / PR #52: `7498f4413bc26bfc4e320b31f15b705ef2f37e6e`
- V2-04 / PR #53: `c6a25e4ea1eba7112b7e1f0898d8cdffee482741`
- V2-05 / PR #54: `eaf043c8456b111fe18629d2d7ef309d8b4ce17c`
- V2-06 / PR #55: `20123f3d5dfd1880c30e02d780af6bcf6f8e1718`
- V2-07 / PR #56 pre-audit head: `678345ba1bc977fa7b351c9faa731d776cf41d4f`

Every one of those exact heads had a complete successful Security Validation run
before this re-audit began.

The pass rechecked, in order:

1. frozen V2 wire schemas, strict validators, canonical timestamp/ID/bounds rules,
   Ed25519 key-id derivation and domain-separated signing inputs;
2. canonical replay, historical Writer/Recovery authority, immediate-anchor g+1
   linearization, stale/fatal disposition boundaries, Pending-Rekey and seal fences;
3. StateV6 MAC binding, monotonic remote-prefix reconciliation, non-extractable
   WriterDeviceKeyV2 persistence, immutable envelope/reservation/outbox journal,
   operation-generation fencing and fail-closed normal write authority;
4. Google-v2 provider/profile/account binding, ManifestV6, RecoveryArtifactV6,
   RecoveryTakeoverStagingV2 and SyncBackupV6 restore validation;
5. productive v1→v2 cutover including freeze fencing, one-shot controls, migration
   provenance, staged/activated Recovery+Backup, crash/unknown-outcome resume and
   final source/successor freshness;
6. productive read-only Join including Recovery-family leaf discovery, RootWrap/
   State/WriterKey/lineage binding and final fresh canonical verification;
7. productive Cooperative Handoff including target PoP, distinct A→B identity,
   fresh source authority, g+1 grant preparation, ceremony-owned outbox isolation,
   bounded unknown-outcome retry, stale/durable terminal evidence, source demotion
   and target adoption only after independent fresh canonical verification;
8. cross-layer Coordinator/Backup behavior for ceremony-owned and quarantined rows,
   App/Settings wiring boundaries, §24 implementation inventory and production
   release-gate documentation.

No new wire-format, verifier, cryptographic-authority or productive V2-01…V2-07
ceremony defect was identified before remediation in this pass. The first new
finding is IA-062: release-gate/status documentation still describes the pre-V2-07
implementation boundary. IA-062 is intentionally recorded OPEN before any status
document is changed.

Current functional boundary after V2-07 remains:
- §24 steps 1–10 implemented and internally validated;
- Forced Takeover remains the next unimplemented protocol ceremony;
- native v2→v2 Rotation and two-phase Recovery-Rekey orchestration remain open;
- normal App/Settings/domain-materialization/UI wiring remains open;
- Live-Google Parallel-Append and the external production gates remain open.

### 2026-09-24 complete V2-01…V2-07 re-audit after Cooperative Handoff

Re-reviewed the full implemented v2 stack, current Git ancestry, §24 inventory,
release-gate status, cross-slice Join/Handoff/Coordinator/Backup boundaries and
the current PR heads rather than relying on earlier review snapshots.

Findings were recorded before remediation:
- IA-065: the historical V2-03 decision-ledger table still called its rows
  `Current implementation status`;
- IA-066: V2-02…V2-07 contained the current V2-01 hardening semantics byte-for-byte
  but did not contain the current V2-01 PR head in their Git ancestry.

Both were remediated only after their OPEN audit entries existed. No additional
wire-format, cryptographic, canonical-replay, Writer/Recovery-authority,
StateV6, migration, Join or Cooperative-Handoff implementation defect was found
in this pass.

Validated stack after ancestry repair:
- V2-01 / PR #49: `c7e2621cf05da539a0b58e9d0d9f93387bd78e19`
- V2-02 / PR #50: `ecef8db879f59b1fed78e506a4a89da4b85edddf`
- V2-03 / PR #52: `df80592997481d5687de615f888a0e9abbb91c7a`
- V2-04 / PR #53: `877923734d350b78d8abd6e407cbcecf47e94b07`
- V2-05 / PR #54: `8536724252520058c8a65931cc287a37862844de`
- V2-06 / PR #55: `489ad3cde189d7170ce833f0cff82360e6874b13`
- V2-07 / PR #56 pre-closure head:
  `3d4a15d390a163f3406f5d9ddfdee821e4602b2d`

Every recomposed V2-02…V2-07 head above completed the full Security Validation
successfully; V2-01 was already fully green on its unchanged current head.

Current implementation boundary remains:
- §24 steps 1–10 implemented and internally validated;
- productive Forced Takeover remains open;
- native v2→v2 Rotation and two-phase Recovery-Rekey remain open;
- normal App/Settings/domain-materialization/UI wiring remains open;
- Live-Google Parallel-Append and external production gates remain open.


### 2026-09-25 V2-08 Forced Takeover implementation/review pass

Implemented the productive Forced Takeover ceremony from Exact Protocol §16 and
Architecture §23 item 12 on top of the fully re-audited V2-07 stack.

The implementation deliberately reuses the existing WriterGrantOperationStateV2
and ceremony-owned outbox path rather than introducing a second grant transport:
- a fresh canonical_full verify establishes the exact decision prefix and current
  Writer/Recovery authority;
- the current RecoveryArtifactV6 is reopened with the user-supplied URS and bound
  to the active diary/epoch/root/manifest/account plus all persisted freshness
  floors available on the device;
- any current RecoveryAuthorityTransitionProofV2 is rebound to the exact
  canonically accepted transition envelope before the takeover signing key is
  used;
- the g+1 reason="forced_takeover" Grant targets the authenticated local
  WriterDeviceKeyV2 and is signed only with the transient non-extractable
  Recovery takeover key;
- persistence independently reopens the prepared Grant and verifies predecessor,
  Recovery generation/key ID/signature, decision anchor and local target key;
- crash/Unknown-Outcome resume reuses the exact prepared bytes and re-verifies
  their historical Recovery authorization from the fresh canonical prefix;
- accepted readback promotes the local key only through StateV6 reconciliation;
  stale/raced claims enter the existing authenticated stale_writer_pending
  quarantine.

Two cross-slice deferred-layer completions became concrete during V2-08:
1. the V2-07 persistence boundary intentionally accepted only cooperative Handoff
   Grants; V2-08 extends that boundary with a separately checked Forced-Takeover
   branch rather than weakening the Handoff checks;
2. V2-06 intentionally failed closed on Pending-Rekey Join. Exact Protocol §16
   requires device-loss continuation after a durable RecoveryAuthorityTransition,
   so Join now admits that state only when the current RecoveryArtifact carries
   the exact canonically accepted RecoveryAuthorityTransitionProofV2. An
   unproved/stale transition remains rejected.

Productive regressions cover normal takeover after read-only Join, exact
prepared-byte crash resume without a second Recovery capability, stale-prefix
quarantine, wrong Recovery Key rejection, and full device-loss recovery during
Pending-Rekey. The latter proves that takeover may become Writer-active while
the normal domain WriteAuthority remains read_only/maintenance-only until the
mandatory recovery_rekey rotation is completed.

No wire format, frozen signature input or D-001…D-010 architecture decision was
changed. The implemented internal boundary now reaches Architecture §23 item 12
(Forced Takeover + stale-pending quarantine). Native v2→v2 Rotation/two-phase
Recovery-Rekey orchestration, App/UI/domain wiring, Live-Google parallel-append
validation and external production gates remain open.

### 2026-09-25 V2-09 native v2 Rotation / two-phase Recovery-Rekey implementation/review pass

Implemented the productive native v2→v2 Rotation and same-epoch two-phase
Recovery-Rekey ceremonies on top of the V2-08 Forced-Takeover boundary.

The final implementation keeps the irreversible decisions explicitly ordered:
- native rotation freezes a fully verified active Source, snapshots semantic and
  lineage state, prepares a fresh-RK Successor, verifies its exact staging
  prefix, persists one-shot Announcement/Confirmation bytes plus activation
  proof and RecoveryArtifactV6, then switches locally only after durable Source
  seal, durable Successor confirmation, activated BackupV6 and lineage reverify;
- Recovery-Rekey first persists the new immutable same-epoch RecoveryArtifactV6
  and exact writer-signed RecoveryAuthorityTransitionV2, makes that transition
  canonically durable, creates/test-restores the mandatory activated Source
  BackupV6, and only then requires a native rotation_kind="recovery_rekey"
  Successor with a new RK;
- crash/Unknown-Outcome paths never regenerate control bytes. Persisted unknown
  stages may make one later exact-byte retry only after fresh bound-prefix
  verification; Announcement retries additionally reverify the Successor staging
  prefix before the irreversible Source seal;
- Recovery-Rekey supersession is allowed only from the exact remote-current
  post-durable predecessor and is committed atomically; a losing pre-durable
  supersession rebinds the still-current older operation;
- after device loss, a fresh profile can prove the new RecoveryArtifact, Join
  read-only, Forced-Takeover into maintenance-only Writer authority, adopt the
  remote Pending-Rekey without the lost local operation state, and finish Phase B;
- native Successor local protection is inherited from the authenticated active
  v2 Source RootWrapV6 rather than the unrelated retired v1 placeholder.

Adversarial review findings IA-068…IA-080 were recorded before remediation.
They cover ceremony outbox ownership, persistence-layer phase binding, terminal
operation fences, same-epoch backup anchors, supersession/stale semantics,
release-status drift, Forced-Takeover operation locking, pre-publish abort
reachability, bounded Unknown-Outcome liveness, cross-remote Announcement retry
checks and replacement-device RootWrap inheritance.

Full Security Validation is green on security-code head
`8f508ba096d2af6634ab4127f51c4de71f339d76`: TypeScript, the full 256-test
unit suite (including 49 productive profile-upgrade/rotation/rekey tests),
crypto/local protection, Google/auth, state-machine/reconciliation,
recovery/backup/bootstrap, legacy migration, productive rotation crash matrix,
production build, ESLint, Stylelint, Storybook, the configured Playwright matrix
and whitespace checks all pass.

No wire format, signature input or D-001…D-010 architecture decision changed.
The current internal implementation boundary now includes native v2→v2 Rotation
and two-phase Recovery-Rekey. Normal App/Settings/domain-materialization/UI
wiring, the Live-Google parallel-append gate and external production gates remain
open.



### 2026-09-26 V2-10 App/Settings/domain-materialization implementation/review pass

Implemented Architecture §23 item 13 and the deferred application-layer
responsibilities on top of the fully validated V2-09 stack. The normal product
path now selects v1 or v2 before any domain read/write rather than leaving the
V2 protocol services as ceremony-only code.

The V2-10 boundary includes:
- a protocol-selecting application data store in front of the existing
  pain/activity/medication/settings repositories and conflict UI;
- a provider-neutral authenticated V2 application runtime built from the shared
  coordinator, `TransferableSingleWriterV2WriteAuthority`,
  `IndexedDbV2CoordinatorStore` and `V2DomainWritePreparer`;
- ordinary domain writes that derive their current parent from the same fresh
  `canonical_full` used for Writer authorization, while explicit current-head
  parents remain reserved for conflict merges;
- canonical-pull persistence of accepted immutable encrypted EnvelopeV6 bytes
  plus an HMAC-authenticated offline read-model index bound to the exact
  StateV6 anchor/manifest/accepted order, with no health-plaintext cache;
- strict exclusion of foreign stale-writer rows from the local journal/outbox;
- V2 Settings flows for v1->v2 upgrade, read-only Join, cooperative Handoff,
  Writer adoption, Forced Takeover, Recovery-Rekey and replacement-device
  Pending-Rekey continuation, with read-only/Pending-Rekey/stale-quarantine
  state visible in the normal application UI;
- profile-aware Google/session routing that fences legacy v1 enablement and
  controls after V2 selection while keeping the data-layer provider-neutral;
- profile-aware local Passphrase/PRF/lock/unlock for the selected RootWrapV6.
  If same-diary retained v1 history is still best-effort, strong V2 status stays
  fail-closed locked until that historical source is strengthened; V2 unlock
  resumes this catch-up after a crash.

Findings IA-081…IA-086 were each recorded OPEN before remediation. They are
closed by the implementation and regressions above. The security-code evidence
head `d4bcd4753dfb23ffc03c0cccc7bde67d13bd36d9` completed the full Security
Validation successfully: production dependency audit, TypeScript, complete unit
suite including productive V2 app/local-protection regressions, crypto/local
protection, Google/provider boundary, single-writer reconciliation,
recovery/backup/bootstrap, legacy migration, productive rotation crash matrix,
production build, ESLint, Stylelint, Storybook, the full configured Playwright
matrix and whitespace checks.

No frozen wire format, signature input or D-001…D-010 security decision changed.
The current internal implementation boundary is now V2-01…V2-10, including
Architecture §23 item 13 (UI/application integration). The remaining internal
pre-release slice is the Live-Google Parallel-Append-Gate; external deployment,
real authenticator/browser validation and independent audit gates remain
separate release blockers.

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
| IA-060 | V2-07 / durable WriterGrant transition evidence | `advanceWriterGrantOperationBinding()` initially allowed a direct `prepared/append_unknown -> durable` transition based only on the operation/StateV6 binding. The productive Handoff service reaches `durable` only after a fresh canonical readback has already marked the exact ceremony outbox entry durable, but the persistence boundary itself did not require that authenticated evidence. A direct internal caller could therefore persist a false terminal Handoff success while the exact Grant remained merely local/pending. | **Fixed after being recorded OPEN.** The storage boundary now requires the exact ceremony-owned outbox entry (`authority=null`) to be MAC-valid and already `status="durable"` before any terminal durable operation transition. A direct `prepared -> durable` regression without remote/canonical evidence fails without changing operation, StateV6 or outbox. |
| IA-061 | V2-07 / stale WriterGrant transition evidence | Productive Handoff reaches `stale` only after a fresh canonical verify has been reconciled into MAC-authenticated StateV6, but `advanceWriterGrantOperationBinding()` itself still permits `prepared/append_unknown -> stale` while StateV6 continues to show the exact original `authority_anchor`, predecessor Writer and Recovery generation with no seal/rekey fence. A direct internal persistence caller could therefore falsely terminalize a still-authorized Handoff and quarantine its one-shot Grant without authenticated stale evidence. | **Fixed after being recorded OPEN.** A terminal stale transition now requires MAC-authenticated StateV6 to carry a remote anchor different from the operation's decision anchor, which in the production reconciliation path can only arise from a fresh verified physical prefix extension. With the original anchor still current, the transition fails before outbox, operation or StateV6 change. A direct-storage regression pins this boundary. |
| IA-062 | V2-07 / release-gate inventory drift | After Cooperative Handoff became productive and fully validated, `PRODUCTION_SECURITY_RELEASE_GATES.md` and its internal TODO still described the v2 implementation boundary as V2-01…V2-06 and listed Cooperative Handoff as open. The protocol code was correct, but the authoritative release-status inventory could cause reviewers to reason from an outdated implementation boundary. | **Fixed after being recorded OPEN.** Release gates now describe V2-01…V2-07, include productive Cooperative Handoff in implemented/tested scope, start remaining internal work at Forced Takeover, and pin the last fully green security-code head before status-only documentation cleanup (`4ecbb48ab659843e36adbbeb08b679685f924efa`). The decisions ledger's V2-03 implementation table is explicitly labeled as a historical snapshot and points reviewers to the implementation audit/release gates for current status. |
| IA-063 | V2-07 / stale WriterGrant prefix-advance proof | IA-061 added a persistence-layer stale-evidence gate, but the first cut only required authenticated StateV6 `remote_anchor` to differ from the prepared Grant's `authority_anchor`. A same-height/different-hash anchor is not a proof of physical prefix advancement and must never authorize terminal stale classification, even though the normal canonical reconciliation path would already reject such a fork. | **Fixed after being recorded OPEN.** Terminal WriterGrant `stale` now requires the authenticated StateV6 anchor to use the same v2 anchor profile and have `covered_row_count` strictly greater than the prepared authority anchor. A direct-storage regression persists a MAC-valid same-height/different-hash StateV6 anchor and proves operation, State ref and ceremony outbox remain non-terminal. Full Security Validation is green on implementation head `4ecbb48ab659843e36adbbeb08b679685f924efa`. |
| IA-064 | V2-07 / anti-churn assurance status coupling | After IA-062 correctly relabeled the V2 decision ledger's implementation table as a historical V2-03 snapshot, `architecture.test.ts` still required the old literal heading `Implementation status at this review`. The new documentation was semantically correct, but the assurance test encoded the stale wording rather than the intended anti-churn property and therefore made the full validation fail. | **Fixed after being recorded OPEN.** The assurance test now requires the historical V2-03 snapshot label, explicitly requires pointers to the current implementation audit and production release gates, and retains the D-001…D-010 anti-churn checks. Full Security Validation is green on head `844034967388f34ea59c412d41854d98ca190a1f`. |
| IA-065 | V2-07 / historical decision-ledger status labeling | IA-062/IA-064 correctly marked the V2 decision-ledger implementation section as a historical V2-03 snapshot and redirected current status to the implementation audit/release gates, but the table immediately below still used the heading `Current implementation status` and contained then-correct statements such as `v2 adapter pending` / `V2-04 must wire ...`. That heading contradicted the historical-snapshot warning and could still be read as the current V2-07 boundary. | **Fixed after being recorded OPEN.** The table is now explicitly labeled `Historical implementation status at V2-03 review`; its old row contents remain unchanged as historical evidence. Architecture assurance now requires that historical label, forbids the ambiguous `Current implementation status` header, and retains pointers to the current implementation audit/release gates. |
| IA-066 | V2-01…V2-07 / stacked-branch ancestry drift | The current V2-01 PR head contained four later hardening commits (canonical protocol timestamps and canonical `migration_origin` bounds) that were byte-for-byte present in the downstream V2-02…V2-07 trees, but those downstream branches still descended from the older V2-01 commit `bea77cc64dc9b6689a875450216f853065dea950` rather than the current PR #49 head `c7e2621cf05da539a0b58e9d0d9f93387bd78e19`. The security semantics were present, but the stacked Git ancestry no longer proved that the reviewed lower slice was actually an ancestor of every upper slice. | **Fixed after being recorded OPEN.** The stack was repaired bottom-up with tree-preserving merge commits. Every current adjacent pair V2-01→V2-07 now has `behind_by=0`, every PR reports the current lower head as its base SHA, and all recomposed slice heads completed full Security Validation successfully. The V2-01 hardening files were byte-identical before the ancestry repair, so no security semantics changed during the merge repair. |
| IA-067 | V2-08 / implementation-audit status tail drift | After the V2-08 implementation section was added, the later V2-07 final-disposition paragraph still called its old boundary `current` and listed Forced Takeover as open. Because that paragraph appears later in the file than the V2-08 section, a reviewer reading bottom-up could incorrectly treat the historical V2-07 boundary as current. | **Fixed after being recorded OPEN.** The trailing V2-07 paragraph is now explicitly labeled as the boundary at the conclusion of the 2026-09-24 V2-07 review, its historical evidence is preserved, and a separate current V2-08 boundary states that Architecture §23 item 12 is implemented while native v2→v2 Rotation/Recovery-Rekey, App/UI, Live-Google and external gates remain open. |


| IA-068 | V2-09 / Maintenance-Control outbox ownership | Native v2 Rotation and Recovery-Rekey require writer-signed one-shot Maintenance-Control envelopes (RecoveryAuthorityTransitionV2, RotationAnnouncementV2 and successor-side migration/confirmation controls) to survive crashes in local persistence. The existing generic v2 Coordinator excludes WriterGrant ceremony rows only through `authority=null`; a writer-signed Maintenance-Control persisted with normal Writer provenance would therefore be returned by `pending()`. While its persistent rotation/recovery operation lock is active, normal WriteAuthority is intentionally read-only, so a concurrent/resumed generic Coordinator could terminally quarantine that exact ceremony envelope as `stale_writer_pending` before its owning protocol service reconciles it. That would turn the safety lock itself into a crash-resume denial of service. | **Fixed after being recorded OPEN.** Ceremony-owned writer-signed Maintenance-Control outbox rows now carry authenticated `ceremony_owner` metadata in the outbox MAC. Generic Coordinator `pending()` excludes them and generic verified pulls preserve their disposition; only the owning rotation/rekey ceremony finalizes them. A productive regression proves a remotely accepted Recovery transition remains locally `prepared` across a generic pull and is then completed by its owner. |
| IA-069 | V2-09 / productive ceremony assurance gap | The new ProductiveNativeRotationV2Service and ProductiveRecoveryRekeyV2Service are present on the V2-09 branch, but no V2-09-specific productive regression file is part of the PR diff. A green pre-existing Security Validation would therefore not exercise normal native rotation, two-phase Recovery-Rekey, crash/Unknown-Outcome resume, Pending-Rekey adoption after device loss, or final local switch invariants through these new services. | **Fixed after being recorded OPEN.** Productive V2-09 regressions now cover normal v2→v2 rotation, Source-freeze crash resume, full two-phase Recovery-Rekey, prepared/publish/append crash boundaries, bounded Unknown-Outcome resume, Source/Successor race classification, direct persistence gates, supersession/fallback, terminal WriteAuthority semantics, remote Pending-Rekey adoption, and the full replacement-device `Join -> Forced Takeover -> adoption -> Phase B` path. The final security-code head passes the complete validation matrix. |
| IA-070 | V2-09 / native rotation persistence phase binding | ProductiveNativeRotationV2Service checks that a `recovery_rekey` rotation binds the exact authenticated current transition and a local RecoveryRekeyOperationStateV2 at `successor_rotation_required`, but `initializeNativeSourceRotationBundle()` did not independently enforce that coupling. A direct internal persistence caller could therefore bind a `recovery_rekey` RotationOperationStateV2 to StateV6 without the mandatory completed Phase-A state; conversely a normal rotation persistence call did not itself reject Pending-Rekey. | **Fixed after being recorded OPEN.** `initializeNativeSourceRotationBundle()` independently enforces normal-vs-`recovery_rekey` state, exact authenticated transition ID, and for rekey rotation the exact bound `RecoveryRekeyOperationStateV2` at `successor_rotation_required`. Direct-storage regression coverage rejects bypass attempts. |
| IA-071 | V2-09 / terminal Recovery-Rekey WriteAuthority fence | The pre-V2-09 WriteAuthority conservatively blocked normal writes whenever `recovery_operation_state_ref !== null`, because no productive RecoveryRekeyOperationStateV2 existed yet. With V2-09, terminal `stale`, `superseded`, or `completed` Recovery-Rekey refs are legitimate historical evidence. Keeping the old blanket check would leave an otherwise active, non-Pending-Rekey Writer permanently read-only after a terminal Rekey attempt. | **Fixed after being recorded OPEN.** WriteAuthority now treats only non-terminal Recovery-Rekey operation refs as the local operation fence; historical terminal `completed`, `stale`, and `superseded` refs no longer permanently force read-only. The independent authenticated Pending-Rekey fence remains fail-closed. Regression coverage proves terminal stale permits normal Writer authority while a non-terminal ref does not. |
| IA-072 | V2-09 / BackupV6 same-epoch Recovery-Rekey anchor | BackupV6 activation validation required every non-native RecoveryArtifactV6 `remote_anchor` to equal the epoch's original `successor_staging_anchor`. That is correct for the activation-time artifact, but impossible for the §16 same-epoch Recovery-Rekey artifact: the new artifact carries a RecoveryAuthorityTransitionProofV2 prepared at the later `authority_anchor_before_transition`, and the mandatory activated Source backup is created only after that transition becomes durable. The old invariant therefore makes the normative Phase-A Source backup unconstructable for every migrated/rotated non-native epoch. | **Fixed after being recorded OPEN.** BackupV6 keeps the exact Successor staging-anchor rule for activation artifacts without a same-epoch transition proof. A Recovery-Rekey artifact with `RecoveryAuthorityTransitionProofV2` instead binds `remote_anchor` to the proof's exact `authority_anchor_before_transition`; the anchor must still reproduce as a real backup-row prefix and the canonical end-Recovery state is fully reverified. Productive Recovery-Rekey Source-backup/test-restore coverage is green. |
| IA-073 | V2-09 / Recovery-Rekey supersession persistence stage | The productive service reconciles an older Recovery-Rekey to a remote-current post-durable state before allowing a newer local Rekey to supersede it, but both prepared-bundle/binding persistence boundaries only required the old referenced operation to be non-terminal. If the remote Transition had become current while the local old operation still lagged at `transition_pending`/`transition_unknown`, a direct internal caller could bind a superseding operation without first reconciling the old ceremony to durable evidence. | **Fixed after being recorded OPEN.** Both Recovery-Rekey persistence entry points allow supersession only when the exact locally bound old operation is post-durable (`transition_durable`, `source_backup_verified`, or `successor_rotation_required`) and matches the authenticated remote-current transition. Pre-durable local state must reconcile first. Productive supersession and stale-fallback regressions are green. |
| IA-074 | V2-09 / false stale after durable Recovery transition | `advanceRecoveryRekeyOperationBinding(... -> stale)` required authenticated prefix advancement after `artifact_publish_attempted=true`, but did not reject the case where StateV6 already proves that this operation's own Transition is the canonical current Recovery authority. A direct internal caller could therefore terminalize a remotely durable/current Rekey as `stale` merely because its own accepted transition lengthened the prefix, breaking mandatory Phase-B completion. | **Fixed after being recorded OPEN.** Persistence now rejects `-> stale` when authenticated StateV6 already proves this operation's exact transition/to-Recovery tuple is canonical current Pending-Rekey. Such a state must reconcile to `transition_durable`. A direct regression exercises the crash window where the remote transition is durable while the local operation still lags. |
| IA-075 | V2-09 / release-gate and audit boundary drift | After native v2→v2 Rotation and two-phase Recovery-Rekey became productive and regression-covered, `PRODUCTION_SECURITY_RELEASE_GATES.md` and the trailing current-boundary paragraph in this audit still identified V2-08 as the implemented frontier and listed Rotation/Recovery-Rekey as open. That stale inventory would make later reviewers reason from the wrong protocol boundary and could hide regressions behind an obsolete TODO. | **Fixed after being recorded OPEN.** Release gates and the audit tail now advance the current internal boundary to V2-01…V2-09, record productive native rotation/two-phase Recovery-Rekey and their device-loss continuation, and leave App/UI/domain wiring, Live-Google parallel append and external production gates open. Historical V2-07/V2-08 boundary paragraphs remain explicitly historical. The last fully green security-code head before this status-only correction is `8f508ba096d2af6634ab4127f51c4de71f339d76`. |
| IA-076 | V2-09 / Forced-Takeover vs local Recovery-Rekey operation lock | `ProductiveForcedTakeoverV2Service.nonTerminalSecurityOperation()` exempted a non-terminal local `recovery_operation_state_ref` whenever `recovery_rekey_rotation_required=true`. That exception is unnecessary for the device-loss path (a fresh replacement device has no local Rekey operation yet) and contradicts Exact Protocol §16 Operation-Locking: on the same device, Forced Takeover is blocked while a local RecoveryRekeyOperationStateV2 exists; only after device loss may the replacement device takeover first and adopt the remote Pending-Rekey afterwards. | **Fixed after being recorded OPEN.** Forced Takeover now treats every local non-terminal Recovery-Rekey operation as a lock both in the service gate and the WriterGrant persistence boundary; the old Pending-Rekey exception is gone. A replacement device still works because fresh Join has no lost local Rekey operation: the end-to-end regression completes `Join -> Forced Takeover (maintenance-only) -> remote_pending_rekey_adoption -> Phase B`. |
| IA-077 | V2-09 / unreachable pre-publish Recovery-Rekey abort | `RECOVERY_REKEY_STAGES_V2`/`ALLOWED` explicitly permit `new_material_staged -> stale` before any remote RecoveryArtifact publish attempt, matching Exact Protocol §16 crash/abort rules. But `validateRecoveryRekeyOperationStateV2()` required `artifact_publish_attempted=true` for every stage except `new_material_staged`, so the resulting terminal `stale` state with a false publish fence was rejected and the advertised transition was unreachable. | **Fixed after being recorded OPEN.** The validator permits `artifact_publish_attempted=false` only for `new_material_staged` and terminal `stale`, while the transition function permits false-fence stale only directly from an unattempted `new_material_staged`. Every later stale path retains the monotone publish fence. Regression coverage exercises the exact pre-publish abort. |
| IA-078 | V2-09 / Unknown-Outcome resume liveness | Recovery-Rekey moved an absent/unresolved Transition append to `transition_unknown`, but a later resume only re-read and returned the same state without the §14-authorized exact-byte retry. Native Rotation similarly performed at most one in-call retry, then persisted `announcement_unknown`/`confirmation_unknown`; later resumes returned `unknown` without another append even when fresh canonical_full proved the exact bound Source/Successor prefixes unchanged. These paths are fail-safe but can become permanently stuck after an Unknown Outcome that did not commit. | **Fixed after being recorded OPEN.** Persisted `transition_unknown`, `announcement_unknown`, and `confirmation_unknown` states now allow one exact-byte append on each later explicit resume only after fresh canonical verification of their bound prefixes. Initial unknown chains remain bounded; no semantic bytes are regenerated and no blind third append occurs. No-commit Unknown-Outcome regressions prove eventual completion after a later fresh resume. |
| IA-079 | V2-09 / Announcement retry omitted fresh Successor staging check | `ProductiveNativeRotationV2Service.publishOrReconcileAnnouncement()` initially verified both the frozen Source and Successor staging prefix, but after an `unknown_outcome` with the Announcement still absent it re-read only the Source before issuing its second exact-byte append. Exact Protocol §14 requires every RotationAnnouncement retry to prove both Source=`source_anchor_before_announcement` and Successor=`successor_staging_anchor`. A Successor row arriving between the first unknown request and the retry could otherwise lead to an irreversible Source seal for a no-longer-staged Successor. | **Fixed after being recorded OPEN.** Every native Announcement append/retry now freshly checks both the frozen Source and the exact Successor staging prefix. An injected Successor row between the first no-commit unknown outcome and the retry causes stale/cutover classification and proves the Source Announcement is never appended/sealed. |
| IA-080 | V2-09 / native v2 rotation inherited local protection from active v1 placeholder | `ProductiveNativeRotationV2Service.planSuccessor()` reused `prepareSuccessorRootWrapV6ForActiveMode()`, whose security-mode inheritance is intentionally anchored to the active v1 diary for profile-upgrade. After a fresh-device v2 Join, the local v1 slot is only a retired unrelated placeholder diary, so mandatory recovery_rekey Phase B failed with `RootWrapV6 successor diary does not match the active v1 diary.` This makes the normative device-loss continuation `Join -> Forced Takeover -> remote_pending_rekey_adoption -> recovery_rekey rotation` impossible on a replacement profile. | **Fixed after being recorded OPEN.** Native v2→v2 planning now derives Successor local protection from the authenticated active v2 Source `RootWrapV6`, verifies that Source wrap against the active v2 selection, uses a fresh best-effort wrapping key when appropriate, and reuses only an already-unlocked passphrase/PRF factor that actually opens the authenticated Source wrap. The v1-based helper remains profile-upgrade-specific. The full replacement-device Pending-Rekey continuation now passes end-to-end. |
| IA-081 | V2-10 / UI repository protocol bypass after v2 selection | The app-level pain/activity/medication/settings repositories still call the v1 `localDatabase` CRUD functions directly. After `activeProtocolSelectionV2` exists, those calls can continue creating v1 revisions in the retired/local placeholder path instead of entering `V2DomainWritePreparer`, so UI writes bypass StateV6, fresh canonical verification, Writer authority, v2 signatures and stale-writer fencing. `initializeDataLayer`/`GoogleSyncSettings` are likewise v1-only. | **Fixed after being recorded OPEN.** `applicationDataStore` now dispatches all existing domain repositories and conflict UI by active protocol. V2 mutations enter the provider-neutral authenticated V2 runtime and `V2DomainWritePreparer`, deriving current parents from the same fresh `canonical_full` used for authorization; V2 reads materialize only the authenticated accepted graph. `initializeDataLayer` installs a V2 coordinator/runtime when V2 is selected and rejects cross-profile sessions. Productive repository regressions prove Writer writes become canonically durable and the same repository call on a joined read-only device is rejected before any new local EnvelopeV6 is persisted. |
| IA-082 | V2-10 / verified local v2 read-model persistence | `IndexedDbV2CoordinatorStore.commitVerifiedPull()` reconciles StateV6 and outbox dispositions but does not persist newly verified remote EnvelopeV6 rows or an authenticated accepted-order index. Consequently the app cannot satisfy the architecture rule that reading from already-verified local state remains available offline without either trusting stale/rejected local rows or re-reading Google. | **Fixed after being recorded OPEN.** Canonical pulls now atomically import only accepted immutable encrypted EnvelopeV6 rows into the local V2 journal and persist an HMAC-authenticated `VerifiedReadModelV2` bound to epoch, manifest fingerprint, exact StateV6 remote anchor and accepted envelope IDs in physical first-occurrence order. Offline reads reopen only those encrypted accepted envelopes; no health plaintext cache is introduced. Journal, read-model MAC, anchor, manifest or missing-envelope tamper fails closed. A productive regression writes through the real pain repository, disconnects the V2 runtime and successfully reads the accepted data offline; a read-model-MAC tamper regression is rejected. |
| IA-083 | V2-10 / foreign stale-row import into local stale-pending outbox | The first V2-10 verified-pull import treated every remote `stale_writer_envelope_id` that was not already local like an accepted remote row: it persisted the encrypted bytes locally and created a synthetic `stale_writer_pending` outbox entry. `stale_writer_pending` is a local quarantine obligation for this installation's own previously prepared Writer envelope; importing stale rows authored by other devices would manufacture local remediation state, inflate the pending count and make a clean read-only Join appear to own foreign stale work. | **Fixed after being recorded OPEN.** Verified pull imports only canonically accepted remote envelopes. A stale remote row that was never local is not added to the encrypted journal and never receives a synthetic outbox entry; only an already-local authenticated outbox entry can be transitioned to `stale_writer_pending`. A fresh read-only-device regression pulls a physical stale row authored by another Writer and proves zero local stale-pending count plus absence from both local envelope journal and outbox. |
| IA-084 | V2-10 / Pending-Rekey replacement-device UI dead end | The first V2-10 Writer settings rendered Forced Takeover only when `writerStatus==='read_only' && !recoveryRekeyRequired`. That hides the one recovery action required after a fresh-device Join into a remotely pending Recovery-Rekey. Exact Protocol/Architecture require `Join -> Forced Takeover (maintenance-only) -> remote_pending_rekey_adoption -> Phase B`; cooperative Handoff and normal domain writes remain blocked, but Forced Takeover must stay available. | **Fixed after being recorded OPEN.** V2 Settings now keeps Recovery-key-authorized Forced Takeover available on read-only Pending-Rekey devices, labels the resulting authority as maintenance-only, hides cooperative Handoff there and exposes Pending-Rekey completion once takeover is canonical. The existing full device-loss regression now runs through the application data-layer entry points and proves `read_only + pending -> Forced Takeover -> writer_active + pending -> remote_pending_rekey_adoption/Phase B -> writer_active + no pending`. |
| IA-085 | V2-10 / Settings profile-transition listener initialization | The first profile-aware `GoogleSyncSettings` registered `onSyncState()` before initializing its local `cancelled` guard even though `onSyncState()` synchronously invokes the new listener. That creates a temporal-dead-zone runtime failure on mount. The listener also refreshed durability without updating `protocolProfile`, so an in-place v1→v2 upgrade could leave legacy v1 controls visible until remount. | **Fixed after being recorded OPEN.** The cancellation guard is initialized before listener registration, and every sync-state refresh re-reads the active protocol/session status so an in-place profile switch immediately fences the legacy v1 controls. The dedicated V2 settings root is also DOM-distinct from the legacy Google settings section, preserving strict browser selectors. Production build, Storybook and the full configured Playwright matrix are green on the V2-10 security-code evidence head. |
| IA-086 | V2-10 / local strong-protection UI remained v1-only after v2 selection | `App` and `LocalSecuritySettings` still read/enrolled/unlocked/locked only the v1 `RootWrap`, while the active v2 RK is protected by a separate `RootWrapV6` in the v2 security store. After Join/upgrade, enabling Passphrase or PRF in the visible UI could therefore strengthen only the retired/placeholder v1 context and leave the active v2 RK under its previous best-effort wrap, while the UI claimed strong local protection. On a v1→v2 profile-upgrade device, the inverse is also relevant: historical v1 health envelopes remain locally present, so strengthening only v2 would leave the retired source decryptable under an older weaker local wrap. | **Fixed after being recorded OPEN.** The existing local-security API now dispatches to the active protocol. Under v2, status/unlock/lock/enrollment operate on the selected `RootWrapV6`, verify the opened RK against authenticated StateV6 and use an atomic identity-preserving RootWrapV6 replacement with readback. If a retained same-diary v1 Source is still best-effort, a newly persisted strong V2 wrap remains deliberately reported locked until that historical Source is strengthened; successful V2 passphrase/PRF unlock resumes and completes the catch-up. This is more crash-resumable than a source-first PRF rewrite because the persisted V2 wrap retains the exact credential/eval-input metadata needed after restart. Already-strong retained v1 material need not be rekeyed to the same factor. Passphrase, PRF, wrong-factor, lock/unlock and simulated crash-window regressions plus an architecture ordering/fence test are green. |
| IA-087 | V2-10 / post-Join strong RootWrapV6 opened through placeholder-diary helper | The V2-10 local-protection fix correctly stores new passphrase/PRF factors under the active v2 diary ID, but several post-selection V2 ceremony services still call `openReadOnlyJoinRootWrapV6WithActiveMode()`. That helper intentionally resolves strong factors through the still-active v1 placeholder diary during the pre-switch Join ceremony. On a fresh device whose unrelated placeholder diary differs from the joined v2 diary, strengthening the joined V2 RootWrapV6 therefore makes later Handoff, Forced Takeover, Recovery-Rekey and native source rotation unable to find the otherwise valid unlocked v2 factor. | **Fixed after being recorded OPEN.** The Join-specific helper remains confined to the pre-selection Join path. Post-selection Handoff, Forced Takeover, Recovery-Rekey, application-runtime opening and native v2 rotation now use `openSuccessorRootWrapV6WithActiveMode()`, which resolves strong factors by the authenticated `wrap.diary_id` rather than the active v1 placeholder diary. A fresh-device Join -> passphrase protection -> lock/unlock -> Writer transfer-descriptor regression proves the post-Join ceremony path remains usable; Security Validation #971 is green on the implementation head. |
| IA-088 | V2-11 / Live-Google Parallel-Append gate had no reproducible executable harness | Architecture §14 / Exact Protocol §24 require a real-provider experiment with concurrent `AppendCellsRequest` calls and stable full-read physical row ordering. The repository previously documented the requirement but had no executable live harness, so the remaining internal gate could not be run reproducibly or distinguished from mock coverage. | **Harness implemented; live gate remains OPEN until executed with a dedicated Google test account.** `scripts/live-google-parallel-append-gate.mjs` issues independent concurrent `appendCells` requests for unique sentinel pairs, requires both successful writes to appear exactly once and adjacent, and requires their physical order to remain unchanged across a second full reread. It runs at least 10 rounds (20 by default) via `npm run test:live-google-parallel-append`. A PASS from this real-provider run is required before §23 item 15 can be closed; ordinary CI cannot satisfy it. |
| IA-089 | V2 E2E / successful Auth-Origin handoff is not browser-proven | A real local Google OAuth ceremony reached `Identität wird gebunden …`, but the subsequent Popup → Bridge credential transfer, identity confirmation, RPC activation, and first provider request did not complete. Existing unit/architecture tests instantiated lower-level provider boundaries or only proved that an unconfigured auth page failed closed; none drove the productive `window.open`/iframe/MessageChannel lifecycle. Code review identified a concrete failure mode consistent with that symptom: a Bridge identity error was rendered only inside the hidden iframe and its provider `fetch` had no inner deadline, so the Diary could remain at the binding state until its outer 120-second timeout. This simulated failure mode is not evidence that the historical real-Google incident had exactly that root cause. This affected **INV-02** (credential confinement) and the availability side of the authenticated provider capability boundary; failed handoff must also preserve **INV-03** by granting no Writer capability or remote write. | **Simulated failure mode fixed; historical live root cause remains unproven.** Provider identity reads now have a 30-second abort bound. Bridge failure clears the credential and sends only an action-bound credential-free `google-auth-failed/v2` capability message before closing both ports; the Diary rejects immediately and removes the iframe/capability. Browser regressions cover stalled confirmation with a finite outer bound, immediate provider rejection propagation, successful Popup → Bridge → RPC, stale action, foreign origin, Authorization-header rejection, credential sentinel absence, and disconnect revocation. `npx playwright test tests/google-auth-handoff.spec.ts --project=chromium --reporter=line`, auth/architecture unit tests, lint, and build are green. This closes the simulated L3 defect and its INV-02/INV-03 regression only. IA-089 remains open for the original real-Google incident until provider/deployment reproduction or equivalent evidence establishes its root cause; Live Google and separate-origin deployment gates remain open. |
| IA-090 | V2 E2E / Popup identity failure is not propagated through the Bridge | IA-089 added bounded provider identity reads and Bridge→Diary failure propagation, but `bindPopup()` still closed its token port without sending a failure message when the Popup's own provider-identity request failed. The Bridge then waited forever for its one token-port message and the Diary again remained pending until the outer timeout. This is an adversarial sibling of IA-089 affecting the same INV-02/INV-03 capability boundary and disproved IA-089's overly broad closure claim for all identity-request failures. | **Fixed after being recorded OPEN.** Popup identity failure now sends an action-bound, credential-free `google-auth-token-failed/v2` frame over the already transferred token capability before closing it. The Bridge accepts that frame only for the exact action, clears any credential, emits the existing credential-free Bridge failure, and closes both ports; the Diary promptly rejects and removes its capability. A browser regression rejects the first provider identity request and proves rejection well before the outer timeout with no credential sentinel. The stalled-confirmation, Bridge-failure, success/RPC, stale-action, foreign-origin, Authorization, disconnect, architecture, lint, and build siblings are green. No protocol/crypto or Writer semantics changed; Live Google and separate-origin gates remain open. |
| IA-091 | V2 E2E / native V2 genesis has no productive local-selection boundary | The first browser Golden-Path cut could construct and canonically verify a native ManifestV6/genesis WriterGrant and persist RootWrapV6/StateV6, but application services such as cooperative Handoff require `activeProtocolSelectionV2()`. The repository exposed selection only for read-only Join, profile upgrade, or an already-selected native rotation. A native first-V2 Writer therefore could not become product-reachable without abusing the Join selector or directly editing IndexedDB, both forbidden test shortcuts. This prevented the claimed native Golden Path from reaching the same application/runtime boundary as subsequent operations and affected INV-03. | **Fixed after being recorded OPEN.** `atomicSelectNativeGenesisV2` is a separate local transition that accepts only a MAC-authenticated active canonical Writer StateV6 with matching verified/current Writer tuple, non-empty remote anchor, usable local WriterDeviceKeyV2, matching open RootWrapV6, no Pending-Rekey/operation lock, and a fresh empty v1 placeholder. Selection and placeholder retirement commit together in the v1 local database and are read back; repeat is byte-idempotent while a conflicting selection fails. Unit regressions cover read-only rejection, successful canonical Writer selection and collision. The five-case browser Golden Path now uses this boundary before its productive domain writes; lint/build are green. No wire, crypto, grant, verifier, or remote semantics changed. |
| IA-092 | Test lifecycle / background sync rejection escapes after test completion | Running the productive Recovery-Rekey/forced-takeover suites together completed all 72 assertions but Vitest reported an unhandled `Stale StateV6 generation before verified pull commit` rejection from `syncManager` after the owning test had completed. This means an installed background synchronization pass can outlive test teardown or propagate a rejected pass without an observed owner, making the green result unreliable and potentially masking a real lifecycle race at the INV-03 application boundary. | **Fixed after being recorded OPEN.** Timer-owned passes now explicitly consume their promise after `run()` publishes the failure through the observable error snapshot, and clearing an authenticated synchronizer cancels its queued timer so a prior session cannot race a replacement database/session. Deterministic fake-timer siblings prove both error publication without an unhandled rejection and disconnect cancellation; the formerly racing read-only repository case passes together with them, and the 12-case Recovery-Rekey/Pending-Rekey selection completes with zero unhandled errors. No protocol, authority, wire or cryptographic semantics changed. |
| IA-093 | V2 E2E / Golden Path still bootstraps security state inside the test harness | Package #7 is recorded DONE, but `MultiDeviceHarness.bootstrapCanonicalV2()` directly constructs ManifestV6, the genesis WriterGrant envelope and RecoveryArtifactV6, while `writeCanonicalPainV2()` directly initializes StateV6, persists the WriterDeviceKeyV2 and creates/persists RootWrapV6 before calling `atomicSelectNativeGenesisV2`. The new selection boundary is productive, but it does not turn this test-owned security bootstrap into the required productive new-diary lifecycle. This bypasses the application/service integration boundary that GATE-E2E-01 is intended to prove and can hide missing orchestration between Recovery/RootWrap/StateV6/remote genesis. It affects assurance for INV-01/INV-03 rather than changing the frozen wire semantics. | **OPEN.** Keep the valuable canonical/write/reload/Join coverage, but #7 must remain IN_PROGRESS until the initial Diary/V2 security bootstrap is driven through an existing productive service/application path, or a missing productive orchestration boundary is implemented with its own regression. Do not create a test-only bootstrap API and do not weaken crypto/authority checks. |

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
- existing app domain repositories cannot bypass v2 after `activeProtocolSelectionV2`; a read-only joined device is rejected before a new local EnvelopeV6 is persisted;
- successful normal app writes require fresh canonical Writer authorization and canonical remote readback before the repository call resolves;
- canonical pull imports only accepted encrypted remote EnvelopeV6 rows; foreign stale-writer rows never synthesize local journal/outbox or stale-pending obligations;
- offline v2 reads materialize only the MAC-authenticated accepted read-model bound to exact StateV6 anchor/manifest; read-model MAC or referenced-envelope tamper fails closed;
- v1/v2 authenticated session routing rejects cross-profile sessions and legacy v1 remote enablement after v2 selection;
- replacement-device Pending-Rekey application flow remains `Join -> Forced Takeover (maintenance-only) -> remote_pending_rekey_adoption -> Phase B`, while cooperative Handoff and normal domain writes stay fenced;
- legacy Google settings switch immediately to the v2 surface after in-place profile selection and do not share ambiguous browser selectors with the v2 ceremony UI;
- active-v2 Passphrase/PRF status, enrollment, lock and unlock operate on RootWrapV6 and authenticate StateV6 before data access;
- a strong V2 RootWrap with retained same-diary best-effort v1 source remains reported locked until source catch-up; successful V2 unlock resumes crash-interrupted passphrase/PRF catch-up;
- already-strong retained same-diary v1 source need not be rewritten to the new V2 local factor, but best-effort historical health material may not coexist with an advertised unlocked strong V2 mode;

### 2026-09-24 full-stack re-audit final disposition

The V2-01…V2-07 re-audit is complete. It rechecked the frozen wire/crypto layer,
canonical replay and historical authority, StateV6/persistence/write gates,
Google/Recovery/Backup, productive profile upgrade, read-only Join, Cooperative
Handoff, cross-layer Coordinator behavior, App/UI boundaries and release-status
inventory.

New findings from this pass were recorded before remediation:

- IA-062: release/status inventory drift after V2-07;
- IA-063: WriterGrant stale persistence accepted a merely different rather than
  strictly longer authenticated remote anchor;
- IA-064: the anti-churn architecture test encoded the stale decision-ledger
  heading instead of the intended historical-snapshot property.

All three are closed. IA-063 is the only protocol-adjacent code hardening from
this pass; IA-062 and IA-064 are status/assurance corrections. No additional
wire-format, cryptographic-authority, verifier, migration, Join or Cooperative
Handoff defect remained open after the final pass.

The implementation boundary at the conclusion of this 2026-09-24 V2-07 review
was intentionally unchanged: the implemented stack ended at Cooperative Handoff;
Forced Takeover, native v2→v2 Rotation plus two-phase Recovery-Rekey orchestration,
normal App/Settings/domain-materialization/UI wiring, the Live-Google
Parallel-Append-Gate and the external production gates were still open.

The boundary at the conclusion of the 2026-09-25 V2-08 pass above reached
Architecture §23 item 12: productive Forced Takeover plus stale-pending
quarantine. At that historical point native v2→v2 Rotation/two-phase
Recovery-Rekey, App/UI/domain wiring, Live-Google parallel-append validation and
the external production gates were still open.

The historical boundary after the 2026-09-25 V2-09 pass additionally included
productive native v2→v2 Rotation and complete two-phase Recovery-Rekey,
including bounded Unknown-Outcome resume, supersession, replacement-device
Pending-Rekey continuation and v2-Source RootWrap inheritance.

The current boundary after the 2026-09-26 V2-10 pass additionally includes
normal App/Settings/domain-materialization/UI wiring, authenticated encrypted
offline read-model persistence, productive application ceremony entry points
and active-v2 local RootWrapV6 protection. The remaining internal pre-release
slice is Live-Google parallel-append validation; external production gates remain
open. The fully green V2-10 security-code evidence head is
`d4bcd4753dfb23ffc03c0cccc7bde67d13bd36d9`.

## Anti-churn rule for later reviews

When a later review touches an entry above, classify it explicitly:

- **regression:** an already-fixed IA invariant was lost;
- **new evidence:** an assumption in Exact Protocol or D-001…D-010 changed;
- **deferred-layer completion:** a V2-03/V2-04+ responsibility is now being
  implemented;
- **same boundary:** no change required.

Do not turn an IA entry into a new D-xxx decision unless the architecture or
threat model actually changes.
