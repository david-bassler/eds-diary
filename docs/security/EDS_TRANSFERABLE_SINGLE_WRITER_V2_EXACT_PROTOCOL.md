# EDS Diary – Exaktes Protokollprofil Transferable Single Writer v2

Stand: 20.09.2026

Status: **NORMATIV / PROTOKOLL EINGEFROREN / NOCH NICHT IMPLEMENTIERT.**

Profil-ID:

~~~text
google-sheets-transferable-single-writer-v2
~~~

Dieses Dokument schließt die Wire-, Schema-, Signatur-, Recovery-Takeover- und
Verifier-Lücken aus EDS_TRANSFERABLE_SINGLE_WRITER_V2_ARCHITECTURE.md. Für v2
hat es bei konkreten Byte-, Krypto-, State- und Übergangsregeln Vorrang vor dem
allgemeineren Architekturtext.

v1 bleibt vollständig eingefroren. Kein v1-Byteformat, v1-State oder v1-Verifier
wird durch dieses Dokument erweitert oder umgedeutet.

---

## 1. Normative Grundentscheidungen

1. v2 verwendet eine neue Epoche und einen neuen Wire-Namespace.
2. Öffentlicher Manifest-Header: "sync-v6", protocol_version 6.
3. JSON: strikt I-JSON + RFC 8785 JCS; Duplicate Properties werden vor Parsing abgelehnt.
4. Binärfelder: RFC-4648 Base64URL ohne "="; Decode-Length und Re-Encode müssen exakt passen.
5. Envelope-AEAD: AES-256-GCM, 96-Bit IV, 128-Bit Tag.
6. KDF: HKDF-SHA-256 mit v6-Domainseparation.
7. Writer- und Recovery-Takeover-Signaturen: Ed25519.
8. Ed25519 Public Key: exakt 32 rohe Bytes, Base64URL.
9. Ed25519 Signatur: exakt 64 rohe Bytes, Base64URL.
10. Private Writer-Keys werden ausschließlich als nicht extrahierbare Ed25519-`CryptoKey`-Objekte persistiert. Es gibt keinen Raw-/PKCS#8-Fallback für Writer-Keys. Kann die Zielplattform diesen Key nicht erzeugen und persistent structured-clonen, ist v2-Writerbetrieb auf dieser Plattform nicht unterstützt. Dies ist trotzdem keine Hardware-/Anti-Cloning-Garantie.
11. Recovery-Takeover-Private-Key wird nicht als normaler lokaler Security-State persistiert.
12. Ein Fachwrite ist ohne frische vollständige Remote-Verifikation read-only.
13. HTTP-Erfolg verleiht niemals Writer-Authority; Authority entsteht nur nach Full Readback.
14. Physische Row-Reihenfolge ist nur für den Authority-Automaten relevant, niemals als fachliches latest-wins.
15. Alle JSON-Protokollinteger sind ECMAScript-Safe-Integer im Bereich
    0..9007199254740991; Felder mit semantischem Start bei 1 müssen zusätzlich
    >=1 sein. Fließkommazahlen sind für Generationen, Counts und Row-Indizes
    unzulässig.

---

## 2. IDs und Byte-Längen

~~~text
diary_id                 16 CSPRNG bytes
epoch_id                 16 CSPRNG bytes
key_id                   16 CSPRNG bytes
record_id                16 bytes
writer_device_id         16 CSPRNG bytes
recovery_artifact_id     16 CSPRNG bytes
creation_locator         16 CSPRNG bytes

envelope_id              32 CSPRNG bytes
revision_id              32 CSPRNG bytes
writer_grant_id          32 CSPRNG bytes
transfer_nonce           32 CSPRNG bytes
backup_id                32 CSPRNG bytes

RK_epoch                 32 CSPRNG bytes
URS                      32 CSPRNG bytes
Ed25519 public key       32 bytes
Ed25519 signature        64 bytes
~~~

writer_key_id wird nicht zufällig erzeugt:

~~~text
writer_key_id =
Base64URL(SHA-256(
  UTF8("eds-diary/writer-key-id/v2") || 0x00 || raw_ed25519_public_key
))
~~~

recovery_takeover_key_id analog:

~~~text
recovery_takeover_key_id =
Base64URL(SHA-256(
  UTF8("eds-diary/recovery-takeover-key-id/v2") || 0x00 ||
  raw_ed25519_public_key
))
~~~

---

## 3. v6 Krypto-Domains

~~~text
epoch_salt = SHA-256(
  UTF8("eds-diary/hkdf-salt/v6") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)

K_env(envelope_id) = HKDF-SHA-256(
  RK_epoch,
  epoch_salt,
  UTF8("eds-diary/envelope-key/v6") || 0x00 || envelope_id_bytes,
  32
)

K_epoch_manifest = HKDF-SHA-256(
  RK_epoch,
  epoch_salt,
  UTF8("eds-diary/epoch-manifest/v6"),
  32
)

K_local_state_mac = HKDF-SHA-256(
  RK_epoch,
  epoch_salt,
  UTF8("eds-diary/local-state-mac/v6"),
  32
)

K_backup(backup_id) = HKDF-SHA-256(
  RK_epoch,
  epoch_salt,
  UTF8("eds-diary/backup-manifest/v6") || 0x00 || backup_id_bytes,
  32
)

K_recovery = HKDF-SHA-256(
  URS,
  recovery_salt_32_random_bytes,
  UTF8("eds-diary/recovery-wrap/v6"),
  32
)

K_recovery_stage = HKDF-SHA-256(
  URS,
  staging_salt_32_random_bytes,
  UTF8("eds-diary/recovery-takeover-staging/v2"),
  32
)

K_activation_lineage_cache = HKDF-SHA-256(
  RK_epoch,
  epoch_salt,
  UTF8("eds-diary/activation-lineage-cache/v2"),
  32
)
~~~

Keine v5-Domain darf für neue v2-Bytes verwendet werden.

---

## 4. EnvelopeV6

One-shot-Regeln aus v1 bleiben erhalten: envelope_id wird vor Verschlüsselung
persistent reserviert; unter einer envelope_id findet exakt eine neue
Verschlüsselung statt; Retry sendet dieselben persistierten Bytes.

Buckets:

~~~text
1024, 2048, 4096, 8192, 16384
~~~

Frame:

~~~text
uint32_be(payload_length) || payload_jcs_utf8 || zero_padding
~~~

Remote-/lokale Duplikatregel: dieselbe envelope_id mit anderen Rowbytes ist
fatal. Eine byte-identische physische Retry-Duplikatrow zählt in Prefix/Bounds,
wird semantisch aber nur beim ersten Auftreten verarbeitet. Derselbe IV bei
unterschiedlichen envelope_id ist eine RNG-/Security-Anomalie und blockiert neue
Verschlüsselungen/fail-closed.

AAD exakt:

~~~json
{
  "protocol_version": 6,
  "crypto_suite": "A256GCM-HKDF-SHA256-ED25519-v6",
  "sync_profile": "google-sheets-transferable-single-writer-v2",
  "diary_id": "<16-byte-b64url>",
  "epoch_id": "<16-byte-b64url>",
  "envelope_id": "<32-byte-b64url>",
  "padding_bucket": 1024
}
~~~

---

## 5. RevisionV2 – exakter Wrapper


### 5.1 Exakte v2 Schema-Allowlist

Jedes v2-Manifest erlaubt für den ersten Implementierungsstand exakt:

~~~text
activity-entry/v1
activity-type-settings/v1
epoch-migration-sw-v2
medication-entry/v1
medication-prescription/v1
pain-entry/v1
pain-type-settings/v1
recovery-authority-transition-sw-v2
rotation-announcement-sw-v2
writer-grant-sw-v2
~~~

Die sechs fachlichen record_schema-Versionen bleiben inhaltlich dieselben
maschinenlesbaren Domänenschemas; nur der umgebende RevisionV2-Wrapper ändert
sich. Andere Control-Schemas sind in dieser Profilversion verboten.

record_type -> record_schema ist exakt:

~~~text
pain_entry                -> pain-entry/v1
activity_entry            -> activity-entry/v1
medication_entry          -> medication-entry/v1
medication_prescription   -> medication-prescription/v1
pain_type_settings        -> pain-type-settings/v1
activity_type_settings    -> activity-type-settings/v1
writer_grant              -> writer-grant-sw-v2
rotation_announcement     -> rotation-announcement-sw-v2
epoch_migration           -> epoch-migration-sw-v2
recovery_authority_transition -> recovery-authority-transition-sw-v2
~~~

Für alle zehn Schema-IDs sind immutable maschinenlesbare Schema-Definitionen
gebunden; die vier neuen v2-Control-Schemas liegen als
`src/security/schemas/*-sw.v2.schema.json` im Repo. Die produktive Registry wird
ausschließlich aus diesen versionierten Schemaobjekten gebildet:

~~~text
schema_registry_entries = [
  { record_schema, schema_sha256 }, ...
]

schema_sha256 = Base64URL(SHA-256(UTF8(JCS(machine_readable_schema))))
record_schema_registry_hash =
  Base64URL(SHA-256(UTF8(JCS(schema_registry_entries))))
~~~

Die Entries sind nach UTF-8-Bytes von record_schema sortiert und eindeutig.

Exakt diese Properties, keine weiteren:

~~~text
record_type
record_schema
record_id
revision_id
parent_revision_ids
record_status
record_data
migration_origin
protocol_created_at
writer_context
writer_signature
~~~

writer_context ist für normale Fach- und writer-autorisierte Control-Revisionen
exakt:

~~~json
{
  "writer_generation": 7,
  "writer_grant_id": "<32-byte-b64url>",
  "writer_device_id": "<16-byte-b64url>",
  "writer_key_id": "<32-byte-b64url>"
}
~~~

writer_signature ist dabei eine 64-Byte-Ed25519-Signatur als Base64URL.

Für "writer-grant-sw-v2" gilt als einzige Ausnahme:

~~~text
writer_context = null
writer_signature = null
~~~

Der Grant besitzt seine eigene Autorisierung in record_data.

Alle v1-Wrapperregeln zu record_id, revision_id, Parents, Tombstones,
migration_origin und Fachgraph bleiben semantisch erhalten, jedoch unter dem
neuen exakten v2-Wrapper.

---

## 6. Signaturinput einer normalen Revision

Die Signatur umfasst nicht sich selbst.

revision_signing_core ist exakt:

~~~json
{
  "sync_profile": "google-sheets-transferable-single-writer-v2",
  "diary_id": "<diary>",
  "epoch_id": "<epoch>",
  "record_type": "...",
  "record_schema": "...",
  "record_id": "...",
  "revision_id": "...",
  "parent_revision_ids": [],
  "record_status": "active",
  "record_data": {},
  "migration_origin": null,
  "protocol_created_at": "...",
  "writer_context": {
    "writer_generation": 7,
    "writer_grant_id": "...",
    "writer_device_id": "...",
    "writer_key_id": "..."
  }
}
~~~

Exakte Bytes:

~~~text
UTF8("eds-diary/revision-signature/v2") || 0x00 ||
UTF8(JCS(revision_signing_core))
~~~

Verifikation erfolgt gegen denjenigen Writer-Public-Key, den der Verifier aus
`writer_context` und seiner bereits verifizierten Authority-Historie bestimmt:
current authority bei aktuellen Rows, historischer Writer-Key bei
`stale_writer_rejected`. Eine Revision darf niemals allein deshalb gegen den
aktuellen Key geprüft werden, weil sie physisch später steht.

---

## 7. TransferdescriptorV2

Ein read-only Zielgerät B erzeugt lokal sein Writer-Keypaar und zeigt folgenden
Descriptor als QR/Kopiercode:

~~~json
{
  "format": "eds-writer-transfer-v2",
  "version": 2,
  "sync_profile": "google-sheets-transferable-single-writer-v2",
  "diary_id": "<16-byte-b64url>",
  "epoch_id": "<16-byte-b64url>",
  "writer_device_id": "<16-byte-b64url>",
  "writer_key_id": "<32-byte-b64url>",
  "writer_public_key": "<32-byte-b64url>",
  "nonce": "<32-byte-b64url>",
  "possession_signature": "<64-byte-b64url>"
}
~~~

writer_key_id muss aus writer_public_key nach §2 reproduzierbar sein.

PoP-Input:

~~~text
UTF8("eds-diary/transfer-descriptor-pop/v2") || 0x00 ||
UTF8(JCS({
  format,
  version,
  sync_profile,
  diary_id,
  epoch_id,
  writer_device_id,
  writer_key_id,
  writer_public_key,
  nonce
}))
~~~

A lehnt Descriptoren mit falschem Profil, Diary, Epoch, Key-ID oder ungültiger
PoP-Signatur vor Grant-Erzeugung ab.

Der Descriptor verleiht selbst keinerlei Remote-Authority.

---

## 8. WriterGrantV2 – exakter Control-Record

Wrapper:

~~~text
record_type = "writer_grant"
record_schema = "writer-grant-sw-v2"
record_status = "control"
parent_revision_ids = []
migration_origin = null
writer_context = null
writer_signature = null
~~~

record_data exakt:

~~~json
{
  "grant_id": "<32-byte-b64url>",
  "writer_generation": 7,
  "writer_device_id": "<16-byte-b64url>",
  "writer_key_id": "<32-byte-b64url>",
  "writer_public_key": "<32-byte-b64url>",
  "previous_grant_id": "<32-byte-b64url|null>",
  "previous_writer_generation": 6,
  "recovery_generation": 3,
  "reason": "initial|handoff|forced_takeover",
  "authority_anchor": {
    "anchor_profile": "google-sheets-transferable-single-writer-v2",
    "covered_row_count": 123,
    "prefix_hash": "<32-byte-b64url>"
  },
  "authorization": {
    "kind": "manifest_genesis|writer_handoff|recovery_takeover",
    "signer_key_id": "<32-byte-b64url|null>",
    "signature": "<64-byte-b64url|null>"
  }
}
~~~

grant_signing_core ist record_data ohne authorization.

Grant-Signing-Input:

~~~text
UTF8("eds-diary/writer-grant/v2") || 0x00 ||
diary_id_bytes || epoch_id_bytes || 0x00 ||
UTF8(JCS(grant_signing_core))
~~~

Regeln:

- Generation 1: previous_grant_id=null, previous_writer_generation=0,
  reason="initial", authorization.kind="manifest_genesis",
  signer_key_id=null, signature=null.
- Der Gen-1-Grant ist nur gültig, wenn grant_id, Device-ID, Key-ID, Public Key,
  Generation und Recovery-Generation exakt den manifestgebundenen Initialwerten
  entsprechen.
- Handoff: authorization.kind="writer_handoff";
  authorization.signer_key_id = predecessor writer_key_id; Signatur mit dessen
  Public Key.
- Forced Takeover: authorization.kind="recovery_takeover";
  authorization.signer_key_id muss demjenigen recovery_takeover_key_id
  entsprechen, der **am authority_anchor-Prefix** kanonisch war; Signatur gegen
  dessen historischen Recovery-Takeover-Public-Key.
- Für jeden Grant muss record_data.recovery_generation exakt der am
  authority_anchor-Prefix verifizierten Recovery-Generation entsprechen.
- Nur ein Grant mit authority_anchor unmittelbar vor seiner Row kann current
  werden; deshalb entspricht diese historische Recovery-Authority beim Gewinner
  zugleich dem aktuellen Recovery-State. Ein später appended, inzwischen
  überholter Forced-Takeover-Grant kann so korrekt als stale statt fälschlich
  fatal klassifiziert werden.
- authority_anchor beschreibt den vollständig verifizierten **Entscheidungs-Prefix**,
  auf dessen Basis der Grant erzeugt wurde. covered_row_count darf deshalb kleiner
  als die Position unmittelbar vor der Grant-Row sein.
- Der Verifier muss authority_anchor exakt gegen Hcovered_row_count reproduzieren
  und zusätzlich beweisen, dass an diesem historischen Prefix die in
  previous_grant_id/previous_writer_generation referenzierte Authority kanonisch
  aktiv und die Source noch nicht versiegelt war.
- Ein Grant darf nur einen direkten Nachfolger dieser am Anchor gültigen Authority
  beanspruchen: writer_generation = previous_writer_generation + 1.
- **Nur** wenn authority_anchor exakt dem physischen Prefix unmittelbar vor der
  Grant-Row entspricht **und** dieselbe predecessor-Authority dort weiterhin
  aktuell/unsealed ist, darf der Grant die Authority fortschreiben.
- Ist der Anchor historisch älter als der Prefix unmittelbar vor der Grant-Row,
  darf der Grant niemals mehr Authority übertragen.
- Ist inzwischen bereits ein anderer gültiger Nachfolgegrant kanonisch geworden,
  bleibt ein ansonsten vollständig gültiger Claim gegen seinen historischen
  Entscheidungs-Prefix `stale_grant_rejected`.
- Ist noch dieselbe predecessor-Authority current, aber seit dem historischen
  Anchor mindestens eine andere physische Row hinzugekommen, ist der alte,
  vorbereitete Grant ebenfalls `stale_grant_rejected`. Dadurch können einmal
  signierte Handoff-/Takeover-Grants nicht zeitlich unbegrenzt nachträglich
  Authority übertragen.
- Concurrent g+1-Claims bleiben trotzdem deterministisch: nur der Claim, dessen
  Anchor beim Append unmittelbar vor seiner Row liegt, kann gewinnen; weitere
  zuvor gegen denselben Prefix vorbereitete Claims sind stale.
- Ist current_writer_generation bereits größer als die Candidate-Generation und
  der Candidate war relativ zu seinem historischen Anchor vollständig gültig,
  ist er ebenfalls stale_grant_rejected.
- Ein Anchor, der den behaupteten predecessor an seiner eigenen Prefix-Grenze
  nicht trägt, eine Zukunftsgeneration, eine nicht direkte Generationserhöhung
  oder eine ungültige Autorisierung ist security_blocked, nicht latest-wins.

---

## 9. Recovery-Takeover-AuthorityV2

Für jede Recovery-Generation existiert genau ein Ed25519-Takeover-Schlüsselpaar.

Key-Lifecycle:

1. Bei **v1→v2** wird für die übernommene Recovery-Generation das erste
   Ed25519-Takeover-Keypair transient erzeugt.
2. Eine spätere **recovery_rekey** ändert die Recovery-Authority zuerst auf der
   noch aktiven Source durch RecoveryAuthorityTransitionV2 (§16b). Erst nach
   durable Readback dieser Transition darf eine Successor-Epoche für den Rekey
   erzeugt werden.
3. RecoveryAuthorityTransitionV2 erhöht recovery_generation exakt um 1,
   bindet neues recovery_urs_commitment und ein neues Ed25519-Takeover-Keypair.
4. Bei normaler v2→v2-Rotation werden die am final verifizierten Source-Prefix
   **aktuell gültigen** Recovery-Felder unverändert in das Successor-Manifest
   übernommen. Das gilt auch für eine Rotation, die direkt auf einen
   Recovery-Rekey folgt.
5. Für ein neu erzeugtes Paar: Public Key roh als 32 Byte exportieren, Private
   Key einmalig als PKCS#8 exportieren und recovery_takeover_key_id aus dem
   Public Key ableiten.
6. Vor mutierendem Remote-I/O wird PKCS#8 crash-resumable als
   RecoveryTakeoverStagingV2 (§9.1) unter dem **neuen** URS persistiert und
   readback-verifiziert.
7. Für einen Recovery-Rekey wird zusätzlich das exakte, bereits
   writer-signierte RecoveryAuthorityTransitionV2-Envelope one-shot vorbereitet
   und im neuen RecoveryArtifactV6 als RecoveryAuthorityTransitionProofV2
   gebunden, bevor die Transition appended wird.
8. Plaintext-PKCS#8 und ein ggf. extrahierbarer temporärer Private Key werden
   danach aus dem normalen Sitzungszustand verworfen.
9. Ein späterer Forced Takeover decryptet ausschließlich ein RecoveryArtifactV6,
   dessen Recovery-Generation/Key/Commitment gegen den **vollständig
   verifizierten aktuellen Recovery-State** der Epoche matchen, und importiert
   PKCS#8 für diese Ceremony als extractable=false, usage=["sign"].
10. Diese importierte Capability wird nach Readback/Abschluss verworfen.

Der normale lokale Writer-State enthält niemals recovery_takeover_private_key,
PKCS#8 oder eine dauerhaft nutzbare Recovery-Takeover-Capability. Außerhalb des
finalen RecoveryArtifactV6 darf PKCS#8 nur im nachfolgend exakt definierten,
URS-verschlüsselten und operationsgebundenen Crash-Resume-Staging vorkommen.

Ist URS bzw. das aktuelle RecoveryArtifactV6 kompromittiert, ist Forced Takeover
für diese Recovery-Generation kompromittiert. recovery_rekey erzeugt daher neue
URS-Bindung und neues Takeover-Keypair.

**Bewusste Threat-Boundary:** recovery_rekey wird von der **aktuell kanonischen
Writer-Authority** autorisiert; der alte Recovery-Key muss nicht nachgewiesen
werden. Ein Angreifer mit gleichzeitig aktuellem Writer-Private-Key, RK_epoch
und Google-Mutationszugriff kann deshalb die Recovery-Authority auf eigenes
Material umstellen. Das ist die gewählte Wiederherstellbarkeitsgrenze für den
Fall „alter Recovery-Key verloren“. Ein zukünftiges Profil mit zusätzlichem
Recovery-Zweitfaktor müsste eine neue Protokollversion verwenden.

### 9.1 RecoveryTakeoverStagingV2 – nur lokaler Operation-State

Dieses Objekt ist **kein Export-/Remote-Wire-Artefakt**, darf nie an Google
publiziert und nie als RecoveryArtifact akzeptiert werden. Es existiert nur
während Epoch-Erzeugung/Rotation/recovery_rekey.

Exakt:

~~~text
{
  format: "recovery-takeover-staging-v2",
  version: 2,
  diary_id,
  epoch_id,
  recovery_generation,
  recovery_takeover_key_id,
  recovery_takeover_public_key,
  manifest_fingerprint,
  salt,
  iv,
  ciphertext
}
~~~

salt=32 CSPRNG bytes, iv=12 CSPRNG bytes.

AAD:

~~~text
UTF8(JCS({
  format,
  version,
  diary_id,
  epoch_id,
  recovery_generation,
  recovery_takeover_key_id,
  recovery_takeover_public_key,
  manifest_fingerprint,
  salt,
  iv
}))
~~~

Plaintext exakt:

~~~text
{
  recovery_takeover_private_key_pkcs8
}
~~~

Verschlüsselung:

~~~text
AES-256-GCM(K_recovery_stage, iv, UTF8(JCS(plaintext)), AAD)
~~~

Vor dem ersten **mutierenden** Remote-Schritt der Successor-Erzeugung muss das
vollständige Staging-Objekt persistent geschrieben und byte-/AEAD-readback-
verifiziert sein. Authentifizierung und das Lesen der Account-Bindung dürfen
vorher erfolgen, weil sie zum Erzeugen des geschützten Manifests benötigt werden.
Resume verlangt
erneute URS-Eingabe und den §19-Keypair-Check. Staging-Material einer anderen
Diary/Epoch/Manifest-Fingerprint/Recovery-Generation ist unbrauchbar und fatal
für diesen Resume-Versuch.

---

## 10. Protected ManifestV6

Öffentlicher Header:

~~~text
A1 = "sync-v6"
B1 = "6"
C1 = manifest_iv
D1 = manifest_ciphertext
~~~

Protected Payload exakt:

~~~text
diary_id
epoch_id
key_id
recovery_generation
recovery_urs_commitment
diary_marker = "epoch-manifest-v6"
crypto_suite = "A256GCM-HKDF-SHA256-ED25519-v6"
sync_profile = "google-sheets-transferable-single-writer-v2"
created_at
google_account_binding
predecessor_epochs
record_schema_allowlist
record_schema_registry_hash
protocol_limits

epoch_start_authority_mode
epoch_start_writer_generation
epoch_start_writer_grant_id
epoch_start_writer_device_id
epoch_start_writer_key_id
epoch_start_writer_public_key

recovery_takeover_key_id
recovery_takeover_public_key
~~~

epoch_start_authority_mode ist exakt:

~~~text
"genesis_grant_required" | "carried_from_predecessor"
~~~

Für **native v2-Genesis** mit predecessor_epochs=[] gilt zwingend
"genesis_grant_required" und epoch_start_writer_generation=1.

Für **v1→v2** gilt ebenfalls "genesis_grant_required",
epoch_start_writer_generation=1 und predecessor_epochs enthält exakt die
v1-Source.

In beiden genesis_grant_required-Fällen wird der Gen-1-Grant vor
Manifest-Verschlüsselung vollständig geplant; deshalb sind Grant-ID, Device-ID,
Key-ID und Public Key bereits im immutable Manifest gebunden. Vor diesem Grant
darf keine andere _r-Protokollrow stehen. Sein authority_anchor ist exakt H0 mit
covered_row_count=0. Der Verifier startet aus dem Manifest-Trust-Root, verlangt
diese Row als einmalige manifest_genesis-Bestätigung und ändert durch sie die
bereits manifestgebundene Authority nicht noch einmal.

Für **v2→v2-Rotation** gilt "carried_from_predecessor". Der Successor übernimmt
Generation, Grant-ID, Device-ID, Key-ID und Public Key unverändert als
Epoch-Start-Trust-Root. Es wird **kein** künstlicher Genesis-/Duplikatgrant
geschrieben; der erste spätere WriterGrant muss ein normaler direkter Nachfolger
dieser übernommenen Authority sein.

protocol_limits ist exakt:

~~~text
{
  max_payload_bytes: 16380,
  padding_buckets: [1024,2048,4096,8192,16384],
  max_unique_envelopes: 100000,
  max_unique_canonical_bytes: 134217728,
  max_remote_physical_rows: 100000,
  max_remote_physical_canonical_bytes: 134217728,
  max_canonical_row_bytes: 21936,
  max_activation_lineage_entries: 128
}
~~~

Recovery-Commitment v6:

~~~text
Base64URL(HMAC-SHA-256(
  key = URS,
  data = UTF8("eds-diary/recovery-urs-commitment/v6") || 0x00 ||
         diary_id_bytes || uint64_be(recovery_generation)
))
~~~

predecessor_epochs ist exakt:

~~~text
[]                                  # echte v2-Genesis ohne Source
[{epoch_id, manifest_fingerprint}]  # v1→v2 oder v2→v2 Single-Source-Übergang
~~~

Mehr als ein Predecessor ist in diesem Profil verboten.

Konsistenz:
- predecessor_epochs=[] => epoch_start_authority_mode muss
  "genesis_grant_required" sein.
- "carried_from_predecessor" => exakt ein Predecessor.
- v1→v2 => exakt ein Predecessor + "genesis_grant_required".
- v2→v2 => exakt ein Predecessor + "carried_from_predecessor".

created_at ist exakt YYYY-MM-DDTHH:mm:ss.SSSZ.

Manifest-AAD:

~~~json
{
  "format": "sync-v6",
  "protocol_version": 6,
  "sync_profile": "google-sheets-transferable-single-writer-v2",
  "diary_id": "<diary>",
  "epoch_id": "<epoch>"
}
~~~

~~~text
manifest_plaintext = UTF8(JCS(protected_manifest))
AES-256-GCM(K_epoch_manifest, manifest_iv, manifest_plaintext, manifest_AAD)
manifest_iv = 12 CSPRNG bytes
~~~

Fingerprint exakt:

~~~text
manifest_public_bytes = UTF8(JCS({
  format: "sync-v6",
  protocol_version: 6,
  manifest_iv,
  manifest_ciphertext
}))

manifest_fingerprint = Base64URL(SHA-256(manifest_public_bytes))
~~~

---
## 10a. Google Storage Profile v2 – exakt

Der Storage-Provider-Identifier ist unabhängig vom Syncprofil:

~~~text
storage_provider_id = "google-drive-sheets-v1"
sync_profile        = "google-sheets-transferable-single-writer-v2"
~~~

Nach jedem neuen Access Token wird wie in v1 die aktuelle
drive.about.user.permissionId ermittelt. Die v2-Bindung ist:

~~~text
google_account_binding = Base64URL(SHA-256(
  UTF8("eds-diary/google-account/v6") || 0x00 ||
  diary_id_bytes || 0x00 || UTF8(permissionId)
))
~~~

Epoch-Locator:

~~~text
epoch_locator = Base64URL(first16(SHA-256(
  UTF8("sync-v6/epoch-locator") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)))
~~~

Vor Create:

~~~text
creation_locator = 16 CSPRNG bytes, Base64URL
filename = "sync-" + creation_locator
~~~

Nach Manifest-Readback sind die Protokoll-appProperties exakt:

~~~text
app_format    = "sync-v6"
epoch_locator = <oben definierter Wert>
~~~

Keine weiteren Protokoll-appProperties sind zulässig.

Die Epoch-Ressource verwendet dieselbe strikte Zwei-Tab-Google-Grid-Struktur und
dieselben owner-only/permission/Drive-Invarianten wie v1: exakt "_m" und "_r",
keine Merges, ausschließlich String-Zellen, produktive Row-Writes ausschließlich
über AppendCellsRequest. Create/Reconciliation und Unknown-Create-Outcome folgen
dem v1-Ablauf, jedoch ausschließlich mit den hier definierten v6 Manifestbytes,
"app_format=sync-v6" und dem v6 epoch_locator; Response-IDs sind nur Kandidaten,
Discovery/Readback entscheidet. Der v1-Wire-Identifier "sync-v5" und dessen
Locator-Domain dürfen in v2 niemals verwendet werden.

Recovery Discovery verwendet zwei getrennte Locator:

~~~text
recovery_family_locator = Base64URL(first16(SHA-256(
  UTF8("eds-diary/recovery-family-locator/v6") || 0x00 || URS
)))

recovery_artifact_locator = Base64URL(first16(SHA-256(
  UTF8("eds-diary/recovery-artifact-locator/v6") || 0x00 ||
  URS || 0x00 || diary_id_bytes || epoch_id_bytes
)))
~~~

Die private owner-only Recovery-Ressource ist **epoch-spezifisch und immutable**.
Eine normale Rotation mit derselben URS erzeugt deshalb eine neue Ressource und
überschreibt niemals das Source-Artefakt.

Sie verwendet exakt einen GRID-Tab "_a" mit rowCount=1, columnCount=1, keinen
Merges und RecoveryArtifactV6 als kanonischen JSON-String in A1.
Drive-/Permission-Invarianten sind dieselben owner-only-Regeln wie bei v1.

~~~text
filename = "eds-diary-recovery-" + recovery_artifact_locator

app_format = "sync-recovery-v6"
recovery_family_locator = recovery_family_locator
recovery_artifact_locator = recovery_artifact_locator
~~~

Diese drei appProperties sind die einzigen Protokoll-properties der Recovery-
Ressource.

Publish ist exakt fail-closed:

1. Für das konkrete (diary_id,epoch_id) Discovery über exakten Dateinamen und
   recovery_artifact_locator. Mehr als eine plausible Ressource =>
   ambiguous/security stop.
2. Existiert noch kein Artefakt, Ressource erstellen und anschließend wieder per
   Discovery eindeutig binden.
3. Existiert dieselbe Ressource bereits, darf ihr A1 entweder leer sein oder
   exakt dieselben kanonischen RecoveryArtifactV6-Bytes enthalten. Andere
   bereits vorhandene Artifact-Bytes unter demselben epoch-spezifischen Locator
   => security stop; kein semantisches Replacement.
4. Schreiben/Timeout wird ausschließlich durch bytegenauen Readback derselben
   kanonischen Artifact-Bytes entschieden.
5. Nach Write erneut Discovery: exakt dieselbe eine epoch-spezifische Ressource
   muss kanonisch übrig sein.
6. Historische Source-Artefakte werden bei Rotation **nicht** gelöscht oder
   überschrieben. Garbage Collection ist nicht Teil des v2-Sicherheitsprotokolls.

Account+URS-Recovery:

1. Über recovery_family_locator alle owner-only v6-Recovery-Ressourcen dieser
   Familie discovern; jede Ressource strikt prüfen und mit URS entschlüsseln.
2. Für jedes gültige Artifact den zugehörigen Epoch-Remote über den aus
   diary_id+epoch_id berechenbaren v6 epoch_locator discovern und vollständig
   verifizieren.
3. Ein vorbereiteter Successor wird **nicht** allein durch Existenz,
   predecessor_epochs oder sein RecoveryArtifact aktiv.
4. Native v2-Genesis ist genau dann Aktivierungs-Root, wenn
   predecessor_epochs=[] und activation_lineage=[].
5. Für jede nicht-native v2-Epoche muss activation_lineage (§10c) die **gesamte**
   Kette vom vertrauenswürdigen Root bis zur aktuellen Epoche lückenlos
   beweisen. Nur den direkten Predecessor zu prüfen genügt ausdrücklich nicht.
6. Eine RecoveryAuthorityTransitionV2 innerhalb der aktuellen Epoche wird
   zusätzlich durch recovery_authority_transition_proof (§16c) geprüft bzw. bei
   exakt unverändertem Anchor crash-resumable abgeschlossen.
7. Erst wenn Manifest, aktuelle _r-Historie, activation_lineage und gegebenenfalls
   Recovery-Authority-Transition gemeinsam konsistent sind, darf das Artifact
   als current Recovery-Authority verwendet werden.
8. Mehrere inkompatible vollständig gültige aktivierte Ketten oder mehr als ein
   unretired kanonischer Leaf => ambiguous/security stop.
9. Ein vorbereiteter Successor oder Recovery-Rekey ohne vollständigen
   Aktivierungs-/Transition-Beweis bleibt staged/read-only und darf niemals
   remote-active oder Forced-Takeover-fähig werden.

---
## 10b. RecoveryActivationProofV2

Zweck: Für **einen einzelnen v2→v2-Link** beweist dieser Proof, dass der
vorbereitete Successor tatsächlich durch seine direkte Source aktiviert wurde.
Der zugehörige Source-RK steht ausschließlich im passenden
ActivationLineageV2-Eintrag (§10c). Die vollständige Recovery vertraut nie nur
diesem direkten Link, sondern validiert die gesamte activation_lineage vom Root
bis zur aktuellen Epoche.

Der Proof wird erzeugt, während die Source noch vollständig verifiziert und
unsealed ist und der aktuelle Writer-Private-Key verfügbar ist. Er bindet den
genau geplanten Rotation-Announcement-Envelope, wird aber bereits **vor dessen
Append** in RecoveryArtifactV6 und staged Backup aufgenommen.

Exakt:

~~~text
{
  format: "recovery-activation-proof-v2",
  version: 2,
  source_profile: "google-sheets-transferable-single-writer-v2",
  source_epoch_id,
  source_manifest_fingerprint,
  source_anchor_before_announcement,
  source_writer_generation,
  source_writer_grant_id,
  source_writer_device_id,
  source_writer_key_id,
  successor_epoch_id,
  successor_manifest_fingerprint,
  successor_recovery_generation,
  rotation_kind,
  announcement_envelope: {
    envelope_id,
    iv,
    ciphertext
  },
  activation_signature
}
~~~

`source_anchor_before_announcement` ist RemoteAnchorV2 des vollständig
verifizierten Source-Prefix unmittelbar vor dem geplanten Announcement.

`rotation_kind` ist exakt `"normal" | "recovery_rekey"`.

`successor_recovery_generation` muss exakt der Recovery-Generation des
Successor-Manifests **und** der am finalen Source-Prefix aktuell verifizierten
Recovery-Generation entsprechen.

Bei rotation_kind="recovery_rekey" muss die Generationserhöhung bereits zuvor
durch RecoveryAuthorityTransitionV2 auf der Source durable geworden sein. Der
Rotation-Announcement selbst erhöht keine Recovery-Generation.

`announcement_envelope` enthält die **exakt one-shot vorbereiteten und
persistent reservierten** Rowbytes des signierten
rotation-announcement-sw-v2. Diese Bytes dürfen bei Retry nie regeneriert werden.

Signatur-Core ist das Proof-Objekt ohne `activation_signature`.

Exakte Signaturbytes:

~~~text
UTF8("eds-diary/recovery-activation-proof/v2") || 0x00 ||
UTF8(JCS(activation_proof_core))
~~~

`activation_signature` ist exakt eine 64-Byte-Ed25519-Signatur als Base64URL
mit dem an source_anchor_before_announcement kanonisch aktuellen Writer-Key.
Die drei announcement_envelope-Felder müssen kanonisches Base64URL und dieselben
EnvelopeV6-Row-Bounds wie normale Remote-Rows erfüllen.

Bei normal/recovery_rekey übernimmt der Successor dieselbe Writer-Authority als
Epoch-Start-Trust-Root. Diese Successor-Aussage ist bei Recovery jedoch **nur
eine zu prüfende Behauptung** und kein unabhängiger Beweis für die Source-
Authority.

Aktivierungsprüfung mit nur aktuellem URS + Google-Konto:

1. RecoveryArtifactV6 entschlüsseln und Successor vollständig verifizieren.
2. Der umgebende ActivationLineageV2-Eintrag muss source_root_key als exakt
   32-Byte-RK der im Proof benannten direkten Source liefern.
3. Source-Ressource über source_epoch_id/epoch_locator discovern; öffentliches
   Source-Manifest lesen und dessen Fingerprint exakt mit
   source_manifest_fingerprint vergleichen.
4. Source-Manifest mit source_root_key entschlüsseln und vollständig
   gegen Fingerprint, Diary-/Epoch-ID, Account-Binding, Recovery-Bindungen,
   Schema-Registry und Protokollgrenzen prüfen.
5. Source-`_r` mit demselben source_root_key **vollständig** durch den
   TransferableSingleWriterV2Verifier verifizieren, mindestens bis einschließlich
   source_anchor_before_announcement.covered_row_count. Der an genau diesem
   Prefix kanonische Writer muss exakt source_writer_generation,
   source_writer_grant_id, source_writer_device_id und source_writer_key_id des
   Proofs entsprechen; der dazugehörige historische Public Key wird aus dieser
   verifizierten Source-Historie gewonnen.
6. Proof-Struktur, Source-/Successor-IDs, Manifest-Fingerprint, rotation_kind und
   successor_recovery_generation exakt gegen Source-/Successor-Manifest und
   Artifact prüfen. Die source_writer_*-Authority muss zusätzlich exakt den
   `epoch_start_writer_*`-Feldern des Successors entsprechen.
7. activation_signature gegen den **aus der verifizierten Source-Historie**
   ermittelten Writer-Public-Key prüfen; nicht gegen eine bloße Successor-
   Selbstbehauptung.
8. Die **unmittelbar nächste physische Source-Row** muss byte-identisch
   `[envelope_id,iv,ciphertext]` aus announcement_envelope sein. Diese Row mit
   source_root_key öffnen und als gültiges
   rotation-announcement-sw-v2 der bei Schritt 5 current Source-Authority
   vollständig verifizieren. Ihre Successor-ID, Manifest-Fingerprint,
   rotation_kind und successor_recovery_generation müssen exakt dem Proof und
   Successor entsprechen.
9. Fehlt diese Row, ist der Successor staged/nicht aktiviert. Steht irgendeine
   andere Row zuerst oder ist die Row semantisch/signaturseitig ungültig, ist
   der Aktivierungsbeweis ungültig.
10. Eine byte-identische Retry-Duplikatrow **nach** der ersten gültigen
    Announcement-Row ändert die Aktivierungsentscheidung nicht.
11. Der Proof ist kein Ersatz für die normale Source-Verifikation im laufenden
    Writer-Betrieb. Er ist ausschließlich ein Recovery-/Backup-Aktivierungsbeweis
    für eine bereits geplante v2→v2-Rotation.

Der Proof zeigt absichtlich nur: „Dieser exakt vorbereitete, vom damaligen
Writer signierte Successor wurde an genau diesem historisch verifizierten
Source-Prefix tatsächlich aktiviert.“ Er behauptet keine globale Freshness über
spätere Provider-Rollbacks hinaus.

---
## 10c. ActivationLineageV2 – transitiver Aktivierungsbeweis

Jedes RecoveryArtifactV6 enthält eine geordnete `activation_lineage`. Sie
beweist nicht nur den direkten Vorgänger, sondern die **gesamte** kanonische
Aktivierungskette bis zur aktuellen v2-Epoche.

Maximal `protocol_limits.max_activation_lineage_entries = 128` Einträge. Eine
129. Rotation ist in diesem Profil nicht zulässig; Lineage-Compaction benötigt
eine neue Protokollversion.

Eintrag Union exakt:

~~~text
ProfileUpgradeActivationEntryV2 = {
  kind: "profile_upgrade",
  source_profile: "google-sheets-single-writer-v1",
  source_epoch_id,
  source_manifest_fingerprint,
  source_root_key,
  source_anchor_before_announcement,
  successor_epoch_id,
  successor_manifest_fingerprint,
  announcement_envelope: {
    envelope_id,
    iv,
    ciphertext
  }
}

V2RotationActivationEntryV2 = {
  kind: "v2_rotation",
  source_profile: "google-sheets-transferable-single-writer-v2",
  source_root_key,
  proof: RecoveryActivationProofV2
}
~~~

`source_root_key` ist jeweils Base64URL von exakt 32 Byte und steht nur
innerhalb des URS-verschlüsselten RecoveryArtifactV6 bzw. des unter RK_epoch
verschlüsselten lokalen ActivationLineageCacheV2.

Konstruktionsregeln:

- native v2-Genesis: activation_lineage=[].
- v1→v2 profile_upgrade: activation_lineage enthält exakt einen
  ProfileUpgradeActivationEntryV2.
- v2→v2: der Successor kopiert die **bereits vollständig verifizierte** Lineage
  der aktiven Source byte-/semantikgleich und hängt genau einen
  V2RotationActivationEntryV2 für Source→Successor an.
- Ein staged/nicht aktivierter Epoch darf niemals als Source einer neuen
  Lineage-Erweiterung dienen.
- Jeder Eintrag muss auf den unmittelbar vorherigen/folgenden Epoch-Fingerprint
  passen; Lücken, Wiederholungen, alternative Branches oder Zyklus => fatal.

ProfileUpgrade-Prüfung:

1. v1-Source über source_root_key und source_manifest_fingerprint vollständig
   mit dem eingefrorenen v1-Verifier prüfen.
2. source_anchor_before_announcement muss exakt ein verifizierter finaler
   Source-Prefix sein.
3. Die unmittelbar nächste physische v1-Row muss byte-identisch
   announcement_envelope sein.
4. Diese Row mit source_root_key öffnen und als gültiges
   rotation-announcement-sw-v1 auf successor_epoch_id +
   successor_manifest_fingerprint prüfen.
5. Erst dann ist die erste v2-Epoche aktiviert.

V2-Link-Prüfung:

- source_root_key + proof werden exakt nach §10b geprüft.
- source_epoch_id/fingerprint des Proofs müssen dem vorherigen kanonisch
  aktivierten Lineage-Leaf entsprechen.
- successor_epoch_id/fingerprint des Proofs müssen dem nächsten Leaf bzw. beim
  letzten Eintrag der RecoveryArtifactV6-Epoche entsprechen.

Recovery validiert Einträge **vom Root nach vorn**. Ein späterer gültiger Link
kann einen früheren fehlenden/ungültigen Link niemals heilen.

### 10d. ActivationLineageCacheV2 – lokaler verschlüsselter Cache

Damit normale Rotation und recovery_rekey auch dann möglich bleiben, wenn der
alte URS nicht mehr bekannt ist, wird die zuletzt vollständig verifizierte
activation_lineage lokal unter RK_epoch verschlüsselt gehalten.

Exakt:

~~~text
{
  format: "activation-lineage-cache-v2",
  version: 2,
  diary_id,
  epoch_id,
  manifest_fingerprint,
  iv,
  ciphertext
}
~~~

iv = 12 CSPRNG-Bytes.

AAD exakt:

~~~text
UTF8(JCS({
  format,
  version,
  diary_id,
  epoch_id,
  manifest_fingerprint,
  iv
}))
~~~

Plaintext exakt:

~~~text
{
  activation_lineage
}
~~~

~~~text
AES-256-GCM(
  K_activation_lineage_cache,
  iv,
  UTF8(JCS(plaintext)),
  AAD
)
~~~

Nach erfolgreicher Aktivierung/Recovery muss der Cache persistent geschrieben,
AEAD-readback-verifiziert und gegen die aktuelle Epoche gebunden sein. Rotation
oder recovery_rekey ist blockiert, wenn dieser Cache fehlt, nicht entschlüsselbar
ist oder die Lineage nicht vollständig erneut validiert werden kann. Normale
Fachwrites benötigen den Cache nicht.

Der Cache enthält historische Root-Keys und ist deshalb vertrauliches Material;
er darf weder in Logs noch in unverschlüsseltem Local State erscheinen.

---

## 11. RemoteAnchorV2

Exakt:

~~~json
{
  "anchor_profile": "google-sheets-transferable-single-writer-v2",
  "covered_row_count": 123,
  "prefix_hash": "<32-byte-b64url>"
}
~~~

Prefix H0:

~~~text
SHA-256(
  UTF8("eds-diary/remote-prefix/v6") || 0x00 ||
  UTF8("google-sheets-transferable-single-writer-v2") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)
~~~

Für jede physische Row in Reihenfolge:

~~~text
Hi = SHA-256(
  UTF8("eds-diary/remote-prefix-step/v6") || 0x00 ||
  H(i-1) || uint64_be(i) || uint32_be(len(row_jcs)) || row_jcs
)
~~~

row_jcs ist JCS des exakten String-Tripels [envelope_id, iv, ciphertext].

Auch stale_writer_rejected- und stale_grant_rejected-Rows bleiben Bestandteil des
physischen Prefix und damit des Anchors.

---

## 12. Verifier-Automat

Der v2-Full-Verifier beginnt ausschließlich aus dem Manifest-Trust-Root und
verarbeitet _r strikt in physischer Reihenfolge.

Zustand:

~~~text
current_writer_generation
current_writer_grant_id
current_writer_device_id
current_writer_key_id
current_writer_public_key
current_recovery_generation
current_recovery_urs_commitment
current_recovery_takeover_key_id
current_recovery_takeover_public_key
source_epoch_sealed
genesis_grant_confirmation_required
accepted_revision_graph
authority_history_by_prefix
recovery_history_by_prefix

~~~

Initialisierung:

- source_epoch_sealed=false.
- authority_history_by_prefix[0] enthält die manifestgebundene
  Epoch-Start-Writer-Authority und unsealed.
- recovery_history_by_prefix[0] enthält Recovery-Generation, URS-Commitment,
  Takeover-Key-ID und Takeover-Public-Key aus dem Manifest.
- current_recovery_generation, current_recovery_urs_commitment,
  current_recovery_takeover_key_id und current_recovery_takeover_public_key
  starten exakt aus dem Manifest und dürfen innerhalb derselben Epoche
  ausschließlich durch eine gültige RecoveryAuthorityTransitionV2 atomar
  fortgeschrieben werden.
- genesis_grant_confirmation_required ist genau dann true, wenn
  epoch_start_authority_mode="genesis_grant_required".

Pro Row:

1. Grid-/Bounds-/Base64URL-/Envelope-AEAD vollständig prüfen. Gleiche
   envelope_id + andere Bytes => security_blocked. Byte-identische spätere
   Retry-Duplikate zählen physisch, sind aber semantische No-ops und springen
   direkt zu Schritt 6/7.
2. Wrapper als exaktes RevisionV2 validieren.
2a. Falls genesis_grant_confirmation_required=true, ist **ausschließlich** der
    exakt manifestgebundene Gen-1-writer-grant-sw-v2 mit H0 zulässig. Jede
    andere semantische Row => security_blocked. Erst nach dessen erfolgreicher
    Validierung wird das Flag irreversibel gelöscht.
3. Bei writer-grant-sw-v2:
   - falls source_epoch_sealed=true: einen sonst vollständig wohlgeformten Grant
     als stale_after_seal_rejected behandeln; malformed/kryptographisch ungültige
     Rows bleiben security_blocked;
   - authority_anchor gegen den historischen Prefix und die dortige
     authority_history_by_prefix prüfen, nicht zwingend gegen rowIndex-1;
   - Handoff gegen den am Anchor gültigen predecessor Writer-Key;
   - Forced Takeover gegen die in recovery_history_by_prefix am
     authority_anchor verifizierte Recovery-Takeover-Authority;
   - ist der predecessor an der aktuellen Row weiterhin current, bei gültigem
     direkten Nachfolger Authority fortschreiben;
   - ist der Candidate relativ zu seinem historischen Anchor vollständig gültig,
     aber seine Generation inzwischen bereits durch einen anderen gültigen
     Nachfolger erreicht/überschritten, => stale_grant_rejected;
   - Zukunftsgeneration, falsche historische Vorgängerbindung, falscher Anchor
     oder ungültige Autorisierung => security_blocked.
4. Bei normaler Revision:
   - source_epoch_sealed wird **niemals** auf false zurückgesetzt;
   - falls source_epoch_sealed=true: eine sonst vollständig wohlgeformte und
     gegen ihre historische Authority korrekt signierte Row als
     stale_after_seal_rejected behandeln;
   - entspricht writer_context exakt der current authority, Signatur gegen
     current_writer_public_key prüfen und die Row normal auswerten;
   - referenziert writer_context eine bereits verifizierte **ältere** Authority,
     deren Device-/Grant-/Key-Tupel exakt in der Authority-Historie existiert,
     Signatur gegen deren historischen Public Key prüfen und bei Erfolg
     stale_writer_rejected klassifizieren;
   - gleiche writer_generation wie current, aber andere Grant-/Key-/Device-ID
     => security_blocked;
   - unbekannte historische Authority oder zukünftige Generation ohne Grant
     => security_blocked;
   - ein gültiges recovery-authority-transition-sw-v2 der current authority
     wird zusätzlich nach §16b geprüft; nur bei exakt aktuellem Recovery-from-
     State und Anchor unmittelbar vor der Row wird der Recovery-State atomar auf
     die to-Felder fortgeschrieben. Historisch überholte, sonst gültige
     Transition => stale_recovery_transition_rejected;
   - ein gültiges rotation-announcement-sw-v2 der current authority setzt
     source_epoch_sealed irreversibel auf true.
5. Nur akzeptierte Fachrevisionen gehen in den fachlichen Graphen.
6. Jede physische Row geht unabhängig von semantischer Annahme in Prefix-Hash
   und Bounds ein.
7. Nach jeder Row werden Writer-/Seal-State in authority_history_by_prefix und
   Recovery-State in recovery_history_by_prefix für den neuen Prefix
   festgehalten.
8. EOF mit genesis_grant_confirmation_required=true => security_blocked /
   manifest_genesis_missing.

Ein Root-Key-besitzendes stale Gerät kann neue Ciphertexte erzeugen, aber ohne
aktuellen Writer-Key weder aktuelle Fachrevisionen noch einen Handoff-Grant
authentisieren.

---

## 13. Schreibfreigabe / Freshness

Ein Gerät darf RevisionV2 erst persistent erzeugen, wenn innerhalb desselben
Write-Vorgangs:

1. der konfigurierte RootWrap-Modus erfolgreich entsperrt ist. `best-effort`
   ist dabei zulässig, bleibt aber ausdrücklich nur Best-Effort-At-rest-Schutz;
   PRF/Passphrase sind die starken lokalen Modi;
2. `epoch_status="active"` ist; ein vorbereiteter/staged Successor bleibt
   `remote_bound` oder `local_offline` und darf keine normalen Fach-/Grantwrites
   erzeugen;
3. authentifizierte Provider-Session aktiv ist;
4. Remote vollständig neu gelesen und gegen den persistierten RemoteAnchorV2
   verifiziert wurde;
5. source_epoch_sealed=false ist;
6. verifizierte current authority exakt zum lokalen Device-Key passt;
7. lokaler Status writer_active ist;
8. kein nicht-terminaler rotation_state_ref, migration_state_ref,
   writer_operation_state_ref oder recovery_operation_state_ref die konkrete
   Mutation sperrt.

Es gibt im strikten v2 **kein zeitbasiertes Offline-Lease und kein
Freshness-Intervall**.

Nach Erstellung und Append folgt vollständiger Readback. Ändert sich die Authority
zwischen Prepare und Readback, wird die lokale Revision als stale_writer_pending
quarantiniert und nicht automatisch neu signiert oder erneut unter der neuen
Generation erzeugt.

---

## 14. Unknown Outcome – Grant und Fachwrite

Vor jedem Remote-Append werden exakte Envelope-Bytes persistent gespeichert.

Bei Timeout/unklarem Ergebnis:

1. niemals semantisch neuen Grant oder neue Revision erzeugen;
2. Remote vollständig lesen;
3. gleiche envelope_id + gleiche Bytes => dieses konkrete Envelope existiert;
4. gleiche envelope_id + andere Bytes => fatal;
5. fehlt das Envelope und Authority ist unverändert **und**
   source_epoch_sealed=false => exakt dieselben Bytes erneut appendieren;
6. fehlt das Envelope und Authority unverändert, aber Source inzwischen sealed
   => nicht erneut appendieren; staged/quarantiniert behandeln und kanonischen
   Successor discovern;
7. fehlt das Envelope und Authority hat sich geändert => nicht erneut appendieren;
   Fachrevision als stale_writer_pending quarantinieren bzw. den zugehörigen
   WriterGrantOperationStateV2 auf stage="stale" setzen.

Ein HTTP-200 ohne finalen Full Readback ist niemals durable.

---

## 15. Cooperative Handoff A -> B

Voraussetzungen:

- A ist auf einer kanonisch aktivierten Epoche (`epoch_status="active"`) nach
  frischem Full Verify current writer und source_epoch_sealed=false.
- B ist vollständig verifiziert read_only derselben Diary/Epoch.
- A hat keine nicht-durablen eigenen Pending-Envelopes.
- A verifiziert TransferdescriptorV2 von B.

A plant exakt einen Grant g+1, persistiert dessen exakte Bytes, signiert den
Grant-Signing-Input mit As aktuellem Writer-Key, appendet und liest vollständig
zurück.

A persistiert read_only erst, wenn derselbe Grant kanonisch akzeptiert wurde.

B persistiert writer_active erst nach eigenem Full Verify und nur wenn Device-ID,
Key-ID und Public Key des kanonischen Grants exakt zu Bs lokalem Private Key
gehören.

---

## 16. Forced Takeover

Ein read-only Gerät muss URS erneut erhalten. Danach:

1. RecoveryArtifactV6 decrypten, activation_lineage vollständig prüfen und
   gegebenenfalls RecoveryAuthorityTransitionProofV2 gemäß §16c
   prüfen/abschließen.
2. Recovery-Generation und recovery_urs_commitment müssen zum **vollständig
   verifizierten aktuellen Recovery-State** der Epoche passen.
3. recovery_takeover_key_id und Public Key müssen zu diesem aktuellen
   Recovery-State passen.
4. PKCS#8 transient als non-extractable Ed25519 signing key importieren und den
   §19-Keypair-Check bestehen.
5. Kanonische Aktivierung der Epoche bestätigen (`epoch_status="active"`),
   Remote erneut vollständig verifizieren, source_epoch_sealed=false verlangen
   und beweisen, dass der gelesene Prefix **alle** verfügbaren vertrauenswürdigen
   Freshness-Floors erweitert (Artifact-Anchor, lokaler Anchor, ggf.
   Backup-Anchor). Kein Anchor-Downgrade.
6. Grant g+1 reason="forced_takeover" gegen genau diesen frisch verifizierten
   Entscheidungs-Prefix erzeugen.
7. Grant-Signing-Input mit Recovery-Takeover-Key signieren.
8. Append + Full Readback.
9. writer_active nur bei kanonisch akzeptiertem eigenen Grant.
10. Recovery signing capability aus normalem Sitzungszustand verwerfen.

---

## 16a. Weitere v2 Control-Schemas

"rotation-announcement-sw-v2" ist eine normale writer-autorisierte Control-
RevisionV2 und wird mit der zum Row-Zeitpunkt aktuellen Writer-Authority signiert.

Wrapper zusätzlich zu §5 exakt:

~~~text
record_type = "rotation_announcement"
record_schema = "rotation-announcement-sw-v2"
record_status = "control"
parent_revision_ids = []
migration_origin = null
~~~

record_data exakt:

~~~text
rotation_id
from_epoch_id
successor_epoch_id
successor_creation_locator
successor_manifest_fingerprint
rotation_kind = "normal" | "recovery_rekey"
source_writer_generation
source_writer_grant_id
successor_recovery_generation
~~~

source_writer_generation und source_writer_grant_id müssen dem writer_context
der Control-Revision entsprechen.

Für **beide** rotation_kind-Werte gilt:
successor_recovery_generation == aktuell verifizierte
Source-Recovery-Generation am finalen Source-Prefix.

rotation_kind="recovery_rekey" bedeutet, dass innerhalb derselben
Maintenance-Operation zuvor eine RecoveryAuthorityTransitionV2 durable wurde.
Die Generationserhöhung findet **dort auf der Source** statt, nicht erst im
Successor-Manifest.

Diese Felder werden durch die normale RevisionV2-Writer-Signatur geschützt und
müssen mit dem RecoveryActivationProofV2 sowie dem Successor-Manifest
übereinstimmen.

"epoch-migration-sw-v2" ist ebenfalls eine normale writer-autorisierte
Control-RevisionV2.

Wrapper zusätzlich zu §5 exakt:

~~~text
record_type = "epoch_migration"
record_schema = "epoch-migration-sw-v2"
record_status = "control"
parent_revision_ids = []
migration_origin = null
~~~

record_data exakt:

~~~text
migration_id
migration_kind
source
result_semantic_snapshot_hash
active_head_count
tombstone_head_count
source_writer_authority
~~~

source enthält exakt:

~~~text
source_epoch_id
source_manifest_fingerprint
source_anchor
source_lineage_snapshot_hash
source_semantic_snapshot_hash
~~~

source_writer_authority ist exakt null oder:

~~~text
{
  writer_generation,
  writer_grant_id,
  writer_device_id,
  writer_key_id
}
~~~

migration_kind ist exakt:

~~~text
"profile_upgrade" | "normal" | "recovery_rekey"
~~~

Regeln:

- profile_upgrade ist ausschließlich v1→v2:
  source_writer_authority=null und source_anchor ist ein nicht-null
  RemoteAnchorV1 der final verifizierten v1-Source.
- normal/recovery_rekey sind v2→v2:
  source_writer_authority ist nicht-null, entspricht exakt der final
  verifizierten Source-Authority und source_anchor ist RemoteAnchorV2.
- Ein späteres Emergency-Verfahren benötigt eine neue explizite
  Schema-/Protokollentscheidung; es wird in diesem eingefrorenen v2-Profil nicht
  vorweggenommen.
- Bei unveränderter Ein-Source-Migration muss
  result_semantic_snapshot_hash == source_semantic_snapshot_hash gelten.

Snapshot-Hashes sind exakt und provider-/locale-unabhängig. Zuerst werden alle
aktuellen **nicht-Control-Heads** des Quellgraphen bestimmt.

Für jeden Head:

~~~text
semantic_entry = {
  record_type,
  record_schema,
  record_id,
  record_status,
  record_data
}

lineage_entry = {
  record_id,
  revision_id,
  parent_revision_ids
}
~~~

semantic_entries werden lexikographisch nach ihren UTF8(JCS(entry))-Bytes
sortiert. lineage_entries werden nach den **dekodierten revision_id-Bytes**
lexikographisch unsigned sortiert. parent_revision_ids sind ebenfalls nach
dekodierten ID-Bytes sortiert.

~~~text
source_semantic_snapshot_hash =
  Base64URL(SHA-256(UTF8(JCS(semantic_entries))))

source_lineage_snapshot_hash =
  Base64URL(SHA-256(UTF8(JCS(lineage_entries))))
~~~

result_semantic_snapshot_hash wird mit exakt derselben semantic_entry-Projektion
über die aktuellen nicht-Control-Heads des Successors berechnet.
active_head_count/tombstone_head_count zählen genau diese Heads nach
record_status.

## 16b. RecoveryAuthorityTransitionV2

Recovery-Rekey ändert die Recovery-Authority **innerhalb der noch aktiven,
unsealed Source-Epoche**, bevor eine Successor-Rotation beginnt.

Wrapper zusätzlich zu §5 exakt:

~~~text
record_type = "recovery_authority_transition"
record_schema = "recovery-authority-transition-sw-v2"
record_status = "control"
parent_revision_ids = []
migration_origin = null
~~~

Die Row ist eine normale writer-autorisierte RevisionV2; writer_context und
writer_signature müssen die an der Row-Position current Writer-Authority
verwenden.

record_data exakt:

~~~text
{
  transition_id,
  transition_kind: "recovery_rekey",
  from_recovery_generation,
  from_recovery_takeover_key_id,
  to_recovery_generation,
  to_recovery_urs_commitment,
  to_recovery_takeover_key_id,
  to_recovery_takeover_public_key,
  authority_anchor
}
~~~

Normen:

- transition_id dekodiert zu 32 CSPRNG-Bytes.
- authority_anchor ist RemoteAnchorV2 und muss **exakt** dem physischen Prefix
  unmittelbar vor der Transition-Row entsprechen.
- source_epoch_sealed muss false sein.
- from_recovery_generation und from_recovery_takeover_key_id müssen exakt dem
  aktuell verifizierten Recovery-State an diesem Prefix entsprechen.
- to_recovery_generation = from_recovery_generation + 1.
- to_recovery_takeover_public_key dekodiert zu exakt 32 Ed25519-Bytes.
- to_recovery_takeover_key_id muss daraus gemäß §2 reproduzierbar sein.
- to_recovery_urs_commitment ist exakt das §10-Recovery-Commitment des neuen
  32-Byte-URS für to_recovery_generation.
- Der normale RevisionV2-Signing-Input bindet alle diese Felder an die aktuelle
  Writer-Authority.
- Bei Annahme ersetzt der Verifier current_recovery_generation,
  current_recovery_urs_commitment, current_recovery_takeover_key_id und
  current_recovery_takeover_public_key atomar.
- Eine strukturell/kryptographisch gültige, aber bereits überholte Transition
  gegen einen historischen Recovery-State ist
  `stale_recovery_transition_rejected`; sie ändert keinen State.
- Eine Transition mit falschem from-State, Generation-Sprung, falschem Key-ID
  oder historischem Anchor darf niemals current werden.

### 16c. RecoveryAuthorityTransitionProofV2

Damit ein Recovery-Rekey auch einen Crash/Geräteverlust **zwischen** Publikation
des neuen RecoveryArtifactV6 und Append der Transition übersteht, bindet das
neue Artifact die exakt vorbereitete Transition-Row.

Exakt:

~~~text
{
  format: "recovery-authority-transition-proof-v2",
  version: 2,
  source_epoch_id,
  source_manifest_fingerprint,
  authority_anchor_before_transition,
  from_recovery_generation,
  from_recovery_takeover_key_id,
  to_recovery_generation,
  to_recovery_urs_commitment,
  to_recovery_takeover_key_id,
  to_recovery_takeover_public_key,
  transition_envelope: {
    envelope_id,
    iv,
    ciphertext
  }
}
~~~

transition_envelope ist das **one-shot vorbereitete**, bereits durch
writer_signature autorisierte RecoveryAuthorityTransitionV2-Envelope. Es wird
vor der ersten Remote-Publikation persistent reserviert und bei Retry niemals
regeneriert.

Recovery mit dem neuen URS:

1. RecoveryArtifactV6 decrypten, RK_epoch und neues Takeover-Keypair prüfen.
2. activation_lineage vollständig gemäß §10c prüfen; die Source muss kanonisch
   aktiv sein.
3. Source mit RK_epoch bis authority_anchor_before_transition vollständig
   verifizieren. Current Writer- und Recovery-State müssen exakt den
   Proof-from-Feldern entsprechen; Source muss unsealed sein.
4. Ist die **unmittelbar nächste** physische Row byte-identisch
   transition_envelope, diese Row decrypten und vollständig als gültige
   RecoveryAuthorityTransitionV2 verifizieren. Danach muss der current
   Recovery-State exakt den Proof-to-Feldern und dem Artifact entsprechen.
5. Existiert **noch keine Row nach dem Anchor**, darf Recovery die bereits
   vorbereiteten transition_envelope-Bytes exakt einmal appendieren und danach
   Full Readback durchführen. Dadurch kann der neue Recovery-Key einen
   unterbrochenen, vom damaligen Writer bereits autorisierten Rekey fertigstellen,
   ohne dessen Private Writer-Key zu besitzen.
6. Steht irgendeine andere physische Row zuerst, wird die vorbereitete Transition
   **nicht** nachträglich appended. Das Artifact bleibt für diesen Source-State
   staged/read-only; kein Forced Takeover mit der neuen Authority.
7. Gleiche envelope_id + andere Bytes oder ein semantisch/signaturseitig
   ungültiges Transition-Envelope => security_blocked.

Während eines Recovery-Rekeys friert der initiierende Client normale Fachwrites,
Handoff, Forced Takeover und Rotation vom finalen Anchor bis zum durable
Transition-Readback ein. Ein konkurrierender legitimer/staler Remote-Claim kann
den vorbereiteten Rekey dennoch überholen; dann gilt Schritt 6 fail-closed.

---

## 17. Rotation und Recovery-Rekey

Normale Epoch-Rotation setzt im Successor
epoch_start_authority_mode="carried_from_predecessor" und übernimmt die aktuelle
Writer-Authority in den Successor-Manifest-Trust-Root:

~~~text
epoch_start_writer_generation = aktuelle Generation
epoch_start_writer_grant_id = aktueller Grant
epoch_start_writer_device_id
epoch_start_writer_key_id
epoch_start_writer_public_key
~~~

Für einen Successor, der eine bestehende Authority fortsetzt, ist der erste
Successor-Control-Record kein neuer Gerätewechsel; das genaue Migration-Control
bindet die Source-Authority und den Successor-Manifest-Fingerprint.

Vor Append des Rotation-Announcements wird dessen exakte Envelope-Row one-shot
vorbereitet. Aus dem final verifizierten Source-Anchor, den Successor-Daten und
genau diesen Rowbytes wird RecoveryActivationProofV2 erzeugt und mit dem
aktuellen Source-Writer-Key signiert. RecoveryArtifactV6 und ein staged
SyncBackupV6 dürfen diesen Proof bereits vor dem Append enthalten.

Remote-Reihenfolge auf der Source entscheidet:

- gültiger Writer-Takeover-Grant vor Rotation-Announcement => der historische
  Proof-Anchor ist nicht mehr unmittelbar von der geplanten Announcement-Row
  gefolgt; Announcement des alten Writers ist stale/ungültig und
  RecoveryActivationProofV2 aktiviert den Successor nicht;
- gültiges byte-identisches Rotation-Announcement zuerst => Source ist ab dieser
  Row versiegelt; §10b wird gültig und der Successor ist recovery-seitig
  aktiviert; spätere Fachwrites und Writer-Grants auf Source sind semantisch
  verworfen; weitere Takeover-Aktionen müssen gegen den kanonischen Successor
  erfolgen.

Normale v2→v2-Rotation übernimmt recovery_generation,
recovery_urs_commitment, recovery_takeover_key_id und
recovery_takeover_public_key aus dem **final verifizierten aktuellen
Source-Recovery-State** unverändert in das Successor-Manifest und erzeugt für
die neue Epoche ein neues RecoveryArtifactV6 mit neuem RK_epoch,
Manifest-Fingerprint, erweiterter activation_lineage und finalem Successor-Anchor.

Recovery-Rekey ist eine zweiphasige Maintenance-Operation:

1. aktive Source vollständig verifizieren und lokal einfrieren;
2. neuen URS + neues Recovery-Takeover-Keypair erzeugen;
3. RecoveryAuthorityTransitionV2 one-shot gegen den finalen Source-Anchor
   vorbereiten;
4. neues **same-epoch** RecoveryArtifactV6 unter dem neuen URS publizieren. Es
   enthält denselben RK_epoch, dieselbe vollständig verifizierte
   activation_lineage, den neuen Recovery-Key-State und
   RecoveryAuthorityTransitionProofV2;
5. Recovery des staged Artifacts testen;
6. exakte Transition-Envelope-Bytes appendieren + Full Readback;
7. neues Artifact jetzt gegen den aktuellen Source-Recovery-State prüfen und
   Forced-Takeover-Keypair-Check durchführen;
8. obligatorischen **activated Source-SyncBackupV6** erzeugen und
   Test-Restore-verifizieren;
9. erst jetzt gilt der Recovery-Key-Wechsel als durable abgeschlossen;
10. falls der Rekey zugleich Epoch-Rotation verlangt, danach einen normalen
    Successor-Aufbau starten; rotation_kind/migration_kind dürfen
    "recovery_rekey" zur Audit-Semantik tragen, aber
    successor_recovery_generation == bereits aktuelle Source-Generation.

Altes Recovery-Takeover-Material darf ab der durable Transition keinen Grant
mehr autorisieren. Alte RecoveryArtifacts bleiben immutable vorhanden, werden
aber beim Full Verify als ältere Recovery-Generation erkannt und können keine
Writer-Authority mehr herstellen.

---

## 18. EpochLocalSecurityStateV6

Exakt versioniertes neues State-Schema; V5 bleibt unverändert.

Exakt diese Top-Level-Properties, keine weiteren:

~~~text
{
  local_state_version: 6,
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  recovery_generation,
  recovery_urs_commitment,
  remote_binding,
  remote_anchor,
  epoch_status,
  operation_generation,
  rotation_state_ref,
  migration_state_ref,
  writer_operation_state_ref,
  recovery_operation_state_ref,
  activation_lineage_cache_ref,
  local_journal_count,
  local_journal_hash,
  writer_status,
  writer_device_id,
  writer_signing_key_id,
  writer_generation,
  writer_grant_id,
  verified_writer_device_id,
  verified_writer_key_id,
  verified_writer_generation,
  verified_writer_grant_id,
  recovery_takeover_key_id,
  stale_writer_pending_count
}
~~~

remote_binding ist exakt null oder:

~~~text
{
  storage_provider_id: "google-drive-sheets-v1",
  sync_profile: "google-sheets-transferable-single-writer-v2",
  remote_resource_id,
  remote_identity_binding
}
~~~

remote_anchor ist null oder RemoteAnchorV2.

epoch_status ist exakt:

~~~text
local_offline | remote_bound | active | offline_restored | retired | orphaned
~~~

Für v2 gilt zusätzlich:
- ein vorbereiteter Successor bleibt `remote_bound` (oder nach Backup-Restore
  `local_offline`/`offline_restored`) und `writer_status="read_only"`, solange
  seine kanonische Aktivierung nicht gemäß §10b bzw. beim profile_upgrade durch
  die verifizierte v1-Source bewiesen ist;
- `active` darf erst nach diesem Aktivierungsnachweis persistiert werden;
- die Rotation-/Migrationsservices dürfen während ihrer expliziten
  Maintenance-Operation die vorbereiteten Successor-Rows erzeugen; das ist kein
  normales Writer-Gate und verleiht dem staged Successor keine interaktive
  Writer-Authority.

writer_status ist exakt "writer_active" | "read_only".

writer_device_id und writer_signing_key_id bezeichnen die **lokale** Device-
Identität und deren lokalen Writer-Key. writer_generation/writer_grant_id sind
nur bei writer_active nicht-null und müssen dann exakt
verified_writer_generation/verified_writer_grant_id entsprechen. Bei read_only
sind writer_generation=null und writer_grant_id=null.

verified_writer_device_id, verified_writer_key_id,
verified_writer_generation und verified_writer_grant_id sind entweder gemeinsam
null (noch kein gebundener Full Verify) oder gemeinsam gesetzt. Nach erfolgreichem
gebundenem Full Verify beschreiben sie exakt die zuletzt vollständig remote
verifizierte kanonische Authority.

recovery_takeover_key_id ist nach gebundenem Full Verify nicht-null und muss
exakt zum **aktuellen** Recovery-State des Verifiers passen.
stale_writer_pending_count und operation_generation sind nichtnegative
Safe-Integer.

rotation_state_ref, migration_state_ref, writer_operation_state_ref,
recovery_operation_state_ref und activation_lineage_cache_ref sind null oder
verwenden exakt die geschlossene
{operation_id,state,state_record_hash}-Referenzform.

recovery_generation, recovery_urs_commitment und recovery_takeover_key_id
beschreiben nach gebundenem Full Verify den **aktuellen** Recovery-State nach
allen akzeptierten RecoveryAuthorityTransitionV2-Controls; sie sind nicht
notwendig identisch mit den immutable Manifest-Startwerten.

Der Writer-Private-CryptoKey liegt in einem getrennten lokalen Key-Store und wird
über writer_signing_key_id referenziert. State und Referenz werden über
K_local_state_mac authentifiziert.

Ein fehlender, nicht nutzbarer oder nicht zum Public Key passender Private Key
führt zu read_only, nicht zu stiller Neugenerierung.

### 18.1 RootWrapV6 und lokales Journal

v2 besitzt ein eigenes lokales Wrap-Schema; RootWrapV5 bleibt unverändert.

~~~text
{
  local_wrap_version: 6,
  mode: "best-effort" | "prf" | "passphrase",
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  wrap_id,
  wrap_iv,
  wrapped_root_key,
  mode_metadata
}
~~~

wrap_id ist exakt 16 CSPRNG-Bytes Base64URL, wrap_iv exakt 12 CSPRNG-Bytes.
AAD ist UTF8(JCS(desselben Objekts ohne wrap_iv und wrapped_root_key)).

Best-Effort: mode_metadata={}, eigener non-extractable AES-256-GCM CryptoKey im
Browserprofil.

Für alle drei Modi ist die Root-Wrap-Verschlüsselung exakt:

~~~text
plaintext = RK_epoch  # exakt 32 Byte

wrap_key =
  best-effort: lokaler non-extractable AES-256-GCM CryptoKey
  passphrase:  K_local_passphrase
  prf:         K_local_prf

wrapped_root_key =
  AES-256-GCM.encrypt(
    key = wrap_key,
    iv = wrap_iv,
    plaintext = RK_epoch,
    aad = AAD,
    tag_length = 128
  )
~~~

Öffnen ist die exakte inverse Operation; Ergebnis muss genau 32 Byte RK_epoch
sein. `wrapped_root_key` ist Ciphertext||128-Bit-Tag als Base64URL.

Passphrase:

~~~text
mode_metadata = {
  passphrase_profile: "argon2id-v6-1",
  passphrase_salt
}
~~~

passphrase_salt ist 16 CSPRNG-Bytes. Argon2id v0x13 verwendet exakt
password=exact_UTF8(passphrase), salt=passphrase_salt, 64 MiB, 3 Iterationen,
Parallelism 1, Output 32 Byte. Eingaberegeln bleiben wie v1: mindestens 15
Unicode-Codepoints, maximal 1024 UTF-8-Bytes, kein trim/keine Normalisierung und
lokale Common-Passphrase-Blockliste. Danach:

~~~text
pass_context =
  UTF8("eds-diary/local-passphrase-wrap/v6") || 0x00 ||
  diary_id_bytes || epoch_id_bytes || key_id_bytes

K_local_passphrase = HKDF-SHA-256(
  argon_base,
  SHA-256(UTF8("eds-diary/local-passphrase-salt/v6") || 0x00 ||
         diary_id_bytes || epoch_id_bytes),
  pass_context,
  32
)
~~~

PRF:

~~~text
mode_metadata = {
  prf_profile: "webauthn-prf-v6-1",
  credential_id,
  prf_eval_input,
  prf_wrap_salt,
  rp_id
}

prf_eval_input = 32 CSPRNG bytes
prf_wrap_salt = 32 CSPRNG bytes

credential_id_hash = SHA-256(credential_id_bytes)
prf_context =
  UTF8("eds-diary/local-prf-wrap/v6") || 0x00 ||
  diary_id_bytes || epoch_id_bytes || key_id_bytes || credential_id_hash

K_local_prf = HKDF-SHA-256(
  prf_output_32_bytes,
  prf_wrap_salt,
  prf_context,
  32
)
~~~

userVerification="required", exakte Credential-ID und Post-Enrollment-PRF-
Verifikation bleiben Pflicht.

Lokales Envelope-Journal:

~~~text
L0 = SHA-256(
  UTF8("eds-diary/local-journal/v6") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)

entry_hash = SHA-256(UTF8(JCS([envelope_id,iv,ciphertext])))
Li = SHA-256(L(i-1) || uint64_be(i) || entry_hash)
~~~

State-Tag:

~~~text
local_state_tag = Base64URL(HMAC-SHA-256(
  K_local_state_mac,
  UTF8(JCS(epoch_local_security_state_v6))
))
~~~

### 18.2 WriterDeviceKeyV2 Local Store

Erzeugung exakt:

~~~text
crypto.subtle.generateKey(
  {name:"Ed25519"},
  false,                 # Private Key non-extractable; Public Key exportierbar
  ["sign","verify"]
)
~~~

Der Public Key wird unmittelbar einmal als `raw` exportiert und gemäß §2 an
writer_signing_key_id gebunden. Der Private Key darf nie exportiert werden.
Fehlschlag bei Erzeugung/Persistenz => v2-Writerbetrieb nicht verfügbar; kein
exportierbarer Fallback.

Separater IndexedDB-Key-Store-Eintrag exakt:

~~~text
{
  writer_signing_key_id,
  writer_device_id,
  writer_public_key,
  private_key
}
~~~

private_key ist ein non-extractable Ed25519 CryptoKey mit usage=["sign"].
writer_signing_key_id muss aus writer_public_key gemäß §2 reproduzierbar sein.

Beim Laden wird die Keypair-Bindung durch folgende Challenge geprüft:

~~~text
UTF8("eds-diary/writer-device-key-check/v2") || 0x00 ||
diary_id_bytes || epoch_id_bytes ||
writer_device_id_bytes || raw_writer_public_key
~~~

Der Private Key signiert diese Bytes; Verifikation muss mit writer_public_key
erfolgreich sein. Fehlschlag => read_only/security error, niemals Key-
Neugenerierung als stiller Ersatz.

### 18.3 Exakte v2 Crash-Resume-Operation-States

Kein sicherheitsrelevanter Remote-Append darf ausschließlich durch flüchtigen
UI-/Promise-State repräsentiert sein. Vor dem ersten möglichen Remote-Append
werden die exakten one-shot Envelope-Bytes und der Entscheidungs-Anchor
persistent gespeichert und über den State-Record-Hash readback-verifiziert.

Gemeinsame Prepared Row:

~~~text
PreparedEnvelopeRowV2 = {
  envelope_id,
  iv,
  ciphertext
}
~~~

### WriterGrantOperationStateV2

~~~text
{
  format: "writer-grant-operation-v2",
  version: 2,
  operation_id,
  operation_kind: "handoff" | "forced_takeover",
  epoch_id,
  stage:
    "prepared" |
    "append_unknown" |
    "durable" |
    "stale",
  authority_anchor,
  prepared_envelope,
  expected_writer_generation,
  expected_writer_grant_id
}
~~~

`prepared_envelope` ist das exakte WriterGrantV2-Envelope.
Retry ist nur gemäß §14 zulässig; durch die Grant-Freshness-Regel aus §8 wird
ein historisch gewordener vorbereiteter Grant zu `stale`, niemals später doch
current.

### RecoveryRekeyOperationStateV2

~~~text
{
  format: "recovery-rekey-operation-v2",
  version: 2,
  operation_id,
  epoch_id,
  stage:
    "new_material_staged" |
    "recovery_artifact_published" |
    "transition_pending" |
    "transition_unknown" |
    "transition_durable" |
    "activated_backup_verified" |
    "completed" |
    "stale",
  authority_anchor_before_transition,
  transition_envelope,
  recovery_artifact_id,
  recovery_artifact_locator,
  transition_proof_sha256,
  to_recovery_generation,
  to_recovery_takeover_key_id
}
~~~

Dieser State enthält **niemals** URS, PKCS#8 oder plaintext Root-Keys.
RecoveryTakeoverStagingV2 hält das private Takeover-Material separat
URS-verschlüsselt.

Crash-Regeln:

- Vor `recovery_artifact_published` ist keine neue Remote-Recovery-Authority
  behauptbar.
- Nach `recovery_artifact_published`, aber vor durable Transition, kann nur
  §16c die exakt vorbereitete Transition crash-resumable abschließen.
- Nach `transition_durable` muss ein activated SyncBackupV6 der **Source**
  erzeugt und Test-Restore-verifiziert werden, bevor der Rekey als
  `completed` gilt oder eine recovery_rekey-Successor-Rotation beginnt.
- Wird der Transition-Anchor überholt, stage=`stale`; keine neuen Envelope-
  Bytes aus denselben Semantiken erzeugen.

### RotationOperationStateV2

~~~text
{
  format: "rotation-operation-v2",
  version: 2,
  operation_id,
  rotation_kind: "normal" | "recovery_rekey" | "profile_upgrade",
  source_epoch_id,
  successor_epoch_id,
  stage:
    "source_frozen_verified" |
    "successor_planned" |
    "successor_bound" |
    "copying" |
    "successor_verified" |
    "recovery_artifact_verified" |
    "staged_backup_verified" |
    "announcement_prepared" |
    "announcement_unknown" |
    "announcement_durable" |
    "activated_backup_verified" |
    "switched" |
    "stale",
  source_anchor_before_announcement,
  successor_manifest_fingerprint,
  activation_lineage_sha256,
  announcement_envelope,
  activation_proof_sha256,
  recovery_artifact_id,
  staged_backup_id,
  activated_backup_id
}
~~~

`announcement_envelope` und `activation_proof_sha256` sind bis
`announcement_prepared` null und danach immutable/non-null.
`activated_backup_id` ist bis `activated_backup_verified` null.

Nach `announcement_durable` ist das Source-Seal irreversibel. Vor
`switched` muss zwingend ein **neuer activated SyncBackupV6** des Successors
erzeugt, Test-Restore-verifiziert und als `activated_backup_verified`
persistiert sein. Das frühere staged Backup genügt dafür nicht.

Alle Resume-Pfade beginnen mit Full Verify der beteiligten Remote-Epochen und
Abgleich der gespeicherten Anchor/Envelope-Bytes. Ein State-Record-Hash-Mismatch,
unbekannte Stage oder semantisch inkonsistente Kombination ist
security_blocked; kein „best effort“-Fortsetzen.

### Operation-Locking

- Während nicht-terminalem RecoveryRekeyOperationStateV2 sind Fachwrites,
  Handoff, Forced Takeover und Rotation lokal gesperrt.
- Während nicht-terminalem RotationOperationStateV2 sind normale Source-Writes
  ab dem dokumentierten Freeze gesperrt.
- Handoff und Forced Takeover dürfen nicht parallel zu einem anderen
  WriterGrantOperationStateV2 laufen.
- Web Locks bleiben zusätzlich erforderlich, sind aber **nicht** die persistente
  Crash-Grenze.

---

## 19. RecoveryArtifactV6

Header exakt:

~~~json
{
  "format": "sync-recovery-v6",
  "version": 6,
  "recovery_artifact_id": "<16-byte-b64url>",
  "kdf_profile_id": "recovery-hkdf-v6-1",
  "salt": "<32-byte-b64url>",
  "wrap_iv": "<12-byte-b64url>",
  "wrapped_payload": "<b64url>"
}
~~~

Encrypted Payload exakt; remote_anchor ist für ein aktivierbares v2-Artefakt
nicht-null:

~~~text
recovery_artifact_id
diary_id
epoch_id
key_id
RK_epoch
manifest_fingerprint
remote_anchor
google_account_binding
recovery_generation
recovery_urs_commitment
recovery_takeover_key_id
recovery_takeover_public_key
recovery_takeover_private_key_pkcs8
activation_lineage
recovery_authority_transition_proof
created_at
~~~

recovery_urs_commitment muss exakt aus dem eingegebenen URS, diary_id und
recovery_generation gemäß §10 reproduzierbar sein und dem **aktuell
verifizierten Recovery-State** der Epoche entsprechen.

activation_lineage ist exakt ActivationLineageV2 (§10c). Sie enthält sämtliche
für transitive Aktivierungsprüfung erforderlichen historischen Source-RKs nur
innerhalb dieses verschlüsselten Payloads.

recovery_authority_transition_proof ist:
- null, wenn die Artifact-Recovery-Generation bereits im immutable Manifest
  startet oder keine same-epoch RecoveryAuthorityTransitionV2 für dieses Artifact
  benötigt wird;
- zwingend RecoveryAuthorityTransitionProofV2 (§16c), wenn das Artifact eine
  neuere same-epoch Recovery-Generation als das Manifest repräsentiert.

Nach erfolgreicher Aktivierungsprüfung dürfen historische source_root_key-Werte
nicht als aktuelle RootWraps/Writerzustände persistiert werden. Der
Sicherheits-Tradeoff ist explizit: Kompromittierung des aktuellen URS offenbart
die in activation_lineage enthaltenen historischen Root-Keys; dafür ist die
kanonische Aktivierungskette ohne alte Recovery-Keys selbständig prüfbar.

recovery_takeover_private_key_pkcs8 ist Base64URL des exakt exportierten
Ed25519-PKCS#8-Schlüssels. Beim Restore wird daraus ein non-extractable Private
Key importiert.

Exakter Keypair-Check:

~~~text
key_check_input =
  UTF8("eds-diary/recovery-takeover-key-check/v2") || 0x00 ||
  diary_id_bytes || epoch_id_bytes ||
  uint64_be(recovery_generation) ||
  raw_recovery_takeover_public_key

signature = Ed25519.sign(imported_private_key, key_check_input)
Ed25519.verify(recovery_takeover_public_key_from_artifact,
               signature, key_check_input) == true
~~~

recovery_takeover_key_id muss aus recovery_takeover_public_key des Artifacts
gemäß §2 reproduzierbar sein.

- Ohne recovery_authority_transition_proof müssen recovery_generation,
  recovery_urs_commitment, Key-ID und Public Key exakt dem vollständig
  verifizierten aktuellen Recovery-State entsprechen.
- Mit recovery_authority_transition_proof darf das Artifact vor durable
  Transition zunächst den **to-State** repräsentieren, während Remote noch exakt
  am Proof-from-State/Anchor steht. In diesem Zustand ist es staged/read-only und
  ausschließlich §16c darf die vorbereitete Transition fertigstellen.
- Nach durable Transition müssen Artifact-Felder und aktueller Recovery-State
  exakt übereinstimmen; erst dann ist Forced Takeover zulässig.

salt ist exakt 32 Byte, wrap_iv exakt 12 Byte. wrapped_payload muss nach
Base64URL-Decoding mindestens 16 und höchstens 1048576 Byte enthalten.

~~~text
recovery_plaintext = UTF8(JCS(encrypted_payload))
AES-256-GCM(K_recovery, wrap_iv, recovery_plaintext, Artifact-AAD)
~~~

Artifact-AAD ist UTF8(JCS(header_ohne_wrapped_payload)).

Der im Artifact enthaltene remote_anchor ist ein **Freshness-Floor**, niemals
eine Aufforderung zum Downgrade. Bei Restore/Forced-Takeover muss der aktuell
gelesene Remotezustand jeden verfügbaren vertrauenswürdigen Anchor erweitern:
mindestens den Artifact-Anchor und, falls auf diesem Gerät vorhanden, den
neueren lokal persistierten RemoteAnchorV2. Sind zwei bekannte Anchor nicht
monoton miteinander vereinbar, gilt security_blocked. Ein älterer Artifact-
Anchor darf einen neueren lokalen Anchor niemals ersetzen.

---

## 20. SyncBackupV6

Neues geschlossenes Format "sync-backup-v6", niemals optionale Erweiterung von v5.

Top-Level exakt:

~~~text
{
  format: "sync-backup-v6",
  backup_format_version: 6,
  backup_id,
  backup_manifest_iv,
  backup_manifest_ciphertext,
  epoch_manifest_public,
  recovery_artifact,
  record_rows,
  pending_outbox_rows,
  stale_writer_pending_rows
}
~~~

epoch_manifest_public sind exakt die vier persistierten ManifestV6-Zellen.
recovery_artifact ist ein vollständiges RecoveryArtifactV6-Objekt; dessen
Ciphertext wird nicht für den Backup-Export neu erzeugt.

record_rows enthält die exakte physische Remote-Reihenfolge.
pending_outbox_rows enthält lokale aktuelle-Authority-Envelopes, die noch nicht
byteidentisch remote vorhanden sind. stale_writer_pending_rows enthält
ausschließlich quarantinierte ältere Writer-Envelopes und wird bei Restore
niemals automatisch gepusht.

ActivationLineageV2 und RecoveryAuthorityTransitionProofV2 liegen **nicht**
zusätzlich im öffentlichen Backup-Top-Level. Sie werden erst aus dem
verschlüsselten RecoveryArtifactV6 gewonnen. Das verschlüsselte Backup-Manifest
bindet ihre Hashes.

activation_state im verschlüsselten Backup-Manifest ist exakt
"staged" | "activated". "activated" ist **keine selbstbeglaubigende Aussage**.
Restore muss die Aktivierung passend zum Epoch-Ursprung erneut beweisen:
- native v2-Genesis: predecessor_epochs=[] + genesis-Grant vollständig prüfen;
- jede nicht-native v2-Epoche: activation_lineage gemäß §10c vollständig vom
  Root bis zum aktuellen Leaf prüfen;
- same-epoch recovery_rekey: zusätzlich recovery_authority_transition_proof
  gemäß §16c prüfen bzw. crash-resumable abschließen.
Ohne erfolgreiche Prüfung bleibt das Restore local_offline/read_only.

backup_manifest_iv ist exakt 12 CSPRNG-Bytes.

Backup-AAD exakt:

~~~text
UTF8(JCS({
  format: "sync-backup-v6",
  backup_format_version: 6,
  backup_id
}))

backup_manifest_plaintext = UTF8(JCS(backup_manifest))
AES-256-GCM(K_backup(backup_id), backup_manifest_iv,
            backup_manifest_plaintext, Backup-AAD)
~~~

Das verschlüsselte Backup-Manifest enthält exakt:

~~~text
{
  backup_id,
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  remote_anchor_at_export,
  writer_authority_at_export,
  recovery_generation,
  recovery_takeover_key_id,
  activation_lineage_sha256,
  recovery_authority_transition_proof_sha256,
  activation_state,
  recovery_artifact_sha256,
  record_row_count,
  record_rows_canonical_bytes,
  record_prefix_hash,
  epoch_manifest_public_sha256,
  record_rows_jcs_sha256,
  pending_outbox_count,
  pending_outbox_rows_canonical_bytes,
  pending_outbox_rows_jcs_sha256,
  stale_writer_pending_count,
  stale_writer_pending_rows_canonical_bytes,
  stale_writer_pending_rows_jcs_sha256,
  unique_union_count,
  unique_union_canonical_bytes,
  created_at
}
~~~

writer_authority_at_export ist exakt:

~~~text
{
  writer_generation,
  writer_grant_id,
  writer_device_id,
  writer_key_id,
  writer_public_key
}
~~~

activation_lineage_sha256 ist exakt
Base64URL(SHA-256(UTF8(JCS(recovery_artifact.activation_lineage)))).

recovery_authority_transition_proof_sha256 ist null, wenn
recovery_artifact.recovery_authority_transition_proof=null; ansonsten exakt
Base64URL(SHA-256(UTF8(JCS(
  recovery_artifact.recovery_authority_transition_proof
)))).

Beide Hashes müssen beim Restore nach Artifact-Entschlüsselung reproduziert
werden.

recovery_artifact_sha256 ist Base64URL(SHA-256(UTF8(JCS(recovery_artifact)))).
remote_anchor_at_export ist für ein exportierbares gebundenes v2-Profil
nicht-null und muss exakt aus record_rows reproduzierbar sein.
record_prefix_hash muss RemoteAnchorV2.prefix_hash entsprechen.
writer_authority_at_export muss der durch dieselben record_rows verifizierten
kanonischen End-Authority entsprechen. recovery_artifact.remote_anchor muss von
remote_anchor_at_export monoton umfasst werden; sonst ist das Backup ungültig.
Counts, JCS-Hashes und Bytegrenzen werden für jede Kategorie separat und für die
eindeutige Union aller Envelope-IDs geprüft. Gleiche envelope_id mit anderen Bytes ist fatal.

created_at ist exakt YYYY-MM-DDTHH:mm:ss.SSSZ.

Die v5-Grenzen bleiben für v6 unverändert: maximal 256 MiB Backup-Dokument,
100000 eindeutige Envelopes und 134217728 kanonische Bytes für die eindeutige
Union.

Test-Restore muss Manifest, RecoveryArtifactV6-Bindung, sämtliche Hashes/Counts,
RemoteAnchorV2, Writer-Authority und jede Row vollständig prüfen und anschließend
den produktiven TransferableSingleWriterV2Verifier verwenden.

- activation_state="staged" => ausschließlich local_offline/read_only Restore.
- activation_state="activated" + strukturell/kryptographisch ungültiger,
  widersprüchlicher oder gegen vorhandene Source-Historie fehlschlagender
  Aktivierungsnachweis => security_blocked/fatal; niemals still auf staged
  herabstufen.
- activation_state="activated", interne Artifact-/Lineage-Struktur gültig, aber
  mindestens eine für die transitive externe Aktivierungsprüfung benötigte
  historische Source ist momentan nicht erreichbar => optional
  local_offline/read_only Restore; niemals remote-active, bis die vollständige
  Lineageprüfung erfolgreich nachgeholt wurde.
- Ein **source-unabhängiger** Wiedergewinn von Writer-Authority aus einem Backup
  ist in v2 ausdrücklich nicht garantiert. Der obligatorische activated Backup
  garantiert Daten-/Schlüsselwiederherstellung; remote-active Writer-Recovery
  benötigt die historische Aktivierungs-Source-Kette oder eine zukünftige neue
  Protokollversion mit selbständigem Lineage-Checkpoint.

Restore darf stale_writer_pending_rows nur als Quarantäne wiederherstellen.

---

## 21. v1 -> v2 Migration

Migration ist Epoch-Rotation, keine In-place-Mutation.

Reihenfolge:

1. v1 Source full-verifizieren.
2. aktuelle v1-URS gegen das authentifizierte v1-Recovery-Commitment verifizieren;
   v1 recovery_generation unverändert in v2 übernehmen und daraus das neue
   v6-Recovery-Commitment berechnen. Ein Recovery-Rekey wird nicht still mit dem
   Profilupgrade kombiniert.
3. Source lokal einfrieren.
4. neue writer_device_id und neues Writer-Ed25519-Keypair erzeugen.
5. für die übernommene Recovery-Generation das erste
   Recovery-Takeover-Keypair erzeugen.
6. epoch_start_authority_mode="genesis_grant_required" setzen und
   epoch_start_writer_grant_id + Writer-Authority planen.
7. immutable ManifestV6 lokal erzeugen und Fingerprint bestimmen.
8. RecoveryTakeoverStagingV2 mit diesem Manifest-Fingerprint
   persistieren/readback-verifizieren; erst danach extrahierbaren temporären
   Recovery-Private-Key verwerfen und mutierendes Remote-I/O beginnen.
9. Gen-1-Grant als erste _r-Row mit authority_anchor=H0 schreiben.
10. fachliche Heads als RevisionV2 unter Gen-1-Authority schreiben/signieren.
11. Migration-Control mit migration_kind="profile_upgrade" und
    source_writer_authority=null schreiben.
12. Successor vollständig mit V2-Verifier verifizieren.
13. ProfileUpgradeActivationEntryV2 aus RK_v1, finalem v1-Source-Anchor
    und den exakt one-shot vorbereiteten v1-Rotation-Announcement-Bytes erzeugen;
    activation_lineage=[dieser Eintrag].
14. aus RecoveryTakeoverStagingV2 das finale RecoveryArtifactV6 mit finalem
    Successor-Anchor, activation_lineage und
    recovery_authority_transition_proof=null erzeugen, lokal/remote
    readback-verifizieren und staged Test-Recovery durchführen.
15. staged SyncBackupV6 erzeugen und Test-Restore als local_offline/read_only
    durchführen.
16. RecoveryTakeoverStagingV2 darf jetzt gelöscht werden.
17. exakt vorbereitetes v1 Rotation Announcement durable machen.
18. vollständige activation_lineage-Prüfung bestätigt jetzt den Successor als
    aktiviert.
19. **obligatorisch** ein neues activation_state="activated" SyncBackupV6 des
    Successors erzeugen und Test-Restore-verifizieren.
20. ActivationLineageCacheV2 persistieren/readback-verifizieren.
21. erst danach atomar auf v2 umschalten; v1 retire.

Kein v1-Client darf eine v2-Epoche als v1 interpretieren.

---

## 22. Fail-closed Klassifikation

Nicht-fatal semantisch verworfen:

~~~text
stale_writer_rejected
stale_grant_rejected
stale_recovery_transition_rejected
stale_after_seal_rejected
~~~

Fatal/security_blocked:

~~~text
invalid_signature
wrong_same_generation_authority
future_generation_without_grant
wrong_predecessor_on_candidate_current_transition
wrong_authority_anchor
manifest_genesis_mismatch
manifest_genesis_missing
recovery_generation_mismatch
recovery_key_mismatch
recovery_transition_state_mismatch
duplicate_envelope_id_with_different_bytes
iv_reuse_across_envelope_ids
rollback_against_persisted_anchor
schema_or_canonicalization_failure
~~~

Ein fataler Zustand darf nicht durch latest-wins, Timestamp, Row-Löschung oder
automatische Umsignierung repariert werden.

---

## 23. Golden Vectors vor Implementierungsfreigabe

Vor produktiver v2-Implementierung müssen feste Golden Vectors committed werden
für mindestens:

1. v6 epoch_salt.
2. K_env.
3. EnvelopeV6 AAD + Ciphertext.
4. writer_key_id.
5. Transferdescriptor-PoP-Input + Ed25519-Signatur.
6. RevisionV2-Signing-Input + Ed25519-Signatur.
7. initial WriterGrantV2.
8. Handoff WriterGrantV2 + Signatur.
9. Forced-Takeover WriterGrantV2 + Recovery-Signatur.
10. Remote Prefix H0/H1/Hn + RemoteAnchorV2.
11. historischer Grant-Anchor bei zwei konkurrierenden g+1-Claims.
12. ManifestV6 Plaintext/AAD/Fingerprint einschließlich
    epoch_start_authority_mode und protocol_limits.
13. v6 Google Account Binding + epoch_locator + recovery_family_locator +
    epoch-spezifischer recovery_artifact_locator.
14. RecoveryTakeoverStagingV2 KDF/AAD/Crash-Resume + falsche URS.
15. RecoveryArtifactV6 AAD/Payload/Keypair-Check roundtrip.
16. RecoveryActivationProofV2 Signatur + Source-Prefix-/Next-Row-Prüfung.
17. ActivationLineageV2 für native Genesis, profile_upgrade und mindestens zwei
    aufeinanderfolgende v2→v2-Rotationen.
18. RecoveryAuthorityTransitionV2 + RecoveryAuthorityTransitionProofV2:
    staged, exact completion, durable und überholter Anchor.
19. ActivationLineageCacheV2 AEAD/Readback.
20. SyncBackupV6 staged/activated Manifest/hash binding einschließlich
    activation_lineage und Recovery-Transition-Proof.

Negative Vectors:

- falsche Diary/Epoch;
- falscher writer_key_id;
- manipuliertes Public Key Byte;
- manipulierte Ed25519-Signatur;
- falscher predecessor;
- Generation-Sprung;
- gleiche Generation anderer Grant;
- alte Recovery-Generation;
- falscher Recovery-Takeover-Key;
- Versuch, ein epoch-spezifisches RecoveryArtifact mit anderen Bytes zu ersetzen;
- zwei plausible Recovery-Ressourcen desselben epoch-spezifischen Locators;
- vorbereiteter Successor ohne Source-Announcement darf bei Recovery nicht aktiv
  werden;
- Recovery-Rekey: neues URS + staged same-epoch Artifact, Transition fehlt und
  Source steht exakt am Anchor => Recovery appendet exakt vorbereitete Transition;
- Recovery-Rekey: fremde Row vor vorbereiteter Transition => neuer Recovery-State
  bleibt staged/read-only;
- Recovery mit gültigem direkten ActivationProof, aber ungültigem älteren
  ActivationLineage-Eintrag => fatal/nicht aktiv;
- Recovery-Rekey-Successor mit gültigem Announcement, aber nicht durable
  Source-RecoveryAuthorityTransitionV2 => nicht aktiv;
- manipulierte announcement_envelope-Bytes oder activation_signature;
- Proof mit stale Writer-Key, der nicht der kanonischen Source-Authority am
  gebundenen Prefix entspricht;
- falscher source_root_key in einem ActivationLineageV2-Eintrag oder
  Source-Manifest-Fingerprint;
- staged Successor darf weder Fachwrite noch Handoff noch Forced Takeover
  ausführen;
- Transferdescriptor ohne Private-Key-Possession;
- Rollback vor bereits bekannten Grant;
- stale Fachrow nach Handoff;
- konkurrierende g+1-Claims;
- Grant mit Anchor, an dessen historischem Prefix der behauptete predecessor
  nicht current war;
- Rotation-Announcement gefolgt von Fachwrite/Grant auf versiegelter Source;
- RecoveryArtifact mit älterem Anchor als lokal bereits verifiziert;
- inkompatible bekannte Recovery-/Local-Anchor;
- Crash nach Manifest-Erzeugung, aber vor finalem RecoveryArtifactV6: Resume nur
  über gültiges RecoveryTakeoverStagingV2 + URS;
- manipuliertes oder manifestfremdes RecoveryTakeoverStagingV2.

---

## 24. Implementierungsfreigabe

Nach Merge dieses Protokollprofils dürfen Implementierungs-PRs beginnen.

Reihenfolge:

1. reine v2 Typen/Validatoren/Krypto-Helper + Golden Vectors;
2. RevisionV2 + WriterSignatureV2;
3. TransferableSingleWriterV2Verifier;
4. WriterGrantStateMachine;
5. EpochLocalSecurityStateV6 + Writer-Key-Store;
6. RecoveryArtifactV6 / RecoveryTakeoverAuthorityV2;
7. SyncBackupV6;
8. v1->v2 Migration;
9. read-only Join;
10. Cooperative Handoff;
11. Forced Takeover + stale quarantine;
12. UI;
13. Live-Google Parallel-Append-Gate.

Produktive Freigabe bleibt blockiert, bis der Live-Google-Test bestätigt, dass die
beobachtete endgültige physische Row-Reihenfolge paralleler AppendCellsRequest-
Aufrufe als deterministischer Input des Verifiers verwendbar ist.

---

## 25. Nicht garantiert

v2 garantiert keine providerseitige Geräte-ACL und keine globale Freshness ohne
erhaltenen neueren Anchor/Recovery-/Backup-Beleg.

Ein kompromittiertes Altgerät mit Google-Credential kann die Provider-Ressource
weiter stören oder löschen. Es kann ohne aktuellen Writer-Key bzw. aktuelle
Recovery-Takeover-Authority jedoch keine semantisch gültige neue Authority oder
aktuelle Writer-Revision erzeugen.

Ein kopierter aktueller Writer-Private-Key ist protokollseitig dieselbe
Writer-Authority. Echte Hardware-/Anti-Cloning-Bindung ist nicht Teil von v2.
