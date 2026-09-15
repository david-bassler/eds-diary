# Codex Remediation Plan – PR #9 / Google Sheets Single-Writer v1

Stand: 15.09.2026

Status: **VERBINDLICHER IMPLEMENTIERUNGSAUFTRAG.**

## 0. Ziel

Arbeite den bestehenden Stand aus PR #9 so weit nach, dass die **internen, im Repository lösbaren Release-Blocker** des Profils `google-sheets-single-writer-v1` beseitigt sind.

Dies ist **kein neuer Architekturentwurf**. Die Security-Semantik ist bereits normiert. Erfinde keine neuen Protokollregeln und weiche nicht auf vereinfachte Platzhalter aus.

Der bisherige PR #9 ist eine brauchbare Zwischenstufe, aber noch **nicht mergefähig**. Die nachfolgenden Punkte sind konkrete Review-Befunde und Acceptance Criteria.

## 1. Normative Priorität

Lies vollständig und behandle sie in dieser Reihenfolge als Source of Truth:

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
3. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
4. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
5. `CODEX_IMPLEMENTATION_PLAN_SINGLE_WRITER_V1.md`
6. dieses Dokument
7. `AGENTS.md`

Bei einer echten Inkonsistenz zwischen diesem Review-Dokument und einer höher priorisierten Norm gilt die höher priorisierte Norm.

**Wichtig:** Der vorhandene Code in PR #9 ist nicht Source of Truth. Wenn er der Norm widerspricht, ändere ihn.

## 2. Arbeitsweise

- Arbeite auf dem bereitgestellten aktuellen Checkout weiter.
- **Nicht abbrechen**, nur weil im Codex-Workspace kein Git-Remote konfiguriert ist.
- Keine Security-Semantik erfinden. Falls nach vollständigem Lesen tatsächlich eine nicht normierte sicherheitsrelevante Entscheidung verbleibt: fail-closed implementieren und `SECURITY/SPEC DECISION REQUIRED` dokumentieren.
- Keine bereits spezifizierten Punkte als „offen“ behandeln.
- Kein künstliches Grünmachen durch Stubs, permissive Verifier oder Tests, die nur prüfen, dass ein Callback aufgerufen wurde.
- Produktpfade müssen die sicheren Implementierungen wirklich verwenden.
- Kein Merge durch Codex.
- Wenn die Plattform trotz Anweisung einen neuen PR erzeugt, ist das kein Grund zum Abbruch; implementiere vollständig im aktuellen Checkout und nenne im Abschlussbericht Branch/PR. Inhaltliche Vollständigkeit hat Vorrang vor PR-Hygiene.

---

# 3. Kritischer Block A – Manifest/Fingerprint nur einmal und bytegenau

## Befund

`src/security/manifest.ts` enthält bereits die richtige normative `manifestFingerprint()`-Konstruktion. `src/sync/google/GoogleSheetsSingleWriterProfileCodec.ts` berechnet den Fingerprint jedoch separat als Hash über ein JCS-Array der vier Sheet-Zellen. Das ist ein Protokollfehler.

## Pflichtänderung

- Es darf **genau eine** normative Fingerprint-Implementierung geben.
- Der Sync-Codec muss die zentrale Funktion aus `src/security/manifest.ts` verwenden oder exakt dieselben zentralen Bytes konsumieren.
- Kein zweiter Fingerprint-Algorithmus im Repo.
- Manifest-Zellen vor Fingerprint strikt auf `sync-v5`, Version `5`, 12-Byte IV, kanonisches Base64URL und Ciphertextgrenzen prüfen.

## Tests

- Golden Vector aus `EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`.
- Test, dass Array-Hashing/andere Serialisierung **nicht** akzeptiert wird.
- Grep-/Architekturtest, der parallele ad-hoc Manifest-Fingerprint-Implementierungen verhindert, soweit praktikabel.

---

# 4. Kritischer Block B – echter produktiver Full Remote Verifier

## Befund

`VerifiedRemoteState` und `verifyRemote()` sind als richtige Architekturgrenze vorhanden, aber der eigentliche produktive Verifier ist noch nicht vollständig verdrahtet. Die aktuellen Tests können einen Callback einsetzen, der lediglich Row-IDs als „verified“ markiert. Das beweist keine kryptographische Remote-Verifikation.

## Pflichtänderung

Implementiere einen produktiven Verifier, der vor `writer_active` **und erneut vor Durable/Anchor-Commit** mindestens in dieser Reihenfolge vollständig prüft:

1. erwartete Diary-/Epoch-/Provider-Bindung aus vertrauenswürdigem lokalem Zustand laden;
2. Google-Datei-/Grid-Invarianten sind bereits vom Transport streng geprüft;
3. Manifestheader strikt validieren;
4. normativen `manifest_fingerprint` berechnen und gegen gepinnten erwarteten Fingerprint prüfen;
5. `K_epoch_manifest` ableiten, Manifest AEAD öffnen;
6. geschütztes Manifest strikt schema-validieren: IDs, `sync_profile`, `crypto_suite`, `recovery_generation`, `recovery_urs_commitment`, `google_account_binding`, Allowlist, Registry-Hash, Limits, predecessor-Epochen;
7. lokalen gebundelten Schema-Registry-Hash exakt reproduzieren;
8. jede physische `_r`-Zeile in Reihenfolge strikt prüfen;
9. jede Envelope-ID/IV/Ciphertext Base64URL-/Längen-/Bucket-validieren;
10. jeden Envelope unter seinem einmaligen `K_env` mit normativer Record-AAD öffnen;
11. entschlüsselten Wrapper strikt gegen die passende maschinenlesbare Schema-Datei validieren;
12. `revision_id`-Eindeutigkeit, Parent-before-Child, Record/Type/Schema-Bindung, Limits und Graph-Azyklizität prüfen;
13. Control-Envelopes exakt prüfen; verbotene Multi-Writer-Control-Schemas in diesem Profil fatal;
14. `rotation-announcement-sw-v1` auswerten; unterschiedliche konkurrierende gültige Announcements aus derselben Epoche => fail-closed Fork/Security State;
15. aktuellen Revisionsgraph/Heads bestimmen; kein Timestamp-/Row-LWW;
16. gepinnten alten Anchor gegen das aktuelle physische Präfix prüfen;
17. lokale immutable Envelopes/Outbox gegen Remote bytegenau reconciliieren; gleiche ID + andere Bytes fatal; lokale nicht repräsentierte Heads dürfen nicht verschwinden;
18. nur dann ein `VerifiedRemoteState` erzeugen.

`VerifiedRemoteState` darf nicht durch beliebige triviale Callbacks im Produktpfad erzeugt werden können. Test-Doubles dürfen eine explizite Test-Implementierung verwenden, aber Produktcode muss den realen Verifier verdrahten.

## Coordinator

- `pullVerify()` darf `writer_active` erst nach obigem vollständigen Verifier setzen.
- Nach jedem Append/Unknown-Outcome-Reconcile muss der **gesamte finale Remotezustand** erneut durch denselben Verifier laufen, bevor Anchor + Durable-Ack atomar persistiert werden.
- Der Anchor muss aus genau dem verifizierten Snapshot entstehen, nicht aus einem früheren unverified Snapshot.
- Generation-/Operation-Token nach Netz-I/O erneut prüfen.

## Tests

Mindestens negative Tests für:

- ungültiges AEAD in beliebiger Row;
- gültige AEAD, aber ungültiges Record-Schema;
- unbekanntes/forbidden Control-Schema;
- Parent fehlt / Parent nach Kind / Cross-Record Parent;
- Duplicate `revision_id`;
- konkurrierende Rotation-Announcements;
- alter Anchor nicht mehr enthalten;
- lokale Outbox-ID remote mit anderen Bytes;
- Remote enthält zusätzliche kryptographisch ungültige Zeile nach erfolgreichem Append => **kein Durable-Ack**;
- trivialer Test-Callback darf nicht der produktive Verifier sein.

---

# 5. Kritischer Block C – Google Transport streng gemäß Wire-Profil

## Befund

Der aktuelle Adapter benutzt teilweise `values:batchGet`, hardcodiert `_r.sheetId = 1`, prüft Grid-/Merge-/Tab-/Drive-/Permission-Invarianten nicht vollständig und verwendet nicht die normativen `appProperties`.

## Pflichtänderung

### 5.1 Struktur-/Grid-Read

Sicherheitsrelevante Reads dürfen nicht auf der Values API als Vertrauensquelle beruhen.

Verwende `spreadsheets.get` mit enger Field-Mask zunächst **ohne große Grid-Daten** und prüfe mindestens:

- exakt zwei Tabs `_m` und `_r`;
- beide `GRID`;
- keine zusätzlichen/umbenannten Tabs;
- keine Merges;
- `_m`: exakt 4 Spalten und 1 Protokollzeile; Zellen `userEnteredValue.stringValue`;
- `_r`: exakt 3 Spalten;
- `1 <= rowCount <= 100000` vor großem Read;
- tatsächliche, dynamische `sheetId` von `_r` erfassen und für `AppendCellsRequest` verwenden;
- keine `formulaValue`, `numberValue`, `boolValue`, Error-/berechnete Ersatzdarstellung im Protokolllog;
- lückenloser physischer Log bis `last_protocol_row`; Trailing Empty Rows erlaubt.

Große `_r`-Daten chunked lesen und Byte-/Row-Limits vor übermäßiger Allokation erzwingen.

### 5.2 Drive-Dateibindung

Vor Aktivierung/Binden vollständig prüfen, wie in der Norm spezifiziert:

- `ownedByMe=true`;
- `shared=false`;
- kein `driveId`;
- `isAppAuthorized=true`;
- erwarteter MIME-Type;
- nicht trashed;
- paginierte `permissions.list` und genau die zulässige Owner-User-Permission des gebundenen Kontos;
- `google_account_binding` aus dem verifizierten `permissionId` gemäß Norm reproduzieren.

### 5.3 `appProperties`

Nach Bindung exakt nur:

```text
app_format = "sync-v5"
epoch_locator = <normativ berechneter Wert>
```

Entferne/verwende nicht als Protokollvertrag:

```text
eds_locator
eds_profile
```

Keine E-Mail, Diary-ID, Epoch-ID, Vorgängerlink oder medizinische Daten in Titel/Properties.

### 5.4 Schreiben

- ausschließlich `spreadsheets.batchUpdate` + `AppendCellsRequest`;
- dynamisch verifizierte `_r.sheetId`;
- `fields="userEnteredValue"`;
- ausschließlich `stringValue`;
- Requestgröße <= normativer Grenze;
- Readback-Verifikation.

### 5.5 Fehlernormalisierung

Vollständig und deterministisch zwischen `auth_required`, `permission_denied`, `not_found`, `rate_limited`, `temporary_failure`, `conflict_or_unexpected_remote_change`, `integrity_failure`, `provider_incompatible` und `unknown_outcome` unterscheiden.

`unknown_outcome` nur dort, wo eine **mutierende Operation serverseitig erfolgreich gewesen sein könnte**, deren Ergebnis aber nicht bekannt ist. Ein normaler Read-5xx ist nicht automatisch Unknown Outcome.

---

# 6. Kritischer Block D – Create/Lost Response/Reconciliation korrekt

## Befund

Der aktuelle Create-Pfad schreibt Manifest und erst danach Discovery-Properties; Discovery sucht zugleich über diese erst später gesetzten Properties. Geht die Create-Antwort verloren, ist ein erfolgreich erzeugtes Sheet dadurch nicht sicher wiederauffindbar. Genau diese Konstruktion verbietet die Norm.

## Pflichtänderung

Implementiere den Ablauf aus Abschnitt 9 der exakten Spezifikation vollständig:

1. **vor Netz-I/O** persistent/readback-verifiziert Planned-State erzeugen:
   - `creation_locator`;
   - Dateiname `sync-<creation_locator>`;
   - Diary/Epoch/Key IDs;
   - erwartete normative `appProperties`;
   - one-shot Manifestbytes + Fingerprint;
2. **vor jedem Create zuerst Discovery** über neutralen Dateinamen / Drive-Metadaten, nicht nur über nachträglich gesetzte Properties;
3. `spreadsheets.create` erzeugt nur die exakte **leere** `_m`/`_r`-Struktur mit Titel `sync-<creation_locator>`;
4. Create-Response-ID ist nur ein Kandidat;
5. Responseverlust => Discovery muss das eben erzeugte Sheet trotzdem finden können;
6. Kandidaten klassifizieren: empty / manifest-tragend / partial / conflicting;
7. mehrere ausschließlich leere Duplikate deterministisch nach Norm behandeln; manifest-tragende/partial/conflicting Mehrdeutigkeit => `ambiguous` fail-closed;
8. auf ausgewähltem leeren Kandidaten Manifest in einem BatchUpdate schreiben;
9. Timeout => Readback/Reconciliation, niemals Manifest neu verschlüsseln;
10. Manifest-Readback exakt prüfen;
11. danach normative `appProperties` setzen;
12. Timeout => wieder Reconciliation;
13. vollständige Datei-/Account-/Manifestprüfung;
14. unmittelbar vor `bound` erneut Discovery; exakt ein kanonischer Kandidat;
15. `bound` atomar lokal persistieren; erst danach Append erlauben.

## Tests

Explizite Crash-/Unknown-Outcome-Tests für jeden Netzpunkt:

- Create serverseitig erfolgreich, Response verloren;
- Manifest-Batch erfolgreich, Response verloren;
- appProperties-PATCH erfolgreich, Response verloren;
- zwei leere Duplikate;
- leer + manifest-tragend;
- zwei manifest-tragende;
- partial candidate;
- conflicting candidate;
- Retry erzeugt kein zweites autoritatives Diary-Sheet.

---

# 7. Kritischer Block E – lokale Source of Truth gemäß RK/Epoch, nicht Device-Key-Cipherrecords

## Befund

`src/data/localDatabase.ts` verschlüsselt Fachrecords derzeit direkt mit einem im selben Profil gespeicherten Best-Effort-AES-Key. Das ist nur ein Migrations-Zwischenstand und **nicht** die normative lokale Source of Truth.

## Pflichtänderung

Baue den produktiven lokalen Pfad um auf:

- lokaler Root-Wrap gemäß `mode = best-effort | prf | passphrase`;
- `RK_epoch` nach Unlock als nicht-extractable HKDF-Key/runtime Kontext;
- immutable vorbereitete Envelopes als Source of Truth;
- persistente Envelope-ID-Reservation vor Encryption;
- persistente Outbox mit exakt gespeicherten Remote-Row-Bytes;
- `epoch_local_security_state` exakt schema- und HMAC-gebunden;
- `K_local_state_mac` nie persistieren;
- lokales Envelope-Journal mit `local_seq`, Count und Hashkette;
- `remote_binding`, `remote_anchor`, `epoch_status`, `operation_generation`, Rotation-/Migration-State-Refs im MAC-State;
- Diary-spezifischer Web Lock für jede sicherheitsrelevante Mutation;
- State **innerhalb des Locks neu lesen**;
- keinen Web Lock über Popup/Nutzerinteraktion/lange Netzrequests halten; Operation-Token/Generation persistieren und nach Re-Lock prüfen;
- Anchor + Durable-Outbox-Ack in **derselben IndexedDB-Transaktion**;
- bei State-/Journal-MAC-Fehler fail-closed.

Die bisherigen Feature-Repositories dürfen ihre UI-Schnittstellen behalten, müssen aber intern aus dem Revisions-/Envelope-State lesen und neue Revisionen/Envelopes erzeugen. Es darf keine parallele mutable Cipherrecord-Source-of-Truth neben dem Envelopejournal bleiben.

Der Best-Effort-Modus darf weiterhin technisch als Fallback existieren, aber seine Schutzgrenze muss korrekt bezeichnet sein.

## WebAuthn/Passphrase

Wenn die vollständige UI für WebAuthn-PRF mangels realem Authenticator nicht live getestet werden kann, implementiere zumindest die normativen Persistenz-/Ableitungs-/Enrollment-Grenzen vollständig und halte den UI-Schreibbetrieb fail-closed, bis Enrollment praktisch erfolgreich war. Kein stilles Downgrade.

---

# 8. Kritischer Block F – striktes JSON / Schema Runtime Validation

## Befund

`parseCanonicalJson()` nutzt `JSON.parse()` vor Duplicate-Key-Erkennung. Doppelte JSON-Properties sind danach bereits überschrieben und können nicht mehr erkannt werden.

## Pflichtänderung

- Untrusted JSON muss Duplicate Keys **vor** normaler Objektmaterialisierung erkennen und ablehnen.
- RFC-8785-JCS/I-JSON vollständig beibehalten.
- Nach AEAD-Decrypt: Parsergrenzen/Bytegrenzen vor teuren Operationen, Duplicate-Key-Erkennung, exaktes Schema, Extra-Properties fatal, Re-JCS-Gleichheit prüfen.
- Verwende die maschinenlesbaren Dateien in `src/security/schemas/*.json` tatsächlich zur Laufzeit oder generiere daraus einen gebundelten, deterministischen Validator. Nur Dateien + Registry-Hash ohne Runtime-Validierung reichen nicht.
- Control-Schemas genauso strikt.

## Tests

- Duplicate Top-Level Key;
- Duplicate verschachtelter Key;
- Extra Property;
- fehlende Property;
- falscher Typ;
- non-I-JSON/unpaired surrogate;
- nichtkanonische, aber semantisch gleiche JSON-Bytes nach Decrypt => ablehnen.

---

# 9. Kritischer Block G – Recovery vollständig bis Bootstrap/Aktivierung

## Positiv vorhandener Stand

Recovery-Artefakt ist jetzt außen opaque und Unwrap liefert zunächst nur einen Root-Key-Kandidaten. Das ist die richtige Richtung.

## Pflichtänderung

Der Produktpfad muss vor persistenter Aktivierung exakt einen vollständigen Bootstrap abschließen:

### Remote Bootstrap

- Artifact strikt prüfen;
- URS-KDF/AEAD;
- inner/outer Artifact-ID match;
- `recovery_urs_commitment` aus bereits authentifiziertem Manifest-/vertrauenswürdigem Kontext prüfen;
- Google Account Binding exakt prüfen;
- Remote-Datei streng prüfen;
- Manifest-Fingerprint match;
- Manifest öffnen und IDs + `recovery_generation` match;
- im Recovery-Payload bei remote aktiver Epoche nicht-null Anchor vollständig gegen Remote prüfen;
- gesamtes Remote decrypt/schema/graph/control verifizieren;
- erst danach neuen lokalen Root-Wrap erzeugen, readback-verifizieren und atomar aktivieren.

### Offline Backup Bootstrap

- vollständiges normatives Backup verifizieren;
- eingebettetes Manifest + Fingerprint + Generation prüfen;
- alle Rows/AEAD/Graph/Hashes prüfen;
- isolierten Kandidatenzustand aufbauen;
- Root-Wrap readback-verifizieren;
- als `offline_restored` aktivieren;
- Remote-Bindung bleibt gesperrt, bis später sicher verifiziert/migriert.

Import in ein bereits bestehendes Diary darf keinen automatischen Rollback verursachen.

Ein generisches `bootstrap: () => Promise<void>` ohne beweisbar gebundene normative Schritte ist als alleinige Produkt-Sicherheitsgrenze nicht ausreichend.

---

# 10. Kritischer Block H – vollständiges v5/Single-Writer-Backup

## Befund

Das aktuelle `backup.ts` ist ein eigenes kleines `backup-v1` mit 16-MiB-Grenze und entspricht nicht dem normativen Backupformat.

## Pflichtänderung

Implementiere das in der Norm festgelegte `sync-backup-v5` einschließlich:

- `backup_id` one-shot;
- `K_backup(backup_id)`;
- exaktes Top-Level-Schema;
- geschütztes Backup-Manifest mit exakt normierten Feldern;
- eingebetteter öffentlicher Epoch-Manifestheader;
- `record_rows` in exakter physischer Remote-Reihenfolge;
- `pending_outbox_rows` enthält **jeden** lokalen immutable Envelope, der nicht byte-identisch remote vorkommt, unabhängig von Outbox-Flags;
- local/offline: `record_rows=[]`, kompletter lokaler Envelopebestand in pending;
- JCS-/SHA-/Prefix-/Anchor-Bindung;
- maximale Datei 256 MiB, kombinierte 100k Envelopes/128 MiB kanonische Rows;
- streaming/inkrementelle Verarbeitung statt vollständigem `File.text()` + einem unbounded `JSON.parse()` für große Backups;
- Test-Restore vollständig AEAD-/Schema-/Graph-verifiziert;
- Restore nicht-destruktiv.

Kein alternatives `eds-diary-backup-v1` als Produktionsformat behalten.

---

# 11. Kritischer Block I – persistente crashsichere Single-Writer-Rotation

## Befund

`rotation.ts` ist weiterhin primär eine In-Memory-Schrittfolge. Außerdem ist die alte Epoche während `copying` etc. noch als writable modelliert. Das widerspricht dem Single-Writer-Profil mit persistentem lokalen Schreib-Freeze vor finalem Source-Snapshot.

## Pflichtänderung

Implementiere den persistenten Rotationszustand und die normative Reihenfolge:

1. diary-spezifischen Maintenance-/Rotation-State unter Web Lock setzen;
2. **lokale fachliche Mutationen persistent einfrieren**, bevor der finale Source-Snapshot/Anchor gebildet wird;
3. alten Remote vollständig pullen + verifizieren;
4. finalen Source-Anchor/Semantic-Snapshot bilden;
5. `RK_new`, neue IDs, Manifest one-shot, lokalen Root-Wrap erzeugen + readback;
6. Successor create/bind über robusten Create-Pfad;
7. vollständigen semantischen Live-State in neue Epoch-Revisions/envelopes migrieren;
8. `epoch-migration-sw-v1` mit Source-Anchor/Lineage-/Semantic-Hashes;
9. Successor komplett remote lesen/decrypten und Semantic Snapshot vergleichen;
10. URS erneut bereitstellen oder bewusst neues URS + Generation;
11. neues Recovery-Artefakt erzeugen und test-unwrappen;
12. vollständiges Backup erzeugen und Test-Restore;
13. erst danach `rotation-announcement-sw-v1` in alter Epoche appendieren;
14. Announcement über finalen vollständigen Read + Anchor durable machen;
15. Successor erneut vollständig verifizieren;
16. atomar lokal Successor `active`, Vorgänger `retired`;
17. Schreib-Freeze lösen.

Crash in jedem persistierten Zustand muss resume/fail-closed möglich sein. Ein teilweise beschriebener fehlerhafter Successor wird orphaned, nicht in-place umgedeutet.

Stale Client: vor Push Successor erkennen, alte Remote-Writes einfrieren und lokale nicht repräsentierte Heads semantisch in Successor rebasen.

`oldEpochWritable()` darf während der kritischen Freeze-/Copy-/Verify-Phase nicht einfach `true` liefern.

---

# 12. Kritischer Block J – vollständige Legacy-Migration

## Pflichtänderung

Inventarisiere und migriere **alle** real existierenden fachlichen Quellen, insbesondere:

```text
localStorage["eds-diary-activity-types-v1"]
```

Diese wird deterministisch als Singleton `activity_type_settings` gemäß normativer Singleton-ID-Regel in die v5-Revisions-/Envelope-Source-of-Truth übernommen.

Zusätzlich:

- bestehende IDB-Fachrecords deterministisch über normatives Legacy-ID-Mapping;
- Kollision fatal;
- Shadow/Backfill + `legacy_dirty_generation` Baseline/Catch-up, sodass Änderungen während Migration nicht verloren gehen;
- Legacy erst entfernen/deaktivieren, wenn Ziel vollständig verifiziert und Catch-up abgeschlossen;
- keine neuen fachlichen Klartextwrites nach Cutover;
- keine still vergessenen Settings;
- sichere Migration muss wiederholbar/crash-resumable sein;
- UI ehrlich, solange irgendein Legacy-Klartext-Remote/Local noch existiert.

Tests müssen mindestens Änderung während Backfill und alte Activity-Types enthalten.

---

# 13. Provider/Auth/Product-Wiring

Der bestehende Legacy-Google-Connect-Pfad darf weiterhin fail-closed bleiben, solange der separate Auth-Origin noch nicht bereitgestellt ist. Das ist ein **externer/deploymentbezogener Blocker** und kein Grund, interne Sync-/Crypto-Komponenten unvollständig zu lassen.

Aber:

- alle internen produktiven Komponenten müssen fertig verdrahtet sein, sodass nach Lieferung eines gültigen `AuthProvider`/Tokens keine zweite Sicherheitsarchitektur mehr gebaut werden muss;
- Provider-Core bleibt frei von Google-SDK-/Token-Typen;
- Access Token nur RAM;
- kein Google Runtime JS im sensiblen Haupt-Origin.

---

# 14. Tests – Definition der erforderlichen Assurance für diesen Durchlauf

Erweitere Tests wesentlich über die aktuellen 21 Tests hinaus. Mindestens:

## 14.1 Golden/Byte Tests

- alle Golden Vectors aus der exakten Spec, soweit die betroffenen Funktionen implementiert sind;
- Manifest AAD/Fingerprint;
- Envelope HKDF/AAD/Padding/AEAD;
- Prefix H0/H1/H2/Anchor;
- Recovery HKDF/Commitment/Artifact;
- Local State MAC / Journal;
- Singleton-/Legacy-ID;
- Schema Registry Hash;
- Rotation Announcement/Control Hashes, soweit normiert.

Erwartete Werte fest in Fixtures; nicht aus getesteten Funktionen erzeugen.

## 14.2 Crash/Unknown Outcome

Für Create, Manifest-Write, appProperties, Append, Anchor/Durable und Rotation an jeder relevanten Persistenz-/Netzgrenze.

## 14.3 Google hostile structure

- extra Tab;
- umbenannter Tab;
- Merge;
- falsche Spaltenzahl;
- Formel-/Number-/Bool-Zelle;
- Leerzeile im Log;
- zu große rowCount vor Grid-Read;
- hardcodierte falsche sheetId darf nicht funktionieren;
- falsche Owner-/Sharing-/Drive-Dateibindung.

## 14.4 Local state

- Journalzeile fehlt/verändert/dupliziert;
- State-MAC falsch;
- operation_generation verändert sich zwischen Netzrequest und Commit;
- Web-Lock-Re-Read verhindert stale Head/Anchor;
- Anchor+Durable atomar; Crash davor/danach konsistent.

## 14.5 Recovery/Backup/Rotation

- falsches URS;
- korrektes URS, aber falsches Manifest;
- alter Recovery-Anchor;
- Offline-Backup-Bootstrap;
- Restore in bestehendes neueres Diary blockiert Rollback;
- Crash in jedem Rotation-State;
- stale alter Client rebase/freeze;
- Announcement vor Recovery/Backup darf nicht aktivieren.

## 14.6 State model

Das kleine Single-Writer-Modell darf die zentrale Invariante nicht lediglich per `writer:boolean` konstruieren. Modell/Exhaustive Test muss mindestens echte Übergänge für:

- unverified -> verified -> writer;
- local generation changes;
- append unknown outcome;
- final verification;
- durable anchor;
- rotation freeze/announcement;
- stale session

enthalten und verbotene Zustände tatsächlich erreichbar zu machen versuchen.

---

# 15. Definition of Done

Dieser Auftrag ist erst abgeschlossen, wenn:

1. alle oben genannten **internen** Blocker implementiert sind;
2. `docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md` keine internen Punkte mehr als „nicht erfüllt“/„produktiver Verifier nicht verdrahtet“/„nur Zwischenstand“ ausweist;
3. verbleibende Blocker ausschließlich wirklich externe Dinge sind, z. B. separater Auth-Origin, echte Google-Testcredentials, reale WebAuthn-Hardware-/Browsermatrix, Hosting-Header und externer Audit;
4. Build erfolgreich;
5. neue Security-/Sync-Tests erfolgreich;
6. keine neuen Lintfehler in geänderten Dateien;
7. vorhandene unabhängige UI-Baselinefehler dürfen dokumentiert bleiben, aber neue Regressionen müssen getrennt ausgewiesen werden;
8. keine Produktionsfreigabe behauptet wird, solange externe Gates offen sind;
9. alle Abweichungen von der Norm mit `SECURITY/SPEC DECISION REQUIRED` statt Eigenentscheidung gestoppt werden;
10. Abschlussbericht pro Abschnitt 3–14 `DONE`, `BLOCKED_EXTERNAL` oder `SECURITY/SPEC DECISION REQUIRED` ausweist. `TODO_INTERNAL` ist **kein akzeptabler Abschluss** dieses Remediation-Durchlaufs.

---

# 16. Abschlussbericht

Am Ende aktualisiere:

- `docs/security/IMPLEMENTATION_AUDIT_SINGLE_WRITER_V1.md`
- `docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md`
- `docs/security/PRODUCTION_SECURITY_RELEASE_GATES.md`

Berichte exakt:

- welche Dateien/Module produktiv verdrahtet sind;
- welche Tests wirklich gelaufen sind;
- genaue Pass/Fail-Zahlen;
- `npm audit`-Funde ohne Herunterspielen;
- alle verbleibenden externen Gates;
- keine Behauptung „vollständig sicher“, „auditiert“ oder „production secure“.

Wenn ein Punkt dieses Dokuments nicht umgesetzt werden konnte, benenne ihn konkret und erkläre den technischen Grund. Nicht still überspringen.
