# Transferable Single Writer v2 – Implementation Audit Trail

Stand: 22.09.2026

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
  verifier, including the operation-bound `rotation_resume` path.

Primary review sources:

- Exact Protocol §§4–13, 16a–16b, 22–24;
- inherited v1 wrapper/graph rules explicitly retained by v2 §5;
- D-001…D-010;
- the frozen machine-readable v2 schema registry.

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
| IA-011 | V2-02 / manifest trust root | `VerifiedManifestTrustRootV2` is currently an input contract, not yet the output of the final ManifestV6 codec. V2-02 defensively rechecks key/ID/history shape but does not duplicate every protected-manifest invariant. | **Intentional deferred layer.** V2-04 must make the ManifestV6 parser/codec the only production source of this trust root and enforce profile, crypto suite, schema registry, protocol limits, account binding and immutable manifest fingerprint there. |
| IA-012 | V2-02 / rollback floors | Replay computes RemoteAnchorV2 but does not itself reconcile a persisted local/backup/recovery freshness floor. | **Intentional deferred layer.** EpochLocalSecurityStateV6 and the fail-closed write/recovery gates in V2-03 consume the verifier result and enforce monotone anchor/freshness rules. |
| IA-013 | V2-01 / one-shot persistence | The pure EnvelopeV6 primitive accepts caller-supplied envelope ID and IV; by itself it cannot prove persistent pre-reservation or cross-crash one-shot use. | **Intentional deferred layer.** The exact one-shot reservation/journal rule belongs to V2-03 local persistence. Do not “fix” V2-01 by adding product storage to the pure primitive. |

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

## Required regression coverage

Later changes must retain explicit vectors for at least:

- H0/H1/Hn RemoteAnchorV2;
- EnvelopeV6 exact AAD/ciphertext and tamper rejection;
- impossible/non-canonical `protocol_created_at`;
- byte-identical physical retry rows as semantic no-ops but physical Prefix
  members;
- same `envelope_id` with different bytes;
- IV reuse across different envelope IDs;
- same `revision_id` across different envelopes, including otherwise-stale
  controls;
- concurrent g+1 grants and historical Writer signatures;
- cross-type Control-ID collision;
- Pending-Rekey fence plus Forced-Takeover exception;
- native-Epoch Migration rejection;
- `canonical_full` vs `rotation_resume` type/result separation;
- `rotation_resume` rejection when any non-Migration-retry row extends the
  Migration staging prefix.

## Anti-churn rule for later reviews

When a later review touches an entry above, classify it explicitly:

- **regression:** an already-fixed IA invariant was lost;
- **new evidence:** an assumption in Exact Protocol or D-001…D-010 changed;
- **deferred-layer completion:** a V2-03/V2-04+ responsibility is now being
  implemented;
- **same boundary:** no change required.

Do not turn an IA entry into a new D-xxx decision unless the architecture or
threat model actually changes.
