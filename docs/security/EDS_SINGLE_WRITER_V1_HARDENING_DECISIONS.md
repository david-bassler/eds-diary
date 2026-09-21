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
RecoveryArtifactV5 is generated one-shot, locally persisted, independently
bootstrap-tested, and kept local while the successor is staged. It is published
to the owner-only Google Recovery resource only **after** the source announcement
has been read back and accepted under V1-H-002. Remote enablement is the explicit
exception because there is no prior remote source to retire.

If Recovery publication succeeds but the process crashes before the local
announcement_durable state is persisted, resume repeats the same artifact
publication idempotently; it does not regenerate the artifact.

**Why.** The Recovery resource is discovered by URS-derived locator and is used
as the first pointer during Google recovery. Publishing a staged successor before
the source cutover meant a crash or competing rotation could make a successor
that never became canonical look like the current recovery target.

**Rejected alternative.** Publish Recovery immediately after successor
bootstrap because the artifact is cryptographically valid. Rejected because
cryptographic self-consistency of a staged successor is not the same as
canonical activation.

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

The production database opener is version-agnostic and repairs only the secure
schema; it never recreates deleted legacy stores.

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
an old client that requests its fixed older database version receives a
VersionError once the fence is established.

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

## Regression checklist

A future change touching these paths must preserve all of the following:

- source pending envelopes are durable before the v1 rotation freeze anchor is
  fixed;
- verified.retired is fatal when freezing a source for a new rotation;
- the exact announcement is the only row allowed after the frozen prefix during
  v1 cutover;
- source remote state is checked again immediately before local switch;
- staged normal/rekey RecoveryArtifact is not remotely published before durable
  source announcement;
- remote enablement remains the explicit no-source publication exception;
- verified legacy cutover leaves no plaintext legacy object store or legacy
  activity-type localStorage value;
- an old open client may block the schema fence but may not be silently ignored;
- normal current-backup export rejects retired epochs;
- normal backup recovery rejects retired epochs;
- no frozen v1 wire/schema/fingerprint bytes are changed by these rules.

A future review should classify a proposed reversal as either a new assumption,
an implementation mismatch, or an explicit product-policy change. It should not
silently weaken these decisions as a local simplification.
