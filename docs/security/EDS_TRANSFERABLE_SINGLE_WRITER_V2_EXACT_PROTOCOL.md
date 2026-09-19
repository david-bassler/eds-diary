# EDS Diary – Exaktes Protokollprofil Transferable Single Writer v2

Stand: 19.09.2026

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

---

## 2. IDs und Byte-Längen

~~~text
diary_id                 16 CSPRNG bytes
epoch_id                 16 CSPRNG bytes
key_id                   16 CSPRNG bytes
record_id                16 bytes
writer_device_id         16 CSPRNG bytes
recovery_artifact_id     16 CSPRNG bytes

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

Verifikation erfolgt gegen den Public Key des aktuell kanonischen Grants an der
physischen Row-Position der Revision.

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
- Handoff: authorization.kind="writer_handoff"; Signatur mit dem Public Key des
  unmittelbar vorher kanonischen Writer-Grants.
- Forced Takeover: authorization.kind="recovery_takeover"; Signatur mit dem im
  Manifest für die aktuelle Recovery-Generation gebundenen Recovery-Takeover-Key.
- authority_anchor muss exakt den vollständig verifizierten physischen Prefix
  unmittelbar vor der Grant-Row beschreiben.
- Jeder gültige Nachfolgegrant erhöht Generation exakt um 1 und referenziert
  exakt den aktuellen Grant.
- Ein zweiter Claim auf denselben predecessor, der physisch später erscheint,
  ist stale_grant_rejected.
- Zukunftsgeneration, falscher predecessor, falscher Anchor oder ungültige
  Signatur sind security_blocked, nicht latest-wins.

---

## 9. Recovery-Takeover-AuthorityV2

Für jede Recovery-Generation existiert ein eigenes Ed25519-Schlüsselpaar.

Bei Erzeugung einer v2-Epoche oder recovery_rekey:

1. Ed25519-Keypair transient erzeugen.
2. Public Key roh als 32 Byte exportieren.
3. Private Key einmalig als PKCS#8 exportieren.
4. recovery_takeover_key_id aus Public Key ableiten.
5. Public Key + Key-ID im geschützten Manifest binden.
6. PKCS#8 ausschließlich in den verschlüsselten RecoveryArtifactV6-Payload aufnehmen.
7. Plaintext-PKCS#8 und extrahierbaren temporären Private Key nach Artefakterzeugung
   aus dem normalen Sitzungszustand verwerfen.
8. Ein späterer Forced Takeover decryptet das RecoveryArtifactV6 erst nach
   erneuter URS-Eingabe und importiert PKCS#8 für diese Ceremony als
   extractable=false, usage=["sign"].
9. Diese importierte Capability wird nach Readback/Abschluss verworfen.

Der normale lokale Writer-State enthält niemals recovery_takeover_private_key,
PKCS#8 oder eine dauerhaft nutzbare Recovery-Takeover-Capability.

Ist URS bzw. das aktuelle RecoveryArtifactV6 kompromittiert, ist Forced Takeover
für diese Recovery-Generation kompromittiert. recovery_rekey muss daher ein neues
Takeover-Keypair erzeugen.

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

epoch_start_writer_generation
epoch_start_writer_grant_id
epoch_start_writer_device_id
epoch_start_writer_key_id
epoch_start_writer_public_key

recovery_takeover_key_id
recovery_takeover_public_key
~~~

Für eine neu migrierte v1→v2-Epoche ist epoch_start_writer_generation exakt 1 und ein Gen-1-Grant wird vor Manifest-Verschlüsselung vollständig geplant; deshalb ist epoch_start_writer_grant_id bereits im immutable Manifest gebunden. Bei einer späteren v2→v2-Rotation übernimmt der Successor dagegen die bereits kanonische Generation und Grant-ID unverändert als Epoch-Start-Trust-Root; dafür wird kein künstlicher neuer Writer-Grant erzeugt.

Recovery-Commitment v6:

~~~text
Base64URL(HMAC-SHA-256(
  key = URS,
  data = UTF8("eds-diary/recovery-urs-commitment/v6") || 0x00 ||
         diary_id_bytes || uint64_be(recovery_generation)
))
~~~

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
current_recovery_takeover_key_id
source_epoch_sealed
accepted_revision_graph
~~~

Pro Row:

1. Grid-/Bounds-/Base64URL-/Envelope-AEAD vollständig prüfen.
2. Wrapper als exaktes RevisionV2 validieren.
3. Bei writer-grant-sw-v2:
   - authority_anchor muss dem Prefix vor dieser Row entsprechen;
   - Initialgrant nur gemäß Manifest;
   - Handoff gegen aktuellen Writer-Key;
   - Forced Takeover gegen aktuelle Recovery-Takeover-Authority;
   - bei gültigem direkten Nachfolger Authority fortschreiben;
   - konkurrierender späterer Claim auf alten predecessor => stale_grant_rejected;
   - strukturell unmöglicher/future/falsch signierter Grant => security_blocked.
4. Bei normaler Revision:
   - source_epoch_sealed=false;
   - writer_context muss exakt current authority sein;
   - writer_signature muss über §6 gültig sein;
   - ältere Authority => stale_writer_rejected;
   - gleiche Generation mit anderer Grant-/Key-/Device-ID => security_blocked;
   - zukünftige Authority ohne Grant => security_blocked.
5. Nur akzeptierte Fachrevisionen gehen in den fachlichen Graphen.
6. Jede physische Row geht in Prefix-Hash und Bounds ein.

Ein Root-Key-besitzendes stale Gerät kann neue Ciphertexte erzeugen, aber ohne
aktuellen Writer-Key weder aktuelle Fachrevisionen noch einen Handoff-Grant
authentisieren.

---

## 13. Schreibfreigabe / Freshness

Ein Gerät darf RevisionV2 erst persistent erzeugen, wenn innerhalb desselben
Write-Vorgangs:

1. starke lokale Entsperrung aktiv ist;
2. authentifizierte Provider-Session aktiv ist;
3. Remote vollständig neu gelesen und gegen den persistierten RemoteAnchorV2
   verifiziert wurde;
4. verifizierte current authority exakt zum lokalen Device-Key passt;
5. lokaler Status writer_active ist.

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
5. fehlt das Envelope und Authority ist unverändert => exakt dieselben Bytes erneut
   appendieren;
6. fehlt das Envelope und Authority hat sich geändert => nicht erneut appendieren;
   als stale_writer_pending bzw. stale_grant_attempt quarantinieren.

Ein HTTP-200 ohne finalen Full Readback ist niemals durable.

---

## 15. Cooperative Handoff A -> B

Voraussetzungen:

- A ist nach frischem Full Verify current writer.
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

1. RecoveryArtifactV6 decrypten und vollständig binden.
2. Recovery-Generation muss zum verifizierten Manifest passen.
3. recovery_takeover_key_id und Public Key müssen zum Manifest passen.
4. PKCS#8 transient als non-extractable Ed25519 signing key importieren.
5. Remote erneut vollständig verifizieren.
6. Grant g+1 reason="forced_takeover" erzeugen.
7. Grant-Signing-Input mit Recovery-Takeover-Key signieren.
8. Append + Full Readback.
9. writer_active nur bei kanonisch akzeptiertem eigenen Grant.
10. Recovery signing capability aus normalem Sitzungszustand verwerfen.

---

## 16a. Weitere v2 Control-Schemas

"rotation-announcement-sw-v2" ist eine normale writer-autorisierte Control-
RevisionV2 und wird mit der zum Row-Zeitpunkt aktuellen Writer-Authority signiert.
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
recovery_generation
~~~

source_writer_generation und source_writer_grant_id müssen dem writer_context
der Control-Revision entsprechen.

"epoch-migration-sw-v2" ist ebenfalls eine normale writer-autorisierte
Control-RevisionV2. record_data exakt:

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

source_writer_authority enthält exakt:

~~~text
writer_generation
writer_grant_id
writer_device_id
writer_key_id
~~~

migration_kind ist exakt "normal" | "local_rotation" | "remote_enablement" |
"emergency". Bei unveränderter Ein-Source-Migration muss
result_semantic_snapshot_hash == source_semantic_snapshot_hash gelten.

## 17. Rotation und Recovery-Rekey

Normale Epoch-Rotation übernimmt die aktuelle Writer-Authority in den
Successor-Manifest-Trust-Root:

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

Recovery-Rekey erzeugt zwingend:

- recovery_generation + 1;
- neue URS-Bindung;
- neues Recovery-Takeover-Ed25519-Keypair;
- neues RecoveryArtifactV6;
- Manifestbindung im Successor.

Altes Recovery-Takeover-Material darf in der neuen Epoche keinen Grant signieren.

---

## 18. EpochLocalSecurityStateV6

Exakt versioniertes neues State-Schema; V5 bleibt unverändert.

EpochLocalSecurityStateV6 besitzt exakt folgende Top-Level-Properties:

~~~text
local_state_version = 6
diary_id
epoch_id
key_id
manifest_fingerprint
recovery_generation
recovery_urs_commitment
remote_binding
remote_anchor
epoch_status
operation_generation
rotation_state_ref
migration_state_ref
local_journal_count
local_journal_hash

remote_binding.storage_provider_id
remote_binding.sync_profile
remote_binding.remote_resource_id
remote_binding.remote_identity_binding

remote_anchor: RemoteAnchorV2|null

writer_status = "writer_active"|"read_only"
writer_device_id
writer_signing_key_id
writer_generation
writer_grant_id

verified_writer_device_id
verified_writer_key_id
verified_writer_generation
verified_writer_grant_id

recovery_generation
recovery_takeover_key_id

stale_writer_pending_count
operation_generation
~~~

Der Writer-Private-CryptoKey liegt in einem getrennten lokalen Key-Store und wird
über writer_signing_key_id referenziert. State und Referenz werden über
K_local_state_mac authentifiziert.

Ein fehlender, nicht nutzbarer oder nicht zum Public Key passender Private Key
führt zu read_only, nicht zu stiller Neugenerierung.

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

Encrypted Payload exakt:

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
created_at
~~~

recovery_takeover_private_key_pkcs8 ist Base64URL des exakt exportierten Ed25519-PKCS#8-Schlüssels. Beim Restore wird daraus ein non-extractable Private Key importiert und ein fester domainspezifischer Challenge-String signiert; diese Signatur muss mit recovery_takeover_public_key aus dem Manifest verifizierbar sein. So wird das Keypair ohne erneuten Private-Key-Export gebunden.

Artifact-AAD ist JCS des Headers ohne wrapped_payload.

---

## 20. SyncBackupV6

Neues geschlossenes Format "sync-backup-v6", niemals optionale Erweiterung von v5.

BackupV6 bindet mindestens:

- v2 Manifest Public Header;
- RemoteAnchorV2;
- vollständig verifizierte Writer-Authority am Exportpunkt;
- Recovery-Generation;
- recovery_takeover_key_id;
- verschlüsseltes RecoveryArtifactV6 als opakes gebundenes Artefakt;
- Remote Rows;
- lokale Pending Rows einschließlich stale_writer_pending in separater,
  nicht automatisch pushbarer Kategorie;
- Hashes/Counts/Bounds analog zum v5-Backup unter v6-Domains.

Test-Restore muss den produktiven TransferableSingleWriterV2Verifier verwenden.

---

## 21. v1 -> v2 Migration

Migration ist Epoch-Rotation, keine In-place-Mutation.

Reihenfolge:

1. v1 Source full-verifizieren.
2. Source lokal einfrieren.
3. neues Writer-Ed25519-Keypair erzeugen.
4. neues Recovery-Takeover-Keypair erzeugen.
5. epoch_start_writer_grant_id und Writer-Authority planen.
6. immutable ManifestV6 erzeugen.
7. Gen-1-Grant schreiben.
8. fachliche Heads als RevisionV2 unter Gen-1-Authority schreiben/signieren.
9. Migration-Control schreiben.
10. Successor vollständig mit V2-Verifier verifizieren.
11. RecoveryArtifactV6 erzeugen und Test-Recovery durchführen.
12. SyncBackupV6 erzeugen und Test-Restore durchführen.
13. v1 Rotation Announcement durable machen.
14. atomar auf v2 umschalten; v1 retire.

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
11. ManifestV6 Plaintext/AAD/Fingerprint.
12. RecoveryArtifactV6 AAD/Payload roundtrip.
13. SyncBackupV6 manifest/hash binding.

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
- Transferdescriptor ohne Private-Key-Possession;
- Rollback vor bereits bekannten Grant;
- stale Fachrow nach Handoff;
- konkurrierende g+1-Claims.

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
