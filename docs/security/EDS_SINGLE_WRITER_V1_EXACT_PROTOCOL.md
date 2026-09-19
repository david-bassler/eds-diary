# EDS Diary – Exaktes Protokollprofil Google Sheets Single-Writer v1

Stand: 15.09.2026

Status: **NORMATIV.** Diese Datei schließt die Byte-/Wire-/State-Lücken der gekürzten Repo-Spezifikationen. Für die Implementierung von `google-sheets-single-writer-v1` hat sie bei konkreten Serialisierungs-, Krypto-, Persistenz- und Transportdetails Vorrang vor den allgemeineren Dateien.

## 0. Herkunft und bewusst neue Entscheidungen

Die folgenden Regeln werden aus der ausführlichen v5-Final-Spezifikation **unverändert übernommen**, soweit nicht ausdrücklich als Single-Writer-Entscheidung markiert:

- 16-Byte `diary_id`, `epoch_id`, `key_id`; 32-Byte `envelope_id`, `revision_id`, `backup_id`;
- RFC 8785 JCS auf strikt validiertem I-JSON;
- per-Envelope HKDF, AES-256-GCM, Record-AAD und 1/2/4/8/16-KiB-Padding;
- immutable one-shot Epoch-Manifest;
- Recovery-Artefakt + URS + `recovery_urs_commitment`;
- lokaler Root-Wrap, State-MAC und Envelope-Journal;
- Google Account Binding, Create/Reconciliation und strikte Grid-Prüfung;
- Backup-Grundformat und Größen-/Parsergrenzen.

**Neue normative Single-Writer-v1-Entscheidungen** in dieser Datei:

1. geschütztes Manifest enthält zusätzlich exakt `sync_profile: "google-sheets-single-writer-v1"`;
2. die Single-Writer-Basis-Allowlist enthält sechs Fachschemas plus zwei eigene Control-Schemas; `remote_checkpoint`, `rotation_fence` und `rotation_abort` sind in diesem Profil verboten;
3. Control-Schemas heißen `rotation-announcement-sw-v1` und `epoch-migration-sw-v1`;
4. `remote_anchor` ist der vollständig verifizierte physische Prefix ohne Checkpoint;
5. lokale `remote_binding` ist providerneutral; der Google-Codec mappt sie auf die Google-Wire-Bindung;
6. normale Rotation friert lokale fachliche Mutationen persistent ein, statt einen Remote-Fence zu erzeugen.

Das Profil ist **nicht** als byte-kompatible In-place-Abwandlung einer anderen Writer-Semantik zu behandeln. Eine spätere geräteübergreifend gefencete Writer-Authority – aktuell als `google-sheets-transferable-single-writer-v2` geplant – erfordert eine neue Epoche und ein neues Profil.

---

# 1. Globale Kodierungsregeln

## 1.1 Base64URL

Binärfelder in JSON/Sheet-Zellen werden ausschließlich als RFC-4648-Base64URL **ohne `=`-Padding** dargestellt.

Pflichtprüfung bei untrusted Input:

1. nur `[A-Za-z0-9_-]`;
2. kein Whitespace, kein `=`;
3. dekodieren;
4. auf erwartete Byte-Länge prüfen;
5. erneut Base64URL ohne Padding kodieren;
6. Ergebnis muss byte-/stringgenau dem Input entsprechen.

## 1.2 JCS / I-JSON

Kryptographisch gebundene JSON-Strukturen verwenden **RFC 8785 JCS** auf strikt I-JSON-kompatiblen Daten.

Verboten ist eine selbstgebaute „ungefähr sortierte JSON“-Serialisierung, die nicht RFC 8785 vollständig reproduziert.

Pflicht:

- UTF-8;
- Duplicate Properties vor normalem Objekt-Parsing erkennen/ablehnen;
- keine unpaired Surrogates/non-I-JSON Strings;
- keine `undefined`, `NaN`, `Infinity`;
- keine stille Unicode-Normalisierung;
- unbekannte Properties in Security-/Protocol-Objekten ablehnen;
- nach Decrypt: strikt parsen, Schema prüfen, erneut JCS-kodieren und kanonische Nutzbytes vergleichen.

## 1.3 Integer

`uint32_be` und `uint64_be` sind unsigned big-endian. Protokollzähler in JSON sind nichtnegative JavaScript-Safe-Integer, sofern nicht ausdrücklich als Base64URL-Bytefeld definiert.

---

# 2. IDs und Root-Key

```text
RK_epoch       = 32 CSPRNG-Bytes
URS            = 32 CSPRNG-Bytes

diary_id       = 16 CSPRNG-Bytes, Base64URL
 epoch_id       = 16 CSPRNG-Bytes, Base64URL
 key_id         = 16 CSPRNG-Bytes, Base64URL
 record_id      = 16 Bytes, Base64URL
 wrap_id        = 16 CSPRNG-Bytes, Base64URL
 creation_locator = 16 CSPRNG-Bytes, Base64URL
 recovery_artifact_id = 16 CSPRNG-Bytes, Base64URL

envelope_id    = 32 CSPRNG-Bytes, Base64URL
revision_id    = 32 CSPRNG-Bytes, Base64URL
rotation_id    = 32 CSPRNG-Bytes, Base64URL
migration_id   = 32 CSPRNG-Bytes, Base64URL
backup_id      = 32 CSPRNG-Bytes, Base64URL
```

`diary_id_bytes`/`epoch_id_bytes` in KDF-/Hash-Formeln sind die **dekodierten 16 rohen Bytes**, niemals UTF-8 der Base64URL-Zeichenfolge.

Epoch Salt:

```text
epoch_salt = SHA-256(
  UTF8("eds-diary/hkdf-salt/v5") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)
```

Envelope Key:

```text
K_env(envelope_id) = HKDF-SHA-256(
  IKM  = RK_epoch,
  salt = epoch_salt,
  info = UTF8("eds-diary/envelope-key/v5") || 0x00 || envelope_id_bytes,
  L    = 32
)
```

Weitere Schlüssel:

```text
K_epoch_manifest = HKDF-SHA-256(
  RK_epoch, epoch_salt, UTF8("eds-diary/epoch-manifest/v5"), 32
)

K_backup(backup_id) = HKDF-SHA-256(
  RK_epoch, epoch_salt,
  UTF8("eds-diary/backup-manifest/v5") || 0x00 || backup_id_bytes,
  32
)

K_local_state_mac = HKDF-SHA-256(
  RK_epoch, epoch_salt, UTF8("eds-diary/local-state-mac/v5"), 32
)
```

---

# 3. Envelope AEAD – exakt

## 3.1 One-shot

1. `envelope_id` erzeugen;
2. **persistent reservieren**;
3. Reservation readback-verifizieren;
4. `K_env` ableiten;
5. 12-Byte CSPRNG-IV erzeugen;
6. exakt **eine** neue AES-GCM-Verschlüsselung unter diesem `K_env`;
7. immutable `envelope_id`, `iv`, `ciphertext=C||T` und Journal-/Outbox-State atomar persistieren;
8. Retry sendet nur dieselben gespeicherten Bytes.

Crash nach Reservation darf die ID verbrennen. Sie darf niemals für einen anderen Klartext wiederverwendet werden.

## 3.2 Padding

Erlaubte Klartext-Frame-Buckets:

```text
1024, 2048, 4096, 8192, 16384 Bytes
```

Frame:

```text
uint32_be(payload_length) || payload_jcs_utf8 || zero_padding
```

Kleinster Bucket, in den `4 + payload_length` passt. Maximales Payload: 16380 Byte.

Beim Decrypt wird der Bucket **vor AEAD** ausschließlich aus der dekodierten Ciphertextlänge bestimmt:

```text
padding_bucket = len(C || T) - 16
```

Nur die fünf obigen Werte sind zulässig. Nach Decrypt müssen Frame-Länge, `payload_length` und ausschließlich Nullbytes im Padding exakt stimmen.

## 3.3 Record-AAD

Exaktes Objekt, keine weiteren Felder:

```json
{
  "protocol_version": 5,
  "crypto_suite": "A256GCM-HKDF-SHA256-v5",
  "diary_id": "<16-byte-b64url>",
  "epoch_id": "<16-byte-b64url>",
  "envelope_id": "<32-byte-b64url>",
  "padding_bucket": 1024
}
```

```text
AAD_bytes = UTF8(JCS(aad_object))
AES-256-GCM, IV=12 Byte, Tag=128 Bit, WebCrypto ciphertext = C || T
```

Fachmetadaten wie `record_id`, `record_type`, `revision_id`, Parents und Control-Daten stehen **nicht** in der AAD, sondern ausschließlich im Ciphertext.

---

# 4. Gemeinsamer verschlüsselter Recordwrapper

Exakt diese Properties, keine zusätzlichen:

```text
{
  record_type,
  record_schema,
  record_id,
  revision_id,
  parent_revision_ids,
  record_status,
  record_data,
  migration_origin,
  protocol_created_at
}
```

Normen:

- `record_schema` ist ein **versionierter String**, keine Zahl;
- `record_id` dekodiert zu 16 Byte;
- `revision_id` dekodiert zu 32 Byte;
- `parent_revision_ids` enthält 0..8 eindeutige 32-Byte-IDs;
- `protocol_created_at` exakt `YYYY-MM-DDTHH:mm:ss.SSSZ`, rein informativ;
- fachlich `record_status = "active" | "deleted"`;
- Control exakt `record_status = "control"`;
- Tombstone: `record_data = null`;
- Control: `parent_revision_ids=[]`, `migration_origin=null`.

`revision_id` darf innerhalb derselben Epoche nicht in mehreren unterschiedlichen Envelopes auftreten. Parents müssen physisch vor dem Kind liegen, zur gleichen `(record_type,record_id,record_schema)` gehören; Graph zusätzlich iterativ auf Zyklen prüfen.

Grenzen: max. 8 Parents, 4096 Revisionen je `record_id`, Tiefe 4096.

## 4.1 Single-Writer-v1 Basis-Allowlist

Jedes Single-Writer-v1-Manifest enthält mindestens exakt diese Basis-Schemas:

```text
activity-entry/v1
activity-type-settings/v1
epoch-migration-sw-v1
medication-entry/v1
medication-prescription/v1
pain-entry/v1
pain-type-settings/v1
rotation-announcement-sw-v1
```

Die Liste ist nach UTF-8-Bytes sortiert und eindeutig. Zusätzliche später reviewte Fachschemas nur in einer **neuen Epoche**.

In diesem Profil verboten:

```text
remote-checkpoint/v1
rotation-fence/v1
rotation-abort/v1
```

Taucht ein solches Control-Schema in einer Single-Writer-Epoche auf, ist das ein Profil-/Integritätsfehler; nicht „für Kompatibilität“ ignorieren.

## 4.2 Fachschemas

Bestehende sechs Fachtypen:

```text
pain_entry                -> pain-entry/v1
activity_entry            -> activity-entry/v1
medication_entry          -> medication-entry/v1
medication_prescription   -> medication-prescription/v1
pain_type_settings        -> pain-type-settings/v1
activity_type_settings    -> activity-type-settings/v1
```

Für diese IDs müssen im Repo **maschinenlesbare immutable Schema-Dateien** liegen. Gleichbleibende Schema-ID darf nach Merge niemals still andere Semantik erhalten.

Registry:

```text
schema_registry_entries = [
  { record_schema, schema_sha256 }, ...
]

schema_sha256 = Base64URL(SHA-256(UTF8(JCS(machine_readable_schema))))
record_schema_registry_hash = Base64URL(
  SHA-256(UTF8(JCS(schema_registry_entries)))
)
```

Ein Remote-Manifest wird nur aktiviert, wenn dieser Hash aus den lokal gebundelten Schema-Dateien exakt reproduziert wird.

## 4.3 Settings-Singletons

Nur `pain_type_settings` und `activity_type_settings`:

```text
singleton_record_id_bytes = first16(SHA-256(
  UTF8("eds-diary/singleton-record-id/v5") || 0x00 ||
  diary_id_bytes || 0x00 || UTF8(record_type)
))
```

## 4.4 Legacy-ID-Mapping

Gewöhnliche Legacy-Records:

```text
legacy_record_id_bytes = first16(SHA-256(
  UTF8("eds-diary/legacy-record-id/v5") || 0x00 ||
  diary_id_bytes || 0x00 || UTF8(record_type) || 0x00 || UTF8(exact_legacy_id)
))
```

`exact_legacy_id` 1..1024 UTF-8-Bytes. Kollision -> fatal; nicht durch neue Zufalls-ID verdecken.

## 4.5 `migration_origin`

`null` außer bei Cross-Epoch-Migration/Rebase. Sonst exakt:

```text
{
  sources: [
    {
      source_epoch_id,
      source_record_id,
      source_revision_ids
    }, ...
  ]
}
```

1..8 eindeutige Sources; pro Source 1..8 eindeutige 32-Byte Revision-IDs, byte-sortiert. Sources nach dekodierter `source_epoch_id`, dann `source_record_id` sortiert.

---

# 5. Single-Writer Control-Schemas

## 5.1 `rotation-announcement-sw-v1`

Wrapper:

```text
record_type = "rotation_announcement"
record_schema = "rotation-announcement-sw-v1"
record_status = "control"
parent_revision_ids = []
migration_origin = null
```

`record_data` exakt:

```text
{
  rotation_id,
  from_epoch_id,
  successor_epoch_id,
  successor_creation_locator,
  successor_manifest_fingerprint,
  rotation_kind: "normal"
}
```

Keine zusätzlichen Felder. Enthält niemals `RK_new` oder URS.

Mehr als ein unterschiedliches gültiges Announcement aus derselben Vorgängerepoche ist ein Security/Fork-Zustand. Kein Latest-Wins.

## 5.2 `epoch-migration-sw-v1`

Wrapper wie Control oben. `record_data` exakt:

```text
{
  migration_id,
  migration_kind,
  source: {
    source_epoch_id,
    source_manifest_fingerprint,
    source_anchor,
    source_lineage_snapshot_hash,
    source_semantic_snapshot_hash
  },
  result_semantic_snapshot_hash,
  active_head_count,
  tombstone_head_count
}
```

`migration_kind` exakt:

```text
"normal" | "local_rotation" | "remote_enablement" | "emergency"
```

Single-Writer v1 hat genau **eine** Source. `source_anchor` ist bei `normal` remote Rotation nicht-null und exakt der final vollständig verifizierte Single-Writer-Anchor nach Schreib-Freeze. Bei rein lokaler `local_rotation`/`remote_enablement` exakt `null`.

Lineage-/Semantic-Snapshot-Hash verwendet die v5-Regeln: alle aktuellen fachlichen Heads erhalten; kein Timestamp-/Row-Winner. Bei unveränderter Ein-Source-Migration gilt zwingend:

```text
result_semantic_snapshot_hash == source_semantic_snapshot_hash
```

---

# 6. Epoch Manifest – exakt für Single-Writer v1

Jede Epoche besitzt **genau eine** one-shot erzeugte immutable Manifestinstanz. Sie wird lokal erzeugt/persistiert/readback-verifiziert, bevor ein Remote-Create erfolgen darf. Timeout/Restore regeneriert sie niemals.

## 6.1 Öffentlicher Header / `_m`

Exakt:

```text
A1 = "sync-v5"
B1 = "5"
C1 = manifest_iv              # 12 Byte Base64URL
D1 = manifest_ciphertext      # C || T Base64URL
```

Öffentlich keine Diary-/Epoch-ID.

## 6.2 Geschützter Payload

Exakt diese Properties:

```text
{
  diary_id,
  epoch_id,
  key_id,
  recovery_generation,
  recovery_urs_commitment,
  diary_marker: "epoch-manifest-v5",
  crypto_suite: "A256GCM-HKDF-SHA256-v5",
  sync_profile: "google-sheets-single-writer-v1",
  created_at,
  google_account_binding,
  predecessor_epochs,
  record_schema_allowlist,
  record_schema_registry_hash,
  protocol_limits
}
```

`predecessor_epochs`:

```text
[]                                  # Genesis
[{epoch_id, manifest_fingerprint}]  # Single-Source-Übergang
```

Single-Writer v1 unterstützt keine normale Multi-Predecessor-Fork-Konvergenz. Ein beobachteter Remote-Fork bleibt fail-closed und erfordert ein späteres explizites Profil/Recoveryverfahren.

`protocol_limits` exakt:

```text
{
  max_payload_bytes: 16380,
  padding_buckets: [1024,2048,4096,8192,16384],
  max_unique_envelopes: 100000,
  max_unique_canonical_bytes: 134217728,
  max_remote_physical_rows: 100000,
  max_remote_physical_canonical_bytes: 134217728,
  max_canonical_row_bytes: 21936
}
```

Keine Checkpoint-Reserve-Felder im Single-Writer-Profil.

## 6.3 Recovery-Commitment im Manifest

```text
recovery_urs_commitment = Base64URL(
  HMAC-SHA-256(
    key = URS_32_bytes,
    data = UTF8("eds-diary/recovery-urs-commitment/v5") || 0x00 ||
           diary_id_bytes || uint64_be(recovery_generation)
  )
)
```

Dieses Commitment liegt **nur im verschlüsselten Manifest-Payload**. Es ist nicht öffentlich im Recovery-Header oder als separater Browserstorage-Verifier zu persistieren.

## 6.4 Manifest-AEAD

```text
manifest_AAD = UTF8(JCS({
  format: "sync-v5",
  protocol_version: 5,
  diary_id,
  epoch_id
}))

manifest_plaintext = UTF8(JCS(protected_manifest))
AES-256-GCM(K_epoch_manifest, manifest_iv, manifest_plaintext, manifest_AAD)
```

Nach Decrypt müssen insbesondere `diary_id`, `epoch_id`, `recovery_generation`, `recovery_urs_commitment` und `sync_profile` exakt zum erwarteten Kontext passen.

## 6.5 Fingerprint

```text
manifest_public_bytes = UTF8(JCS({
  format: "sync-v5",
  protocol_version: 5,
  manifest_iv,
  manifest_ciphertext
}))

manifest_fingerprint = Base64URL(SHA-256(manifest_public_bytes))
```

---

# 7. Google Identity-/Dateibindung

## 7.1 Google Account Binding

Nach jedem neuen Access Token vor Remote-I/O:

```text
drive.about.get(fields=user(permissionId))
```

Dann:

```text
google_account_binding = Base64URL(SHA-256(
  UTF8("eds-diary/google-account/v5") || 0x00 ||
  diary_id_bytes || 0x00 || UTF8(permissionId)
))
```

`permissionId`/E-Mail werden nicht im öffentlichen Manifest, Titel oder `appProperties` gespeichert.

## 7.2 Providerneutraler lokaler Binding-State

Core-seitig exakt:

```text
remote_binding = null | {
  provider_id: "google-sheets-single-writer-v1",
  remote_resource_id,
  remote_identity_binding
}
```

Der Google-Codec mappt:

```text
remote_resource_id      <-> file_id
remote_identity_binding <-> google_account_binding
```

Core kennt keine Google-SDK-/Drive-/Sheets-Typen.

---

# 8. Google Remote-Ressource – strikte Struktur

Eine Epoch-Datei besitzt **genau zwei GRID-Sheets**: `_m`, `_r`. Keine weiteren Tabs, keine Merges.

`_m`: exakt 4 Spalten, genau eine Grid-Zeile, A1:D1 ausschließlich `userEnteredValue.stringValue`.

`_r`: exakt 3 Spalten, keine Headerzeile. Trailing leere Grid-Zeilen sind technisch zulässig; innerhalb `1..last_protocol_row` keine Lücke.

Vor jedem großen Read zunächst `spreadsheets.get` ohne große Grid-Daten und mindestens prüfen:

- exakt zwei Tabs `_m`, `_r`;
- beide `GRID`;
- exakte `columnCount` 4 bzw. 3;
- `_m.rowCount == 1`;
- `_r`: `1 <= rowCount <= 100000`;
- keine Merges.

Danach Grid-Daten chunked über `userEnteredValue` lesen. Für jede Protokollzelle sind `formulaValue`, `numberValue`, `boolValue`, Error-/berechnete Ersatzwerte unzulässig.

**Produktive Writes:** `spreadsheets.batchUpdate` + `AppendCellsRequest`, explizite `_r.sheetId`, `fields="userEnteredValue"`, jede Zelle `ExtendedValue.stringValue`.

**Verboten im sicheren Profil:** `spreadsheets.values.append`.

Drive-Dateiinvarianten vor produktiven Writes mindestens:

```text
mimeType == application/vnd.google-apps.spreadsheet
trashed == false
ownedByMe == true
shared == false
driveId == null/absent
isAppAuthorized == true
```

`permissions.list` vollständig paginieren, `includePermissionsForView=published`; exakt eine effektive Owner-User-Permission, deren `id` der aktuellen `permissionId` entspricht. Zusätzliche User/Group/Domain/Anyone/Published-Permissions -> fail-closed.

---

# 9. Create/Reconciliation – Unknown Outcome korrekt

## 9.1 Locators

Vor Create:

```text
creation_locator = 16 CSPRNG-Bytes Base64URL
filename = "sync-" + creation_locator
```

Drive `appProperties` nach Bindung exakt:

```text
app_format = "sync-v5"
epoch_locator = Base64URL(first16(SHA-256(
  UTF8("sync-v5/epoch-locator") || 0x00 || diary_id_bytes || epoch_id_bytes
)))
```

Keine weiteren Protokoll-`appProperties`.

## 9.2 Persistenter Planned-State vor Netz-I/O

Vor erstem Create persistent/readback-verifiziert:

- `creation_locator`;
- exakter neutraler Dateiname;
- `diary_id`, `epoch_id`, `key_id`;
- erwartete `appProperties`;
- bereits one-shot erzeugte exakte Manifestwerte/`manifest_public_bytes`;
- `manifest_fingerprint`.

## 9.3 Ablauf

1. State `creation_pending` persistieren.
2. `spreadsheets.create` mit Titel `sync-<creation_locator>` und **leerer** exakter Zwei-Tab-Struktur `_m`/`_r`; kein Default-Sheet.
3. Response-ID nur als Kandidat behandeln.
4. Immer denselben Reconciliation-Pfad durchlaufen.
5. Ausgewählten leeren Kandidaten: A1:D1 in **einem** `spreadsheets.batchUpdate` mit bereits persistierten Manifestbytes schreiben.
6. Timeout -> Readback, keine Neuverschlüsselung.
7. Erst nach Manifest-Readback erwartete `appProperties` setzen; Timeout wieder nur Readback/Reconciliation.
8. Vollständige Datei-/Account-/Manifestprüfung.
9. Unmittelbar vor `bound` erneut Discovery; exakt eine kanonische Datei muss übrig sein.
10. Erst nach atomar persistiertem `bound` sind Record-Appends erlaubt.

## 9.4 Discovery nach unklarem Create

Suche per Drive nach **exaktem Titel** `sync-<creation_locator>`, Spreadsheet-MIME, `trashed=false`. Titel ist nur Discovery-Hilfe, niemals Authentisierung.

Kandidaten:

- `bound_expected_candidate`: erwartetes Manifest, `_r` leer, erwartete Properties;
- `partial_expected_candidate`: erwartetes Manifest, `_r` leer, Protokoll-Properties fehlen vollständig; nur erwartete Properties ergänzen;
- `empty_retry_duplicate`: exakte leere Zwei-Tab-Struktur, `_m` leer, `_r` leer, keine Protokoll-Properties;
- sonst `conflicting_candidate`.

Regeln:

- genau ein bound candidate gewinnt gegen reine leere Duplikate;
- sonst genau ein partial -> fertigstellen;
- sonst bei mehreren ausschließlich leeren Duplikaten deterministisch lexikographisch kleinste `file_id` wählen, nur dort Manifest schreiben, andere danach orphan/trash;
- mehr als ein manifest-tragender/partial Kandidat oder irgendein conflicting candidate -> `ambiguous`/Security Stop;
- kein Kandidat -> pending; vor neuem Create erneut Discovery;
- vor `bound` exakt einen nicht getrashten voll verifizierten Kandidaten beweisen.

Damit ist auch „Create serverseitig erfolgreich, Response verloren“ recoverbar. Eine Implementierung, die Discovery ausschließlich über erst **nach** Create gesetzte `appProperties` macht, ist unzulässig.

---

# 10. Physischer Prefix und Single-Writer Anchor

Für physische Zeile `i`:

```text
row_i = UTF8(JCS([envelope_id, iv, ciphertext]))

H0 = SHA-256(
  UTF8("eds-diary/remote-prefix/v5") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)

Hi = SHA-256(
  H(i-1) || uint64_be(i) || uint32_be(len(row_i)) || row_i
)
```

Keine Sortierung/Deduplizierung. Byte-identische Retry-Duplikate zählen physisch jeweils mit.

Single-Writer-Anchor exakt:

```text
{
  anchor_profile: "google-sheets-single-writer-v1",
  covered_row_count,
  prefix_hash
}
```

`prefix_hash = Base64URL(Hcovered_row_count)`.

Monotone Fortschreibung:

- Remote muss mindestens `covered_row_count` Zeilen besitzen;
- Hash über exakt die ersten alten `covered_row_count` Zeilen muss alten `prefix_hash` reproduzieren;
- danach muss der **gesamte neu gelesene Remotezustand vollständig kryptographisch/semantisch validiert** werden;
- erst dann neuer Anchor.

Kein automatisches Downgrade auf älteren Anchor.

---

# 11. Vollständige Pull-before-Push-Verifikation

`writer_active` darf erst gesetzt werden, wenn **alle** Schritte grün sind:

1. Auth/Google Account Binding;
2. Remote Binding + Drive-Dateiinvarianten + Permissions;
3. `_m`/`_r` physische Struktur;
4. Manifest-Fingerprint und Manifest-AEAD;
5. `sync_profile` exakt Single-Writer v1;
6. lokaler alter Anchor wird durch Remote-Prefix monoton umfasst;
7. **jede** `_r`-Zeile:
   - Base64URL kanonisch;
   - exakte ID-/IV-/Ciphertextlängen;
   - Bucket aus Ciphertextlänge bestimmen;
   - `K_env` ableiten;
   - AES-GCM mit exakter AAD öffnen;
   - Frame/Padding prüfen;
   - JCS-Kanonizität prüfen;
   - Wrapper-/Recordschema prüfen;
8. gleiche `envelope_id` + andere Bytes fatal; byte-identische Duplikate fachlich einmal, physisch mehrfach;
9. beobachtete gleiche IV bei unterschiedlichen Envelope-IDs -> RNG/Security-Anomalie, neue Verschlüsselungen blockieren;
10. vollständigen Revision Graph rekonstruieren: IDs, Parents, Parent-before-Child, Zyklen, Bounds, mehrere Heads;
11. Control-Records verarbeiten; gültiges `rotation_announcement` der aktuellen Epoche retiret/friert die alte Epoche;
12. lokale immutable Envelopes/Pending gegen Remote bytegenau reconciliieren;
13. lokale `operation_generation`/Maintenance-/Rotation-State erneut prüfen;
14. erst dann `writer_active`.

Nur Manifest + Prefix-Hash zu prüfen reicht **nicht**.

---

# 12. Append / Unknown Outcome / Durable

Normaler Append:

1. lokal persistent vorbereitetes Envelope auswählen;
2. vor Netz-I/O `writer_active`, Generation, Maintenance-State prüfen;
3. exakt gespeicherte `[envelope_id,iv,ciphertext]` via `AppendCellsRequest` senden;
4. unabhängig vom HTTP-Ergebnis Readback/Reconciliation;
5. ID mit anderen Bytes -> fatal;
6. identische Zeile vorhanden -> `remote_seen`;
7. kein Treffer nach unknown outcome -> exakt dieselben Bytes erneut senden;
8. danach **vollständigen Remotezustand nach Abschnitt 11 erneut validieren**;
9. neuen kompletten Prefix-Anchor berechnen;
10. unter Web Lock State re-read; erwartete Generation muss noch stimmen;
11. Anchor + Durable-Status in **derselben lokalen atomaren Transaktion** persistieren und State-MAC fortschreiben.

HTTP 2xx allein ist niemals Durable-Ack.

Wenn beim finalen Pull ein Announcement, unerwartete Struktur oder sonstige nicht aus dem eigenen verifizierten Ablauf erklärbare Änderung erscheint: Writer entziehen/fail-closed; nicht trotzdem Anchor fortschreiben.

---

# 13. Lokale sichere Persistenz

## 13.1 Zielarchitektur

Fachrecords werden **nicht** als separate mutable Klartext- oder „mit Gerätekey direkt verschlüsselte JSON-Records“ zur Security-Source-of-Truth gemacht.

Source of Truth nach Cutover:

```text
RK_epoch (nur wrapped persistent)
  -> immutable v5 Envelopes
  -> lokales Envelope-Journal
  -> Revision Graph / entschlüsselter Read-Model nur nach Unlock
```

Best-Effort-Key schützt den **Root-Wrap**, nicht als Ersatzkryptographie alle Fachrecords direkt.

## 13.2 Root-Wrap exakt

Persistentes Objekt:

```text
{
  local_wrap_version: 5,
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
```

AAD:

```text
UTF8(JCS({
  local_wrap_version,
  mode,
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  wrap_id,
  mode_metadata
}))
```

### Best-Effort

`mode_metadata = {}`. Pro Root-Wrap eigener AES-256-GCM `CryptoKey`, `extractable:false`, im Browserprofil unter demselben `wrap_id`. Kein Raw-Key-Fallback.

### WebAuthn PRF

`mode_metadata` exakt:

```text
{
  prf_profile: "webauthn-prf-v5-1",
  credential_id,
  prf_eval_input,
  prf_wrap_salt,
  rp_id
}
```

`prf_eval_input=32` Byte, `prf_wrap_salt=32` Byte, `userVerification:"required"`, exakte Credential-ID. Post-Enrollment-Assertion muss echte 32-Byte-PRF-Ausgabe beweisen.

```text
credential_id_hash = SHA-256(credential_id_bytes)
prf_context = UTF8("eds-diary/local-prf-wrap/v5") || 0x00 ||
              diary_id_bytes || epoch_id_bytes || key_id_bytes || credential_id_hash

K_local_prf = HKDF-SHA-256(
  prf_output_32_bytes,
  prf_wrap_salt,
  prf_context,
  32
)
```

Credential-ID-Vergleich byteweise, nicht über JS-String-Heuristiken.

### Passphrase

`mode_metadata` exakt:

```text
{
  passphrase_profile: "argon2id-v5-1",
  passphrase_salt
}
```

`passphrase_salt=16` CSPRNG-Bytes.

```text
argon_base = Argon2id-v0x13(
  password = exact_UTF8(passphrase),
  salt = passphrase_salt,
  memory = 64 MiB,
  iterations = 3,
  parallelism = 1,
  output = 32
)

pass_context = UTF8("eds-diary/local-passphrase-wrap/v5") || 0x00 ||
               diary_id_bytes || epoch_id_bytes || key_id_bytes

K_local_passphrase = HKDF-SHA-256(
  IKM = argon_base,
  salt = SHA-256(UTF8("eds-diary/local-passphrase-salt/v5") || 0x00 ||
                 diary_id_bytes || epoch_id_bytes),
  info = pass_context,
  L = 32
)
```

Mindestens 15 Unicode-Codepoints, max. 1024 UTF-8-Bytes, kein trim/Normalization, lokale Blocklist.

## 13.3 Epoch Local Security State

Exaktes MAC-Payload-Schema:

```text
{
  local_state_version: 5,
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  recovery_generation,
  remote_binding,
  remote_anchor,
  epoch_status,
  operation_generation,
  rotation_state_ref,
  migration_state_ref,
  local_journal_count,
  local_journal_hash
}
```

`epoch_status` exakt:

```text
local_offline | remote_bound | active | offline_restored | retired | orphaned
```

Refs:

```text
rotation_state_ref = null | { operation_id, state, state_record_hash }
migration_state_ref = null | { operation_id, state, state_record_hash }
```

Tag:

```text
local_state_tag = Base64URL(HMAC-SHA-256(
  K_local_state_mac,
  UTF8(JCS(epoch_local_security_state))
))
```

Jede erfolgreiche atomare Security-State-Mutation erhöht `operation_generation` genau einmal.

## 13.4 Lokales Envelope-Journal

```text
L0 = SHA-256(
  UTF8("eds-diary/local-journal/v5") || 0x00 ||
  diary_id_bytes || epoch_id_bytes
)

entry_hash = SHA-256(UTF8(JCS([envelope_id,iv,ciphertext])))
Li = SHA-256(L(i-1) || uint64_be(i) || entry_hash)
```

Envelope und Journal-Update sowie `local_journal_count/hash` werden beim erstmaligen Persistieren atomar geschrieben.

Delivery/Outbox-Flags sind **rekonstruierbare Zustände**, nicht einzige Wahrheit. Fehlt ein Pending-Flag, darf ein lokales immutable Envelope deshalb nicht dauerhaft vom Sync verschwinden.

## 13.5 Web Locks

Alle lokalen Security-Mutationen unter diary-spezifischem `navigator.locks` Exclusive Lock. Innerhalb Lock maßgeblichen IDB-State neu lesen.

Netz-I/O nicht unter lang gehaltenem Lock. Vor I/O erwartete `operation_generation` persistieren/merken; danach Lock neu erwerben, State neu lesen, Generation vergleichen. Staler Callback darf neuen State nicht überschreiben.

Wenn Web Locks im unterstützten Browser nicht zuverlässig verfügbar sind: produktiver Schreibbetrieb fail-closed.

---

# 14. Recovery – exakt

## 14.1 Öffentliches Recovery-Artefakt

Exakt:

```text
{
  format: "sync-recovery-v5",
  version: 5,
  recovery_artifact_id,
  kdf_profile_id: "recovery-hkdf-v5-1",
  salt,
  wrap_iv,
  wrapped_payload
}
```

Öffentlich **kein** `diary_id`, `epoch_id`, Manifest-Fingerprint, Remote-Anchor oder `recovery_urs_commitment`.

`salt=32` Byte, `wrap_iv=12` Byte.

```text
K_recovery = HKDF-SHA-256(
  URS_32_bytes,
  recovery_salt,
  UTF8("eds-diary/recovery-wrap/v5"),
  32
)
```

AAD exakt:

```text
UTF8(JCS({
  format: "sync-recovery-v5",
  version: 5,
  recovery_artifact_id,
  kdf_profile_id,
  salt,
  wrap_iv
}))
```

## 14.2 Geschützter Recovery-Payload

Exakt:

```text
{
  recovery_artifact_id,
  diary_id,
  epoch_id,
  key_id,
  RK_epoch,
  manifest_fingerprint,
  remote_anchor,
  google_account_binding,
  recovery_generation,
  created_at
}
```

Kein öffentliches Secret-Commitment. Continuity wird nach Unwrap gegen das **authentifizierte Manifest-Commitment** geprüft.

## 14.3 Root-Key ist nach Unwrap nur Kandidat

AEAD-Unwrap allein aktiviert den RK **niemals** persistent.

Remote-Bootstrap vollständig:

1. Recovery-Payload strikt prüfen;
2. ID innen/außen match;
3. Google Identity Binding prüfen;
4. kanonische Remote-Datei + Datei-/Permissions-Invarianten prüfen;
5. Manifest-Fingerprint prüfen;
6. Manifest mit `K_epoch_manifest` authentifizieren;
7. Manifest IDs/Generation/profile prüfen;
8. mit eingegebenem URS `recovery_urs_commitment` des Manifests reproduzieren;
9. Recovery-`remote_anchor` muss nicht-null sein und gegen vollständigen Remote-Prefix verifiziert werden;
10. **alle Envelopes/Graph/Controls vollständig prüfen**;
11. erst danach neuen lokalen Root-Wrap erzeugen, readback-verifizieren und atomar aktivieren.

Offline-Backup-Bootstrap analog über vollständig verifiziertes Backup derselben Epoche. Ohne Remote- oder Backup-Bootstrap bleibt RK nur kurzlebiger RAM-Kandidat.

---

# 15. Backup – Single-Writer v1

Backup bleibt vom Sync getrennt. `.syncbackup` ist ein einzelnes unkomprimiertes UTF-8-JCS-Dokument, max. 256 MiB; für große Dateien streaming/inkrementell, kein einzelnes unbounded `File.text()` + `JSON.parse()`.

Top-Level exakt:

```text
{
  format: "sync-backup-v5",
  backup_format_version: 5,
  backup_id,
  backup_manifest_iv,
  backup_manifest_ciphertext,
  epoch_manifest_public,
  record_rows,
  pending_outbox_rows
}
```

`epoch_manifest_public` sind exakt die bei Epoch-Erzeugung persistierten Manifestbytes; Backup regeneriert/re-encryptet kein Manifest.

`record_rows` = exakte physische Remote-Reihenfolge inklusive byte-identischer Retry-Duplikate.

`pending_outbox_rows` = **jeder** lokale immutable Envelope derselben Epoche, der nicht byteidentisch in `record_rows` vorkommt; nicht nur aufgrund eines Outbox-Flags.

K_backup one-shot pro `backup_id`. AAD:

```text
UTF8(JCS({
  format: "sync-backup-v5",
  backup_format_version: 5,
  backup_id
}))
```

Geschütztes Backup-Manifest enthält mindestens/exakt für dieses Profil:

```text
{
  backup_id,
  diary_id,
  epoch_id,
  key_id,
  manifest_fingerprint,
  remote_anchor_at_export,
  record_row_count,
  record_rows_canonical_bytes,
  record_prefix_hash,
  epoch_manifest_public_sha256,
  record_rows_jcs_sha256,
  pending_outbox_count,
  pending_outbox_rows_canonical_bytes,
  pending_outbox_rows_jcs_sha256,
  unique_union_count,
  unique_union_canonical_bytes,
  created_at
}
```

Bei remote gebundener Epoche ist `remote_anchor_at_export` nicht-null und exakt der Single-Writer-Anchor; er muss gegen die exportierten `record_rows` reproduzierbar sein. Local/offline: `record_rows=[]`, Anchor `null`, `record_prefix_hash=Base64URL(H0)`, gesamter Envelope-Bestand in Pending.

Restore: Manifest, Counts/Bytes/Hashes, Prefix, Anchor, jede Envelope-AEAD, Graph und Controls vollständig prüfen, bevor ein lokaler Zustand aktiviert wird.

---

# 16. Rotation – Single Writer crashsicher

Single Writer entfernt Remote-Fence/Checkpoint, **nicht** die Crash-Sicherheit.

## 16.1 Persistent Maintenance Gate

Vor finalem Source-Snapshot wird unter Web Lock ein persistenter Rotation/Maintenance-State gesetzt. Ab dann sind fachliche Mutationen dieses Diaries read-only/queued; sie dürfen den Source-Snapshot nicht heimlich verändern.

Ein Crash lässt dieses Gate bestehen. Reload muss Rotation fortsetzen oder vor Announcement sicher abbrechen; normaler Schreibbetrieb darf nicht einfach wieder starten.

## 16.2 Mindestzustände

Persistente State-Machine mindestens:

```text
prepared
root_wrap_verified
source_frozen_verified
recovery_secret_verified
successor_planned
successor_bound
copying
successor_verified
recovery_verified
backup_verified
announcement_pending
announcement_durable
switched
```

Jeder Schritt wird persistiert/readback-verifiziert und über `rotation_state_ref.state_record_hash` an den MAC-State gebunden.

## 16.3 Ablauf

1. Source vollständig Pull-before-Push/verifizieren; finalen Source-Anchor bilden.
2. Maintenance/Write-Freeze persistieren.
3. Source semantic + lineage snapshot hashen.
4. Recovery-Linie festlegen: bei gleicher Generation URS gegen Source-Manifest-Commitment prüfen; bei bewusst neuem URS neue Generation.
5. `RK_new`, `epoch_id`, `key_id`, `creation_locator` erzeugen.
6. neuen Root-Wrap erzeugen/readback-verifizieren.
7. Successor-Manifest one-shot erzeugen; `predecessor_epochs` bindet Source; Single-Writer-Profil/Commitment fest.
8. Successor create/reconcile/bind.
9. **jeden Source-Head** als neue Successor-Genesis-Revision mit neuer `revision_id`/`envelope_id`, gleicher logischer `record_id`, leerem Parent-Array und `migration_origin` kopieren. Mehrere Heads bleiben mehrere Heads.
10. `epoch_migration`/`epoch-migration-sw-v1` schreiben.
11. Successor vollständig Pull/Decrypt/Graph/Prefix verifizieren; Semantic-Hash muss Source entsprechen; Successor-Anchor durable.
12. finales Recovery-Artefakt erzeugen + Test-Unwrap + vollständigen Successor-Bootstrap prüfen.
13. Backup erzeugen + Test-Restore vollständig prüfen.
14. erst jetzt `rotation_announcement` in **alter** Epoche erzeugen/append/reconcile.
15. alte Epoche danach vollständig erneut verifizieren und Announcement mit neuem Source-Anchor durable machen.
16. Successor nochmals verifizieren; lokal atomar Successor `active`, Source `retired`, Maintenance lösen.

Vor `announcement_durable` darf der Versuch sicher abgebrochen werden; staged Successor wird orphaned, Source bleibt nach vollständiger Reverifikation aktiv. **Nach `announcement_durable` darf die alte Epoche nie wieder fachlich aktiv werden.** Crash an dieser Stelle muss Switch/Successor-Recovery fortsetzen.

Stale Gerät: Pull alte Epoche -> Announcement validieren -> alte Writes permanent sperren -> Successor + RK_new über Pairing/Recovery erwerben -> lokale alte Heads, die im Successor nicht repräsentiert sind, als neue Successor-Revisionen rebasen/mergen -> erst dort wieder pushen.

---

# 17. Legacy-Migration

Zu inventarisieren/migrieren:

- alle bisherigen fachlichen IndexedDB-Stores;
- `settings`;
- `localStorage["eds-diary-activity-types-v1"]`;
- sonstige tatsächlich vorhandene fachliche Browserpersistenz.

Ziel ist **nicht** „dieselben mutable Records unter einem Device-Key verschlüsseln“, sondern der v5-Revision-/Envelope-Store mit gewrapptem RK.

Migration:

1. nicht-destruktive Baseline erfassen;
2. `legacy_dirty_generation`/äquivalentes payloadfreies Dirty-Signal, damit Writes während Backfill nicht verloren gehen;
3. Legacy -> deterministische v5 Record-IDs -> Revisions -> Envelopes;
4. Ziel decrypt/readback + semantisch vergleichen;
5. Catch-up bis Generation stabil;
6. erst dann Read-/Write-Cutover;
7. Legacy-Stores zunächst erhalten/read-only;
8. alter Klartext erst durch separates getestetes Purge-Gate entfernen.

Aktivitätstypen werden auf den Singleton `activity_type_settings` / `activity-type-settings/v1` migriert; nicht einfach mit neuem Key-Namen ignorieren.

---

# 18. Fehlernormalisierung Google Adapter

Nicht jeden Fehler zu `unknown_outcome` machen.

Mindestens:

```text
401                         -> auth_required
403                         -> permission_denied (oder eng erkannter Quota-Fall)
404                         -> not_found
409/412 o. unerwarteter Zustand -> conflict_or_unexpected_remote_change
429                         -> rate_limited
5xx bei Reads               -> temporary_failure
Netz/Timeout/5xx nach Mutation, deren Serverwirkung unklar ist -> unknown_outcome
malformed Grid/Manifest/Bytes -> integrity_failure
inkompatible API/Schema     -> provider_incompatible
```

Bei Mutationsfehlern entscheidet anschließend immer Reconciliation; technische Backoff-Policy erzeugt niemals neues Envelope/IV/Ciphertext.

---

# 19. Golden Vectors

Diese Werte sind normativ. Testimplementierungen dürfen intern anders gebaut sein, müssen dieselben kanonischen Bytes/Outputs liefern.

## 19.1 HKDF

```text
RK_epoch    = AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
diary_id    = AAECAwQFBgcICQoLDA0ODw
epoch_id    = EBESExQVFhcYGRobHB0eHw
envelope_id = ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8

epoch_salt = blimEvgiJ5Xv-5w9aAUNukos8MBdujI4hNszRuJnzms
K_env       = SCTEmrQmiRdlUP1rRaDwnbBXhBpmnGuQ6CfeLpAlKOo
K_epoch_manifest = WWNfsSobhH8xfNAHimlipzFYM_dMf0xp9FfvQv-JJoo
```

## 19.2 Envelope AEAD / Padding

Fixed revision:

```json
{"migration_origin":null,"parent_revision_ids":[],"protocol_created_at":"2026-09-15T12:00:00.000Z","record_data":null,"record_id":"6VfGNsfksH5Z3lPHFXoqhw","record_schema":"pain-entry/v1","record_status":"deleted","record_type":"pain_entry","revision_id":"QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8"}
```

```text
payload_length = 300
padding_bucket = 1024
iv = AAECAwQFBgcICQoL
```

AAD JCS exakt:

```json
{"crypto_suite":"A256GCM-HKDF-SHA256-v5","diary_id":"AAECAwQFBgcICQoLDA0ODw","envelope_id":"ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8","epoch_id":"EBESExQVFhcYGRobHB0eHw","padding_bucket":1024,"protocol_version":5}
```

```text
SHA256(AAD_bytes)   = vesZ-WJKc7pO3fSo73L-Up9sTNii3VsksMt1Q0sAsEU
SHA256(frame_bytes) = 0O6vh2H8HLZm9Fn-3po4syGIGCj6Sd7kMn2qwduATWg
len(C||T)           = 1040
SHA256(C||T)        = oCUqKTRXU0qJIiOGPl708-g3w1OhpLvWqTSP8jc6C1I
```

Der Test muss die tatsächlichen AES-GCM-Ausgabebytes erzeugen und deren SHA-256 gegen diesen Wert prüfen; ein Roundtrip allein reicht nicht.

## 19.3 Manifest AAD

```json
{"diary_id":"AAECAwQFBgcICQoLDA0ODw","epoch_id":"EBESExQVFhcYGRobHB0eHw","format":"sync-v5","protocol_version":5}
```

```text
SHA256(manifest_AAD) = FADWunkMvpmyJD6naWHZzfxmvsAnpGEyTmIe0GuNBJ0
```

## 19.4 Recovery

```text
URS = QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8
recovery_salt = YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8
K_recovery = P8l2o6n_Ym8B4D-a3SIQsdCHIIMGo3b51xZIoWsEOus
recovery_generation = 0
recovery_urs_commitment = LwXN6L17yVOpFppyrpm2tigy7g7iIKBg43RunhvOnn4
```

## 19.5 Prefix

Mit `diary_id`/`epoch_id` aus 19.1:

```text
H0 = QNdRgLk7idJSD31lWxyuHM3tVRj_gNyuIoTLswdK7mM
row1 = ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","BBBBBBBBBBBBBBBB","CCCCCCCCCCCCCCCCCCCCCCCC"]
H1 = uSjwuqCX1uhRM43i9S4ueKrUOvahK1hKspQE0truQbM
row2 = ["DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD","EEEEEEEEEEEEEEEE","FFFFFFFFFFFFFFFFFFFFFFFF"]
H2 = DAbJMCMsMiUvPSuMf7Xq4V6DPmPtYjUvZcGVIE6VOFE
```

Wichtig: `Hi` enthält `uint32_be(len(row_i))`; eine Implementierung ohne Längenfeld ist falsch.

## 19.6 Single-Writer Anchor

JCS exakt:

```json
{"anchor_profile":"google-sheets-single-writer-v1","covered_row_count":2,"prefix_hash":"DAbJMCMsMiUvPSuMf7Xq4V6DPmPtYjUvZcGVIE6VOFE"}
```

```text
SHA256(anchor_jcs) = rj2L-NXE5_jfBdeR37qB5_9ctolJlEyL9UEJEyV8rSI
```

## 19.7 Legacy-/Singleton-IDs

```text
legacy pain id("pain-legacy-001") = 6VfGNsfksH5Z3lPHFXoqhw
pain_type_settings               = bi484VDkyiS35gsH75PJkg
activity_type_settings           = zq46iIq3qX9xlm_MBuqAkQ
```

## 19.8 Local State

Mit Inputs aus 19.1:

```text
K_local_state_mac = s5rdPtDd0OTNNOxlX1RgTdF9mvPullXT2xaILCd19wM
local_journal_L0  = D080nDa2ttMGd-dlYmvl_k2dcgVOFIWhIv4uuJUn1-g
```

Für `local_seq=1` und die kanonische `row1` aus 19.5:

```text
entry_hash       = bTRNZUTa00Ncn5vuOTjFJf3vModZSRMi8QX8DrQgU4k
local_journal_L1 = FEBs2DZgGx_KW46mgYUOl_4bZT1EJfdBMJkVndUNqMo
```

## 19.9 Passphrase

```text
passphrase = "correct horse battery staple 2026"
passphrase_salt = oKGio6SlpqeoqaqrrK2urw
argon_base = QPscWLpX6ynZAgQKRrhShgbDKix7Y318RV9S_j4UptA
K_local_passphrase = 6BxChVkipdNZJHlvyxY_7TEyK-w9cxyve2a6Zjx5TDU
```

## 19.10 Rotation Announcement Encoding

Exakte JCS-Testinstanz:

```json
{"migration_origin":null,"parent_revision_ids":[],"protocol_created_at":"2026-09-15T12:34:56.000Z","record_data":{"from_epoch_id":"EBESExQVFhcYGRobHB0eHw","rotation_id":"0NHS09TV1tfY2drb3N3e3-Dh4uPk5ebn6Onq6-zt7u8","rotation_kind":"normal","successor_creation_locator":"MDEyMzQ1Njc4OTo7PD0-Pw","successor_epoch_id":"ICEiIyQlJicoKSorLC0uLw","successor_manifest_fingerprint":"QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8"},"record_id":"oKGio6SlpqeoqaqrrK2urw","record_schema":"rotation-announcement-sw-v1","record_status":"control","record_type":"rotation_announcement","revision_id":"sLGys7S1tre4ubq7vL2-v8DBwsPExcbHyMnKy8zNzs8"}
```

```text
SHA256(rotation_announcement_jcs) = PHKGPDt6r2tgrMcBs9u-7Xz3AnL1D5lNYnNQuwmc5fs
```

---

# 20. Release-/Implementierungsverbote

Eine Single-Writer-v1-Implementierung ist nicht abgeschlossen, wenn einer dieser Punkte zutrifft:

- direkte Fachrecord-Verschlüsselung unter einem persistierten Device-Key ersetzt Root-Wrap + v5-Envelope-Architektur;
- eigenes Nicht-RFC8785-„Canonical JSON“;
- kein Padding-Frame;
- `record_schema` als Zahl;
- `diary_id`/`epoch_id` als UTF-8-String in KDF statt dekodierten 16 Bytes;
- Pull setzt Writer vor vollständigem Decrypt/Graph/Control/Reconciliation;
- Durable setzt Anchor vor vollständigem finalem Pull;
- `values.append` im sicheren Google-Pfad;
- Create-Reconciliation sucht nur über erst nach Create gesetzte `appProperties`;
- Google-Adapter mappt alle Fehler zu `unknown_outcome`;
- Recovery-Commitment liegt öffentlich im Recovery-Artefakt;
- AEAD-Unwrap allein aktiviert RK;
- Rotation besteht nur aus In-Memory-Step-Enums ohne persistenten Crash-/Resume-/Announcement-Pfad;
- `localStorage["eds-diary-activity-types-v1"]` wird beim Cutover still vergessen;
- Backup ist nur „Array von Envelopes unter beliebigem AES-Key“ statt des gebundenen v5-Formats;
- Tests ersetzen Golden Vectors durch selbst erzeugte erwartete Werte derselben Implementierung.
