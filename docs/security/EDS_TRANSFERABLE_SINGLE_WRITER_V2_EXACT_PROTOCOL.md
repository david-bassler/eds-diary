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
10. Private Writer-Keys werden als nicht extrahierbare CryptoKeys persistiert, soweit die Plattform dies unterstützt; dies ist keine Hardware-/Anti-Cloning-Garantie.
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

Remote-/lokale Duplikatregel: dieselbe envelope_id mit anderen **vollständigen
v2-Rowbytes einschließlich activation_token** ist fatal. Eine byte-identische
physische Retry-Duplikatrow zählt in Prefix/Bounds, wird semantisch aber nur beim
ersten Auftreten verarbeitet. Derselbe IV bei
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
~~~

Für alle neun Schema-IDs sind immutable maschinenlesbare Schema-Definitionen
gebunden; die drei neuen v2-Control-Schemas liegen als
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

Für eine Revision der aktuellen Authority erfolgt die Verifikation gegen den an
ihrer physischen Row-Position aktuellen Writer-Public-Key. Referenziert eine Row
eine bereits verifizierte ältere Authority, wird ihre Signatur stattdessen gegen
den exakt zu diesem historischen Grant gehörenden Public Key geprüft und die Row
bei Erfolg als stale_writer_rejected klassifiziert. Eine unbekannte oder
widersprüchliche Authority ist fatal.

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
  authorization.signer_key_id = recovery_takeover_key_id; Signatur mit dem im
  Manifest für die aktuelle Recovery-Generation gebundenen Recovery-Takeover-Key.
- Für jeden Grant muss record_data.recovery_generation exakt der
  manifestgebundenen Recovery-Generation dieser Epoche entsprechen.
- authority_anchor beschreibt den vollständig verifizierten **Entscheidungs-Prefix**,
  auf dessen Basis der Grant erzeugt wurde. covered_row_count darf deshalb kleiner
  als die Position unmittelbar vor der Grant-Row sein.
- Der Verifier muss authority_anchor exakt gegen Hcovered_row_count reproduzieren
  und zusätzlich beweisen, dass an diesem historischen Prefix die in
  previous_grant_id/previous_writer_generation referenzierte Authority kanonisch
  aktiv und die Source noch nicht versiegelt war.
- Ein Grant darf nur einen direkten Nachfolger dieser am Anchor gültigen Authority
  beanspruchen: writer_generation = previous_writer_generation + 1.
- Ist dieselbe predecessor-Authority an der Grant-Row weiterhin aktuell, kann der
  Grant die Authority fortschreiben.
- Ist inzwischen bereits ein anderer gültiger Nachfolgegrant kanonisch geworden,
  bleibt ein ansonsten vollständig gültiger, gegen denselben oder einen älteren
  passenden historischen Entscheidungs-Prefix erzeugter Claim
  stale_grant_rejected. Genau dadurch sind parallele g+1-Claims nicht fatal.
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

1. Bei **v1→v2** wird ein neues Ed25519-Keypair transient erzeugt.
2. Bei **recovery_rekey** wird recovery_generation exakt um 1 erhöht und ebenfalls
   ein neues Ed25519-Keypair erzeugt.
3. Bei normaler **v2→v2-Rotation** bleiben recovery_generation,
   recovery_takeover_key_id und dasselbe Takeover-Keypair unverändert. Die
   aktuelle URS wird erneut eingegeben; das Source-RecoveryArtifactV6 wird
   entschlüsselt und dessen Keypair gegen das Source-Manifest geprüft.
4. Für ein neu erzeugtes Paar: Public Key roh als 32 Byte exportieren, Private
   Key einmalig als PKCS#8 exportieren und recovery_takeover_key_id aus dem
   Public Key ableiten. Für ein fortgeführtes Paar werden dieselben Werte aus dem
   verifizierten Source-Artefakt übernommen.
5. Public Key + Key-ID der Ziel-Recovery-Generation im geschützten
   Successor-Manifest binden.
6. Vor jedem mutierenden Remote-Create/Manifest-Publish muss PKCS#8
   crash-resumable als RecoveryTakeoverStagingV2 (§9.1) URS-verschlüsselt
   persistiert und readback-verifiziert werden.
7. Plaintext-PKCS#8 und ein ggf. extrahierbarer temporärer Private Key danach aus
   dem normalen Sitzungszustand verwerfen.
8. Nach finaler Successor-Verifikation wird der exakte Source-
   Rotation-Announcement-Envelope one-shot vorbereitet und persistent
   reserviert, aber noch nicht remote appended.
9. Aus dem Staging-Material wird das endgültige RecoveryArtifactV6 erzeugt. Für
   jede nicht-native Successor-Epoche enthält es zusätzlich den in §19.1
   definierten RecoveryActivationProofV2 mit Source-RK, letztem verifizierten
   Source-Anchor und exakt den vorbereiteten Announcement-Envelope-Bytes.
10. RecoveryArtifactV6 wird lokal und remote bytegenau readback-verifiziert,
    bevor das Source-Announcement appended werden darf.
11. Danach werden genau die im Activation Proof gebundenen
    Announcement-Envelope-Bytes appended und die Source vollständig
    readback-verifiziert.
12. Erst wenn dieses Announcement vom Source-Verifier als kanonisch gültiges
    Rotation-Announcement auf genau den gebundenen Successor akzeptiert wurde,
    ist das RecoveryArtifactV6 aktiviert.
13. Danach wird ein kanonisches SyncBackupV6 erzeugt und per Test-Restore
    einschließlich Activation Proof geprüft. Erst nach diesem Gate darf
    RecoveryTakeoverStagingV2 gelöscht werden.
14. Ein späterer Forced Takeover decryptet ausschließlich ein aktiviertes
    RecoveryArtifactV6 nach erneuter URS-Eingabe und importiert PKCS#8 für diese
    Ceremony als extractable=false, usage=["sign"].
15. Diese importierte Capability wird nach Readback/Abschluss verworfen.

Der normale lokale Writer-State enthält niemals recovery_takeover_private_key,
PKCS#8 oder eine dauerhaft nutzbare Recovery-Takeover-Capability. Außerhalb des
finalen RecoveryArtifactV6 darf PKCS#8 nur im nachfolgend exakt definierten,
URS-verschlüsselten und operationsgebundenen Crash-Resume-Staging vorkommen.

Ist URS bzw. das aktuelle RecoveryArtifactV6 kompromittiert, ist Forced Takeover
für diese Recovery-Generation kompromittiert. recovery_rekey muss daher ein neues
Takeover-Keypair erzeugen.

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
  max_canonical_row_bytes: 21982
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
über AppendCellsRequest.

Abweichend vom eingefrorenen v1 besitzt jede physische v2-_r-Row **exakt vier**
String-Zellen:

~~~text
[envelope_id, iv, ciphertext, activation_token]
~~~

activation_token ist normalerweise exakt der leere String. Ausschließlich bei
einem recovery_rekey-Rotation-Announcement ist er Base64URL eines 32-Byte-
CSPRNG-Aktivierungssecrets gemäß §19.1. Andere nichtleere Werte sind
security_blocked. Ein v1-Row bleibt unverändert ein Tripel.

Create/Reconciliation und Unknown-Create-Outcome folgen
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
   URS-Familie discovern; jede Ressource strikt prüfen und mit URS entschlüsseln.
2. Für jedes kryptographisch gültige Artifact den zugehörigen v6 Epoch-Remote
   discovern und dessen Successor-Manifest/Remote vollständig verifizieren.
3. Native v2-Genesis mit activation_proof=null ist nach erfolgreicher
   Manifest-/Remote-/Recovery-Prüfung direkt recovery-fähig.
4. Jede Nicht-Genesis-Epoche ist nur recovery-fähig, wenn ihr
   RecoveryActivationProofV2 gemäß §19.1 erfolgreich ist. Die Source darf dabei
   außerhalb der aktuellen recovery_family_locator-Familie liegen; insbesondere
   nach recovery_rekey wird sie über die im Proof enthaltene Source-Identität
   und den jeweiligen v5/v6 Epoch-Locator gefunden.
5. Ein vorbereiteter Successor ohne erfolgreichen Activation Proof bleibt
   unactivated und wird niemals aufgrund von Existenz, predecessor_epochs,
   Timestamp oder Dateireihenfolge ausgewählt.
6. Aus allen erfolgreich aktivierten Kandidaten muss genau eine kanonische,
   nicht durch einen weiteren erfolgreich aktivierten Successor abgelöste
   Leaf-Epoche resultieren. Mehrere inkompatible aktivierte Leaves =>
   ambiguous/security stop.
7. Zeigt eine mit der eingegebenen **alten** URS recovery-fähige Source ein
   kanonisches Announcement auf einen Successor, dessen RecoveryArtifact mit
   dieser URS nicht entschlüsselbar ist, ist die alte Recovery-Authority
   superseded: fail-closed, niemals die versiegelte Source als aktuellen Stand
   zurückgeben. Genau so wird recovery_rekey gegenüber der alten URS wirksam.
8. Beim v1→v2-profile_upgrade bleibt die v1-Source bis zum durable v1
   rotation-announcement kanonisch. Danach muss eine aktuelle Implementierung
   dem Announcement auf den v2-Successor folgen; die eingefrorene v1-Source darf
   nicht als aktives Tagebuch zurückgegeben werden.

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

row_jcs ist JCS des exakten v2-String-Quadrupels
[envelope_id, iv, ciphertext, activation_token].

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
current_recovery_takeover_key_id
source_epoch_sealed
genesis_grant_confirmation_required
accepted_revision_graph
authority_history_by_prefix

~~~

Initialisierung:

- source_epoch_sealed=false.
- authority_history_by_prefix[0] enthält die manifestgebundene
  Epoch-Start-Authority und unsealed.
- current_recovery_generation und current_recovery_takeover_key_id stammen exakt
  aus dem Manifest und ändern sich innerhalb derselben Epoche nicht.
- genesis_grant_confirmation_required ist genau dann true, wenn
  epoch_start_authority_mode="genesis_grant_required".

Pro Row:

1. Grid-/Bounds-/Base64URL-/Envelope-AEAD vollständig prüfen. Gleiche
   envelope_id + andere Bytes => security_blocked. Byte-identische spätere
   Retry-Duplikate zählen physisch, sind aber semantische No-ops und springen
   direkt zu Schritt 7/8.
2. Wrapper als exaktes RevisionV2 validieren.
3. Vor jedem Typ-Dispatch: falls genesis_grant_confirmation_required=true, ist
   ausschließlich der exakte manifestgebundene Gen-1-writer-grant-sw-v2 mit
   authority_anchor=H0 und covered_row_count=0 zulässig. Jede andere erste
   semantische Row => manifest_genesis_mismatch/security_blocked. Nach
   erfolgreicher Bestätigung wird das Flag irreversibel gelöscht.
4. Bei writer-grant-sw-v2:
   - falls source_epoch_sealed=true: einen sonst vollständig wohlgeformten Grant
     als stale_after_seal_rejected behandeln; malformed/kryptographisch ungültige
     Rows bleiben security_blocked;
   - authority_anchor gegen den historischen Prefix und die dortige
     authority_history_by_prefix prüfen, nicht zwingend gegen rowIndex-1;
   - Handoff gegen den am Anchor gültigen predecessor Writer-Key;
   - Forced Takeover gegen die manifestgebundene aktuelle
     Recovery-Takeover-Authority;
   - ist der predecessor an der aktuellen Row weiterhin current, bei gültigem
     direkten Nachfolger Authority fortschreiben;
   - ist der Candidate relativ zu seinem historischen Anchor vollständig gültig,
     aber seine Generation inzwischen bereits durch einen anderen gültigen
     Nachfolger erreicht/überschritten, => stale_grant_rejected;
   - Zukunftsgeneration, falsche historische Vorgängerbindung, falscher Anchor
     oder ungültige Autorisierung => security_blocked.
5. Bei normaler Revision:
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
   - für alle nicht-Rotation-Revisionen muss activation_token exakt "" sein;
   - bei rotation-announcement-sw-v2 müssen successor_recovery_generation,
     recovery_activation_commitment und activation_token exakt §16a/§19.1
     erfüllen; insbesondere ist ein nichtleerer Token nur für recovery_rekey
     zulässig;
   - ein gültiges rotation-announcement-sw-v2 der current authority setzt
     source_epoch_sealed irreversibel auf true.
6. Nur akzeptierte Fachrevisionen gehen in den fachlichen Graphen.
7. Jede physische Row geht unabhängig von semantischer Annahme in Prefix-Hash
   und Bounds ein.
8. Nach jeder Row wird der kanonische Authority-/Seal-Zustand für den neuen
   Prefix in authority_history_by_prefix festgehalten.

EOF-Regel: genesis_grant_confirmation_required muss nach Verarbeitung aller Rows
false sein. Ein leeres oder vor dem manifestgebundenen Gen-1-Grant endendes
genesis_grant_required-Log ist manifest_genesis_mismatch/security_blocked.

Ein Root-Key-besitzendes stale Gerät kann neue Ciphertexte erzeugen, aber ohne
aktuellen Writer-Key weder aktuelle Fachrevisionen noch einen Handoff-Grant
authentisieren.

---

## 13. Schreibfreigabe / Freshness

Ein Gerät darf RevisionV2 erst persistent erzeugen, wenn innerhalb desselben
Write-Vorgangs:

1. lokales Unlock gemäß dem konfigurierten RootWrapV6-Modus erfolgreich ist;
   Best-Effort bleibt dabei ausdrücklich eine schwächere At-rest-Grenze, ist aber
   kein eigenes Writer-Authority-Kriterium;
2. authentifizierte Provider-Session aktiv ist;
3. Remote vollständig neu gelesen und gegen den persistierten RemoteAnchorV2
   verifiziert wurde;
4. source_epoch_sealed=false ist;
5. verifizierte current authority exakt zum lokalen Device-Key passt;
6. lokaler Status writer_active ist.

Es gibt im strikten v2 **kein zeitbasiertes Offline-Lease und kein
Freshness-Intervall**.

Nach Signatur/Verschlüsselung wird das exakte Envelope persistent vorbereitet.
Unmittelbar vor Append erfolgt ein zweiter Full Verify. Nur wenn Authority
unverändert und Source weiterhin unsealed ist, dürfen exakt diese vorbereiteten
Bytes gesendet werden. Andernfalls werden sie ohne Append als
stale_writer_pending quarantiniert. Nach Append folgt vollständiger Readback;
eine zwischen Prepare und Readback verlorene Authority macht die Row semantisch
stale und sie wird niemals automatisch neu signiert oder unter der neuen
Generation erzeugt.

---

## 14. Unknown Outcome – Grant und Fachwrite

Vor jedem Remote-Append werden exakte Envelope-Bytes persistent gespeichert.

Bei Timeout/unklarem Ergebnis:

1. niemals semantisch neuen Grant oder neue Revision erzeugen;
2. Remote vollständig lesen;
3. gleiche envelope_id + gleiche Bytes => dieses konkrete Envelope existiert;
4. gleiche envelope_id + andere Bytes => fatal;
5. fehlt das Envelope und Authority ist unverändert und
   source_epoch_sealed=false => exakt dieselben Bytes erneut appendieren;
6. fehlt das Envelope und Authority sich geändert hat oder
   source_epoch_sealed=true => nicht erneut appendieren; als
   stale_writer_pending bzw. stale_grant_attempt quarantinieren.

Ein HTTP-200 ohne finalen Full Readback ist niemals durable.

---

## 15. Cooperative Handoff A -> B

Voraussetzungen:

- A ist nach frischem Full Verify current writer.
- B ist vollständig verifiziert read_only derselben Diary/Epoch.
- A hat keine nicht-durablen eigenen Pending-Envelopes.
- A verifiziert TransferdescriptorV2 von B.

A full-verifiziert, erzeugt und signiert danach exakt einen Grant g+1,
verschlüsselt ihn one-shot und persistiert die exakten Envelope-Bytes.
Unmittelbar vor Append erfolgt erneut ein Full Verify; nur wenn dieselbe
predecessor-Authority weiterhin current und source_epoch_sealed=false ist,
appendet A exakt diese bereits persistierten Bytes und liest vollständig zurück.
Andernfalls wird der vorbereitete Grant nicht appended und als
stale_grant_attempt quarantiniert.

A persistiert read_only erst, wenn derselbe Grant kanonisch akzeptiert wurde.

B persistiert writer_active erst nach eigenem Full Verify und nur wenn Device-ID,
Key-ID und Public Key des kanonischen Grants exakt zu Bs lokalem Private Key
gehören.

---

## 16. Forced Takeover

Ein read-only Gerät muss URS erneut erhalten. Danach:

1. RecoveryArtifactV6 decrypten und vollständig binden.
2. Recovery-Generation muss zum verifizierten Manifest passen.
3. recovery_takeover_key_id und Public Key müssen zum Manifest passen.
4. PKCS#8 transient als non-extractable Ed25519 signing key importieren und den
   §19-Keypair-Check bestehen.
5. Remote erneut vollständig verifizieren und beweisen, dass der gelesene Prefix
   **alle** verfügbaren vertrauenswürdigen Freshness-Floors erweitert
   (Artifact-Anchor, lokaler Anchor, ggf. Backup-Anchor). Kein Anchor-Downgrade.
   Zusätzlich muss source_epoch_sealed=false sein.
6. Grant g+1 reason="forced_takeover" gegen genau diesen frisch verifizierten
   Entscheidungs-Prefix erzeugen.
7. Grant-Signing-Input mit Recovery-Takeover-Key signieren, one-shot
   verschlüsseln und exakte Envelope-Bytes persistent vorbereiten.
8. Unmittelbar vor Append erneut Full Verify: predecessor-Authority muss
   unverändert current und Source unsealed sein. Sonst kein Append und
   stale_grant_attempt.
9. Exakt die vorbereiteten Bytes appendieren + Full Readback.
10. writer_active nur bei kanonisch akzeptiertem eigenen Grant.
11. Recovery signing capability aus normalem Sitzungszustand verwerfen.

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
rotation_kind = "normal"
source_writer_generation
source_writer_grant_id
successor_recovery_generation
recovery_activation_commitment
~~~

source_writer_generation und source_writer_grant_id müssen dem writer_context
der Control-Revision entsprechen.

successor_recovery_generation ist für dieses v2-Control exakt:
- bei normaler v2→v2-Rotation gleich der Source-recovery_generation;
- bei recovery_rekey exakt Source-recovery_generation + 1.

recovery_activation_commitment ist:
- bei normaler v2→v2-Rotation exakt null und die vierte physische Row-Zelle
  activation_token ist exakt "";
- bei recovery_rekey exakt der §19.1-Commitmentwert und activation_token ist
  exakt das zugehörige 32-Byte-Aktivierungssecret als Base64URL.

Das eingefrorene v1 rotation-announcement-sw-v1 besitzt dieses Feld ausdrücklich
nicht; beim v1→v2-profile_upgrade wird die übernommene Recovery-Generation daher
über v1-Recovery-Commitment + Successor-Manifest geprüft, ohne das v1-Wireformat
zu verändern.

Das Feld bezeichnet ausschließlich die Recovery-Generation des gebundenen
v2-Successors; eine mehrdeutige nackte recovery_generation im v2-Announcement
ist verboten.

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

Remote-Reihenfolge auf der Source entscheidet:

- gültiger Writer-Takeover-Grant vor Rotation-Announcement => Announcement des
  alten Writers ist stale/ungültig;
- gültiges Rotation-Announcement zuerst => Source ist ab dieser Row versiegelt;
  spätere Fachwrites und Writer-Grants auf Source sind semantisch verworfen;
  weitere Takeover-Aktionen müssen gegen den kanonischen Successor erfolgen.

Normale v2→v2-Rotation erhält recovery_generation und das aktuelle
Recovery-Takeover-Keypair unverändert, erzeugt aber für die neue Epoche ein neues
RecoveryArtifactV6 mit neuem RK_epoch, Manifest-Fingerprint und finalem
Successor-Anchor.

Recovery-Rekey erzeugt zwingend:

- recovery_generation + 1;
- neue URS-Bindung;
- neues Recovery-Takeover-Ed25519-Keypair;
- neues RecoveryArtifactV6;
- Manifestbindung im Successor.

Altes Recovery-Takeover-Material darf in der neuen Recovery-Generation keinen
Grant signieren.

### 17.1 Exakter v2→v2-Rotationsablauf

Für sowohl normale Rotation als auch recovery_rekey gilt:

1. Source vollständig verifizieren; current Writer muss zum lokalen Writer-Key
   passen, Source muss unsealed sein und es dürfen keine nicht-durablen eigenen
   Pending-Envelopes verbleiben.
2. Successor planen. Bei normaler Rotation Recovery-Generation/Takeover-Keypair
   unverändert übernehmen; bei recovery_rekey neue URS, Generation+1 und neues
   Takeover-Keypair verwenden.
3. Successor-Manifest one-shot erzeugen, RecoveryTakeoverStagingV2 sichern und
   Successor-Remote erstellen.
4. Fach-Heads und epoch-migration-sw-v2 unter der fortgeführten Writer-Authority
   schreiben; Successor vollständig verifizieren.
5. Source erneut vollständig verifizieren. Der fachliche
   source_semantic_snapshot_hash und die kanonische Source-Writer-Authority
   müssen exakt dem bereits im Successor akzeptierten
   epoch-migration-sw-v2 entsprechen. Nur dann den exakten
   rotation-announcement-sw-v2-Envelope one-shot vorbereiten und persistent
   reservieren, aber noch nicht appendieren. Der zu diesem Zeitpunkt verifizierte
   physische Anchor wird source_anchor_before im Activation Proof; sein
   successor_recovery_generation muss §16a erfüllen.
6. Finales RecoveryArtifactV6 des Successors erzeugen. Sein
   RecoveryActivationProofV2 enthält source_root_key, den in Schritt 1
   verifizierten Source-Anchor und exakt die in Schritt 5 reservierten
   Announcement-Envelope-Bytes. Artifact remote publishen und bytegenau
   readback-verifizieren.
7. Source unmittelbar vor Append erneut vollständig verifizieren. Nur wenn
   dieselbe Writer-Authority weiterhin current, Source weiterhin unsealed und
   der fachliche source_semantic_snapshot_hash weiterhin exakt dem
   Successor-Migration-Control entspricht, exakt die reservierten
   Announcement-Bytes appendieren. Zusätzliche physische Rows sind nur zulässig,
   wenn sie semantisch stale/no-op sind und diesen Snapshot nicht verändern.
   Andernfalls Artifact/Successor unactivated/orphaned lassen und nicht
   automatisch neu erzeugen.
8. Source vollständig readback-verifizieren. Die konkrete Announcement-Row muss
   kanonisch akzeptiert sein und §19.1 muss RecoveryArtifactV6 als activated
   bestätigen.
9. Erst jetzt kanonisches SyncBackupV6 mit activation_source_snapshot erzeugen
   und vollständigen Test-Restore durchführen.
10. RecoveryTakeoverStagingV2 löschen und lokal atomar auf den Successor
    umschalten.

Crash/Unknown-Outcome-Regel: In Schritten 5–8 werden niemals neue semantische
Announcement-Bytes erzeugt. Ist das exakte Envelope remote vorhanden, entscheidet
Full Readback. Fehlt es und Source ist weiterhin unsealed unter derselben
Authority, dürfen exakt dieselben Bytes erneut appended werden. Andernfalls
bleibt der vorbereitete Successor unactivated.

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

recovery_takeover_key_id ist nach Manifestverifikation nicht-null und muss exakt
zum Manifest passen. stale_writer_pending_count und operation_generation sind
nichtnegative Safe-Integer.

rotation_state_ref und migration_state_ref verwenden dieselbe geschlossene
{operation_id,state,state_record_hash}-Form wie v1.

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

Die gemeinsame RootWrap-Verschlüsselung ist exakt:

~~~text
plaintext = RK_epoch
iv        = wrap_iv
aad       = AAD
tagLength = 128

K_wrap =
  best-effort -> lokaler non-extractable AES-256-GCM CryptoKey
  prf         -> K_local_prf
  passphrase  -> K_local_passphrase

wrapped_root_key =
  AES-256-GCM-ENCRYPT(key=K_wrap, iv=wrap_iv,
                      plaintext=RK_epoch, aad=AAD, tagLength=128)
~~~

Öffnen verwendet exakt dieselben Parameter mit AES-256-GCM-DECRYPT und muss
exakt 32 Plaintext-Bytes ergeben; jede andere Länge ist fatal.

Best-Effort: mode_metadata={}, eigener non-extractable AES-256-GCM CryptoKey im
Browserprofil.

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
recovery_takeover_key_id
recovery_takeover_public_key
recovery_takeover_private_key_pkcs8
activation_proof
created_at
~~~

activation_proof ist:
- bei echter nativer v2-Genesis mit predecessor_epochs=[] exakt null;
- bei v1→v2 sowie jeder v2→v2-Rotation/recovery_rekey exakt ein
  RecoveryActivationProofV2 gemäß §19.1.

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
Ed25519.verify(recovery_takeover_public_key_from_ProtectedManifestV6,
               signature, key_check_input) == true
~~~

Zusätzlich müssen recovery_takeover_key_id und Public Key aus dem Artifact exakt
den manifestgebundenen Werten entsprechen.

salt ist exakt 32 Byte, wrap_iv exakt 12 Byte. wrapped_payload muss nach
Base64URL-Decoding mindestens 16 und höchstens 65536 Byte enthalten.

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

### 19.1 RecoveryActivationProofV2

Zweck: Ein unter einer neuen URS bereits vor dem Source-Announcement publiziertes
Successor-RecoveryArtifact darf erst dann Recovery-Trust-Root werden, wenn genau
der vorbereitete Source→Successor-Übergang tatsächlich remote kanonisch wurde.
Das löst insbesondere recovery_rekey ohne späteren Besitz der alten URS.

Exakt:

~~~text
{
  version: 2,
  source_sync_profile,
  source_epoch_id,
  source_manifest_fingerprint,
  source_root_key,
  source_anchor_before,
  expected_announcement_envelope: {
    envelope_id,
    iv,
    ciphertext
  },
  successor_epoch_id,
  successor_manifest_fingerprint
}
~~~

Regeln:

- source_sync_profile ist exakt
  "google-sheets-single-writer-v1" oder
  "google-sheets-transferable-single-writer-v2".
- source_epoch_id/source_manifest_fingerprint müssen exakt dem einzigen
  predecessor_epochs-Eintrag des Successor-Manifests entsprechen.
- source_root_key ist Base64URL von exakt 32 Byte und liegt nur innerhalb des
  URS-verschlüsselten RecoveryArtifactV6/Backups. Es ist keine
  Writer-/Takeover-Signierauthority.
- source_anchor_before ist RemoteAnchorV1 bzw. RemoteAnchorV2 passend zum
  source_sync_profile und muss der unmittelbar vor Vorbereitung des
  Announcement-Envelopes vollständig verifizierte Source-Anchor sein.
- expected_announcement_envelope enthält exakt die one-shot reservierten
  [envelope_id,iv,ciphertext]-Bytes des vorbereiteten Rotation-Announcements.
- successor_epoch_id und successor_manifest_fingerprint müssen exakt zum
  entschlüsselten RecoveryArtifact/ProtectedManifestV6 passen.

Aktivierungsprüfung nach Eingabe der neuen URS:

1. RecoveryArtifactV6 AEAD, Manifestbindung, Account-Binding und Keypair-Check
   vollständig prüfen.
2. Source anhand source_sync_profile + diary_id + source_epoch_id über den
   jeweiligen v5/v6 Epoch-Locator authentifiziert discovern.
3. Source-Manifest mit source_root_key decrypten; Diary-ID, Epoch-ID,
   Manifest-Fingerprint, Google-Account-Binding und Profil müssen exakt passen.
4. In den gelesenen Source-Rows die erste byteidentische
   expected_announcement_envelope-Row nach source_anchor_before bestimmen. Fehlt
   sie, ist der Proof unactivated.
5. Den zum source_sync_profile gehörenden produktiven Full Verifier auf dem
   **Prefix bis einschließlich genau dieser Row** verwenden.
   source_anchor_before ist dabei ein verpflichtender Freshness-Floor; der
   geprüfte Prefix muss ihn erweitern. Rows nach der Activation-Row sind für
   diesen Aktivierungsbeweis nicht erforderlich und können dessen Erfolg nicht
   nachträglich aufheben.
6. expected_announcement_envelope muss an der so bestimmten Position
   byteidentisch vorliegen.
7. Unmittelbar vor dieser konkreten Row muss der vom Source-Verifier berechnete
   fachliche Semantic-Snapshot-Hash exakt dem source_semantic_snapshot_hash des
   im Successor akzeptierten epoch-migration-sw-v2 entsprechen. Bei v2-Source
   muss außerdem die zu diesem Zeitpunkt current Writer-Authority exakt
   source_writer_authority dieses Migration-Controls entsprechen. Dadurch kann
   keine nach dem Kopieren hinzugekommene gültige Fachrevision verloren gehen.
8. Diese konkrete Row muss vom Source-Verifier als der kanonisch gültige
   Rotation-Announcement-Control akzeptiert werden; bloße physische Existenz,
   stale_writer_rejected, stale_after_seal_rejected oder ein konkurrierendes
   Announcement genügen nicht.
9. Das entschlüsselte Announcement muss exakt successor_epoch_id und
   successor_manifest_fingerprint des RecoveryArtifacts/Successor-Manifests
   binden. Bei source_sync_profile =
   "google-sheets-transferable-single-writer-v2" muss zusätzlich
   successor_recovery_generation exakt der Recovery-Generation des
   Successor-Manifests entsprechen. Beim eingefrorenen v1-Announcement existiert
   dieses Feld nicht; dort wird die übernommene Generation separat über
   v1-Recovery-Commitment und Successor-Manifest gebunden.
10. Nur dann ist das RecoveryArtifactV6 aktiviert. Fehlt die Row, änderte sich
   der fachliche Source-Snapshot, gewann vorher eine andere Authority/Rotation
   oder wurde die Source zurückgerollt, bleibt das Artifact unactivated und darf
   weder als aktueller Diary-Trust-Root noch für Forced Takeover verwendet
   werden.

Unknown Outcome:
- RecoveryArtifact darf vor dem Announcement bereits durable existieren.
- Bei Crash/Timeout wird kein neues Announcement erzeugt.
- Ist die Source noch unsealed und dieselbe Writer-Authority current, werden
  exakt dieselben vorbereiteten Announcement-Envelope-Bytes erneut appended.
- Ist Authority/Seal-Zustand verändert, bleibt das RecoveryArtifact dauerhaft
  unactivated/orphaned; kein automatischer Ersatzsuccessor unter derselben
  Artifact-Identität.

Die Mitnahme des direkten source_root_key bedeutet bewusst, dass die neue
Recovery-Authority auch den direkten Vorgänger entschlüsseln kann. Die alte
Recovery-Authority erhält umgekehrt keinen Successor-RK und kann die neue Epoche
nach recovery_rekey nicht aus dem alten Artifact ableiten.

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
  activation_source_snapshot,
  record_rows,
  pending_outbox_rows,
  stale_writer_pending_rows
}
~~~

epoch_manifest_public sind exakt die vier persistierten ManifestV6-Zellen.
recovery_artifact ist ein vollständiges RecoveryArtifactV6-Objekt; dessen
Ciphertext wird nicht für den Backup-Export neu erzeugt.

activation_source_snapshot ist:
- bei nativer v2-Genesis exakt null;
- sonst exakt
  { source_manifest_public, source_record_rows_through_activation }.
  source_manifest_public enthält die exakten öffentlichen Manifestzellen der
  Source; source_record_rows_through_activation enthält die exakte physische
  Source-Reihenfolge mindestens bis einschließlich der im
  RecoveryActivationProofV2 gebundenen Announcement-Row.

record_rows enthält die exakte physische Remote-Reihenfolge des Successors.
pending_outbox_rows enthält lokale aktuelle-Authority-Envelopes, die noch nicht
byteidentisch remote vorhanden sind. stale_writer_pending_rows enthält
ausschließlich quarantinierte ältere Writer-Envelopes und wird bei Restore
niemals automatisch gepusht.

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
  recovery_artifact_sha256,
  activation_source_snapshot_sha256,
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

recovery_artifact_sha256 ist Base64URL(SHA-256(UTF8(JCS(recovery_artifact)))).
activation_source_snapshot_sha256 ist bei nativer Genesis null, sonst
Base64URL(SHA-256(UTF8(JCS(activation_source_snapshot)))).

Ein kanonisch exportierbares SyncBackupV6 darf erst nach erfolgreicher
§19.1-Aktivierungsprüfung erzeugt werden. Für Nicht-Genesis muss sein
activation_source_snapshot denselben RecoveryActivationProofV2 offline
reproduzierbar verifizieren. Ein vor Source-Announcement erzeugter
Successor-Testdump ist ausdrücklich kein SyncBackupV6 und darf nicht als
Recovery-Backup exportiert/importiert werden.

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
den produktiven TransferableSingleWriterV2Verifier verwenden. Für Nicht-Genesis
muss zusätzlich RecoveryActivationProofV2 offline gegen
activation_source_snapshot mit dem jeweiligen produktiven v1/v2-Source-Verifier
erfolgreich sein. Restore darf stale_writer_pending_rows nur als Quarantäne
wiederherstellen.

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
13. v1 Source erneut vollständig verifizieren. Der fachliche
    source_semantic_snapshot_hash muss weiterhin exakt dem im Successor
    akzeptierten profile_upgrade-Migration-Control entsprechen. Erst dann den
    exakten v1 Rotation-Announcement-Envelope one-shot vorbereiten und persistent
    reservieren, aber noch nicht appendieren; der aktuelle Source-Anchor wird
    source_anchor_before im RecoveryActivationProofV2.
14. aus RecoveryTakeoverStagingV2 das finale RecoveryArtifactV6 erzeugen; sein
    RecoveryActivationProofV2 enthält den v1-Source-RK, den final verifizierten
    Source-Anchor vor Announcement und exakt die in Schritt 13 reservierten
    Announcement-Envelope-Bytes. Artifact lokal/remote readback-verifizieren.
15. unmittelbar vor Append v1 Source noch einmal vollständig verifizieren; der
    fachliche Semantic-Snapshot muss weiterhin unverändert sein. Nur dann genau
    diese v1 Rotation-Announcement-Bytes appendieren und Source vollständig
    readback-verifizieren; §19.1 muss aktiviert ergeben.
16. erst jetzt SyncBackupV6 einschließlich activation_source_snapshot erzeugen
    und Test-Restore durchführen.
17. RecoveryTakeoverStagingV2 darf jetzt gelöscht werden.
18. atomar auf v2 umschalten; v1 retire.

Kein v1-Client darf eine v2-Epoche als v1 interpretieren.

---

## 22. Fail-closed Klassifikation

Nicht-fatal semantisch verworfen:

~~~text
stale_writer_rejected
stale_grant_rejected
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
recovery_generation_mismatch
recovery_key_mismatch
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
16. RecoveryActivationProofV2 für v1→v2, normale v2-Rotation und
    recovery_rekey einschließlich exakter Announcement-Envelope-Bytes.
17. SyncBackupV6 vollständiges Manifest/hash binding einschließlich
    activation_source_snapshot.

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
- RecoveryActivationProof mit physisch vorhandener, aber stale/verworfener
  Announcement-Row;
- RecoveryActivationProof mit falschem Source-RK, Source-Manifest-Fingerprint,
  Source-Anchor oder anderen Announcement-Bytes;
- gültige Fachrevision zwischen Successor-Kopie und Source-Announcement =>
  Successor bleibt unactivated; stale/no-op physische Row darf den fachlichen
  Snapshot dagegen nicht verändern;
- recovery_rekey: Recovery nur mit neuer URS und ohne alte URS muss nach
  durablem Announcement funktionieren; vor Announcement muss dieselbe neue URS
  den Successor als unactivated ablehnen;
- Gen-1-Manifest ohne Gen-1-Grant, Fachrow vor Gen-1-Grant und EOF vor
  Gen-1-Grant => security_blocked;
- Retry/Handoff/Forced-Takeover nach Source-Seal => kein Append;
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
