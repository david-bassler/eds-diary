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

Die Begründung sicherheitsrelevanter Designentscheidungen, verworfener Alternativen
und der Bedingungen für eine spätere Neubewertung steht im begleitenden
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_DECISIONS.md`. Eine spätere Änderung einer
dort protokollierten Entscheidung muss diesen Ledger ausdrücklich aktualisieren;
dadurch soll erkennbar bleiben, ob ein Review eine neue Annahme findet oder nur
eine bereits verworfene Alternative erneut einführt.

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
cache_id                 16 CSPRNG bytes
recovery_artifact_id     16 CSPRNG bytes
creation_locator         16 CSPRNG bytes

envelope_id              32 CSPRNG bytes
revision_id              32 CSPRNG bytes
grant_id                 32 CSPRNG bytes
rotation_id              32 CSPRNG bytes
migration_id             32 CSPRNG bytes
transition_id            32 CSPRNG bytes
confirmation_id          32 CSPRNG bytes
operation_id             32 CSPRNG bytes
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

Alle oben als CSPRNG markierten IDs werden unabhängig mit einem
kryptographisch sicheren Zufallszahlengenerator erzeugt und als kanonisches
Base64URL ohne "=" serialisiert.
 `grant_id` ist der erzeugte Identifier im
WriterGrantV2-Payload; Felder namens `writer_grant_id` referenzieren exakt
diesen `grant_id` und sind **kein eigener ID-Typ**. `operation_id` ist ausschließlich lokale
Crash-/Resume-Identität, besitzt aber dieselbe 32-Byte-CSPRNG-Regel. Der Name
`cache_id` ist der einzige normative Feldname für den
ActivationLineageCacheV2-Identifier; `activation_lineage_cache_id` ist kein
separates Protokollfeld.

recovery_takeover_key_id analog:

~~~text
recovery_takeover_key_id =
Base64URL(SHA-256(
  UTF8("eds-diary/recovery-takeover-key-id/v2") || 0x00 ||
  raw_ed25519_public_key
))
~~~

Der Recovery-Secret-Identifier ist absichtlich **generationsunabhängig**:

~~~text
recovery_urs_id =
Base64URL(SHA-256(
  UTF8("eds-diary/recovery-urs-id/v2") || 0x00 || URS
))
~~~

`recovery_urs_id` ist kein Ersatz für `recovery_urs_commitment`: Der
Commitment bleibt diary-/generationsgebunden und beweist die konkrete aktuelle
Recovery-Generation; der stabile Identifier dient ausschließlich dazu, die
Wiederverwendung eines früheren 32-Byte-URS ab der ersten v2-Aktivierung
erkennen und fail-closed ablehnen zu können. Wegen 256 Bit CSPRNG-Entropie des
URS ist der öffentlich gebundene Hash keine praktisch nutzbare
Offline-Wörterbuchoberfläche.

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
successor-activation-confirmation-sw-v2
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
successor_activation_confirmation -> successor-activation-confirmation-sw-v2
~~~

Für alle elf Schema-IDs sind immutable maschinenlesbare Schema-Definitionen
gebunden; die fünf neuen v2-Control-Schemas liegen als
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
- Für **jeden** Grant muss writer_key_id aus writer_public_key exakt gemäß §2
  reproduzierbar sein. Mismatch => security_blocked.
- grant_id liegt mit rotation_id, migration_id, transition_id und confirmation_id
  in einem **gemeinsamen epochweiten semantischen Control-ID-Namespace**. Ein
  bereits unter irgendeinem dieser Feldtypen belegter Bytewert darf nicht erneut
  verwendet werden; Wiederverwendung => protocol_id_collision /
  security_blocked. Bei carried_from_predecessor gilt die manifestgebundene
  epoch_start_writer_grant_id bereits als belegt; bei genesis_grant_required ist
  ausschließlich die einmalige manifestgebundene Gen-1-Bestätigungsrow die
  erlaubte Realisierung dieser Vorreservierung.
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
PKCS#8 oder eine dauerhaft nutzbare Recovery-Takeover-Capability. Persistiert
darf PKCS#8 außerhalb des finalen RecoveryArtifactV6 ausschließlich im
nachfolgend exakt definierten, URS-verschlüsselten und operationsgebundenen
Crash-Resume-Staging vorkommen. Flüchtig im Arbeitsspeicher darf es nur während
einer expliziten, bereits authentifizierten Recovery-/Forced-Takeover- oder
Rotation-Ceremony nach erfolgreichem Artifact-/Keypair-Check existieren und muss
unmittelbar danach verworfen werden.

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
creation_locator
recovery_generation
recovery_urs_commitment
recovery_urs_id
recovery_credential_history
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

`creation_locator` ist exakt der vor dem Remote-Create erzeugte 16-Byte-
CSPRNG-Wert aus §10a. Er ist Bestandteil der geschützten Manifestbytes und
damit des Manifest-Fingerprints; nach Manifest-Erzeugung ist er immutable.

Die Recovery-Felder `recovery_generation`, `recovery_urs_commitment`,
`recovery_urs_id`, `recovery_takeover_key_id` und
`recovery_takeover_public_key` sind der **Recovery-Startzustand dieser
Epoche**. Sie bleiben als Manifestbytes immutable, können aber im laufenden
Verifier-State durch RecoveryAuthorityTransitionV2 fortgeschrieben werden.

`recovery_credential_history` ist eine geordnete, nicht leere Liste mit exakt:

~~~text
{
  recovery_generation,
  recovery_urs_id,
  recovery_takeover_key_id
}
~~~

Sie enthält alle seit der **ersten v2-Aktivierung dieses Tagebuchs** bekannten
Recovery-Credentials einschließlich des aktuellen Manifest-Startzustands,
streng nach recovery_generation aufsteigend. Der letzte Eintrag muss exakt
recovery_generation/recovery_urs_id/recovery_takeover_key_id des Manifests
entsprechen. URS-IDs und Takeover-Key-IDs sind innerhalb der Liste jeweils
eindeutig. Mehr als
`protocol_limits.max_recovery_credential_history_entries=128` Einträge sind
verboten; ist das Limit erreicht, ist ein weiterer recovery_rekey in diesem
Profil nicht zulässig und benötigt eine neue Protokollversion.

Native v2-Genesis startet mit genau einem Eintrag. Beim v1→v2-Upgrade kann nur
der **aktuelle** v1-Recovery-Key in diese Historie aufgenommen werden; ältere
vor-v2 URSs/Takeover-Credentials sind mangels v1-Identifier nicht
rekonstruierbar. Das ist eine explizite Legacy-Grenze. Jeder v2→v2-Successor
muss dagegen die am final verifizierten Source-Prefix vollständige
recovery_credential_history byte-/semantikgleich übernehmen.

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
  max_activation_lineage_entries: 128,
  max_recovery_credential_history_entries: 128,
  max_recovery_artifact_ciphertext_bytes: 1048576,
  recovery_grid_chunk_chars: 32000,
  max_recovery_grid_chunks: 44
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

Exakt derselbe `creation_locator` muss vor Manifest-Verschlüsselung in das
Protected ManifestV6 übernommen werden. Create-/Unknown-Outcome-Reconciliation
darf nur eine Ressource binden, deren entschlüsseltes Manifest genau diesen
Locator enthält. Ein späterer Dateiname ist kein Trust-Root; nach erfolgreicher
epoch_locator-Bindung entscheidet der geschützte Manifestwert.

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

Wegen der Google-Sheets-Zellgrößengrenze darf RecoveryArtifactV6 **nicht** als
ein einzelner großer JSON-String in A1 gespeichert werden. v6 verwendet eine
exakt gechunkte Grid-Repräsentation.

Recovery-Grid exakt:

~~~text
Tab: "_a"
rowCount = 45
columnCount = 1
keine Merges
~~~

A1 ist UTF8/JCS-Text des exakten Grid-Headers:

~~~text
{
  grid_format: "sync-recovery-grid-v6",
  grid_version: 6,
  artifact_header: {
    format: "sync-recovery-v6",
    version: 6,
    recovery_artifact_id,
    kdf_profile_id: "recovery-hkdf-v6-1",
    salt,
    wrap_iv
  },
  wrapped_payload_chars,
  wrapped_payload_sha256,
  chunk_chars: 32000,
  chunk_count
}
~~~

`wrapped_payload_sha256 =
Base64URL(SHA-256(UTF8(wrapped_payload)))`.

A2..A(1+chunk_count) enthalten ausschließlich aufeinanderfolgende Substrings
des **Base64URL-Strings** `wrapped_payload`, jeweils exakt 32000 Zeichen außer
dem letzten Chunk mit 1..32000 Zeichen. chunk_count ist exakt
ceil(wrapped_payload_chars / 32000), mindestens 1 und höchstens 44.

Alle Zellen nach dem letzten Chunk bis A45 müssen leer sein. Andere Spalten,
Formeln, Rich Text, Fehlerwerte oder zusätzliche Daten sind verboten.

Readback rekonstruiert:

~~~text
wrapped_payload = concat(A2 ... A(1+chunk_count))

RecoveryArtifactV6 = {
  ...artifact_header,
  wrapped_payload
}
~~~

Danach müssen Zeichenlänge, SHA-256, Base64URL-Kanonizität, Ciphertext-Bytebound
und das vollständige logische RecoveryArtifactV6-Schema erneut geprüft werden.

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
2. Existiert noch keine Ressource, GRID mit exakter Form erzeugen und danach
   wieder per Discovery eindeutig binden.
3. Header + alle Chunks werden in **einem** Sheets-batchUpdate geschrieben.
4. Existiert dieselbe Ressource bereits, darf die rekonstruierte logische
   RecoveryArtifactV6-Struktur entweder noch vollständig leer/uninitialisiert
   sein oder exakt dieselben kanonischen logischen Artifact-Bytes ergeben.
   Andere bereits vorhandene Artifact-Bytes unter demselben epoch-spezifischen
   Locator => security stop; kein semantisches Replacement.
5. Schreiben/Timeout wird ausschließlich durch vollständigen Grid-Readback,
   Chunk-Rekonstruktion und bytegenauen Vergleich des logischen Artifacts
   entschieden.
6. Nach Write erneut Discovery: exakt dieselbe eine epoch-spezifische Ressource
   muss kanonisch übrig sein.
7. Historische Source-Artefakte werden bei Rotation **nicht** gelöscht oder
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
  successor_staging_anchor,
  source_writer_generation,
  source_writer_grant_id,
  source_writer_device_id,
  source_writer_key_id,
  successor_epoch_id,
  successor_manifest_fingerprint,
  successor_recovery_generation,
  rotation_kind,
  recovery_transition_id,
  announcement_envelope: {
    envelope_id,
    iv,
    ciphertext
  },
  successor_confirmation_envelope: {
    envelope_id,
    iv,
    ciphertext
  },
  activation_signature
}
~~~

`source_anchor_before_announcement` ist RemoteAnchorV2 des vollständig
verifizierten Source-Prefix unmittelbar vor dem geplanten Announcement.

`successor_staging_anchor` ist RemoteAnchorV2 des **exakten staged
Successor-Prefix**, der unmittelbar nach der akzeptierten EpochMigrationV2-Row
(ggf. plus ausschließlich byte-identischen Retry-Duplikatrows genau dieses
Migration-Envelopes) endet. Zwischen der ersten akzeptierten Migration-Control
und diesem Anchor darf keine andere semantische Row liegen. Dieser Anchor wird
vor Announcement-Prepare eingefroren und ist Bestandteil der
Source-Writer-Signatur über RecoveryActivationProofV2.

`rotation_kind` ist exakt `"normal" | "recovery_rekey"`.

- normal: recovery_transition_id=null.
- recovery_rekey: recovery_transition_id ist exakt die gebundene
  RecoveryAuthorityTransitionV2.transition_id aus §16a.

`successor_recovery_generation` muss exakt der Recovery-Generation des
Successor-Manifests **und** der am finalen Source-Prefix aktuell verifizierten
Recovery-Generation entsprechen.

Bei rotation_kind="recovery_rekey" muss die Generationserhöhung bereits zuvor
durch RecoveryAuthorityTransitionV2 auf der Source durable geworden sein. Der
Rotation-Announcement selbst erhöht keine Recovery-Generation.

`announcement_envelope` enthält die **exakt one-shot vorbereiteten und
persistent reservierten** Rowbytes des signierten
rotation-announcement-sw-v2. Diese Bytes dürfen bei Retry nie regeneriert werden.

`successor_confirmation_envelope` enthält die ebenfalls one-shot vorbereiteten,
writer-signierten Rowbytes der SuccessorActivationConfirmationV2. Ihr
source_announcement_envelope_sha256 wird aus genau announcement_envelope gemäß
§16a berechnet. Auch diese Bytes dürfen bei Retry/Recovery niemals regeneriert
werden.

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
6. Proof-Struktur, Source-/Successor-IDs, Manifest-Fingerprint, rotation_kind,
   successor_recovery_generation und successor_staging_anchor exakt gegen
   Source-/Successor-Manifest, Artifact und die zugehörige EpochMigrationV2
   prüfen. Die source_writer_*-Authority muss zusätzlich exakt den
   `epoch_start_writer_*`-Feldern des Successors entsprechen. Das im
   Announcement gebundene `successor_creation_locator` muss exakt dem
   geschützten `creation_locator` des Successor-Manifests entsprechen.
6a. Die `recovery_credential_history` des Successor-Manifests und des aktuellen
    Successor-RecoveryArtifactV6 muss exakt der am
    source_anchor_before_announcement vollständig verifizierten Source-Historie
    entsprechen; aktuelle recovery_generation/recovery_urs_id/
    recovery_takeover_key_id müssen deren letztem Eintrag entsprechen. Eine
    verkürzte, umsortierte, ersetzte oder zusätzlich erfundene History =>
    `recovery_credential_history_mismatch` / security_blocked.
6b. Das RK_epoch des aktuellen Successor-RecoveryArtifactV6 muss byteweise von
    jedem source_root_key der vollständigen activation_lineage verschieden sein;
    sonst `successor_root_key_reuse` / security_blocked.
6c. Den Successor-Prefix exakt bis successor_staging_anchor vollständig
    verifizieren. Die akzeptierte EpochMigrationV2 muss die letzte semantische
    Row dieses Prefix sein; danach sind bis zum Anchor nur byte-identische
    Retry-Duplikate genau dieses Migration-Envelopes zulässig. Migration-
    Integrität/Provenienz müssen an diesem Prefix vollständig bestehen.
7. activation_signature gegen den **aus der verifizierten Source-Historie**
   ermittelten Writer-Public-Key prüfen; nicht gegen eine bloße Successor-
   Selbstbehauptung.
8. Die **unmittelbar nächste physische Source-Row** muss byte-identisch
   `[envelope_id,iv,ciphertext]` aus announcement_envelope sein. Diese Row mit
   source_root_key öffnen und als gültiges
   rotation-announcement-sw-v2 der bei Schritt 5 current Source-Authority
   vollständig verifizieren. Ihr source_anchor_before_announcement muss exakt
   dem Proof-Anchor und dem Prefix unmittelbar vor dieser Row entsprechen.
   Successor-ID, Manifest-Fingerprint, rotation_kind,
   successor_recovery_generation und recovery_transition_id müssen exakt dem
   Proof und Successor entsprechen.
9. Fehlt diese Row, ist der Successor staged/nicht aktiviert. Steht irgendeine
   andere Row zuerst oder ist die Row semantisch/signaturseitig ungültig, ist
   der Aktivierungsbeweis ungültig.
10. Eine byte-identische Retry-Duplikatrow **nach** der ersten gültigen
    Announcement-Row ändert die Source-Aktivierungsentscheidung nicht.
11. Den Successor-Suffix ab successor_staging_anchor auswerten:
    - steht der Successor noch exakt am staging anchor, darf Recovery nach
      durable bewiesenem Source-Announcement exakt die vorbereiteten
      successor_confirmation_envelope-Bytes einmal appendieren und Full Readback
      durchführen;
    - existiert bereits eine nächste physische Row, muss **diese erste Row**
      byte-identisch successor_confirmation_envelope sein und vollständig als
      SuccessorActivationConfirmationV2 validieren. Dann wird sie als bereits
      durable Confirmation reconciliiert; es werden keine alternativen Bytes
      erzeugt;
    - jede andere erste Row => successor_cutover_race.
12. successor_activation_anchor ist der exakte Prefix durch die erste gültige
    Confirmation-Row einschließlich unmittelbar anschließender byte-identischer
    Retry-Duplikate genau dieser Confirmation. Ein danach vorhandener Suffix ist
    zulässiger **post-activation** Suffix, muss aber vollständig mit normaler
    Writer-Authority durch canonical_full validieren; der aktuelle RemoteAnchor
    muss successor_activation_anchor monoton erweitern.
13. Die zugehörige EpochMigrationV2 muss zusätzlich die vollständige
    Migration-Integritätsprüfung gemäß §16a.1 bestehen.
14. Erst nach erfolgreicher Confirmation gilt der Successor remote als aktiviert.
15. Der Proof ist kein Ersatz für die normale Source-Verifikation im laufenden
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
eine neue Protokollversion. Zusätzlich gilt unabhängig davon der
RecoveryArtifact-Ciphertext-Bound von 1048576 Byte: würde eine weitere Lineage-
Erweiterung diesen Bound überschreiten, ist die Rotation bereits früher
blockiert.

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
  successor_staging_anchor,
  announcement_envelope: {
    envelope_id,
    iv,
    ciphertext
  },
  successor_confirmation_envelope: {
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
- Für **jede nicht-native v2-Epoche** muss das RK_epoch des zugehörigen
  RecoveryArtifactV6 byteweise verschieden von **jedem** `source_root_key`
  der resultierenden activation_lineage sein. Gleichheit mit dem direkten oder
  irgendeinem historischen Source-RK => `successor_root_key_reuse` /
  security_blocked. Damit ist insbesondere bei recovery_rekey die Eigenschaft
  „alter URS kann den neuen aktiven Successor-RK nicht aus einem historischen
  Artifact gewinnen“ Teil der Cross-Epoch-Verifikation und nicht nur eine
  lokale Erzeugungsregel.

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
5. successor_staging_anchor muss exakt einen verifizierten Successor-Prefix
   unmittelbar nach der akzeptierten EpochMigrationV2 (ggf. nur mit
   byte-identischen Retry-Duplikaten dieser Row als Suffix) binden.
6. Die exakt eine EpochMigrationV2 des Successors muss an genau diesem
   successor_staging_anchor die profile_upgrade-Migration-Integritätsprüfung
   gemäß §16a.1 bestehen.
7. Die unmittelbar nächste Successor-Row muss byte-identisch
   successor_confirmation_envelope sein und als gültige
   SuccessorActivationConfirmationV2 exakt dieses v1-Announcement und denselben
   staging anchor binden. Fehlt sie bei durable v1-Announcement und unverändertem
   Successor-Prefix, darf Recovery die vorbereiteten Bytes exakt einmal
   crash-resumable appendieren.
8. Erst dann ist die erste v2-Epoche aktiviert.

V2-Link-Prüfung:

- source_root_key + proof werden exakt nach §10b geprüft.
- source_epoch_id/fingerprint des Proofs müssen dem vorherigen kanonisch
  aktivierten Lineage-Leaf entsprechen.
- successor_epoch_id/fingerprint des Proofs müssen dem nächsten Leaf bzw. beim
  letzten Eintrag der RecoveryArtifactV6-Epoche entsprechen.
- die exakt eine EpochMigrationV2 des Successors muss §16a.1 vollständig
  bestehen; bei recovery_rekey müssen Proof, Announcement und Migration-Control
  dieselbe recovery_transition_id binden.

Recovery validiert Einträge **vom Root nach vorn**. Ein späterer gültiger Link
kann einen früheren fehlenden/ungültigen Link niemals heilen.

### 10d. ActivationLineageCacheV2 – lokaler verschlüsselter Cache

Damit Rotation und recovery_rekey keine **historischen** URSs benötigen, wird
die zuletzt vollständig verifizierte activation_lineage lokal unter RK_epoch
verschlüsselt gehalten. Das ersetzt nicht den **aktuellen** URS: Eine normale
Rotation benötigt ihn weiterhin, um das aktuelle RecoveryArtifactV6 zu
entschlüsseln und das darin enthaltene Recovery-Takeover-Private-Key-Material
für das Successor-Artifact zu übernehmen. Ist der aktuelle URS verloren, muss
zuerst recovery_rekey auf einen neuen aktuellen URS durchgeführt werden.

Exakt:

~~~text
{
  format: "activation-lineage-cache-v2",
  version: 2,
  cache_id,
  diary_id,
  epoch_id,
  manifest_fingerprint,
  iv,
  ciphertext
}
~~~

cache_id = 16 CSPRNG-Bytes Base64URL.
iv = 12 CSPRNG-Bytes.

AAD exakt:

~~~text
UTF8(JCS({
  format,
  version,
  cache_id,
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

Kompromittierung von **RK_epoch plus lokalem ActivationLineageCacheV2** legt
ebenfalls die darin enthaltenen historischen Source-RKs offen. Die
Lineage-Verfügbarkeit wird hier bewusst höher priorisiert als kryptographische
Löschung alter Epoch-Keys; dieselbe Tradeoff-Grenze gilt beim aktuellen URS und
RecoveryArtifactV6.

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

Der v2-Verifier beginnt ausschließlich aus dem Manifest-Trust-Root und
verarbeitet _r strikt in physischer Reihenfolge.

Er besitzt exakt zwei Verifikationszwecke:

~~~text
verification_purpose =
  "canonical_full" |
  "rotation_resume"
~~~

`canonical_full` ist der einzige Modus für Aktivierung, Join, Recovery,
Writer-Gates, Backup-Export/-Restore und normale Remote-Verifikation.

`rotation_resume` ist ausschließlich für einen lokal MAC-authentifizierten,
nicht-terminalen RotationOperationStateV2 zulässig, dessen successor_epoch_id
und successor_manifest_fingerprint exakt zur geprüften staged Successor-Epoche
passen und dessen stage `"successor_bound"` oder `"copying"` ist.

rotation_resume:

- prüft **jede bereits vorhandene Row** mit denselben Struktur-, AEAD-,
  Signatur-, Authority-, Graph- und Bounds-Regeln wie canonical_full;
- erlaubt bei EOF ausschließlich, dass die für eine nicht-native Epoche
  erforderliche EpochMigrationV2 noch fehlt;
- erlaubt null oder exakt eine akzeptierte Migration-Control; zwei bleiben
  fatal;
- liefert nur `staged_incomplete` bzw. `staged_migration_present` an den
  Rotation-/Migration-Service;
- darf niemals `epoch_status="active"`, `writer_active`, einen normalen
  VerifiedRemoteState für Fachwrites, einen activated Backup-Status oder eine
  Recovery-/Join-Aktivierung erzeugen;
- darf nicht verwendet werden, sobald RotationOperationStateV2
  `successor_verified` oder eine spätere Stage erreicht hat.

Damit kann ein Crash während Copy/Control-Erzeugung sicher fortgesetzt werden,
ohne die kanonische Aktivierungsregel abzuschwächen.

Zustand:

~~~text
current_writer_generation
current_writer_grant_id
current_writer_device_id
current_writer_key_id
current_writer_public_key
current_recovery_generation
current_recovery_urs_commitment
current_recovery_urs_id
current_recovery_takeover_key_id
current_recovery_takeover_public_key
recovery_credential_history
recovery_rekey_rotation_required
current_recovery_rekey_transition_id
source_epoch_sealed
genesis_grant_confirmation_required
accepted_revision_graph
accepted_epoch_migration
accepted_activation_confirmation
migration_control_required
authority_history_by_prefix
recovery_history_by_prefix
seen_protocol_semantic_ids
seen_grant_ids
seen_rotation_ids
seen_migration_ids
seen_recovery_transition_ids
seen_confirmation_ids
seen_recovery_urs_ids
seen_recovery_takeover_key_ids

~~~

Recovery-State-Historieneintrag exakt:

~~~text
{
  recovery_generation,
  recovery_urs_commitment,
  recovery_urs_id,
  recovery_takeover_key_id,
  recovery_takeover_public_key,
  recovery_rekey_rotation_required,
  recovery_rekey_transition_id
}
~~~

Dabei gilt immer:
- recovery_rekey_rotation_required=false <=> recovery_rekey_transition_id=null;
- recovery_rekey_rotation_required=true <=> recovery_rekey_transition_id ist
  exakt eine akzeptierte RecoveryAuthorityTransitionV2.transition_id.

Initialisierung:

- source_epoch_sealed=false.
- authority_history_by_prefix[0] enthält die manifestgebundene
  Epoch-Start-Writer-Authority und unsealed.
- recovery_history_by_prefix[0] enthält Recovery-Generation, URS-Commitment,
  URS-ID, Takeover-Key-ID und Takeover-Public-Key aus dem Manifest.
- current_recovery_generation, current_recovery_urs_commitment,
  current_recovery_urs_id, current_recovery_takeover_key_id und
  current_recovery_takeover_public_key starten exakt aus dem Manifest.
  recovery_credential_history startet als exakte Manifestliste; ihr letzter
  Eintrag muss den aktuellen Recovery-State beschreiben. Fortschreibung ist
  innerhalb derselben Epoche ausschließlich durch eine gültige
  RecoveryAuthorityTransitionV2 zulässig.
- recovery_rekey_rotation_required=false und
  current_recovery_rekey_transition_id=null am Epoch-Start. Dieser Pending-
  Rekey-State wird **nicht** aus einer Source-Epoche in den Successor vererbt;
  eine erfolgreich aktivierte Successor-Epoche startet wieder ohne Pending-Rekey.
- seen_protocol_semantic_ids startet mit epoch_start_writer_grant_id als
  reserviertem Bytewert. Bei carried_from_predecessor ist diese ID bereits
  realisierte Epoch-Start-Authority; bei genesis_grant_required darf exakt die
  manifestgebundene Gen-1-Bestätigungsrow diese Reservation einmalig
  realisieren. Jede Verwendung desselben Bytewerts als rotation_id,
  migration_id, transition_id oder confirmation_id kollidiert ebenfalls.
- seen_grant_ids startet bei carried_from_predecessor mit
  epoch_start_writer_grant_id; bei genesis_grant_required wird dieselbe
  manifestgebundene Gen-1-ID als einmalig erwartete/reservierte ID geführt.
- seen_rotation_ids, seen_migration_ids, seen_recovery_transition_ids und
  seen_confirmation_ids starten leer.
- seen_recovery_urs_ids startet mit **allen** recovery_urs_id-Werten aus der
  manifestgebundenen recovery_credential_history.
- seen_recovery_takeover_key_ids startet mit **allen**
  recovery_takeover_key_id-Werten aus derselben Historie. Damit wird die
  Freshness-Grenze über v2-Epoch-Rotationen hinweg fortgetragen und nicht am
  Epoch-Start zurückgesetzt.
- genesis_grant_confirmation_required ist genau dann true, wenn
  epoch_start_authority_mode="genesis_grant_required".
- migration_control_required ist genau dann true, wenn predecessor_epochs genau
  einen Eintrag enthält; accepted_epoch_migration und
  accepted_activation_confirmation starten null.

Pro Row:

1. Grid-/Bounds-/Base64URL-/Envelope-AEAD vollständig prüfen. Gleiche
   envelope_id + andere Bytes => security_blocked. Byte-identische spätere
   Retry-Duplikate zählen physisch, sind aber semantische No-ops und springen
   direkt zu Schritt 6/7.
2. Wrapper als exaktes RevisionV2 validieren.
2a. Für Control-IDs gilt nach Wrapper-/Schema-Validierung und **vor** semantischer
    State-Mutation:
    - grant_id, rotation_id, migration_id, transition_id und confirmation_id
      teilen **einen gemeinsamen epochweiten Bytewert-Namespace**. Ein Bytewert,
      der bereits unter irgendeinem dieser Feldtypen in
      seen_protocol_semantic_ids belegt ist, darf in keinem anderen
      Envelope/Revision-Objekt erneut auftreten;
    - byte-identische Retry-Duplikatrows wurden bereits in Schritt 1 als No-op
      abgefangen und sind die einzige Wiederholung, die keinen ID-Collision-Fehler
      erzeugt;
    - jede andere Wiederverwendung — auch **cross-type**, z.B.
      transition_id == frühere rotation_id — =>
      protocol_id_collision / security_blocked, unabhängig davon, ob der neue
      Claim später stale geworden wäre;
    - bei der ersten strukturell/schema-gültigen Erscheinung wird der Bytewert
      **vor** weiterer semantischer Klassifikation in
      seen_protocol_semantic_ids und zusätzlich in den passenden typisierten
      seen_*-Satz aufgenommen; dadurch kann auch eine später stale klassifizierte
      Control-ID weder im selben noch in einem anderen Control-ID-Feld erneut
      verwendet werden;
    - bei Gen-1 ist die exakt manifestgebundene Bestätigungsrow die einmalige
      erlaubte Realisierung der vorreservierten grant_id; jede andere Verwendung
      dieses reservierten Bytewerts kollidiert.
2b. Falls genesis_grant_confirmation_required=true, ist **ausschließlich** der
    exakt manifestgebundene Gen-1-writer-grant-sw-v2 mit H0 zulässig. Jede
    andere semantische Row => security_blocked. Erst nach dessen erfolgreicher
    Validierung wird das Flag irreversibel gelöscht.
2c. Solange migration_control_required=true und accepted_epoch_migration=null
    ist, befindet sich eine nicht-native Epoche im **pre-migration staged
    authority freeze**. Control-Rows sind dort ausschließlich
    - die exakt manifestgebundene Gen-1-Bestätigungsrow aus 2b, falls sie am
      Row-Anfang noch erforderlich war, oder
    - die eine epoch-migration-sw-v2-Row.
    Jeder WriterGrant, jede RecoveryAuthorityTransition, jedes
    RotationAnnouncement und jede SuccessorActivationConfirmation vor der
    Migration-Control => staged_pre_migration_control_forbidden /
    security_blocked. Damit bleibt die Successor-Writer-Authority vom
    Epoch-Start bis einschließlich Migration-Control unverändert; kopierte
    Fachrevisionen validieren zwingend unter dieser eingefrorenen Authority.
3. Bei writer-grant-sw-v2:
   - falls source_epoch_sealed=true: einen sonst vollständig wohlgeformten Grant
     als stale_after_seal_rejected behandeln; malformed/kryptographisch ungültige
     Rows bleiben security_blocked;
   - authority_anchor gegen den historischen Prefix sowie Writer-/Recovery-State
     an diesem Prefix prüfen;
   - Handoff gegen den am Anchor gültigen predecessor Writer-Key;
   - Forced Takeover gegen die in recovery_history_by_prefix am
     authority_anchor verifizierte Recovery-Takeover-Authority;
   - **nur** wenn authority_anchor exakt dem physischen Prefix unmittelbar vor
     dieser Grant-Row entspricht und predecessor/Recovery-State dort noch passen,
     kann der Candidate current werden. Gilt an diesem unmittelbaren Prefix
     recovery_rekey_rotation_required=true und reason!="forced_takeover", wird
     der ansonsten vollständig gültige Grant stattdessen als
     rekey_rotation_required_rejected behandelt und ändert keine Writer-
     Authority. Forced Takeover bleibt zulässig, damit nach Geräteverlust wieder
     ein Writer gewonnen werden kann, der die verpflichtende Rekey-Rotation
     ausführt;
   - ist der Candidate relativ zu seinem historischen Anchor vollständig gültig,
     aber der Anchor inzwischen historisch, => stale_grant_rejected, auch wenn
     derselbe predecessor Writer noch current ist;
   - Zukunftsgeneration, falsche historische Vorgängerbindung, Zukunfts-/falscher
     Anchor oder ungültige Autorisierung => security_blocked.
4. Bei normaler Revision:
   - source_epoch_sealed wird **niemals** auf false zurückgesetzt;
   - falls source_epoch_sealed=true: eine sonst vollständig wohlgeformte und
     gegen ihre historische Authority korrekt signierte Row als
     stale_after_seal_rejected behandeln;
   - entspricht writer_context exakt der current authority, Signatur gegen
     current_writer_public_key prüfen. Falls recovery_rekey_rotation_required=true
     und record_schema weder "recovery-authority-transition-sw-v2" noch
     "rotation-announcement-sw-v2" ist, wird die ansonsten vollständig gültige
     Row als rekey_rotation_required_rejected behandelt und semantisch **nicht**
     angewendet. Damit sind insbesondere Fachwrites und zusätzliche
     EpochMigration-Controls während des Pending-Rekey-Fence remote blockiert;
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
     State, Anchor unmittelbar vor der Row und **beiden** frischen
     to_recovery_urs_id/to_recovery_takeover_key_id-Werten wird der Recovery-
     State atomar auf die to-Felder fortgeschrieben. Die seen-Sets werden aus
     der manifestgebundenen, über v2-Epoch-Grenzen fortgetragenen
     recovery_credential_history initialisiert. Wiederverwendung eines seit der
     ersten v2-Aktivierung bereits bekannten URS oder Takeover-Keys =>
     recovery_credential_reuse / security_blocked. Bei Annahme werden beide
     neuen IDs und der neue History-Eintrag atomar aufgenommen. Gleichzeitig
     werden
     recovery_rekey_rotation_required=true und
     current_recovery_rekey_transition_id=transition_id gesetzt. Eine weitere
     gültige RecoveryAuthorityTransitionV2 darf während dieses Pending-Rekey-
     Zustands die Recovery-Generation erneut erhöhen und die gespeicherte
     Transition-ID atomar durch ihre eigene transition_id ersetzen. Historisch
     überholte, sonst gültige Transition => stale_recovery_transition_rejected;
   - ein rotation-announcement-sw-v2 der current authority wird zusätzlich nach
     den **source-lokal prüfbaren** Regeln aus §16a geprüft: Immediate-Prefix-
     Anchor, from_epoch_id, non-self Successor und aktuelle Recovery-Generation.
     Falls recovery_rekey_rotation_required=false, ist ausschließlich
     rotation_kind="normal" mit recovery_transition_id=null zulässig.
     Falls recovery_rekey_rotation_required=true, ist ausschließlich
     rotation_kind="recovery_rekey" zulässig und recovery_transition_id muss
     exakt current_recovery_rekey_transition_id sein. Nur dann setzt das
     Announcement source_epoch_sealed irreversibel auf true. Successor-Manifest,
     ActivationProof und EpochMigration werden separat bei der Cross-Epoch-
     Aktivierung geprüft. Ein ansonsten gültiges Announcement mit historisch
     gewordenem Anchor => stale_rotation_announcement_rejected und **kein Seal**.
     Ein ansonsten gültiges rotation_kind="normal" während aktivem Pending-Rekey
     => rekey_rotation_required_rejected und kein Seal. Ein
     rotation_kind="recovery_rekey" mit fehlender/falscher
     recovery_transition_id oder ein recovery_rekey-Announcement ohne aktiven
     Pending-Rekey-Fence => recovery_transition_state_mismatch /
     security_blocked;
   - ein gültiges epoch-migration-sw-v2 darf pro nicht-nativer Epoche exakt
     einmal auftreten. Ein zweites akzeptierbares Migration-Control ist fatal.
     Beim ersten wird der Successor-Fachgraph am Prefix unmittelbar vor der Row
     gegen result_semantic_snapshot_hash und Head-Counts geprüft und
     accepted_epoch_migration gesetzt; Source-seitige Snapshot-/Authority-
     Bindungen werden bei der Cross-Epoch-Aktivierungsprüfung §16a.1 geprüft;
   - ein gültiges successor-activation-confirmation-sw-v2 darf pro nicht-nativer
     Epoche exakt einmal akzeptiert werden. successor_staging_anchor muss exakt
     dem Prefix unmittelbar vor der Row entsprechen; source/successor IDs,
     Fingerprints und Announcement-Hash werden strukturell geprüft.
     accepted_activation_confirmation wird gesetzt. Eine zweite unterschiedliche
     Confirmation => security_blocked. Ob das referenzierte Source-Announcement
     tatsächlich durable/kanonisch ist, entscheidet ausschließlich die
     Cross-Epoch-Aktivierungsprüfung; die lokale Successor-Row allein verleiht
     noch keine Aktivierung.
5. Nur akzeptierte Fachrevisionen gehen in den fachlichen Graphen.
6. Jede physische Row geht unabhängig von semantischer Annahme in Prefix-Hash
   und Bounds ein.
7. Nach jeder Row werden Writer-/Seal-State in authority_history_by_prefix und
   Recovery-State **einschließlich Pending-Rekey-Flag und jüngster
   Recovery-Rekey-Transition-ID** in recovery_history_by_prefix für den neuen
   Prefix festgehalten.
8. EOF mit genesis_grant_confirmation_required=true => security_blocked /
   manifest_genesis_missing.
9. EOF mit migration_control_required=true und accepted_epoch_migration=null:
   - verification_purpose="canonical_full" => security_blocked /
     migration_control_missing;
   - verification_purpose="rotation_resume" und gebundene Operation-Stage
     successor_bound|copying => staged_incomplete, **kein** kanonischer
     VerifiedRemoteState;
   - jeder andere Fall => security_blocked.
10. EOF mit migration_control_required=true, akzeptierter Migration-Control,
    aber accepted_activation_confirmation=null ist bei canonical_full der
    explizite recoverbare Zustand `activation_confirmation_missing` /
    `staged_confirmation_missing`. Der Prefix ist strukturell verifiziert,
    verleiht aber **keinen** epoch_status=active, keine Writer-Freigabe und keine
    Forced-Takeover-Fähigkeit. Ob die vorbereitete Confirmation nachgetragen
    werden darf, entscheidet erst die Cross-Epoch-Prüfung des durable
    Source-Announcements gemäß §§10b/10c.

Ein Root-Key-besitzendes stale Gerät kann neue Ciphertexte erzeugen, aber ohne
aktuellen Writer-Key weder aktuelle Fachrevisionen noch einen Handoff-Grant
authentisieren.

---

## 13. Schreibfreigabe / Freshness

Ein Gerät darf eine **normale Fachrevision oder einen kooperativen Handoff**
erst persistent erzeugen, wenn innerhalb desselben Write-Vorgangs:

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
6. recovery_rekey_rotation_required=false ist;
7. verifizierte current authority exakt zum lokalen Device-Key passt;
8. lokaler Status writer_active ist;
9. kein nicht-terminaler rotation_state_ref, migration_state_ref,
   writer_operation_state_ref oder recovery_operation_state_ref die konkrete
   Mutation sperrt.

Forced Takeover, RecoveryAuthorityTransitionV2 und die bei aktivem Pending-Rekey-
Fence zwingende recovery_rekey-Rotation verwenden ihre jeweils strengeren
Service-Gates aus §§16-17; sie werden durch Punkt 6 nicht verboten.

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

1. niemals semantisch neue Bytes für dieselbe Benutzeraktion erzeugen;
2. Remote vollständig lesen;
3. gleiche envelope_id + gleiche Bytes => dieses konkrete Envelope existiert;
4. gleiche envelope_id + andere Bytes => fatal;
5. **Fachrevision:** fehlt das Envelope, current Writer-Authority ist unverändert,
   source_epoch_sealed=false und recovery_rekey_rotation_required=false =>
   exakt dieselben Bytes dürfen erneut appended werden. Wird zwischen Prepare
   und Retry ein Recovery-Rekey-Fence remote aktiv, wird die Fachrevision
   quarantiniert und nicht erneut appended;
6. **WriterGrantV2:** fehlt das Envelope => Retry nur, wenn der vollständig
   verifizierte aktuelle RemoteAnchorV2 **exakt** dem im Grant gespeicherten
   authority_anchor entspricht, predecessor/recovery-State noch passen und
   Source unsealed ist. Jede intervenierende physische Row macht den
   vorbereiteten Grant stale; keine spätere Authority-Übertragung.
7. **RecoveryAuthorityTransitionV2:** Retry/Crash-Completion ausschließlich nach
   §16c bei exakt unverändertem Transition-Anchor.
8. **rotation-announcement-sw-v2 / v1 profile-upgrade announcement:** Retry nur,
   wenn der aktuelle Source-Prefix exakt dem im ActivationProof/Operation-State
   gespeicherten source_anchor_before_announcement und der aktuelle
   Successor-Prefix exakt successor_staging_anchor entspricht. Jede
   intervenierende Source- oder Successor-Row vor durable Announcement =>
   vorbereitete Rotation stale/nicht aktivieren.
8a. **SuccessorActivationConfirmationV2:** Retry/Crash-Completion nur, wenn das
    gebundene Source-Announcement bereits vollständig durable verifiziert ist.
    Steht der Successor exakt am successor_staging_anchor, dürfen ausschließlich
    dieselben one-shot Confirmation-Bytes erneut verwendet werden. Erweitert der
    Prefix den staging anchor bereits, muss die erste neue Row exakt diese
    Confirmation sein; dann wird ihr Erfolg reconciliiert und ein nachfolgender
    vollständig gültiger post-activation Suffix akzeptiert. Jede andere erste
    Successor-Row => successor_cutover_race.
9. Ist Source inzwischen sealed oder Writer-/Recovery-Authority anderweitig
   fortgeschritten => nicht erneut appendieren; Fachrevision quarantinieren bzw.
   Operation-State auf stale setzen.

Ein HTTP-200 ohne finalen Full Readback ist niemals durable.

---

## 15. Cooperative Handoff A -> B

Voraussetzungen:

- A ist auf einer kanonisch aktivierten Epoche (`epoch_status="active"`) nach
  frischem Full Verify current writer, source_epoch_sealed=false und
  recovery_rekey_rotation_required=false.
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
10. Falls canonical_full recovery_rekey_rotation_required=true liefert, ist
    dieser writer_active **maintenance-only**: normale Fachwrites, Handoff und
    normale Rotation bleiben remote/protokollseitig gesperrt. Zulässig sind nur
    eine weitere RecoveryAuthorityTransitionV2 oder die verpflichtende
    recovery_rekey-Rotation gegen current_recovery_rekey_transition_id.
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
rotation_kind = "normal" | "recovery_rekey"
source_writer_generation
source_writer_grant_id
successor_recovery_generation
source_anchor_before_announcement
successor_staging_anchor
recovery_transition_id
~~~

source_writer_generation und source_writer_grant_id müssen dem writer_context
der Control-Revision entsprechen.

source_anchor_before_announcement ist RemoteAnchorV2 und muss **exakt** dem
physischen Prefix unmittelbar vor dieser Announcement-Row entsprechen. Nur dann
darf das Announcement die Source versiegeln.

successor_staging_anchor ist RemoteAnchorV2 des exakt eingefrorenen
Successor-Cutover-Prefix gemäß §10b/§16a.1. Der Source-local Verifier prüft nur
dessen Form/Kanonizität; die tatsächliche Successor-Prefix-Bindung wird bei der
Cross-Epoch-Aktivierungsprüfung nachgerechnet.

Zusätzlich gilt zwingend:

- from_epoch_id == aktuelle Source-epoch_id;
- successor_epoch_id != from_epoch_id;
- successor_creation_locator dekodiert zu exakt 16 Byte und muss bei der
  Cross-Epoch-Aktivierungsprüfung exakt dem geschützten `creation_locator` des
  Successor-Manifests entsprechen;
- successor_recovery_generation == aktuell verifizierte
  Source-Recovery-Generation am source_anchor_before_announcement;
- bei der **Cross-Epoch-Aktivierungsprüfung** müssen
  source_anchor_before_announcement und successor_staging_anchor zusätzlich
  exakt den gleichnamigen Feldern des zugehörigen RecoveryActivationProofV2
  entsprechen. Der Source-local Verifier muss dafür keine
  Successor-/Recovery-Ressource laden.

rotation_kind="normal":
- recovery_transition_id = null;
- recovery_rekey_rotation_required muss am
  source_anchor_before_announcement=false sein.

rotation_kind="recovery_rekey":
- recovery_rekey_rotation_required muss am
  source_anchor_before_announcement=true sein;
- recovery_transition_id muss exakt
  current_recovery_rekey_transition_id an diesem Prefix sein;
- die referenzierte Transition muss die am finalen Source-Prefix aktuelle
  Recovery-Generation erzeugt haben und damit die jüngste akzeptierte
  RecoveryAuthorityTransitionV2 vor dem Announcement sein;
- der Beweis lautet damit nur „dieser Successor trägt genau diese durable
  Recovery-Rekey-Transition weiter“. Eine nicht remote beweisbare Behauptung
  über denselben UI-/Prozesslauf wird nicht Teil des Wire-Protokolls.

Ein ansonsten korrekt signiertes Announcement mit historischem
source_anchor_before_announcement wird
`stale_rotation_announcement_rejected` und **versiegelt die Source nicht**.
Ein falscher/future Anchor, falsche Transition-Bindung oder inkonsistenter
Successor ist security_blocked.

Diese Felder werden durch die normale RevisionV2-Writer-Signatur geschützt und
müssen mit RecoveryActivationProofV2, EpochMigrationV2,
successor_staging_anchor und dem Successor-Manifest übereinstimmen.

"successor-activation-confirmation-sw-v2" ist die **Successor-seitige
Aktivierungsgrenze** für jede nicht-native v2-Epoche. Sie wird one-shot bereits
vor dem Source-Announcement vorbereitet, darf aber semantisch erst nach
nachgewiesen durable Source-Announcement als unmittelbare nächste Successor-Row
am successor_staging_anchor abgeschlossen werden.

Wrapper:

~~~text
record_type = "successor_activation_confirmation"
record_schema = "successor-activation-confirmation-sw-v2"
record_status = "control"
parent_revision_ids = []
migration_origin = null
~~~

Die Row ist eine normale writer-autorisierte RevisionV2 der am
successor_staging_anchor aktuellen Successor-Writer-Authority.

record_data exakt:

~~~text
{
  confirmation_id,
  activation_kind: "profile_upgrade" | "v2_rotation",
  source_profile,
  source_epoch_id,
  source_manifest_fingerprint,
  source_anchor_before_announcement,
  successor_epoch_id,
  successor_manifest_fingerprint,
  successor_staging_anchor,
  source_announcement_envelope_sha256
}
~~~

~~~text
source_announcement_envelope_sha256 =
Base64URL(SHA-256(
  UTF8("eds-diary/source-announcement-envelope/v2") || 0x00 ||
  UTF8(JCS([announcement_envelope.envelope_id,
            announcement_envelope.iv,
            announcement_envelope.ciphertext]))
))
~~~

Normen:

- confirmation_id ist eine epochweit eindeutige 32-Byte-CSPRNG-ID.
- successor_epoch_id / successor_manifest_fingerprint müssen exakt der
  aktuellen Successor-Epoche entsprechen.
- successor_staging_anchor muss exakt dem physischen Successor-Prefix
  **unmittelbar vor** dieser Confirmation-Row entsprechen.
- activation_kind="profile_upgrade" =>
  source_profile="google-sheets-single-writer-v1" und Source-Anchor ist
  RemoteAnchorV1.
- activation_kind="v2_rotation" =>
  source_profile="google-sheets-transferable-single-writer-v2" und Source-Anchor
  ist RemoteAnchorV2.
- source_announcement_envelope_sha256 muss aus dem im zugehörigen
  ProfileUpgradeActivationEntryV2 bzw. RecoveryActivationProofV2 gebundenen
  Announcement-Envelope exakt reproduzierbar sein.
- Cross-Epoch-Aktivierung muss **zuerst** den Source-Announcement-Beweis
  vollständig erfolgreich prüfen und **danach** diese Confirmation-Row.
- Für eine nicht-native Epoche darf exakt eine akzeptierte
  SuccessorActivationConfirmationV2 existieren. Eine zweite unterschiedliche
  Confirmation ist security_blocked.
- Erst die durable, cross-epoch verifizierte Confirmation setzt die
  Remote-Aktivierungsgrenze des Successors. Normale Successor-Rows dürfen
  protokollseitig erst **nach** dieser Row als post-activation Suffix gelten.

Fehlt die Confirmation, obwohl der Source-Announcement bereits durable ist, ist
das `activation_confirmation_missing`: ein **recoverbarer staged Zustand**,
kein fataler Verifierfehler. Recovery darf die im Activation-Evidence one-shot
gebundenen Confirmation-Bytes nur dann exakt einmal appendieren, wenn der
aktuelle Successor-Prefix noch exakt successor_staging_anchor ist. Existiert
bereits ein Suffix, muss dessen **erste** Row exakt diese vorbereitete
Confirmation sein; dann wird sie reconciliiert und ein danach vorhandener,
vollständig gültiger Suffix als post-activation verarbeitet. Steht eine andere
erste Row nach dem staging anchor, => successor_cutover_race; keine alternative
Confirmation erzeugen.

---

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
source_recovery_transition_id
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
  source_writer_authority=null, source_recovery_transition_id=null und
  source_anchor ist ein nicht-null RemoteAnchorV1 der final verifizierten
  v1-Source.
- normal ist v2→v2:
  source_writer_authority ist nicht-null, entspricht exakt der final
  verifizierten Source-Authority, source_anchor ist RemoteAnchorV2 und
  source_recovery_transition_id=null.
- recovery_rekey ist v2→v2:
  source_writer_authority ist nicht-null, source_anchor ist RemoteAnchorV2 und
  source_recovery_transition_id ist exakt die transition_id, die auch im
  zugehörigen rotation-announcement-sw-v2 gebunden ist.
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

### 16a.0 Exakte Cross-Epoch-Provenienz der Fach-Heads

Eine v2-Migration kopiert **ausschließlich die am gebundenen Source-Prefix
aktuellen nicht-Control-Heads**. Die interne Parent-Historie wird dabei bewusst
nicht in die neue Epoche kopiert: Jeder kopierte Head wird eine neue
Successor-Genesis-Revision.

Für jeden Source-Head `S` muss am Successor-Prefix unmittelbar vor der
Migration-Control-Row exakt ein Head `T` existieren, für den gilt:

~~~text
T.record_type   == S.record_type
T.record_schema == S.record_schema
T.record_id     == S.record_id
T.record_status == S.record_status
T.record_data   == S.record_data

T.revision_id != S.revision_id
T.parent_revision_ids == []

T.migration_origin == {
  sources: [
    {
      source_epoch_id: <exakt Source-epoch_id>,
      source_record_id: S.record_id,
      source_revision_ids: [S.revision_id]
    }
  ]
}
~~~

Die Gleichheit von `record_data` ist JCS-semantische Gleichheit nach bereits
erfolgreicher Schema-/I-JSON-Prüfung. `source_revision_ids` enthält für diesen
unveränderten Single-Source-Copy **exakt eine** ID; mehrere Source-Heads
desselben `record_id` werden als mehrere unabhängige Successor-Heads erhalten.

Es gilt eine strikte Bijection:

- jeder Source-Head besitzt genau einen solchen Successor-Head;
- jeder Successor-Fach-Head vor der Migration-Control besitzt genau einen
  Source-Head als Gegenstück;
- zwei Successor-Heads dürfen nicht denselben Source-Head beanspruchen;
- kein Successor-Head darf eine andere Source-Epoche, Record-ID oder
  Source-Revision referenzieren;
- ein `migration_origin=null`, eine leere/mehrdeutige Source-Liste oder
  zusätzliche Source-Revisionen sind für diese Migration ungültig.

Die neue Successor-`revision_id` wird unabhängig als 32 CSPRNG-Bytes erzeugt.
`protocol_created_at` darf neu sein und ist weiterhin rein informativ.
Writer-Context/-Signatur müssen die für die jeweilige Successor-Row aktuelle
Writer-Authority verwenden.

Diese Provenienzprüfung ist bewusst **zusätzlich** zu Semantic-Snapshot und
Head-Counts. Der Source-Lineage-Snapshot beweist die tatsächlich kopierbaren
Source-Heads; die Bijection beweist, dass genau diese Heads mit korrekter
Cross-Epoch-Abstammung im Successor materialisiert wurden.

### 16a.1 Verbindliche Migration-Integritätsprüfung

Jede nicht-native v2-Epoche enthält **exakt eine** akzeptierte
`epoch-migration-sw-v2`-Revision, bevor sie kanonisch aktiviert werden darf.
Mehrere akzeptierte Migration-Controls in derselben Epoche sind fatal.

Die Snapshot-Werte sind keine bloßen Audit-Metadaten. Aktivierung prüft sie
gegen die realen Graphen:

1. Die Source-Epoche und ihr Manifest-Fingerprint müssen exakt dem direkten
   Predecessor des Successors und dem passenden ActivationLineageV2-Eintrag
   entsprechen.
2. `source.source_anchor` muss exakt dem Aktivierungsanchor entsprechen:
   - profile_upgrade: source_anchor_before_announcement des
     ProfileUpgradeActivationEntryV2;
   - v2→v2: source_anchor_before_announcement des RecoveryActivationProofV2.
3. Die Source wird bis exakt source.source_anchor vollständig replay-verifiziert.
   Aus **diesem Prefix** werden source_semantic_snapshot_hash und
   source_lineage_snapshot_hash neu berechnet; beide müssen exakt matchen.
4. Bei v2→v2 muss source_writer_authority exakt der an diesem Source-Prefix
   kanonischen Writer-Authority entsprechen.
5. Die Migration-Control-Row selbst muss im Successor writer-autorisiert gültig
   sein. Für ihren Ergebnisvergleich wird der akzeptierte Fachgraph des
   Successors am physischen Prefix **unmittelbar vor der Migration-Control-Row**
   verwendet. Control-Rows ändern diesen Graph nicht.
5a. Der zum Aktivierungsbeweis gehörende successor_staging_anchor muss diesen
    Successor exakt durch die akzeptierte Migration-Control hindurch abdecken.
    Zwischen der ersten akzeptierten Migration-Control-Row und dem Anchor sind
    ausschließlich byte-identische Retry-Duplikate genau dieses
    Migration-Envelopes zulässig; jede andere physische/semantische Row =>
    successor_staging_mismatch / security_blocked.
6. Aus diesem Successor-Prefix werden result_semantic_snapshot_hash,
   active_head_count und tombstone_head_count neu berechnet und exakt gegen
   record_data geprüft.
7. Source- und Successor-Fach-Heads müssen zusätzlich die vollständige
   Cross-Epoch-Provenienz-Bijection aus §16a.0 erfüllen. Fehlende, zusätzliche,
   doppelt beanspruchte oder falsch referenzierte `migration_origin`-Quellen
   sind `migration_provenance_mismatch` / security_blocked.
8. Für den unveränderten Ein-Source-Copy gilt zusätzlich zwingend:
   result_semantic_snapshot_hash == source_semantic_snapshot_hash.
9. Bei migration_kind="recovery_rekey" müssen
   source_recovery_transition_id, Announcement recovery_transition_id und die
   zuletzt akzeptierte RecoveryAuthorityTransitionV2, welche die aktuelle
   Source-Recovery-Generation erzeugt hat, exakt dieselbe transition_id tragen.
10. Erst wenn diese Migration-Integritätsprüfung **und** der jeweilige
   Aktivierungsbeweis erfolgreich sind, ist der Source→Successor-Link gültig.

Damit kann ein kryptographisch korrekt aktivierter Successor mit fehlenden,
zusätzlichen, semantisch veränderten **oder provenance-seitig falsch
zugeordneten** Fach-Heads nicht als gültige Migration akzeptiert werden.

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
  from_recovery_urs_id,
  from_recovery_takeover_key_id,
  to_recovery_generation,
  to_recovery_urs_commitment,
  to_recovery_urs_id,
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
- from_recovery_generation, from_recovery_urs_id und
  from_recovery_takeover_key_id müssen exakt dem aktuell verifizierten
  Recovery-State an diesem Prefix entsprechen.
- to_recovery_generation = from_recovery_generation + 1.
- to_recovery_urs_id muss exakt gemäß §2 aus dem neuen 32-Byte-URS abgeleitet
  sein; to_recovery_urs_commitment ist exakt das §10-Recovery-Commitment
  desselben URS für to_recovery_generation. Der secret-freie kanonische
  Remote-Log-Verifier kann diese Ableitung naturgemäß nicht selbst ausführen:
  er prüft Signatur, Form, History-Freshness und die gebundenen Werte.
  **Vor dem Transition-Append** muss deshalb die secret-aware
  RecoveryArtifact-Erzeugung/Test-Recovery mit dem eingegebenen URS beide Werte
  neu berechnen und exakt matchen. §19 wiederholt dieselbe Prüfung bei jeder
  späteren Artifact-Nutzung; ein Mismatch ist security_blocked und die
  vorbereitete Transition darf nicht appended werden.
- to_recovery_takeover_public_key dekodiert zu exakt 32 Ed25519-Bytes.
- to_recovery_takeover_key_id muss daraus gemäß §2 reproduzierbar sein.
- Weder to_recovery_urs_id noch to_recovery_takeover_key_id darf bereits in
  seen_recovery_urs_ids bzw. seen_recovery_takeover_key_ids vorkommen. Diese
  Sets stammen aus der über alle v2-Epochen fortgetragenen
  recovery_credential_history. Wiederverwendung =>
  recovery_credential_reuse / security_blocked.
- Vor Annahme darf die fortgeschriebene recovery_credential_history den
  manifestgebundenen Maximalwert nicht überschreiten. Bei Annahme wird exakt
  ein neuer History-Eintrag für die to-Generation appended.
- Der normale RevisionV2-Signing-Input bindet alle diese Felder an die aktuelle
  Writer-Authority.
- Bei Annahme ersetzt der Verifier current_recovery_generation,
  current_recovery_urs_commitment, current_recovery_urs_id,
  current_recovery_takeover_key_id und current_recovery_takeover_public_key
  atomar, appended den neuen Eintrag an recovery_credential_history, nimmt die
  beiden neuen IDs in die seen-Sets auf und setzt zusätzlich
  recovery_rekey_rotation_required=true sowie
  current_recovery_rekey_transition_id=transition_id.
- Ist recovery_rekey_rotation_required bereits true, darf eine weitere gültige
  Transition den aktuellen Recovery-State erneut um genau eine Generation
  fortschreiben. Sie supersedet dabei die bisherige Pending-Rekey-Transition:
  current_recovery_rekey_transition_id wird atomar auf ihre transition_id
  ersetzt. Das erlaubt, einen gerade neu kompromittierten Recovery-Key noch vor
  der Successor-Rotation erneut zu ersetzen.
- Solange recovery_rekey_rotation_required=true ist, darf die Source nicht in
  normalen Fachbetrieb zurückkehren. Der Zustand ist vollständig aus der
  Remote-Historie rekonstruierbar und darf nicht von lokalem
  RecoveryRekeyOperationStateV2 abhängen.
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
  from_recovery_urs_id,
  from_recovery_takeover_key_id,
  to_recovery_generation,
  to_recovery_urs_commitment,
  to_recovery_urs_id,
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

Eine **normale** Epoch-Rotation ist nur zulässig, wenn canonical_full auf der
Source recovery_rekey_rotation_required=false liefert.

Ist recovery_rekey_rotation_required=true, darf ausschließlich eine
rotation_kind="recovery_rekey"-Rotation gegen die aktuell verifizierte
current_recovery_rekey_transition_id gestartet werden. Diese Pflicht stammt aus
der Remote-Historie und gilt unabhängig davon, ob auf dem ausführenden Gerät ein
älterer RecoveryRekeyOperationStateV2 existiert.

**Recovery-Key-Material für jede Rotation:** Vor Erzeugung des finalen
Successor-RecoveryArtifactV6 muss der **aktuelle URS** erneut eingegeben werden.
Das aktuelle Source-RecoveryArtifactV6 wird eindeutig discovered, entschlüsselt,
gegen den vollständig verifizierten aktuellen Recovery-State geprüft und der
§19-Keypair-Check ausgeführt. Nur daraus darf das aktuelle
recovery_takeover_private_key_pkcs8 transient für das neue Successor-Artifact
übernommen werden. Vor dem ersten mutierenden Successor-Remote-Schritt wird
dieses **carried** Private-Key-Material für genau die neue Successor-Epoche
erneut als RecoveryTakeoverStagingV2 unter dem aktuellen URS persistent
geschrieben und byte-/AEAD-readback-verifiziert; §9.1 gilt damit ausdrücklich
auch dann, wenn kein neues Takeover-Keypair erzeugt wurde. Historische URSs
werden dank ActivationLineageCacheV2 nicht benötigt. Ist bei einer normalen Rotation der aktuelle URS verloren, ist die
Rotation blockiert; der aktuelle Writer muss stattdessen zuerst recovery_rekey
mit einem neuen URS durchführen. Es gibt kein zusätzliches lokales
Takeover-Private-Key-Escrow.

Die zulässige Rotation setzt im Successor
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

Für **jede** v2→v2-Rotation ist die Reihenfolge verbindlich:

1. activation_lineage der aktiven Source vollständig validieren, aktuellen URS
   und aktuelles Source-RecoveryArtifactV6 gemäß obiger Regel prüfen und finalen
   Source-Anchor/Writer-/Recovery-State einfrieren.
2. Successor mit **neuem unabhängig erzeugtem 32-Byte-CSPRNG-RK_epoch** erzeugen.
   Dieser RK darf keinem source_root_key der resultierenden ActivationLineage
   entsprechen; Gleichheit => successor_root_key_reuse / security_blocked.
   Jeden am eingefrorenen Source-Prefix aktuellen nicht-Control-Head exakt nach
   §16a.0 als neue Successor-Genesis-Revision
   kopieren/signieren: gleiche Fachsemantik, leere Parents und
   `migration_origin` exakt auf die eine kopierte Source-Revision.
3. Exakt eine EpochMigrationV2 schreiben. source.source_anchor ist der finale
   Source-Anchor; source_writer_authority ist die dortige Authority;
   source_recovery_transition_id ist bei normal null und bei recovery_rekey die
   gebundene Transition-ID. Result-Hash/Counts beziehen sich auf den
   Successor-Fachgraph unmittelbar vor dieser Migration-Control-Row.
4. Successor vollständig verifizieren und die gesamte Migration-Integrität
   gemäß §16a.1 gegen Source und Successor prüfen. Der daraus resultierende
   aktuelle RemoteAnchorV2 wird als **successor_staging_anchor** eingefroren.
   Bis zur gebundenen SuccessorActivationConfirmation darf keine andere neue
   Successor-Row erscheinen. Nach exakt dieser Confirmation ist ein gültiger
   post-activation Suffix zulässig; **das initiierende Gerät** bleibt jedoch
   bis zum lokalen Switch für normale Successor-Writes gesperrt.
5. Source **und Successor** unmittelbar vor Announcement-Prepare erneut
   vollständig lesen. Source-Anchor, Writer-/Recovery-State und unsealed-Status
   müssen exakt Schritt 1 entsprechen; der Successor-Anchor muss exakt
   successor_staging_anchor entsprechen. Andernfalls stage=stale und kein
   Announcement wird vorbereitet. Erst danach das exakte Rotation-Announcement
   one-shot vorbereiten. Es bindet source_anchor_before_announcement **und**
   successor_staging_anchor. Aus genau diesen Announcement-Bytes anschließend
   die SuccessorActivationConfirmationV2 one-shot vorbereiten; ihr
   source_announcement_envelope_sha256 bindet exakt dieses Announcement.
6. RecoveryActivationProofV2 mit genau diesen Announcement- **und Confirmation-
   Bytes** und demselben successor_staging_anchor erzeugen und signieren; erst jetzt die verifizierte
   Source-Lineage um genau einen V2RotationActivationEntryV2 erweitern.
7. Successor-RecoveryArtifactV6 mit dieser erweiterten Lineage
   publizieren/readback-verifizieren. Für diesen staged Successor muss
   recovery_artifact.remote_anchor exakt successor_staging_anchor sein.
8. activation_state="staged" SyncBackupV6 erzeugen und read-only Test-Restore.
   record_rows/remote_anchor_at_export müssen exakt successor_staging_anchor
   reproduzieren.
9. Unmittelbar vor dem Source-Append Successor nochmals vollständig lesen und
   exakt successor_staging_anchor verlangen. Danach exakt die vorbereiteten
   Rotation-Announcement-Bytes appendieren + Source-Full-Readback. Jede
   intervenierende physische Source-Row macht den vorbereiteten Source-Anchor
   historisch; das Announcement darf dann nicht versiegeln.
10. **Sofort nach durable Source-Announcement** den Successor erneut vollständig
    lesen und den Suffix ab successor_staging_anchor klassifizieren:
    - exakt staging anchor => Schritt 11 darf die vorbereitete Confirmation
      appendieren;
    - erste neue Row ist byte-identisch die vorbereitete Confirmation und
      validiert vollständig => bereits durable Confirmation reconciliieren;
    - jede andere erste neue Row => successor_cutover_race; Source-Seal bleibt
      irreversibel und es gibt keinen Switch.
11. Falls die Confirmation noch fehlt, exakt die bereits im
    RecoveryActivationProofV2 gebundenen successor_confirmation_envelope-Bytes
    appendieren + Full Readback. Unknown Outcome wird ausschließlich durch
    Readback derselben Bytes entschieden; niemals alternative Confirmation
    erzeugen.
12. successor_activation_anchor als **Aktivierungsgrenze** persistieren: exakter
    Prefix durch die erste gültige Confirmation-Row einschließlich unmittelbar
    anschließender byte-identischer Retry-Duplikate dieser Confirmation. Ein
    danach bereits vorhandener Suffix ist post-activation und muss vollständig
    durch canonical_full unter der jeweils gültigen Writer-Authority
    verifizieren; der aktuelle RemoteAnchor muss successor_activation_anchor
    monoton erweitern.
13. erweiterte activation_lineage einschließlich §16a.1 und Confirmation
    vollständig bis zum Successor prüfen. Hat ein gültiger post-activation
    Suffix nur Fachrows und/oder WriterGrants hinzugefügt, bleibt der lokale
    Cutover fortsetzbar; writer_status beim späteren Switch wird aus der **final
    verifizierten** Authority abgeleitet und ggf. read_only.
    Hat der post-activation Suffix dagegen
    - eine RecoveryAuthorityTransitionV2 kanonisch akzeptiert, sodass der
      aktuelle Recovery-State nicht mehr exakt dem in Schritt 7 publizierten
      staged RecoveryArtifactV6 entspricht, **oder**
    - ein gültiges RotationAnnouncementV2 akzeptiert und damit diesen Successor
      bereits wieder versiegelt,
    dann ist die Remote-Fortschreibung gültig, aber dieser lokale Cutover ist
    terminal `post_activation_superseded`. Kein stale RecoveryArtifact darf in
    ein activated Backup geschrieben und kein automatischer lokaler Switch auf
    diese inzwischen überholte Lifecycle-Sicht durchgeführt werden. Source-Seal
    und Remote-Aktivierung bleiben gültig; das Gerät bleibt read_only und muss
    die aktuelle kanonische Recovery-/Successor-Kette über den dafür
    autorisierten aktuellen Pfad neu übernehmen.
14. Nur wenn Schritt 13 **nicht** post_activation_superseded ergibt:
    obligatorisch neues activation_state="activated" SyncBackupV6 erzeugen und
    Test-Restore-verifizieren. Dessen remote_anchor_at_export muss dem
    vollständig verifizierten aktuellen Successor-Prefix entsprechen,
    successor_activation_anchor monoton erweitern und das enthaltene
    RecoveryArtifactV6 muss exakt dem final verifizierten Recovery-State dieses
    Prefixes entsprechen; ohne Suffix sind staging/activation Recovery-State
    identisch.
15. ActivationLineageCacheV2 des Successors persistent/readback-verifizieren.
16. **Unmittelbar vor dem lokalen Switch** den Successor erneut per
    canonical_full lesen. Die Confirmation/ActivationLineage müssen weiterhin
    gültig sein. Hat der seit dem Backup hinzugekommene Suffix den Recovery-State
    fortgeschrieben oder den Successor versiegelt, =>
    `post_activation_superseded`, kein lokaler Switch. Enthält er nur gültige
    Fachrows und/oder WriterGrants, bleibt der Switch zulässig; writer_status
    wird aus der jetzt final verifizierten Writer-Authority abgeleitet und ggf.
    read_only. Das bereits verifizierte activated Backup bleibt als gültiger
    Cutover-Sicherheitspunkt bestehen; spätere Remote-Rows werden beim Restore
    über dessen Freshness-Floor normal nachgezogen.
17. erst danach lokaler atomarer Switch/Retire; erst ab diesem Switch darf
    dieses Gerät normale Successor-Writes erzeugen, sofern es nach diesem letzten
    Verify weiterhin current Writer ist. Zwischen diesem letzten Remote-Read und
    dem lokalen Commit existiert mangels providerseitigem CAS weiterhin ein
    unvermeidbares Race-Fenster; es kann keine Remote-Authority erzeugen und wird
    vor jeder späteren Mutation durch das obligatorische frische canonical_full
    wieder erkannt.

Ein staged Backup ersetzt das obligatorische activated Cutover-Backup niemals.

**Cross-Resource-Causality-Grenze:** Source und Successor sind getrennte Google-
Ressourcen ohne gemeinsame atomare Transaktion/Uhr. successor_staging_anchor
beweist deshalb exakt den autorisierten Migrations-Basisprefix; der
Rotation-Service friert ihn ein und prüft ihn unmittelbar vor und nach dem
Source-Seal. Ein **vor** der gebundenen Confirmation beobachteter anderer Suffix ist ein
Cutover-Race und blockiert Aktivierung/Switch. Ein Suffix **nach** exakt der
gebundenen Confirmation ist dagegen post-activation und wird normal durch die
Writer-Authority verifiziert.

Aus einer späteren Recovery-Sicht kann das Protokoll jedoch nicht
kryptographisch beweisen, ob eine **ansonsten gültig writer-signierte**
Successor-Suffixrow Millisekunden vor oder nach dem Source-Announcement
geschrieben wurde. Solche Rows gehören nie zum Migration-Snapshot; sie müssen
einzeln durch die normale Writer-Authority validieren. Schutz gegen einen
Angreifer, der bereits aktuellen Writer-Private-Key **und** RK_epoch kontrolliert,
erfordert für echte Cross-Resource-Causality einen zusätzlichen
Koordinationsdienst/eine neue Protokollversion.

Normale v2→v2-Rotation übernimmt recovery_generation,
recovery_urs_commitment, recovery_urs_id, recovery_takeover_key_id,
recovery_takeover_public_key **und die vollständige
recovery_credential_history** aus dem final verifizierten aktuellen
Source-Recovery-State unverändert in das Successor-Manifest. Das zugehörige
Private-Key-Material wird ausschließlich aus dem mit dem erneut eingegebenen
aktuellen URS verifizierten Source-RecoveryArtifact transient übernommen. Die
neue Epoche erhält einen unabhängig erzeugten RK_epoch, der keinem historischen
source_root_key der erweiterten activation_lineage entsprechen darf, sowie ein
neues RecoveryArtifactV6 mit Manifest-Fingerprint, erweiterter
activation_lineage und finalem Successor-Anchor.

Recovery-Rekey ist eine **zwingend zweiphasige** Maintenance-Operation.
Die same-epoch RecoveryAuthorityTransitionV2 ist nur der crash-sichere
Authority-Cutover; der Recovery-Key-Wechsel ist erst nach einer anschließenden
Successor-Epoch mit neuem RK_epoch abgeschlossen.

Phase A – Recovery-Authority auf der noch aktiven Source:

1. aktive Source vollständig verifizieren und lokal einfrieren;
2. neuen URS + neues Recovery-Takeover-Keypair erzeugen; recovery_urs_id und
   takeover_key_id müssen gegen die vollständige v2-Recovery-Credential-
   Historie frisch sein;
3. RecoveryAuthorityTransitionV2 one-shot gegen den finalen Source-Anchor
   vorbereiten;
4. neues **same-epoch** RecoveryArtifactV6 unter dem neuen URS publizieren. Es
   enthält denselben RK_epoch, dieselbe vollständig verifizierte
   activation_lineage, die um den to-State fortgeschriebene
   recovery_credential_history, den neuen Recovery-Key-State und
   RecoveryAuthorityTransitionProofV2. **Vor dem ersten mutierenden
   Publish-Request** muss RecoveryRekeyOperationStateV2.artifact_publish_attempted
   persistent=true/readback-verifiziert sein. Ab diesem Punkt ist auch ein
   Publish-Timeout/Unknown-Outcome kein freier Abort-Pfad: das Outcome wird über
   exakte Discovery/Grid-Readback reconciliiert; sobald die Artifact-Bytes
   remote existieren, muss die vorbereitete Transition fertiggestellt werden,
   solange ihr authority_anchor remote unverändert ist;
5. Recovery des staged Artifacts testen;
6. exakte Transition-Envelope-Bytes appendieren + Full Readback;
7. neues Artifact jetzt gegen den aktuellen Source-Recovery-State prüfen und
   Forced-Takeover-Keypair-Check durchführen;
8. obligatorischen **activated Source-SyncBackupV6** erzeugen und
   Test-Restore-verifizieren.

Phase B – verpflichtende recovery_rekey-Epoch-Rotation:

9. unmittelbar danach RotationOperationStateV2 mit
   rotation_kind="recovery_rekey" und exakt derselben transition_id starten.
   Geht das ursprüngliche Gerät nach der durablen Transition verloren, muss ein
   anderes Gerät mit dem neuen URS zunächst die aktuelle Recovery-Authority und
   recovery_rekey_rotation_required=true remote verifizieren, bei Bedarf per
   Forced Takeover Writer werden und anschließend gemäß §18.3 einen
   RecoveryRekeyOperationStateV2 mit
   operation_origin="remote_pending_rekey_adoption" erzeugen. Die
   verpflichtende Phase B bleibt dadurch vollständig fortsetzbar.
10. Successor erhält einen **neuen unabhängig erzeugten 32-Byte RK_epoch**,
    übernimmt aber die in Phase A bereits aktuelle
    Recovery-Generation/URS-/Takeover-Authority. Der neue RK muss byteweise von
    jedem source_root_key der resultierenden ActivationLineage verschieden sein;
    dies wird bei Cross-Epoch-Aktivierung als successor_root_key_reuse
    fail-closed geprüft.
11. EpochMigrationV2, RotationAnnouncementV2 und RecoveryActivationProofV2
    binden dieselbe recovery_transition_id; alle normalen §17
    Migration-/Anchor-/Lineage-Gates gelten.
12. Successor-RecoveryArtifactV6 unter dem neuen URS muss den **neuen**
    Successor-RK enthalten; staged und activated Backup-Gates vollständig
    durchlaufen.
13. Erst nach `RotationOperationStateV2.stage="switched"`,
    aktiviertem Successor-Backup und persistiertem Successor-Lineage-Cache darf
    RecoveryRekeyOperationStateV2 `completed` werden. Der Successor startet
    aus seinem Manifest-Baseline-Recovery-State wieder mit
    recovery_rekey_rotation_required=false und
    current_recovery_rekey_transition_id=null.

Altes Recovery-Takeover-Material darf ab der durable Transition keinen Grant
mehr autorisieren. Der alte URS kann während Phase A weiterhin das alte
immutable Source-Artifact und damit den **historischen Source-RK** entschlüsseln;
das ist bis zur Successor-Rotation unvermeidbar. Nach Phase B kann der alte URS
den neuen aktiven Successor-RK nicht ableiten. Historische Vertraulichkeit kann
durch Rekey nicht rückwirkend hergestellt werden, wenn das alte Artifact bereits
kopiert oder kompromittiert war.

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
  recovery_urs_id,
  recovery_rekey_rotation_required,
  recovery_rekey_transition_id,
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
  recovery_credential_history_sha256,
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
  seine kanonische Aktivierung nicht vollständig bewiesen ist;
- `epoch_status="orphaned"` ist ausschließlich ein terminaler lokaler Status
  für eine bereits erzeugte, aber **vor** durable Source-Announcement stale
  gewordene Successor-Epoche. Orphaned ist immer read_only, darf nie wieder
  `active`, Rotations-Successor oder Quelle normaler Remote-Mutationen werden
  und wird bei einem neuen Versuch nicht wiederverwendet;
- native v2-Genesis darf erst nach vollständigem Manifest-/Gen-1-/Remote-Verify
  `active` werden;
- jede nicht-native v2-Epoche darf erst `active` werden, wenn die komplette
  ActivationLineageV2 gemäß §10c **und** die Migration-Integritätsprüfung gemäß
  §16a.1 erfolgreich sind; ein direkter §10b-Proof allein reicht ausdrücklich
  nicht;
- `active` darf erst nach diesem vollständigen Aktivierungsnachweis persistiert
  werden;
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

recovery_urs_id und recovery_takeover_key_id sind nach gebundenem Full Verify
nicht-null und müssen exakt zum **aktuellen** Recovery-State des Verifiers
passen. recovery_credential_history_sha256 ist exakt
Base64URL(SHA-256(UTF8(JCS(verifier.recovery_credential_history)))) und bindet
den lokal gecachten epochübergreifenden Freshness-Stand, ohne die komplette
Historie doppelt im normalen State zu persistieren.
stale_writer_pending_count und operation_generation sind nichtnegative
Safe-Integer.

rotation_state_ref, writer_operation_state_ref und recovery_operation_state_ref
sind null oder verwenden exakt die geschlossene Operation-Referenzform:

~~~text
{
  operation_id,
  state,
  state_record_hash
}
~~~

Dabei gilt:
- rotation_state_ref -> RotationOperationStateV2;
- writer_operation_state_ref -> WriterGrantOperationStateV2;
- recovery_operation_state_ref -> RecoveryRekeyOperationStateV2;
- operation_id muss exakt dem referenzierten Objekt entsprechen;
- state muss exakt dessen aktuellem `stage` entsprechen;
- state_record_hash =
  Base64URL(SHA-256(UTF8(JCS(referenced_operation_state)))).

`migration_state_ref` ist in diesem eingefrorenen v2-Profil **zwingend null**.
Profile-Upgrade verwendet RotationOperationStateV2 mit
rotation_kind="profile_upgrade"; ein separates MigrationOperationStateV2 ist
nicht definiert und darf nicht improvisiert werden.

activation_lineage_cache_ref ist **kein Operation-State** und ist null oder
exakt:

~~~text
{
  cache_id,
  cache_record_hash
}
~~~

cache_id muss exakt dem cache_id des referenzierten ActivationLineageCacheV2
entsprechen.

~~~text
cache_record_hash =
  Base64URL(SHA-256(UTF8(JCS(activation_lineage_cache_v2))))
~~~

Operation- und Cache-Refs werden zusätzlich durch K_local_state_mac des
EpochLocalSecurityStateV6 authentifiziert.

recovery_generation, recovery_urs_commitment und recovery_takeover_key_id
beschreiben nach gebundenem Full Verify den **aktuellen** Recovery-State nach
allen akzeptierten RecoveryAuthorityTransitionV2-Controls; sie sind nicht
notwendig identisch mit den immutable Manifest-Startwerten.

recovery_rekey_rotation_required und recovery_rekey_transition_id bilden den
ebenfalls vollständig remote verifizierten Pending-Rekey-State ab:

~~~text
false <=> recovery_rekey_transition_id = null
true  <=> recovery_rekey_transition_id = current_recovery_rekey_transition_id
~~~

Diese Felder sind nur ein lokal authentifizierter Cache des Remote-Verifier-
Ergebnisses. Vor jeder Mutation muss canonical_full den Remote-State erneut
bestätigen; ein lokaler false-Wert kann den Remote-Fence niemals aufheben.

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
  operation_origin: "local_rekey" | "remote_pending_rekey_adoption",
  supersedes_transition_id,
  superseded_by_transition_id,
  epoch_id,
  stage:
    "new_material_staged" |
    "recovery_artifact_published" |
    "transition_pending" |
    "transition_unknown" |
    "transition_durable" |
    "source_backup_verified" |
    "successor_rotation_required" |
    "completed" |
    "stale" |
    "superseded",
  authority_anchor_before_transition,
  transition_id,
  transition_envelope,
  recovery_artifact_id,
  recovery_artifact_locator,
  artifact_publish_attempted,
  transition_proof_sha256,
  to_recovery_generation,
  to_recovery_urs_commitment,
  to_recovery_urs_id,
  to_recovery_takeover_key_id,
  completed_successor_epoch_id,
  completed_successor_manifest_fingerprint
}
~~~

Dieser State enthält **niemals** URS, PKCS#8 oder plaintext Root-Keys.
RecoveryTakeoverStagingV2 hält das private Takeover-Material separat
URS-verschlüsselt.

transition_id, to_recovery_generation, to_recovery_urs_commitment,
to_recovery_urs_id und to_recovery_takeover_key_id müssen exakt den to-Feldern
des persistent vorbereiteten RecoveryAuthorityTransitionV2-Envelope und des
RecoveryAuthorityTransitionProofV2 entsprechen und sind ab der ersten
persistierten Operation-State-Version immutable.

`artifact_publish_attempted` startet false. Unmittelbar **vor dem ersten
mutierenden Remote-Request**, der das staged RecoveryArtifactV6 erzeugen oder
dessen Grid schreiben könnte, wird es persistent auf true gesetzt und
readback-verifiziert; danach ist es immutable true. Damit überlebt auch ein
Crash/Timeout zwischen Remote-Mutation und Artifact-Readback. Solange
`artifact_publish_attempted=true` ist, darf ein rein lokaler Abort niemals
`stale` erzeugen, selbst wenn der lokale Stage-Name noch
`new_material_staged` lautet. Zuerst muss das Publish-Outcome per
authentifizierter Discovery/Grid-Readback reconciliiert werden; existieren die
exakten Artifact-Bytes, gilt die Operation als
`recovery_artifact_published`.

operation_origin="local_rekey" startet ausschließlich in
`new_material_staged`.

Für operation_origin="local_rekey" gilt:
- canonical_full recovery_rekey_rotation_required=false =>
  supersedes_transition_id=null;
- canonical_full recovery_rekey_rotation_required=true =>
  supersedes_transition_id muss exakt current_recovery_rekey_transition_id sein.
  Das ist ein ausdrücklich neuer Rekey-Versuch, der den noch ausstehenden
  Recovery-Key erneut ersetzt.
- superseded_by_transition_id startet immer null.

### Lokale Supersession eines bereits durablen Pending-Rekey

Existiert lokal bereits ein durch recovery_operation_state_ref referenzierter,
nicht-terminaler RecoveryRekeyOperationStateV2 für die remote-current
Pending-Transition und soll ein weiterer Recovery-Key-Wechsel ihn superseden,
gilt exakt:

1. canonical_full muss recovery_rekey_rotation_required=true liefern und die
   transition_id des alten referenzierten States muss exakt
   current_recovery_rekey_transition_id sein.
2. Es darf kein nicht-terminaler RotationOperationStateV2 existieren.
3. Der neue operation_origin="local_rekey"-State wird mit
   supersedes_transition_id=alte transition_id und
   superseded_by_transition_id=null vollständig persistent geschrieben und
   readback-verifiziert.
4. In **einer** lokalen atomaren, MAC-authentifizierten Transaktion wird
   recovery_operation_state_ref vom alten auf den neuen operation_id umgebunden.
   Der alte State bleibt unverändert persistent, ist aber solange **suspendiert**
   und nimmt nicht an Operation-Locking/Resume teil, solange der Ref auf den
   neuen State zeigt.
5. Erst danach dürfen die neuen RecoveryArtifact-/Transition-Remote-Schritte
   beginnen.
6. Wird der neue Versuch **vor dem ersten mutierenden Artifact-Publish-
   Request**, also bei `artifact_publish_attempted=false`, lokal abgebrochen
   oder anderweitig stale, wird sein State terminal `stale`. Sobald
   `artifact_publish_attempted=true` persistent ist, ist ein rein lokaler
   Abbruch auch ohne Erfolgs-Readback verboten: das Publish-Outcome muss zuerst
   remote reconciliiert werden. Solange Remote noch exakt am authority_anchor
   steht, werden dieselben Artifact-Bytes weiter reconciliiert/publiziert und
   anschließend die vorbereitete Transition fertiggestellt. `stale` ist dann
   nur zulässig, wenn canonical_full beweist, dass eine andere physische Row den
   Anchor irreversibel überholt hat und die vorbereitete Transition deshalb nach
   §16c nicht mehr appendbar ist. Erst danach wird der alte suspendierte State
   wieder gebunden/adoptiert, falls dessen Remote-Transition weiterhin current
   ist.
7. Wird die neue Transition durable, muss canonical_full beweisen:
   current_recovery_rekey_transition_id == neue transition_id und
   supersedes_transition_id == alte transition_id. Danach werden **in einer
   lokalen atomaren Transaktion**:
   - der alte State auf stage=`superseded` gesetzt;
   - dessen superseded_by_transition_id=neue transition_id gesetzt;
   - der neue State auf/bei stage=`transition_durable` belassen;
   - recovery_operation_state_ref auf dem neuen operation_id bestätigt.
8. `superseded` ist terminal und darf niemals wieder resumed oder als
   Rotationspflicht interpretiert werden. Die remote-current Transition des
   Verifiers bleibt allein maßgeblich.

Damit existiert zu jedem Zeitpunkt höchstens **ein referenzierter aktiver**
RecoveryRekeyOperationStateV2, während eine vor-durable Supersession bei Crash
auf die weiterhin kanonische ältere Remote-Transition zurückfallen kann.

Zusätzliche Stage-Invarianten:

- stage!="superseded" => superseded_by_transition_id=null.
- stage="superseded" => superseded_by_transition_id ist non-null, ungleich der
  eigenen transition_id und canonical_full muss beweisen, dass genau diese ID
  remote current ist oder bereits durch eine noch neuere Transition in derselben
  nachweisbaren Supersession-Kette ersetzt wurde.
- Aus `transition_durable`, `source_backup_verified` oder
  `successor_rotation_required` ist der Übergang nach `superseded`
  ausschließlich durch Schritt 7 der atomaren Supersession zulässig.
- `completed`, `stale` und `superseded` sind terminal.

operation_origin="remote_pending_rekey_adoption" hat
supersedes_transition_id=null und darf ausschließlich neu
erzeugt werden, wenn:

1. canonical_full auf der Source
   recovery_rekey_rotation_required=true und eine nicht-null
   current_recovery_rekey_transition_id liefert;
2. das unter dem **aktuellen** URS entschlüsselte RecoveryArtifactV6 exakt zu
   aktuellem Recovery-State und derselben transition_id passt;
3. RecoveryAuthorityTransitionProofV2 und die Transition-Row bereits durable
   verifiziert sind;
4. das Gerät nach §16 entweder bereits current Writer ist oder unmittelbar
   vorher einen gültigen Forced Takeover abgeschlossen hat.

Dieser Adoption-State wird lokal mit einem **neuen** operation_id direkt in
stage=`transition_durable` angelegt. authority_anchor_before_transition,
transition_envelope, recovery_artifact_id/-locator, transition_proof_sha256 und
alle to-Felder werden aus dem verifizierten Artifact/Remotezustand übernommen.
Damit hängt Phase B nach Geräteverlust nicht vom verlorenen ursprünglichen
Operation-State ab.

Geschlossene Stage-Reihenfolge für operation_origin="local_rekey":

~~~text
new_material_staged -> recovery_artifact_published | stale
recovery_artifact_published -> transition_pending | stale
transition_pending -> transition_unknown | transition_durable | stale
transition_unknown -> transition_durable | stale
transition_durable -> source_backup_verified
source_backup_verified -> successor_rotation_required
successor_rotation_required -> completed
~~~

Die vier `-> stale`-Kanten sind **keine freien Abbruchpfade**:
- aus `new_material_staged` ist lokaler Abort nur zulässig, solange
  artifact_publish_attempted=false;
- sobald artifact_publish_attempted=true ist, ist `stale` vor
  transition_durable ausschließlich zulässig, wenn canonical_full einen anderen
  ersten physischen Suffix nach authority_anchor beweist und §16c die
  vorbereitete Transition damit irreversibel unappendbar macht;
- ein Unknown Outcome des Artifact-Publish ist deshalb niemals gleichbedeutend
  mit „nicht publiziert“ und erlaubt keinen lokalen Abort.

Für operation_origin="remote_pending_rekey_adoption" gilt
supersedes_transition_id=null und superseded_by_transition_id=null.
`transition_durable` ist der einzige zulässige Initialzustand; danach gilt exakt
derselbe Suffix:

~~~text
transition_durable -> source_backup_verified
source_backup_verified -> successor_rotation_required
successor_rotation_required -> completed
~~~

`stale` darf vor `recovery_artifact_published` bei lokalem Abbruch oder
überholtem Transition-Anchor erreicht werden. **Ab** erfolgreichem
`recovery_artifact_published` ist ein lokaler Abbruch allein nicht mehr
zulässig, weil das immutable Artifact eine vom damaligen Writer bereits
signierte bedingte Remote-Capability enthält. Bis `transition_durable` ist
`stale` dann nur zulässig, wenn canonical_full einen anderen ersten physischen
Suffix nach authority_anchor beweist und §16c dadurch die vorbereitete
Transition endgültig nicht mehr appendieren darf. Nach `transition_durable` ist die neue Recovery-Authority
bereits kanonisch; der Rekey darf dann nicht abgebrochen oder auf die alte
Generation zurückgesetzt werden. Ein post-durable State darf ausschließlich
durch eine **neuere durable RecoveryAuthorityTransitionV2** gemäß der obigen
atomaren Supersession auf `superseded` wechseln.

Crash-Regeln:

- Solange artifact_publish_attempted=false ist, ist keine staged
  Recovery-Capability remote behauptbar und ein lokaler Abort aus
  new_material_staged zulässig.
- Sobald artifact_publish_attempted=true ist, muss ein Crash/Unknown Outcome des
  Artifact-Publish zuerst remote reconciliiert werden; lokale Abwesenheit eines
  Erfolgs-Callbacks beweist keine Abwesenheit der Capability.
- Nach verifiziertem `recovery_artifact_published`, aber vor durable
  Transition, kann nur §16c die exakt vorbereitete Transition crash-resumable
  abschließen.
- Nach `transition_durable` muss ein activated SyncBackupV6 der **Source**
  erzeugt und Test-Restore-verifiziert werden; danach stage=
  `successor_rotation_required`.
- In `successor_rotation_required` muss eine RotationOperationStateV2 mit
  rotation_kind="recovery_rekey", derselben source_epoch_id und derselben
  source_recovery_transition_id erfolgreich bis `switched` geführt werden.
  Ein einzelner stale Rotation-Versuch beendet den Rekey nicht; ein neuer
  anchor-frischer RotationOperationStateV2 darf gestartet werden.
- `completed_successor_epoch_id` und
  `completed_successor_manifest_fingerprint` sind bis `completed` null. Beim
  Übergang zu `completed` werden sie exakt aus dem erfolgreich geswitchten
  Successor übernommen und danach immutable.
- `completed` ist nur zulässig, wenn der Successor einen **anderen neuen
  RK_epoch** besitzt, seine activated Backup-/Lineage-Gates bestanden hat und
  der lokale Switch abgeschlossen ist.

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
    "announcement_prepared" |
    "recovery_artifact_verified" |
    "staged_backup_verified" |
    "announcement_unknown" |
    "announcement_durable" |
    "confirmation_unknown" |
    "confirmation_durable" |
    "activated_backup_verified" |
    "switched" |
    "stale" |
    "cutover_race" |
    "post_activation_superseded",
  source_anchor_before_announcement,
  successor_staging_anchor,
  successor_activation_anchor,
  successor_creation_locator,
  successor_manifest_fingerprint,
  source_recovery_transition_id,
  activation_lineage_sha256,
  announcement_envelope,
  confirmation_envelope,
  activation_evidence_sha256,
  recovery_artifact_id,
  staged_backup_id,
  activated_backup_id
}
~~~

Typbindung:

- rotation_kind="profile_upgrade":
  source_anchor_before_announcement ist RemoteAnchorV1 und
  source_recovery_transition_id=null.
- rotation_kind="normal":
  source_anchor_before_announcement ist RemoteAnchorV2 und
  source_recovery_transition_id=null.
- rotation_kind="recovery_rekey":
  source_anchor_before_announcement ist RemoteAnchorV2 und
  source_recovery_transition_id ist die exakt gebundene transition_id gemäß
  §16a/§16a.1.

`activation_evidence_sha256` ist:
- bei profile_upgrade:
  Base64URL(SHA-256(UTF8(JCS(ProfileUpgradeActivationEntryV2))));
- bei normal/recovery_rekey:
  Base64URL(SHA-256(UTF8(JCS(RecoveryActivationProofV2)))).

Die Stage-Reihenfolge ist geschlossen. Erlaubt sind nur:

~~~text
source_frozen_verified -> successor_planned
successor_planned -> successor_bound
successor_bound -> copying
copying -> successor_verified
successor_verified -> announcement_prepared
announcement_prepared -> recovery_artifact_verified
recovery_artifact_verified -> staged_backup_verified
staged_backup_verified -> announcement_unknown | announcement_durable
announcement_unknown -> announcement_durable | stale
announcement_durable -> confirmation_unknown | confirmation_durable | cutover_race
confirmation_unknown -> confirmation_durable | cutover_race
confirmation_durable -> activated_backup_verified | post_activation_superseded
activated_backup_verified -> switched
~~~

`stale` darf zusätzlich aus jedem Stadium **vor**
`announcement_durable` erreicht werden, wenn der gebundene Source-Anchor,
successor_staging_anchor, die Writer-/Recovery-Authority oder der vorbereitete
Successor anderweitig ungültig wurde.

`cutover_race` darf ausschließlich **nach** durable Source-Announcement aus
`announcement_durable` oder `confirmation_unknown` erreicht werden, wenn
der Successor den staging anchor erweitert und die **erste** neue physische Row
nicht exakt die vorbereitete Confirmation ist bzw. diese nicht vollständig
validiert. Ist die erste neue Row exakt die vorbereitete Confirmation, wird
stattdessen nach `confirmation_durable` reconciliiert; ein danach gültiger
post-activation Suffix ist kein Cutover-Race. Der Source-Seal wird niemals
zurückgerollt; ein echter cutover_race bleibt expliziter Support-/Recovery-Fall
und darf weder activated Backup noch lokalen Switch erzeugen.

`switched`, `stale`, `cutover_race` und
`post_activation_superseded` sind terminal.

`post_activation_superseded` ist ausschließlich nach
`confirmation_durable` zulässig, wenn canonical_full beweist, dass ein
gültiger post-activation Suffix entweder den Recovery-State gegenüber dem
staged RecoveryArtifact fortgeschrieben oder den Successor bereits wieder
versiegelt hat. Dieser Zustand ist **kein** Cutover-Race und macht die gültige
Remote-Historie nicht rückgängig. Er verbietet lediglich activated Backup und
automatischen lokalen Switch dieses überholten Operation-State.

Wird eine Rotation **vor** durable Source-Announcement `stale` und existiert
bereits eine Successor-Ressource, wird deren lokaler EpochLocalSecurityStateV6
irreversibel `epoch_status="orphaned"`, `writer_status="read_only"`. Dieser
Successor, sein immutable RecoveryArtifact und seine vorbereiteten Control-Bytes
dürfen für keinen späteren Rotationsversuch wiederverwendet werden. Ein neuer
Versuch benötigt mindestens neue successor_epoch_id, key_id, RK_epoch,
creation_locator, recovery_artifact_id sowie neue operation-/rotation-/
migration-/confirmation-/envelope-IDs. Ein `cutover_race` **nach** durable
Source-Announcement ist dagegen kein frei wiederholbarer Rotationsversuch: die
Source ist bereits irreversibel versiegelt und der gebundene Successor bleibt
ein expliziter Support-/Recovery-Fall.

Feldinvarianten nach Stage:

- source_anchor_before_announcement: ab source_frozen_verified non-null und
  danach immutable;
- successor_staging_anchor: bis copying null; beim Übergang
  copying->successor_verified exakt aus dem vollständig verifizierten
  Successor-Prefix nach der Migration-Control gesetzt und danach immutable;
- successor_activation_anchor: bis confirmation_durable null; ab
  confirmation_durable exakt als Prefix-Grenze durch die erste gültige
  Confirmation-Row einschließlich unmittelbar anschließender byte-identischer
  Confirmation-Retries gesetzt und immutable. Ein späterer post-activation
  Suffix verändert diesen Anchor nicht;
- successor_creation_locator: ab successor_planned non-null und immutable; er
  muss exakt dem geschützten creation_locator des Successor-Manifests sowie dem
  successor_creation_locator des vorbereiteten Announcements entsprechen;
- successor_manifest_fingerprint: ab successor_bound non-null und immutable;
- announcement_envelope + confirmation_envelope + activation_evidence_sha256:
  bis successor_verified null; ab announcement_prepared alle non-null und
  immutable;
- activation_lineage_sha256 + recovery_artifact_id:
  bis announcement_prepared null; ab recovery_artifact_verified non-null und
  immutable;
- staged_backup_id: bis recovery_artifact_verified null; ab
  staged_backup_verified non-null und immutable;
- activated_backup_id: bis announcement_durable null; ab
  activated_backup_verified non-null und immutable;
  in post_activation_superseded bleibt es null.

Die Reihenfolge `announcement_prepared -> recovery_artifact_verified` ist
zwingend, weil RecoveryActivationProofV2 bzw. ProfileUpgradeActivationEntryV2
die **exakten one-shot Announcement-Envelope-Bytes** bereits im RecoveryArtifact
binden.

Nach `announcement_durable` ist das Source-Seal irreversibel. Vor einem
Confirmation-Append muss canonical_full des Successors entweder weiterhin exakt
successor_staging_anchor ergeben **oder** bereits als erste Suffix-Row exakt die
vorbereitete Confirmation enthalten; im zweiten Fall wird nur reconciliiert und
nicht erneut appended. Erst `confirmation_durable` erzeugt den festen
successor_activation_anchor. Vor `switched` muss zwingend ein neuer activated
SyncBackupV6 des Successors erzeugt, Test-Restore-verifiziert und als
`activated_backup_verified` persistiert sein; dessen exportierter RemoteAnchor
muss dem aktuellen vollständig verifizierten Prefix entsprechen und
successor_activation_anchor monoton erweitern. Das frühere staged Backup genügt
dafür nicht.

Alle Resume-Pfade beginnen mit Verifikation der beteiligten Remote-Epochen und
Abgleich der gespeicherten Anchor/Envelope-/Evidence-Bytes. Für einen staged
Successor in stage successor_bound|copying ist dafür ausschließlich der oben
definierte operation-gebundene `rotation_resume`-Modus zulässig; ab
successor_verified ist wieder `canonical_full` Pflicht. Ein
State-Record-Hash-Mismatch, unbekannte Stage, übersprungene Stage oder
semantisch inkonsistente Feldkombination ist security_blocked; kein
„best effort“-Fortsetzen.

### Operation-Locking

- Während nicht-terminalem RecoveryRekeyOperationStateV2 sind Fachwrites und
  Handoff lokal gesperrt.
- Forced Takeover ist auf demselben Gerät gesperrt, solange ein lokaler
  RecoveryRekeyOperationStateV2 existiert; bei Geräteverlust wird ein
  maintenance-only Writer **vor** Anlage des
  operation_origin="remote_pending_rekey_adoption"-States per Forced Takeover
  gewonnen.
- Rotation ist während RecoveryRekeyOperationStateV2 grundsätzlich gesperrt.
  Einzige Ausnahme: stage="successor_rotation_required" erlaubt exakt eine
  RotationOperationStateV2 mit rotation_kind="recovery_rekey",
  source_epoch_id=RecoveryRekeyOperationStateV2.epoch_id und
  source_recovery_transition_id=RecoveryRekeyOperationStateV2.transition_id.
  Normale/profile_upgrade-Rotation bleibt gesperrt. Wird ein solcher
  RotationOperationStateV2 stale, darf nach erneutem canonical_full ein neuer
  matching Rekey-Rotationsversuch gestartet werden.
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
recovery_urs_id
recovery_credential_history
recovery_takeover_key_id
recovery_takeover_public_key
recovery_takeover_private_key_pkcs8
activation_lineage
recovery_authority_transition_proof
created_at
~~~

recovery_urs_commitment muss exakt aus dem eingegebenen URS, diary_id und
recovery_generation gemäß §10 reproduzierbar sein. recovery_urs_id muss aus
demselben eingegebenen URS gemäß §2 reproduzierbar sein.

Im Normalfall müssen recovery_generation, recovery_urs_commitment,
recovery_urs_id, recovery_credential_history, recovery_takeover_key_id und
recovery_takeover_public_key exakt dem **aktuell verifizierten Recovery-State**
der Epoche entsprechen. Einzige Ausnahme ist der
explizite §16c-Staging-Fall **vor** durabler RecoveryAuthorityTransitionV2:
Dann darf ein Artifact mit gültigem recovery_authority_transition_proof bereits
den exakt gebundenen to-State repräsentieren, während Remote noch am
Proof-from-State/Anchor steht. Dieses Artifact ist ausschließlich staged/read-
only und darf nur die exakt vorbereitete Transition fertigstellen.

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
  recovery_urs_commitment, recovery_urs_id, recovery_credential_history,
  Takeover-Key-ID und Public Key exakt dem vollständig verifizierten aktuellen
  Recovery-State entsprechen.
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

Für ein RecoveryArtifactV6, das während einer noch nicht lokal geswitchten
profile_upgrade-/normal-/recovery_rekey-Successor-Rotation erzeugt wird, muss
remote_anchor exakt dem im zugehörigen Activation-Evidence gebundenen
successor_staging_anchor entsprechen. Same-epoch Recovery-Rekey-Artefakte aus
§16c folgen stattdessen ihrem authority_anchor_before_transition/aktuellen
Source-State.

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
  recovery_urs_commitment,
  recovery_urs_id,
  recovery_takeover_key_id,
  recovery_takeover_public_key,
  recovery_credential_history_sha256,
  recovery_rekey_rotation_required,
  recovery_rekey_transition_id,
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

recovery_credential_history_sha256 ist exakt
Base64URL(SHA-256(UTF8(JCS(recovery_artifact.recovery_credential_history)))).

recovery_generation, recovery_urs_commitment, recovery_urs_id,
recovery_takeover_key_id, recovery_takeover_public_key,
recovery_credential_history_sha256, recovery_rekey_rotation_required und
recovery_rekey_transition_id müssen exakt dem durch `record_rows`
vollständig verifizierten **End-Recovery-State** entsprechen. Das entschlüsselte
`recovery_artifact` muss denselben aktuellen Recovery-State und dieselbe
Credential-History repräsentieren; ein historisches Artifact ist für ein
activated Backup unzulässig. Es gilt zusätzlich:
`recovery_rekey_rotation_required=false` genau dann, wenn
`recovery_rekey_transition_id=null`.

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

Für die obligatorischen Cutover-Backups einer noch nicht lokal geswitchten
nicht-nativen Epoche gilt zusätzlich:
- activation_state="staged" => remote_anchor_at_export muss exakt
  successor_staging_anchor des Activation-Evidence entsprechen;
- activation_state="activated" => die ActivationLineage muss den exakten
  successor_activation_anchor nach der durablen SuccessorActivationConfirmation
  reproduzieren; remote_anchor_at_export muss dem beim Export vollständig
  verifizierten aktuellen Successor-Prefix entsprechen und diesen
  successor_activation_anchor monoton erweitern. Ohne post-activation Suffix
  sind beide Anchor identisch.
Ein Cutover-Backup, dessen Prefix die Aktivierungsgrenze nicht exakt enthält oder
nicht monoton erweitert, ist ungültig.

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

### 21.1 Unvermeidbare v1-TOCTOU-Sicherheitsgrenze

Das eingefrorene `rotation-announcement-sw-v1` besitzt **keinen**
Source-Anchor und v1 besitzt keine geräteübergreifend kryptographisch gefencete
Writer-Authority. Google Sheets API v4 bietet für den hier verwendeten
`spreadsheets.batchUpdate`-/Append-Pfad keinen protokollseitig gebundenen
Compare-and-Swap gegen den zuvor gelesenen _r-Prefix.

Daher kann v2 beim einmaligen profile_upgrade folgende Race nicht
kryptographisch ausschließen:

~~~text
v1 Source bei Hn eingefroren/verifiziert
-> anderer v1-Client appendet Row n+1
-> vorbereitetes v1 Rotation Announcement landet als Row n+2
~~~

Der v1-Verifier kann das Announcement dann als Retirement sehen, während der
ProfileUpgradeActivationEntryV2 es wegen fehlender unmittelbarer
Anchor-Nachbarschaft korrekt **nicht** als Aktivierung des Successors akzeptiert.
Das ist fail-closed, kann aber die Migration in einen Availability-/Support-
Zustand bringen.

Deshalb ist profile_upgrade nur unter folgender expliziter Sicherheitsprämisse
zulässig:

1. aktuelles Gerät ist der einzige tatsächlich schreibende v1-Client für dieses
   Tagebuch;
2. alle anderen Geräte, Browserprofile/PWA-Instanzen mit dieser v1-Epoche sind
   geschlossen bzw. dürfen bis Abschluss des Upgrades nicht schreiben;
3. alle eigenen v1-Pending-/Unknown-Outcome-Envelopes sind vor Freeze vollständig
   reconciliiert;
4. unmittelbar vor dem Announcement-Append wird die v1-Source erneut vollständig
   gelesen und ihr RemoteAnchor muss **exakt** dem eingefrorenen
   source_anchor_before_announcement entsprechen;
5. zwischen diesem finalen Read und dem Append existiert dennoch keine
   kryptographische Cross-Device-CAS-Garantie. Das UI muss diese Restgrenze vor
   profile_upgrade ausdrücklich anzeigen.

Wird nach dem Announcement beim finalen v1-/Successor-Readback festgestellt,
dass entweder zwischen dem eingefrorenen v1-Anchor und dem Announcement eine
fremde/zusätzliche physische Source-Row liegt **oder** der Successor seinen
eingefrorenen successor_staging_anchor nicht mehr exakt trägt, gilt:

~~~text
profile_upgrade_source_race
profile_upgrade_successor_cutover_race
~~~

- Successor bleibt staged/read_only und darf niemals aktiviert werden;
- kein zweites v1-Rotation-Announcement und kein automatisches „Reparieren“ der
  Migration;
- kein stilles Verwerfen der zusätzlichen v1-Row;
- lokaler Zustand geht in einen expliziten Support-/Recovery-Status; Daten aus
  v1 und staged Successor bleiben exportierbar;
- produktiver Mehrgeräte-Cutover ist blockiert.

Eine vollständig kryptographische Beseitigung dieser einmaligen Grenze würde
das eingefrorene v1-Wireformat oder einen zusätzlichen Koordinationsdienst
ändern und ist daher nicht Teil dieses v2-Profils.

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
7. neuen unabhängig erzeugten 32-Byte RK_epoch und creation_locator für die
   v2-Epoche festlegen; der RK muss vom im ProfileUpgradeActivationEntryV2
   gebundenen v1-source_root_key verschieden sein. Aus dem **aktuellen**
   eingegebenen v1-URS wird recovery_urs_id gemäß §2 abgeleitet; zusammen mit
   aktueller Recovery-Generation und dem neu erzeugten v2-Takeover-Key bildet
   dies den exakt einen ersten Eintrag der v2-recovery_credential_history.
   Historisch vor-v2 pensionierte Recovery-Secrets werden nicht behauptet.
   Immutable ManifestV6 mit genau diesem creation_locator und dieser singleton
   History lokal erzeugen und Fingerprint bestimmen.
8. RecoveryTakeoverStagingV2 mit diesem Manifest-Fingerprint
   persistieren/readback-verifizieren; erst danach extrahierbaren temporären
   Recovery-Private-Key verwerfen und mutierendes Remote-I/O beginnen.
9. Gen-1-Grant als erste _r-Row mit authority_anchor=H0 schreiben.
10. jeden am eingefrorenen v1-Source-Prefix aktuellen fachlichen Head exakt nach
    §16a.0 als RevisionV2 unter Gen-1-Authority schreiben/signieren: gleiche
    Fachsemantik, neue revision_id, leere Parents und `migration_origin` mit
    exakt dieser v1-Source-Epoche/record_id/revision_id.
11. Migration-Control mit migration_kind="profile_upgrade",
    source_writer_authority=null und source_recovery_transition_id=null
    schreiben. Source-Snapshot-Hashes werden aus dem final verifizierten
    v1-Source-Prefix berechnet; Result-Hash/Counts aus dem Successor-Fachgraphen
    unmittelbar vor dieser Control-Row.
12. Successor vollständig mit V2-Verifier verifizieren und §16a.1 gegen v1-Source
    und Successor erfolgreich ausführen. Den aktuellen Successor-RemoteAnchor als
    successor_staging_anchor einfrieren. Bis zur
    SuccessorActivationConfirmation ist jede andere neue Row verboten; nach
    exakt dieser Confirmation ist ein vollständig gültiger post-activation
    Suffix zulässig.
13. v1-Rotation-Announcement exakt one-shot vorbereiten. Aus genau diesen
    Announcement-Bytes die SuccessorActivationConfirmationV2 one-shot
    vorbereiten. Danach ProfileUpgradeActivationEntryV2 aus RK_v1, finalem
    v1-Source-Anchor, successor_staging_anchor und genau diesen Announcement-
    **und Confirmation-Bytes** erzeugen;
    activation_lineage=[dieser Eintrag].
14. aus RecoveryTakeoverStagingV2 das finale RecoveryArtifactV6 mit
    remote_anchor=successor_staging_anchor, activation_lineage und
    recovery_authority_transition_proof=null erzeugen, lokal/remote
    readback-verifizieren und staged Test-Recovery durchführen.
15. staged SyncBackupV6 erzeugen und Test-Restore als local_offline/read_only
    durchführen; record_rows/remote_anchor_at_export müssen exakt
    successor_staging_anchor reproduzieren.
16. RecoveryTakeoverStagingV2 darf jetzt gelöscht werden.
17. v1-Source **und Successor erneut vollständig lesen**. Der v1-RemoteAnchor
    muss exakt source_anchor_before_announcement und der Successor-RemoteAnchor
    exakt successor_staging_anchor entsprechen. Andernfalls Upgrade vor
    Announcement abbrechen und v1 weiter als Source behandeln. Existiert bereits
    eine Successor-Ressource, wird sie dabei lokal `orphaned/read_only` und
    darf für einen neuen Versuch nicht wiederverwendet werden; der neue Versuch
    benötigt neue Epoch-/Root-/Creation-/Artifact-/Control-/Envelope-IDs.
18. exakt vorbereitetes v1 Rotation Announcement durable machen und danach
    **beide** Remotes unmittelbar erneut lesen. Liegt das Announcement nicht
    unmittelbar nach dem gebundenen Source-Prefix, =>
    profile_upgrade_source_race gemäß §21.1. Beim Successor gilt:
    exakt staging anchor => Confirmation fehlt noch; erste neue Row ist exakt die
    vorbereitete Confirmation => bereits durable Confirmation reconciliieren;
    jede andere erste neue Row => profile_upgrade_successor_cutover_race.
19. Falls die Confirmation noch fehlt, exakt die im
    ProfileUpgradeActivationEntryV2 gebundenen
    successor_confirmation_envelope-Bytes als unmittelbare nächste Successor-Row
    appendieren + Full Readback. Bei Crash/Unknown Outcome werden ausschließlich
    dieselben Bytes reconciliiert/retried.
20. successor_activation_anchor als exakten Prefix durch die erste gültige
    Confirmation einschließlich unmittelbar anschließender byte-identischer
    Confirmation-Retries persistieren. Einen danach vorhandenen
    post-activation Suffix vollständig per canonical_full verifizieren und
    anschließend die vollständige activation_lineage-/Migration-/Confirmation-
    Prüfung ausführen. Erst jetzt ist der Successor remote aktiviert. Hat dieser
    Suffix den Recovery-State gegenüber dem in Schritt 14 erzeugten
    RecoveryArtifact fortgeschrieben oder den Successor durch ein gültiges
    RotationAnnouncement bereits wieder versiegelt, wird der lokale Upgrade-
    Vorgang terminal `post_activation_superseded`: die gültige Remote-Historie
    bleibt bestehen, aber es gibt aus diesem Operation-State kein activated
    Backup und keinen automatischen lokalen Switch.
21. Nur wenn Schritt 20 nicht post_activation_superseded ergibt:
    **obligatorisch** ein neues activation_state="activated" SyncBackupV6 des
    Successors erzeugen und Test-Restore-verifizieren; remote_anchor_at_export
    muss dem aktuellen vollständig verifizierten Prefix entsprechen,
    successor_activation_anchor monoton erweitern und das RecoveryArtifact muss
    exakt dem End-Recovery-State der exportierten Rows entsprechen.
22. ActivationLineageCacheV2 persistieren/readback-verifizieren.
23. unmittelbar vor dem lokalen Umschalten den v2-Successor erneut
    canonical_full verifizieren. Recovery-State-Fortschritt oder erneutes Seal
    seit dem activated Backup => post_activation_superseded/kein Auto-Switch;
    reine Fachrows/WriterGrants sind zulässig und der lokale writer_status wird
    aus der letzten Authority abgeleitet.
24. erst danach atomar auf v2 umschalten; v1 retire und normale Successor-Writes
    freigeben. Auch hier bleibt zwischen letztem Remote-Read und lokalem Commit
    die dokumentierte No-CAS-Restgrenze; vor jeder Mutation folgt erneut Full
    Verify.

Kein v1-Client darf eine v2-Epoche als v1 interpretieren.

---

## 22. Fail-closed Klassifikation

Nicht-fatal semantisch verworfen:

~~~text
stale_writer_rejected
stale_grant_rejected
stale_recovery_transition_rejected
stale_rotation_announcement_rejected
rekey_rotation_required_rejected
stale_after_seal_rejected
~~~

Recoverbarer staged Verifierzustand, **nicht fatal**:

~~~text
activation_confirmation_missing
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
migration_control_missing
migration_snapshot_mismatch
migration_head_count_mismatch
migration_provenance_mismatch
migration_transition_mismatch
profile_upgrade_source_race
profile_upgrade_successor_cutover_race
successor_staging_mismatch
successor_cutover_race
activation_confirmation_mismatch
staged_pre_migration_control_forbidden
successor_root_key_reuse
recovery_credential_history_mismatch
protocol_id_collision
recovery_credential_reuse
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
14. RecoveryArtifactV6 Google-Grid-Chunking: 1 Chunk, exakte 32000er-Grenze,
    44 Chunks, falsche Länge/Hash, nichtleere Tail-Zelle.
15. RecoveryTakeoverStagingV2 KDF/AAD/Crash-Resume + falsche URS.
16. RecoveryArtifactV6 AAD/Payload/Keypair-Check roundtrip.
17. RecoveryActivationProofV2 Signatur +
    source_anchor_before_announcement/Next-Row-Prüfung einschließlich
    recovery_transition_id.
18. RotationAnnouncementV2: exakter Immediate-Prefix-Anchor; intervenierende
    stale Row => stale_rotation_announcement_rejected ohne Source-Seal.
19. EpochMigrationV2: Source-Semantic-/Lineage-Snapshot, Successor-Result-Hash
    und Head-Counts gegen echte Prefix-Graphen für profile_upgrade, normal und
    recovery_rekey.
20. Cross-Epoch-Provenienz-Bijection: jeder Source-Head wird genau eine
    Successor-Genesis-Revision mit leerem Parent-Array und exakt singleton
    `migration_origin` auf seine Source-Epoche/Record-/Revision-ID; mehrere
    Konflikt-Heads desselben Records bleiben getrennte Heads.
21. ActivationLineageV2 für native Genesis, profile_upgrade und mindestens zwei
    aufeinanderfolgende v2→v2-Rotationen einschließlich Migration-Integrität.
22. RecoveryAuthorityTransitionV2 + RecoveryAuthorityTransitionProofV2:
    staged, exact completion, durable und überholter Anchor.
23. ActivationLineageCacheV2 AEAD/Readback einschließlich cache_id und
    Cache-Ref-Hash.
24. RotationOperationStateV2 für profile_upgrade/normal/recovery_rekey mit allen
    erlaubten Stage-Transitions und Null/non-null-Invarianten.
25. Verifier-purpose canonical_full vs operation-gebundenes rotation_resume:
    fehlende Migration-Control nur in successor_bound|copying als
    staged_incomplete; niemals aktive Authority.
26. Remote Pending-Rekey-Fence: Transition setzt
    recovery_rekey_rotation_required/current_recovery_rekey_transition_id;
    zweite Transition supersedet die ID; Forced Takeover bleibt möglich;
    Fachwrite/Handoff/Normalrotation werden abgewiesen; passendes
    recovery_rekey-Announcement versiegelt.
27. RecoveryRekeyOperationStateV2 remote_pending_rekey_adoption nach
    Geräteverlust: canonical_full + aktuelles RecoveryArtifact + Forced Takeover
    -> Einstieg bei transition_durable -> verpflichtende Successor-Rotation.
28. RecoveryRekeyOperationStateV2 atomare Supersession:
    alter durable State suspendiert, neuer State referenziert; neuer Versuch
    pre-durable stale -> alter State wieder gebunden; neue Transition durable ->
    alter State terminal superseded + superseded_by_transition_id.
29. v1→v2 Profile-Upgrade-Race: finaler Pre-Append-Anchor gleich vs.
    zusätzliche Row zwischen finalem Read und v1-Announcement =>
    profile_upgrade_source_race.
30. SyncBackupV6 staged/activated Manifest/hash binding einschließlich
    activation_lineage, Recovery-Transition-Proof und finalem Recovery-State:
    URS-Commitment/ID, Takeover-Key/Public-Key, Credential-History-Hash und
    Pending-Rekey-Fence müssen exakt dem verifizierten record_rows-Endzustand
    und dem entschlüsselten RecoveryArtifact entsprechen.
31. Identifier-Format/Decode-Längen für cache_id, rotation_id, migration_id,
    transition_id, confirmation_id und operation_id einschließlich
    Base64URL-Re-Encode; falsche Byte-Länge und nicht-kanonische Base64URL-Form
    werden abgelehnt.
32. Gemeinsamer epochweiter Control-ID-Namespace für grant_id/rotation_id/
    migration_id/transition_id/confirmation_id: derselbe Bytewert in einem
    anderen Envelope **oder einem anderen Control-ID-Feld** (z.B.
    transition_id == frühere rotation_id) => protocol_id_collision;
    byte-identischer Envelope-Retry bleibt No-op.
33. RecoveryAuthorityTransitionV2 mit frischem URS + Takeover-Key sowie
    Wiederverwendungsversuche über **mehrere v2-Epochen**: historischer URS
    oder historischer/supersedierter Takeover-Key =>
    recovery_credential_reuse. v1→v2 dokumentiert separat, dass vor-v2
    Credentials mangels historischer IDs nicht rückwirkend erkennbar sind.
34. successor_staging_anchor für v2→v2 und profile_upgrade: exakt direkt nach
    Migration-Control, keine semantische Suffix-Row; Proof/Announcement/Artifact
    und staged Cutover-Backup binden exakt diesen Anchor. Das activated
    Cutover-Backup reproduziert die Confirmation als exakte
    successor_activation_anchor-Grenze und exportiert den aktuellen vollständig
    verifizierten Prefix, der diese Grenze ggf. um gültigen post-activation
    Suffix erweitert.
35. Source-Seal durable, Successor hat vor der Confirmation eine andere erste
    Suffix-Row => successor_cutover_race/profile_upgrade_successor_cutover_race,
    kein Switch. Exakt vorbereitete Confirmation als erste Row wird dagegen
    crash-resumable reconciliiert.
36. SuccessorActivationConfirmationV2: exakter Announcement-Hash, unmittelbarer
    staging-anchor-Prefix, one-shot Confirmation-Envelope, Recovery-Completion
    nach Source-Seal, successor_activation_anchor als feste Aktivierungsgrenze
    und gültiger post-activation Suffix.
37. Nicht-native Successor-Epoche mit RK_epoch gleich direktem oder historischem
    source_root_key => successor_root_key_reuse / security_blocked.
38. Staged Successor: WriterGrant/RecoveryAuthorityTransition/
    RotationAnnouncement/SuccessorActivationConfirmation vor EpochMigrationV2
    => staged_pre_migration_control_forbidden; Epoch-Start-Authority bleibt bis
    zur Migration-Control unverändert.
39. Normale Rotation ohne aktuellen URS/current RecoveryArtifact-Keypair-Check
    => vor Successor-RecoveryArtifact-Erzeugung blockiert; verlorener aktueller
    URS verlangt recovery_rekey.
40. Rotation vor durable Source-Announcement stale => bereits erzeugter
    Successor wird orphaned und darf in neuem Versuch nicht wiederverwendet
    werden.
41. Protected ManifestV6 bindet creation_locator; RotationAnnouncementV2 mit
    successor_creation_locator != Successor-Manifest.creation_locator =>
    security_blocked.
42. Recovery-Rekey Artifact-Publish-Crash/Unknown-Outcome: vor erstem
    mutierenden Publish-Request wird artifact_publish_attempted=true durable;
    Crash danach darf keinen lokalen Abort erzeugen. Exact Artifact-Readback =>
    recovery_artifact_published und Transition completion-pflichtig; anderer
    physischer Source-Suffix am authority_anchor => stale.
43. Post-activation Lifecycle-Suffix: reine Fachrows/WriterGrants werden in
    finalen Verify/Backup integriert. Akzeptierte RecoveryAuthorityTransition
    oder ein den Successor versiegelndes RotationAnnouncement vor lokalem
    Cutover => post_activation_superseded; kein activated Backup mit historischem
    RecoveryArtifact und kein automatischer Switch.
44. Finaler Pre-Switch-Verify: nach activated Backup/Lineage-Cache wird
    unmittelbar vor lokalem Switch erneut canonical_full ausgeführt. Seit Backup
    hinzugekommener RecoveryTransition-/Seal-Fortschritt =>
    post_activation_superseded; reine Fachrows/WriterGrants dürfen fortgesetzt
    werden, Writerstatus stammt aus der letzten Authority.

Negative Vectors:

- falsche Diary/Epoch;
- cache_id/rotation_id/migration_id/transition_id/confirmation_id/operation_id
  mit falscher Decode-Länge oder nicht-kanonischem Base64URL;
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
- durable RecoveryAuthorityTransitionV2, danach Fachrevision des weiterhin
  aktuellen Writer-Keys => rekey_rotation_required_rejected, Fachgraph unverändert;
- durable RecoveryAuthorityTransitionV2, danach Handoff-Grant gegen immediate
  Prefix => rekey_rotation_required_rejected, Writer bleibt unverändert;
- durable RecoveryAuthorityTransitionV2, danach normal-Rotation =>
  rekey_rotation_required_rejected und kein Seal;
- Geräteverlust nach durable Transition, neuer URS + Forced Takeover =>
  Pending-Rekey-Fence bleibt remote true und normale Writes bleiben blockiert;
- zweite gültige RecoveryAuthorityTransitionV2 vor Phase B => ältere
  transition_id darf keine recovery_rekey-Rotation mehr autorisieren;
- Recovery mit gültigem direkten ActivationProof, aber ungültigem älteren
  ActivationLineage-Eintrag => fatal/nicht aktiv;
- Recovery-Rekey-Successor mit gültigem Announcement, aber nicht durable
  Source-RecoveryAuthorityTransitionV2 => nicht aktiv;
- manipulierte announcement_envelope-Bytes oder activation_signature;
- Rotation-Announcement mit historisch gewordenem source_anchor: kein Seal,
  stale_rotation_announcement_rejected;
- Rotation-Announcement mit falschem from_epoch_id, self-successor oder falscher
  recovery_transition_id;
- EpochMigrationV2 mit fehlendem Fach-Head, zusätzlichem Head, falschem
  source_lineage_snapshot_hash oder falschen Head-Counts;
- Successor-Head mit korrektem Fachwert, aber migration_origin=null, falscher
  source_epoch_id/source_record_id/source_revision_id, mehreren Source-Revisionen
  oder doppelt beanspruchter Source-Revision => migration_provenance_mismatch;
- direkte Aktivierungsproofs gültig, aber EpochMigrationV2 inkonsistent =>
  Successor nicht aktiv;
- canonical_full auf nicht-native Epoche ohne Migration-Control =>
  migration_control_missing;
- rotation_resume ohne passende MAC-authentifizierte RotationOperationStateV2
  oder in falscher Stage => security_blocked;
- Proof mit stale Writer-Key, der nicht der kanonischen Source-Authority am
  gebundenen Prefix entspricht;
- falscher source_root_key in einem ActivationLineageV2-Eintrag oder
  Source-Manifest-Fingerprint;
- Successor-RK entspricht direktem oder historischem source_root_key =>
  successor_root_key_reuse;
- staged Successor: WriterGrant/Handoff/Forced-Takeover,
  RecoveryAuthorityTransition, RotationAnnouncement oder
  SuccessorActivationConfirmation vor der Migration-Control =>
  staged_pre_migration_control_forbidden; normale Fachrows ohne vollständige
  Migration-Provenienz scheitern später an §16a.1;
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
- manipuliertes oder manifestfremdes RecoveryTakeoverStagingV2;
- v1 profile_upgrade: zusätzliche v1-Row zwischen finalem Pre-Append-Read und
  Announcement => profile_upgrade_source_race, Successor bleibt staged;
- RecoveryArtifactV6 mit to-State vor durabler Transition ohne gültigen
  RecoveryAuthorityTransitionProofV2 => nicht current/kein Forced Takeover.
- RecoveryAuthorityTransitionV2 verwendet seit erster v2-Aktivierung bereits
  bekannten recovery_urs_id oder recovery_takeover_key_id erneut — auch aus
  einer Vorgänger-Epoche => recovery_credential_reuse;
- Recovery-Rekey wird nach erfolgreichem staged Artifact-Publish lokal abgebrochen,
  obwohl authority_anchor remote unverändert ist => Operation-State ungültig;
  Transition bleibt completion-pflichtig und darf nicht als stale verworfen werden;
- RecoveryArtifact-Publish liefert unknown_outcome/Crash nach möglicher
  Remote-Mutation, artifact_publish_attempted=true, lokaler Code behandelt dies
  trotzdem als „nicht publiziert“ und bricht ab => Operation-State ungültig;
  zuerst Discovery/Grid-Readback-Reconciliation;
- Unknown-Outcome-Retry ohne erneutes canonical_full des aktuellen Prefixes =>
  Implementierungs-/Assurance-Fehler; kein zweiter Append;
- physisch vorhandene stale_writer_rejected-Revision wird lokal als durable statt
  stale_writer_pending klassifiziert => Implementierungs-/Assurance-Fehler;
- neuer Envelope verwendet einen bereits belegten Control-ID-Bytewert erneut,
  auch cross-type zwischen grant_id/rotation_id/migration_id/transition_id/
  confirmation_id => protocol_id_collision;
- ActivationProof/Announcement mit falschem successor_staging_anchor oder
  Successor-Row zwischen Migration-Control und staging anchor =>
  successor_staging_mismatch;
- andere zusätzliche Successor-Row als die exakt vorbereitete Confirmation
  zwischen eingefrorenem staging anchor und Confirmation => Cutover-Race;
- exakt vorbereitete Confirmation bereits als erste Suffix-Row => reconcile als
  confirmation_durable; danach gültiger post-activation Suffix zulässig;
- fehlende Confirmation bei ansonsten gültigem Source-Announcement =>
  activation_confirmation_missing / Successor bleibt recoverbar staged;
- Confirmation mit falschem Announcement-Hash, Source-/Successor-Binding oder
  staging anchor => activation_confirmation_mismatch / security_blocked;
- RotationAnnouncement successor_creation_locator stimmt nicht mit geschütztem
  Successor-Manifest.creation_locator überein => security_blocked;
- normale Rotation ohne erneut eingegebenen aktuellen URS bzw. ohne
  Source-RecoveryArtifact-/Keypair-Check => vor Remote-Cutover blockiert;
- pre-announcement stale Rotation versucht denselben Successor/Artifact oder
  dieselben vorbereiteten Control-Bytes wiederzuverwenden => security_blocked;
- zusätzliche Successor-Row nach durabler Confirmation ist normaler
  post-activation Suffix und muss unabhängig durch Writer-Authority validieren;
- post-activation RecoveryAuthorityTransition macht das staged RecoveryArtifact
  historisch, lokaler Cutover versucht trotzdem activated Backup/Switch =>
  security/assurance failure; erwartet post_activation_superseded;
- post-activation gültiges RotationAnnouncement versiegelt den Successor erneut,
  alter Cutover schaltet trotzdem lokal auf diesen Epoch => security/assurance
  failure; erwartet post_activation_superseded.

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

ActivationLineageV2 priorisiert unabhängig prüfbare Recovery-Kanonizität über
historische Key-Erasure: das aktuelle URS schützt auch die in der Lineage
mitgeführten historischen Source-RKs. Kompromittierung des aktuellen URS kann
deshalb zusätzlich historisch verschlüsselte Epochen offenlegen, soweit deren
Provider-Ressourcen/Backups noch vorhanden sind. Wer stattdessen kryptographische
Löschung alter Epoch-Keys als Primärziel benötigt, braucht ein anderes
Lineage-/Checkpoint-Profil.

Ein activated SyncBackupV6 garantiert ohne erreichbare historische
Activation-Lineage-Source-Kette **keine** Wiedergewinnung von remote-active
Writer-Authority; ein solcher Restore bleibt sicher read-only/offline.
