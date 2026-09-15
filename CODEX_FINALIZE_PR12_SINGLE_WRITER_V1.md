# Codex Finalisierung – Single Writer v1 nach PR #12

Status: verbindlicher Arbeitsauftrag. Arbeite den gesamten aktuellen Checkout als kumulative Implementierung ab. Nicht mergen. Nicht mit intern lösbaren TODOs beenden.

## Normative Priorität

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_DOMAIN_SCHEMAS_V1.md`
3. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
4. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
5. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
6. bestehende Codex-Pläne
7. bestehender Code

Die sechs Dateien unter `src/security/schemas/*` für Pain/Activity/Medication/Settings konkretisieren die neue Fachschema-Norm. Ändere ihre Semantik nicht eigenmächtig.

## 1. Fachschema-Verifikation vollständig machen

Der bisherige flache `validateDataSchema()` ist unzureichend. Implementiere vollständige deterministische Validierung der in den gebundelten Draft-2020-12-Schemas verwendeten Keywords: verschachtelte Objects/Arrays, `required`, `additionalProperties`, `type` inklusive Union, `enum`, `const`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `minimum`, `maximum`, `pattern`, `anyOf`, `allOf`, `if/then`.

Zusätzlich alle semantischen Regeln aus `EDS_DOMAIN_SCHEMAS_V1.md`: reale Kalenderdaten, kanonische UTC-Zeitstempel, Pain-Ende nach Beginn, Activity-Ongoing-/Zeitintervall-Regel, eindeutige Pain-Locations, deutsche case-insensitive Eindeutigkeit der Settings. Remote/Backup niemals normalisieren oder reparieren.

Tests für fehlende Required-Felder, falsche nested Typen, Zusatzfelder, Limits, ungültige Daten/Zeitstempel, Case-Duplikate und ungültige Activity-Farben.

## 2. Lokale Source of Truth vollständig umstellen

Der produktive Pfad darf nicht länger `secureRecords` als mutable Fach-Source-of-Truth benutzen.

Implementiere und verdrahte:
- Diary/Epoch/RK-Kontext und Root-Wrap;
- immutable Revisionen/Envelopes;
- persistente Envelope-ID-Reservation vor Encryption;
- Envelope-Journal mit `local_seq`, Count und Hashkette;
- Outbox mit exakt persistierten Remote-Row-Bytes;
- authentifizierten `epoch_local_security_state`, State-MAC und `operation_generation`;
- Remote Binding, Anchor, Epoch Status, Rotation/Migration-Refs;
- diary-spezifische Web Locks, State reread im Lock, Generation-Recheck nach Netz-I/O;
- Anchor + Durable-Ack atomar in derselben IndexedDB-Transaktion;
- Feature-Repositories lesen fachliche aktuelle Heads aus Revisionen und erzeugen bei Mutation neue Revisionen/Envelopes;
- keine zweite mutable Cipherrecord-Source-of-Truth nach Cutover.

Legacy-Migration vollständig und crash-resumable: Pain, Activity, Medication, Prescriptions, Pain-Type-Settings und `localStorage["eds-diary-activity-types-v1"]`. Mapping `id/status` zu Wrapper gemäß `EDS_DOMAIN_SCHEMAS_V1.md`. Pain-Legacy-Zeitstempel einmalig kanonisieren; unparsebare nichtleere Werte fail-closed ohne Quellverlust. Kollisionen fatal.

## 3. Create/Reconcile als persistente State Machine

Der aktuelle `transport.create()`-Pfad ist nicht normativ und widerspricht der strikten `appProperties`-Prüfung.

Implementiere exakt crash-resumable:
- Planned-State vor Netz-I/O persistent/readback-verifiziert;
- Discovery vor Create über `sync-<creation_locator>`;
- Create erzeugt nur leere `_m`/`_r`-Struktur; kein Manifest im Create;
- Create-Response-ID nur Candidate;
- Kandidaten `empty | expected-manifest | partial | conflicting` klassifizieren;
- ausschließlich leere Duplikate deterministisch behandeln, andere Mehrdeutigkeit fail-closed;
- persistierte one-shot Manifestbytes separat schreiben und readback-verifizieren;
- Unknown Outcome jedes mutierenden Schritts ausschließlich durch Discovery/Readback reconciliieren;
- danach exakt `app_format="sync-v5"` und normativer `epoch_locator` setzen;
- PATCH-Unknown-Outcome reconciliieren;
- vollständige Drive/Owner/Account/Grid/Manifest-Verifikation;
- unmittelbar vor `bound` erneute Discovery, genau ein kanonischer Candidate;
- `bound` atomar persistieren; Append erst danach;
- dynamische `_m`/`_r` Sheet-IDs.

Fault-Injection/Crash-Resume nach jeder persistierten Phase und jedem mutierenden Google-I/O.

## 4. Recovery-Continuity schließen

`recoverRootKeyCandidate(..., manifestCommitment)` darf keine Self-Confirmation erlauben. Der unabhängige `recovery_urs_commitment` muss aus bereits authentifiziertem Remote-/Backup-State stammen bzw. innerhalb des produktiven Bootstrap-Verifiers authentifiziert werden; ein Caller darf nicht einfach ein selbst aus derselben URS berechnetes Commitment als Vertrauensbeweis einspeisen.

AEAD-Unwrap bleibt nur Kandidat. Root-Wrap/Aktivierung erst nach vollständiger produktiver Remote-/Backup-Verifikation und exakter Bindung von Diary, Epoch, Key, Manifest-Fingerprint, Recovery Generation, Account Binding und Anchor.

Ersetze den bisherigen Test, der Commitment selbst berechnet und zurückreicht, durch positive und negative unabhängige Bootstrap-Tests.

## 5. Backup-Restore korrigieren und vollständig testen

Behebe den leeren remote-gebundenen Fall: `remoteBound=true` mit `record_rows=[]` besitzt einen gültigen H0-Anchor und darf beim Restore nicht fälschlich `null` erwarten. Die Bindung remote-bound/offline muss aus authentifiziertem Backup-State eindeutig rekonstruierbar sein; falls dafür ein explizites Manifestfeld nötig ist, verwende die bereits normativ vorgesehene Backup-Semantik und ändere keine Krypto-Domain-Separation.

Test-Restore über einen echten `FullRemoteVerifier`, nicht nur Ablehnung eines Fake-Callbacks. Negative Tests für Counts, Hashes, Anchor, Duplicate-ID/different-bytes, AEAD, Graph und falsche Bindings. Kein aktiver State vor vollständigem Verify ändern.

## 6. Rotation/Migration produktiv verdrahten

Nicht nur Step-Helper:
- persistenter/readback-verifizierter Rotation-State;
- reale Feature-Mutationen ab Freeze sperren;
- finaler Source Prefix/Anchor/Semantic Snapshot nach Freeze;
- Successor RK/Manifest/Root-Wrap;
- Successor über vollständiges Create/Reconcile;
- vollständige semantische Kopie und Full Verify;
- Semantic Snapshot Gleichheit bei normaler Ein-Source-Rotation;
- Recovery verifizieren;
- Backup + Test-Restore;
- echtes Rotation-Announcement in alter Epoche append/readback/full verify;
- erst `announcement_durable`, dann atomarer Switch; alte Epoche retired;
- Crash/Reload nach jeder Phase idempotent fortsetzbar; Abort nur vor durable Announcement.

`epoch-migration-sw-v1` ebenfalls nach normativem Schema und Snapshot-Regeln erzeugen/verifizieren.

## 7. Bereits gehärtete Google-/Verifier-Pfade regressionssicher halten

Nicht zurückbauen: structure-first/chunked Grid read, startRow, Raw String Cells, dynamische Sheet-IDs, Pagination, exakter epoch_locator, Owner permissionId/account binding, Same-ID/different-bytes fatal, IV-Reuse-Anomalie, Pull-before-Push und finaler Full Verify vor Durable.

Ergänze Tests für nichtstandardmäßige Sheet-IDs, `startRow != 0`, Grid-Gaps, oversize, falsche appProperties/account binding und paginierte Discovery/Permissions.

## 8. Abschlussgates

Vor Abschluss adversarial Self-Review des gesamten kumulativen Checkout, nicht nur des letzten Diffs.

Pflicht:
- alle in-repo lösbaren Requirements `PASS`;
- `TODO_INTERNAL: none`;
- `SECURITY/SPEC DECISION REQUIRED: none`, soweit durch `EDS_DOMAIN_SCHEMAS_V1.md` jetzt entschieden;
- keine produktiven Security-Stubs/Bypass-Callbacks;
- Build grün;
- alle Security-/Sync-Vitest-Tests grün inklusive Argon2id Golden Vector ohne Skip;
- gezielter ESLint Security/Sync/Test grün;
- Audit/Implementation/Release-Gates wahrheitsgemäß aktualisiert.

Nur echte externe Punkte dürfen `BLOCKED_EXTERNAL` bleiben: produktiver separater Auth-Origin, echte Google-Testcredentials/Testkonto, reale WebAuthn-PRF-Hardware-/Browsermatrix, Produktionshosting/CSP/Header, externer Audit.

Wenn noch ein intern lösbarer Punkt offen ist, arbeite weiter statt den Auftrag abzuschließen. Fehlender Git-Remote oder gestapelter PR ist kein Abbruchgrund. Keine Security-Semantik erfinden. Kein Merge.