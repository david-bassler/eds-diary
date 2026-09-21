# Single Writer v1 – Production Hardening Decision Ledger

Stand: 21.09.2026

Status: **NORMATIVE IMPLEMENTATION RATIONALE / ANTI-CHURN COMPANION** for the
currently implemented single-writer-v1 production path.

This document records decisions made after the repo-wide adversarial review that
followed PR #47. It does not extend the frozen v1 wire schemas and it does not
claim transferable multi-device writer safety. Its purpose is to prevent later
maintenance from accidentally reintroducing locally convenient behavior that was
shown to permit silent data loss, stale recovery activation, or plaintext health
data persistence.

The v2 protocol remains the mechanism that provides protocol-level transferable
writer authority. v1 remains a single-remote-writer profile and is hardened here
to **fail-stop** when evidence contradicts that operating assumption.

---

## V1-H-001 – Rotation freezes a fully durable source prefix

**Decision.** Once the local rotation state enters "source_frozen_verified", no
new domain revision may be prepared. Before the final source snapshot is bound,
all already-prepared source envelopes are synchronized and fully verified. The
persisted sourceAnchor therefore represents the complete durable source prefix
that was used to derive the migration semantic/lineage snapshots.

**Why.** Previously the frozen semantic snapshot could include local pending
revisions while sourceAnchor covered an earlier remote prefix. This made
sourceAnchor unsuitable as a precise cutover boundary and made later remote
advancement ambiguous: it could be either expected flushing of pre-freeze local
work or an unexpected concurrent writer.

**Rejected alternative.** Keep the old anchor and merely require the source
anchor to increase before local switch. Rejected because a larger prefix says
nothing about which rows were added and therefore cannot prove that the
successor represents every accepted source write.

**Compatibility.** No v1 wire bytes change. An old in-flight rotation whose
stored freeze state was produced under the weaker rule may fail closed after an
upgrade and require a new rotation attempt.

---

## V1-H-002 – The v1 announcement must be the unique row after the frozen prefix

**Decision.** Immediately before publishing the prepared v1
rotation-announcement-sw-v1 envelope, the source is read and fully verified.
The remote prefix must still equal sourceAnchor. The only pending source
envelope may be the exact prepared announcement. After append/readback, the
snapshot must contain exactly one additional row and that row must be the exact
prepared announcement. A repeated/unknown outcome is reconciled by readback; no
blind duplicate append is used.

Immediately before the local atomic switch the source is read again. Its
authenticated anchor must still equal the locally persisted announcement anchor
and the source must be retired.

**Why.** A valid source row appearing between migration freeze and cutover would
otherwise remain on the source but be absent from the already-built successor.
The previous implementation accepted the larger source prefix and switched,
which could silently lose that revision from the active diary.

**Important v1 limit.** The v1 announcement does not carry a cryptographic
decision-anchor field and Google Sheets does not provide the required
protocol-bound compare-and-swap. Therefore a concurrent/stale external v1
writer can still race between the final read and append. The hardened behavior
detects such a race on readback and refuses the local switch. It cannot make
that raced announcement disappear from the append-only remote history. This is
a **fail-stop safety improvement**, not transferable-writer fencing. v2 is still
required for the stronger property.

**Rejected alternative.** Treat every later larger source anchor as acceptable
because v1 is nominally single-writer. Rejected because the product already has
crash/recovery and stale-client surfaces where silently accepting contradictory
evidence is worse than stopping.

---

## V1-H-003 – A staged successor is not the current Google Recovery target

**Decision.** For normal v1 rotation and v1 recovery-rekey rotation,
RecoveryArtifactV5 is generated one-shot, locally persisted and independently
bootstrap-tested while the successor is staged. Before the source announcement,
the provider may prepare and uniquely verify the secret-derived owner-only
Recovery resource, but the staged successor Artifact bytes are **not** written
there. A newly created slot therefore remains empty and is not a recoverable
successor. The exact locally persisted Artifact is written only **after** the
source announcement has been read back and accepted under V1-H-002. Remote
enablement is the explicit exception because there is no prior remote source to
retire.

If Recovery publication succeeds but the process crashes before the local
announcement_durable state is persisted, resume repeats the same artifact
publication idempotently; it does not regenerate the artifact.

**Why.** The Recovery resource is discovered by URS-derived locator and is used
as the first pointer during Google recovery. Publishing a staged successor before
the source cutover meant a crash or competing rotation could make a successor
that never became canonical look like the current recovery target.

**Availability boundary.** Resource creation/discovery ambiguity is resolved
before the source is retired. This matters especially for recovery_rekey, whose
new URS normally has no pre-existing Recovery resource. The pre-bound slot is
also checked against the exact staged Artifact using the same diary/generation/
ordering rules as publish, without writing the staged bytes. That replacement
preflight is repeated immediately before the mutating Source-announcement append.
After the announcement, publication updates the already unique compatible slot
and reconciles by readback. A concurrent change after the final preflight remains
part of the documented v1 no-CAS race boundary.

**Rejected alternative.** Publish Recovery bytes immediately after successor
bootstrap because the artifact is cryptographically valid. Rejected because
cryptographic self-consistency of a staged successor is not the same as
canonical activation. Creating/verifying an empty slot is allowed because it
contains no RK or successor activation material.

**Wire compatibility.** sync-recovery-v5 is unchanged. This is publication
ordering only.

---

## V1-H-004 – Verified encrypted legacy migration ends with plaintext destruction and a schema fence

**Decision.** After legacy data has stabilized, been migrated into encrypted
immutable envelopes, and passed target verification, the migration persists
phase="cutover", verified=true and then:

1. clears every remaining legacy plaintext IndexedDB object store;
2. readback-verifies that every such store is empty;
3. removes the legacy activity-type localStorage key and verifies absence;
4. advances the IndexedDB schema version and deletes the legacy plaintext object
   stores, and the historical plaintext revisions store if present;
5. reopens and verifies that the plaintext stores are absent.

The production database opener recognizes only the schema versions owned by
this app release: IndexedDB version 9 is the secure floor and version 10 is the
post-legacy-destruction schema. Version 8 was the last pre-fence application
schema. Versions above 10 are rejected as belonging to a newer app rather than
being opened optimistically. The opener repairs only within the supported
version range and never recreates deleted legacy stores. A fresh installation
therefore starts above legacy clients rather than at browser-default version 1
without sacrificing downgrade safety.

If another open tab blocks the version change, migration is **not** considered
ready for product use. The user must close the old tab and retry. On retry the
cleanup and schema fence are re-established.

**Why.** The prior migration correctly created encrypted envelopes but left the
original health records in plaintext indefinitely. Worse, an already-running old
app tab could continue writing the legacy stores after verified cutover; the new
app would never inventory them again. Clearing without a version fence was also
insufficient because an old app could reopen the same schema and recreate
plaintext data.

IndexedDB version advancement provides the browser-native compatibility fence:
an old client that requests its fixed version 8 receives a VersionError once the
current opener has established the version-9 floor. After an actual plaintext
legacy migration, the destruction step advances to version 10 while deleting
the old stores. Conversely, this app rejects a database above version 10 so a
future incompatible schema cannot be silently consumed after an application
rollback.

**Rejected alternatives.**
- Leave legacy rows in place because the new UI no longer reads them: rejected
  because at-rest plaintext still exists.
- Clear rows but keep the old schema/version: rejected because a stale client can
  write plaintext again.
- Delete legacy stores before encrypted target verification: rejected because a
  crash or validation failure could destroy the only recoverable copy.

---

## V1-H-005 – “Current backup” and normal backup recovery reject retired epochs

**Decision.** createCurrentVerifiedBackup() requires the fully verified current
remote epoch to have retired=false. The normal independent-backup recovery path
also rejects a cryptographically valid backup whose verified log contains a
rotation announcement and is therefore retired.

Historical backup files remain cryptographically parseable; they are simply not
accepted by the **normal current-profile recovery** workflow.

**Why.** A stale device can possess a perfectly valid old root key and historical
remote prefix. Cryptographic validity alone does not mean the epoch is still the
current diary head. Restoring such a backup as an ordinary local_offline profile
and later remote-enabling it would turn an implicit historical rollback into a
new fork.

**Rejected alternative.** Treat every authentic backup as a normal recoverable
current profile. Rejected because authenticity and currentness are distinct.

**Future option.** A deliberate historical rollback feature may be added later,
but it must be explicitly named, offline/read-only by default, and must not
silently claim current remote authority.

---

## V1-H-006 – v1 is fail-stop under contradictory multi-client evidence, not transferable

These hardenings do **not** change the v1 threat model into the v2 threat model.

For v1:

- one remote writer remains the supported operating assumption;
- same-version tabs sharing the same IndexedDB are coordinated through Web Locks
  and authenticated rotation state;
- stale/old clients are fenced locally where possible;
- contradictory remote advancement during a security-sensitive cutover is
  treated as a fatal race rather than resolved by "latest wins";
- a remote race that already appended bytes may require manual recovery.

For transferable writer authority, per-row writer provenance, stale-writer
semantic rejection, forced takeover, and cryptographically anchor-bound
cross-device cutover, use the v2 protocol and its D-001…D-010 decision ledger.

---

## V1-H-007 – Same-generation Recovery ordering is monotonic, not wall-clock authority

**Decision.** The Google Recovery store continues to reject replacement of a
RecoveryArtifact by another artifact in the same recovery generation unless the
new payload has a strictly greater created_at value. Normal v1 rotation does
not trust the local wall clock to satisfy that rule. Before creating the staged
successor RecoveryArtifact it loads the current remote artifact with the current
URS, decrypts it, and requires exact binding to the active Source diary, epoch,
key, manifest fingerprint, recovery generation and recovery commitment. The new
artifact timestamp is then max(local clock, previous created_at + 1 ms).

If no remote artifact exists for an older profile, the local clock is used for
the first publication. Any other failure while loading/verifying the current
artifact is fatal.

Recovery rekey is different: it advances recovery_generation, so same-generation
timestamp ordering is not the security discriminator. Remote enablement has no
prior remote Source artifact.

**Why.** Normal rotation deliberately carries the same URS and recovery
generation into the successor. The Recovery store therefore needs an ordering
rule that prevents a stale device from replacing a newer same-generation epoch
with an older artifact. Using raw device time alone made a legitimate rotation
unavailable when the clock moved backwards after the previous publication.

**Rejected alternative.** Remove or weaken the same-generation created_at
comparison in GoogleRecoveryArtifactStore. Rejected because then a stale client
holding the same URS could republish an older same-generation epoch as the
normal Google Recovery target.

**Interpretation.** created_at is not proof of real-world chronology and is not
writer authority. In this v1 compatibility mechanism it is only a monotonic
ordering token whose floor is authenticated by decrypting the current remote
RecoveryArtifact.

---

## Regression checklist

A future change touching these paths must preserve all of the following:

- source pending envelopes are durable before the v1 rotation freeze anchor is
  fixed;
- verified.retired is fatal when freezing a source for a new rotation;
- the exact announcement is the only row allowed after the frozen prefix during
  v1 cutover;
- source remote state is checked again immediately before local switch;
- staged normal/rekey RecoveryArtifact bytes are not remotely published before durable
  source announcement; an empty uniquely verified provider slot may be pre-bound,
  and its exact replacement compatibility is rechecked immediately before the
  Source-announcement append;
- remote enablement remains the explicit no-source publication exception;
- verified legacy cutover leaves no plaintext legacy object store or legacy
  activity-type localStorage value;
- an old open client may block the schema fence but may not be silently ignored;
- reappearing legacy localStorage alone is removed without inventing another
  IndexedDB schema version once the legacy object stores are already gone;
- only IndexedDB versions 9 and 10 are accepted after the legacy boundary; future versions fail closed on application rollback;
- normal current-backup export rejects retired epochs;
- normal backup recovery rejects retired epochs;
- same-generation normal rotation derives RecoveryArtifact created_at monotonically from the authenticated current remote artifact rather than trusting wall-clock monotonicity;
- no frozen v1 wire/schema/fingerprint bytes are changed by these rules.

A future review should classify a proposed reversal as either a new assumption,
an implementation mismatch, or an explicit product-policy change. It should not
silently weaken these decisions as a local simplification.
