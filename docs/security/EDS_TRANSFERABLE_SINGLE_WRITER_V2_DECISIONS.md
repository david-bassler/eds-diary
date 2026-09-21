# Transferable Single Writer v2 – Security Decision Ledger

Stand: 21.09.2026

Status: **NORMATIVE RATIONALE / ANTI-CHURN COMPANION** to
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`.

This file exists because repeated adversarial reviews legitimately changed a
number of transition rules. The exact protocol remains the normative source for
wire bytes and verifier behavior; this ledger records **why** a rule exists,
which alternative was rejected, and what assumption would have to change before
reversing it. A later review must not silently flip one of these decisions just
because another formulation looks locally simpler.

## How to use this ledger

For every security-sensitive protocol change:

1. identify the attack/inconsistency that motivated it;
2. state the invariant the chosen rule preserves;
3. record the rejected alternative;
4. state the condition under which reconsideration would be justified;
5. update the corresponding Golden/Negative Vector.

A change that merely reintroduces a rejected alternative without a changed
assumption is a regression, not a new design choice.

---

## D-001 – Recovery credential freshness is diary-wide from first v2 activation

**Decision.** v2 derives a stable, generation-independent `recovery_urs_id`
from the 32-byte URS and carries an ordered `recovery_credential_history`
through every v2 epoch. A new RecoveryAuthorityTransition must use both a URS ID
and a takeover-key ID not previously present in that history.

**Why.** Per-epoch freshness prevents K1→K2→K1 only inside one epoch. After an
epoch rotation the old seen-set otherwise disappears, allowing previously
compromised URS/takeover material to become current again. The
generation-bound `recovery_urs_commitment` cannot detect reuse because the same
URS produces a different commitment in a different generation.

**Rejected alternative.** Keep freshness only in
`recovery_history_by_prefix` of the current epoch. Rejected because epoch
rotation would erase the security memory the Rekey promise depends on.

**Enforcement split.** The ordinary remote-log verifier can prove history
uniqueness of the writer-signed `recovery_urs_id`, but it cannot recompute a
hash of a secret URS it does not possess. Secret-aware Artifact
creation/decryption/test-recovery therefore recomputes **both**
`recovery_urs_id` and the generation-bound commitment from the entered URS and
requires exact equality before the prepared Transition may be completed. The
takeover-key ID is independently reproducible from its public key. This split is
intentional; a future review must not assume that the remote-only verifier knows
the URS.

**Bound/legacy choice.** History is capped at 128 entries. Once exhausted,
another protocol version is required rather than introducing an unreviewed
accumulator/compaction scheme. v1 did not record stable historical URS IDs, so
credentials retired before the first v2 activation cannot be reconstructed or
retroactively banned. That limitation is explicit rather than hidden.

**Revisit only if.** A new protocol version introduces a cryptographically
verified compact history/accumulator or a migration mechanism that can prove
pre-v2 credential history.

---

## D-002 – Publishing the staged RecoveryArtifact is a point of no local return

**Decision.** A recovery_rekey may be freely abandoned only before the first
mutating RecoveryArtifact publish attempt. Immediately before that request the
operation persistently records `artifact_publish_attempted=true`. From then on,
success **or unknown outcome** must be reconciled remotely; absence of a local
success callback is not evidence that the immutable Artifact/capability is
absent. If the exact Artifact exists while its authority anchor remains current,
the operation must finish the exact prepared Transition. It can become stale
only when another physical remote row has actually overtaken that anchor.

**Why.** The published immutable artifact already contains the writer-signed
one-shot Transition envelope. Possession of the new URS therefore grants a
conditional, remotely exercisable capability. Deleting or changing an
IndexedDB operation state cannot revoke bytes already stored remotely.

**Rejected alternative.** Allow a local abort because Artifact publish did not
return success, or allow `transition_unknown -> stale` merely because the
Transition is not yet visible remotely. Rejected because an unknown publish may
already have stored the immutable Artifact, which can later complete the
supposedly aborted Transition.

**Revisit only if.** A future protocol adds a remotely verifiable revocation/
abort control that is ordered against the prepared transition.

---

## D-003 – Unknown-outcome retry requires a new full semantic verification

**Decision.** If an append returns unknown outcome and the exact envelope is
missing on readback, the coordinator performs canonical full verification of
that new snapshot before any retry. The profile-specific WriteAuthority then
decides `push` or `quarantine_stale_writer` for the exact prepared envelope.

**Why.** A structural read cannot prove that writer authority, seal state,
pending-rekey fence, or a control record's decision anchor are unchanged.
Retrying first and verifying afterwards is too late: the client may already
have appended bytes it no longer had authority to append.

**Rejected alternative.** Read + check envelope absence + blindly retry the same
bytes, followed by full verification. Byte identity alone solves one-shot
encryption; it does not solve authority freshness.

**Revisit only if.** The storage provider supplies a protocol-bound atomic
compare-and-swap against the verified prefix/authority state.

---

## D-004 – Physical row presence is not semantic durability

**Decision.** Shared persistence consumes the full `VerifiedRemoteState`,
including explicit accepted and `stale_writer_rejected` envelope sets.
`CoordinatorStore` must not decide durability from row presence/anchor coverage
alone. A stale writer envelope remains quarantined even when its exact bytes are
physically present remotely.

**Why.** v2 deliberately permits a stale writer's ciphertext to exist in the
append-only physical log while excluding the revision from the canonical domain
graph. Treating "present in covered prefix" as "durable commit" would silently
turn a rejected user change into a successful local status.

**Rejected alternative.** Reuse the v1 store contract `rows + anchor` and let
the store infer durability. This is valid only because v1 has no writer-authority
semantic rejection state.

**Revisit only if.** The v2 verifier model is changed so every structurally
valid physical envelope is necessarily a canonical semantic commit—which would
be a different protocol.

---

## D-005 – Writer authority is checked at preparation, push and readback

**Decision.** The shared WriteAuthority contract has three distinct gates:
`canPrepareDomainWrite`, `verifyBeforePush`, and
`accessAfterReadback`. `verifyBeforePush` receives the exact prepared
envelope, the latest verified state, and whether the call is an initial push or
an unknown-outcome retry. It may return `quarantine_stale_writer`.

**Why.** v2's guarantee is stronger than "check once before network I/O". A new
immutable RevisionV2 must not even be persisted as an ordinary writable commit
without fresh authority, and a previously prepared envelope can become stale
before retry/readback.

**Race boundary.** These gates are not a provider-side compare-and-swap. A
different legitimate writer may still advance remote authority after the latest
verify and before this client's append. In that unavoidable window the physical
ciphertext may land, but final full readback must classify it
`stale_writer_rejected` and quarantine it. Eliminating that race would require
the external coordination/lease primitive deliberately excluded by D-006.

**Rejected alternative.** Parameterless `assertBeforePush()`. It cannot bind
the decision to a specific envelope, writer_context, verified prefix or retry
phase.

**Revisit only if.** Domain-write preparation and remote append become one
atomic operation under a stronger external authority primitive.

---

## D-006 – The staging freeze ends at Confirmation for the remote, not for the initiator

**Decision.** Before SuccessorActivationConfirmation, any other first successor
suffix row is a cutover race. Once the exact Confirmation is durable, other
legitimate writers may create a fully verified post-activation suffix. The
rotation-initiating device itself remains blocked from normal successor writes
until its local activated-backup/lineage/switch gates complete.

**Why.** Earlier wording said "all successor appends are blocked until local
switch" while the protocol simultaneously allowed a post-confirmation suffix.
Those statements described two different actors and were contradictory.

**Rejected alternative.** Globally prohibit all remote successor rows until one
particular device finishes its local switch. There is no provider-side lease or
cross-device mechanism that can enforce that claim.

**Revisit only if.** v2 adopts an external coordination/lease primitive.

---

## D-007 – Normal rotation re-stages carried recovery private material

**Decision.** Normal v2→v2 rotation requires the current URS, decrypts and
verifies the current Source RecoveryArtifact/keypair, and re-persists the
carried takeover private key for the new successor as an operation-bound
RecoveryTakeoverStagingV2 before mutating successor remote state.

**Why.** The private key intentionally does not live in ordinary local writer
state. A normal rotation nevertheless has to create a new successor
RecoveryArtifact containing that same current takeover keypair. Crash-resume
must therefore have a protected source of the private bytes even when the
keypair itself was not newly generated.

**Rejected alternative.** Apply RecoveryTakeoverStaging only to newly generated
keypairs. That leaves normal rotation dependent on transient memory after the
Source artifact was opened.

**Revisit only if.** A future design stores takeover signing capability in a
different explicitly reviewed persistent security boundary.

---

## D-008 – Storage provider identity and sync profile identity are separate

**Decision.** Shared transport contracts expose `providerId` separately from
`profileId`. The Google storage provider is
`google-drive-sheets-v1`; the frozen v1 sync profile remains
`google-sheets-single-writer-v1`. Existing v1 persisted
`remote_binding.provider_id` keeps its historical wire meaning and is not
silently rewritten.

**Why.** v1 happened to use one string as both concepts. v2 explicitly reuses
the storage provider with a different sync profile. Keeping the concepts
collapsed would make a transport appear protocol-authoritative merely because
it uses the same Google backend.

**Rejected alternative.** Rename/rewrite old persisted v1 bindings. Rejected
because v1 bytes/state are frozen.

**Revisit only if.** A new persisted-state version deliberately migrates the
legacy v1 binding with explicit compatibility rules.

---

---

## D-009 – rotation_resume is not a shared VerifiedRemoteState

**Decision.** The shared `RemoteProfileVerifier.verify()` /
`TransportProfileCodec.verifyRemote()` path is reserved for
`canonical_full`. v2 `rotation_resume` uses a separate profile-internal API
and a distinct staged-result type. It must never manufacture or return a normal
`VerifiedRemoteState`, and its result must never be passed to
`CoordinatorStore` or `WriteAuthority`.

**Why.** `rotation_resume` intentionally accepts a non-native Successor whose
required Migration-Control may still be missing. The exact protocol permits
that only to resume the bound rotation operation and explicitly denies active
epoch/writer/recovery authority. Reusing the shared verified-state type would
make it too easy for a later caller to confuse “cryptographically checked
staging prefix” with “canonical remote authority”.

**Rejected alternative.** Encode `staged_incomplete` inside the generic
`profileState` of a normal `VerifiedRemoteState`. Rejected because the
generic Coordinator and persistence layer are designed to consume canonical
states and should not need to remember a profile-specific exception that grants
no authority.

**Revisit only if.** The shared verifier contract itself becomes a typed
discriminated union whose non-canonical branch is statically impossible to pass
to CoordinatorStore/WriteAuthority.

---

## D-010 – Valid post-activation lifecycle changes may supersede a local cutover

**Decision.** SuccessorActivationConfirmation makes the Successor remotely
active. A valid post-activation suffix containing only domain rows and/or
WriterGrants can be incorporated into the initiating device's final verify,
activated backup and switch. If the suffix instead advances RecoveryAuthority
or seals the Successor through a newer RotationAnnouncement, the remote history
remains valid but the initiating local operation becomes terminal
`post_activation_superseded`. If this is detected before the activated backup,
no such backup is produced; if it is detected by the mandatory final
`canonical_full` **after** an activated backup but before local switch, that
already verified backup remains a valid historical safety point but no longer
authorizes the local switch. The initiating device must not auto-switch to an
already overhauled lifecycle state.

**Why.** D-006 intentionally allows legitimate remote progress after
Confirmation because there is no provider-side lease. RecoveryAuthorityTransition
can make the staged RecoveryArtifact historically stale, and a later rotation
can seal the just-activated Successor. The lifecycle check therefore runs once
while building the activated backup **and again immediately before the local
switch**. Forcing the old initiator to finish anyway would either produce a
misleading backup or install a local active state that no longer represents the
last known canonical lifecycle. There is still an unavoidable read-to-local-
commit race after that last verify; it cannot grant remote authority and is
caught by the fresh canonical verify required before every later mutation.

**Rejected alternatives.**
- Treat every such suffix as `cutover_race`: rejected because the rows are
  valid post-activation history and D-006 deliberately permits them.
- Globally forbid RecoveryTransition/Rotation until one device finishes local
  switch: rejected because that local completion state is not remotely visible
  or enforceable without a lease.
- Build the activated backup using the old staged RecoveryArtifact: rejected
  because restore would bind a historical Recovery authority to newer rows.

**Revisit only if.** The protocol gains a cross-device lease/finalization token,
or a future backup/recovery format can safely checkpoint current lifecycle state
without requiring the staged Artifact to remain current.

---

## Implementation status at this review

This ledger separates **decision stability** from **implementation status**.
A recorded decision may be normative before its v2 runtime exists.

| Decision | Status after PR #47 |
| --- | --- |
| D-001 | Protocol/schema specified; v2 runtime verifier/artifact implementation still pending. |
| D-002 | Protocol/operation-state semantics specified; v2 runtime still pending. |
| D-003 | Shared coordinator retry path implemented and tested; v2 policy implementation still pending. |
| D-004 | Shared semantic disposition contract implemented; current IndexedDB store remains explicitly v1-only, v2 store/quarantine persistence still pending. |
| D-005 | Shared WriteAuthority contract and push/retry/readback gates implemented. **The v2 domain-write preparation path does not exist yet**, so `canPrepareDomainWrite` is intentionally not wired into current v1 local writes. Wiring it is a v2 implementation requirement, not completed work in this PR. |
| D-006 | Protocol/architecture specified; v2 rotation runtime pending. |
| D-007 | Protocol/architecture specified; v2 recovery/rotation runtime pending. |
| D-008 | Provider/profile identity split implemented in shared contracts and v1 adapters; v2 adapter pending. |
| D-009 | Shared canonical-only verifier boundary documented in contracts; separate v2 rotation-resume API/result type still pending with the v2 verifier implementation. |
| D-010 | Protocol/operation-state and backup semantics specified for post-activation lifecycle supersession; v2 runtime pending. |

A future review should not report an item in the “pending” column as a newly
discovered protocol flaw unless the implementation stack claims that item is
already complete.

---

## Stability rule for future reviews

The repeated reviews are expected to find **new adversarial facts**. They should
not cause oscillation between already-considered alternatives. When a future
finding touches D-001…D-008, the review should state one of:

- **new assumption/evidence:** name it, then update this decision;
- **implementation mismatch:** fix implementation without changing the decision;
- **wording mismatch:** align the document without changing the decision;
- **same tradeoff as before:** keep the recorded decision.

This distinction is part of the review checklist.
