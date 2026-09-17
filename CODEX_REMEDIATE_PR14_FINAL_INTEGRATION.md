# Codex Remediation – PR #16 Final Closure

Status: **VERBINDLICHER RESTAUFTRAG** für den kumulativen Stand von PR #16.

Diese Fassung ersetzt alle früheren Fassungen dieser Datei.

PR #16 hat mehrere frühere Restpunkte tatsächlich geschlossen:

- Write-Heads werden aus verifizierten immutable Envelopes rekonstruiert;
- ein echter `IndexedDbCoordinatorStore` existiert;
- mehrere lokale Envelopes können über den echten Store durable werden;
- Migration läuft unter dem Diary-Lock;
- Creation-Persistence bindet ihren persistierten Zustand an `operation_generation`;
- die öffentlich subclassbare `ProviderBoundRemoteTransport`-Basis wurde entfernt.

Diese Punkte nicht zurückbauen.

Der Checkout ist trotzdem **noch nicht intern abgeschlossen**. Solange einer der folgenden Abschnitte 1–5 nicht PASS ist, sind `TODO_INTERNAL: none`, `DONE`, `final`, „vollständig umgesetzt“ oder eine Merge-Empfehlung unzulässig.

Nicht mergen.

## Normative Priorität

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_DOMAIN_SCHEMAS_V1.md`
3. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
4. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
5. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
6. diese Datei
7. bestehender Code

Bestehender Code, PR-Beschreibung, Implementierungsbericht und bereits grüne Tests sind nicht Source of Truth.

---

# 0. Arbeitsregel – zwingend

Arbeite Abschnitt **1 bis 5 in Reihenfolge** ab.

Für jeden Abschnitt:

1. Ist-Zustand im gesamten kumulativen Produktpfad nachvollziehen.
2. Produktcode vollständig korrigieren/verdrahten.
3. Positive, negative, Crash-/Resume-, Race- und adversarial Tests gemäß Abschnitt ergänzen.
4. Tests tatsächlich ausführen.
5. Acceptance Criteria prüfen.
6. Erst dann den Abschnitt als `PASS` markieren und zum nächsten wechseln.

Ein Helper, Service, Interface, Factory, Callback, Test-Double oder exportierter Entry Point zählt **nicht** als produktive Umsetzung, solange der reale App-/Data-Layer ihn nicht benutzt.

Ein Mock-Orchestrator-Test zählt nicht als Rotation-End-to-End-Test.

Ein Klassenname wie `GoogleSheetsSingleWriterTransport` ist keine Trust-Grenze, wenn beliebiger Produktcode ihn mit selbst gewählten Trust-Daten konstruieren kann.

Wenn beim Self-Review ein weiterer in-repo lösbarer Fehler gefunden wird, gehört er zu diesem Auftrag und muss vor Abschluss behoben werden.

---

# 1. Sicheren Single-Writer-Sync wirklich zum App-Produktpfad machen – KRITISCH

## Aktueller Stand

PR #16 hat mit `SingleWriterSyncService` und `IndexedDbCoordinatorStore` erstmals eine echte interne Sync-Komposition geschaffen.

Aber `initializeDataLayer()` stellt aktuell nur

- `registerSingleWriterSync(service)` und
- `synchronizeDataLayer()`

bereit.

Der PR zeigt noch keinen realen App-/Provider-Lifecycle, der nach erfolgreicher authentifizierter Remote-Bindung den Service tatsächlich erzeugt, registriert und als einzigen produktiven Remote-Sync-Pfad verwendet.

`initializeDataLayer()` initialisiert weiterhin den alten `syncManager`. Der Legacy-Whole-Table-Writer darf nicht wieder produktiv werden.

## Änderung

Verdrahte den sicheren Single-Writer-Service als **einzigen internen produktiven Sync-Pfad**.

Erforderlich:

- ein konkreter interner Lifecycle vom authentifizierten Provider-/Remote-Binding zum `SingleWriterSyncService`;
- dieser Lifecycle wird vom App-/Data-Layer tatsächlich aufgerufen;
- lokaler Dirty-/Sync-Trigger führt zum sicheren Single-Writer-Service, nicht zu einem Legacy-Whole-Table-Writer;
- Pull + Full Verify erfolgt vor Writer-Autorität;
- Envelope-Outbox bleibt einzige produktive Remote-Write-Quelle;
- Reload kann den sicheren Service aus authentifiziertem persistentem Binding erneut herstellen, sobald Provider-Auth verfügbar ist;
- wenn der produktive separate Auth-Origin noch fehlt, bleibt die Google-Aktivierung fail-closed, aber **das interne Wiring ist vollständig vorhanden und getestet**.

Der externe Auth-Origin ist kein Grund, intern nur eine manuell aufzurufende Registrierungsfunktion stehen zu lassen.

## Sicherheitskritischer Verifier-Kontext

`SingleWriterSyncService.createGoogle()` darf **keine sicherheitskritischen erwarteten Trust-Werte frei vom Caller übernehmen**.

Insbesondere dürfen diese Werte nicht einfach über ein caller-konstruiertes `TrustedRemoteContext`/`Omit<...>` vertrauenswürdig werden:

- erwarteter Manifest-Fingerprint;
- Key-ID;
- Recovery Generation;
- Recovery Commitment;
- Google Account Binding;
- alter Remote Anchor;
- lokale immutable Envelopes / lokale Heads.

Diese Werte müssen aus den dafür normativ vorgesehenen authentifizierten lokalen Zuständen, statischen Schema-Registry-Daten und verifizierten immutable Envelopes abgeleitet werden.

Falls ein notwendiger Wert noch nicht authentifiziert persistent vorhanden ist, ist das ein interner Implementierungsfehler, der in diesem Auftrag zu schließen ist; nicht durch einen freien Funktionsparameter umgehen.

## Tests

Mindestens:

- App-/Data-Layer-Lifecycle erzeugt nach authentifiziertem Test-Binding den echten `SingleWriterSyncService`;
- 3 lokale Envelopes laufen über echten `IndexedDbCoordinatorStore` vollständig `prepared -> pending -> remote_seen -> durable`;
- Reload und erneuter Service-Aufbau behandeln durable Rows nicht erneut als pending;
- Unknown Outcome bei Envelope 2;
- stale Generation zwischen Remote-I/O und Durable-Commit;
- Same-ID/different-bytes fatal;
- fehlendes/manipuliertes Outbox-Flag wird aus immutable Envelopes rekonstruiert;
- ohne authentifiziertes Binding kein Sync;
- sicherheitskritische Verifier-Erwartungen können nicht vom allgemeinen Caller überschrieben werden.

### Acceptance

Der sichere Coordinator ist der intern verwendete Produkt-Sync-Pfad. Es existiert kein nur manuell registrierbarer „Produktservice“, während der reale App-Lifecycle ihn nicht benutzt.

---

# 2. Rotation als echten produktiven End-to-End-Pfad implementieren – KRITISCH

## Aktuelles Problem

PR #16 ändert `rotation.ts` nicht.

`runRotation()` ist weiterhin ein Callback-Orchestrator. Der bisherige Test ersetzt die entscheidenden Operationen durch triviale Callbacks.

Damit ist die zentrale Definition-of-Done weiterhin nicht erfüllt:

> Rotation besitzt konkrete produktive Dependencies, einen echten Produkt-Aufrufer und Crash-/Resume-Nachweise über jede persistente Phase.

## Änderung

Implementiere konkrete produktive Rotation-Dependencies und einen realen Produkt-Service/API, der `runRotation()` tatsächlich verwendet.

Die Implementierung muss reale bestehende Komponenten verbinden, nicht nur gleichnamige Callbacks definieren:

1. Successor RK erzeugen.
2. Successor Root-Wrap erzeugen und readback-verifizieren.
3. Freeze persistent setzen und readback-verifizieren.
4. Erst **nach** persistentem Freeze finalen Source-State aus verifizierten immutable Envelopes neu lesen.
5. Source Full Verify + finalen Anchor + Lineage-/Semantic-Snapshot bilden.
6. Successor planned state persistent anlegen.
7. Successor über die produktive `runCreationStateMachine` mit echter IndexedDB-CreationPersistence erstellen/binden.
8. Aktive und Tombstone-Heads wirklich als neue Revisionen/Envelopes in den Successor übertragen.
9. Echtes `epoch-migration-sw-v1` erzeugen.
10. Successor mit echtem `FullRemoteVerifier` vollständig prüfen.
11. Bei normaler Rotation Semantic Snapshot Source == Successor erzwingen.
12. Echtes Recovery Artifact erzeugen und über die produktive unabhängige Bootstrap-Grenze erfolgreich prüfen.
13. Echtes v5 Backup erzeugen und über den produktiven Full-Verifier test-restoren.
14. Echtes verschlüsseltes `rotation-announcement-sw-v1` in der Source-Epoche erzeugen.
15. Über echten Coordinator/Transport append, readback und Full Verify durchführen.
16. Erst danach `announcement_durable` persistieren.
17. Aktiven Epoch-Kontext atomar auf Successor schalten.
18. Source `retired` setzen.

Alle Schritte müssen nach Crash/Reload idempotent resumierbar sein.

Abort nur vor durable Announcement. Nach durable Announcement kein Rollback.

## Tests – zwingend integriert

Mindestens ein integrierter Test mit:

- fake IndexedDB;
- echten Root-/Envelope-/Revision-/Manifest-/Backup-/Recovery-Komponenten;
- echter CreationPersistence;
- echter RotationPersistence;
- echtem Coordinator;
- InMemory-/Fake-Provider nur an der externen Netzwerkgrenze.

Keine Mock-Callbacks für die eigentliche Rotation-Semantik.

Fault Injection/Reload nach **jeder** persistierten Rotationsphase.

Zusätzlich beweisen:

- Feature-Mutation zwischen Freeze und finalem Source-Snapshot schlägt fehl;
- finaler Snapshot erfolgt tatsächlich erst nach Freeze;
- Successor-Semantik stimmt bei normaler Rotation exakt überein;
- Recovery-Bootstrap und Backup-Test-Restore liegen vor Announcement;
- kein Switch vor durable Announcement;
- kein Abort danach;
- Resume erzeugt keinen zweiten Successor und kein zweites Announcement.

### Acceptance

`runRotation()` wird von realem Produktcode mit konkreten Implementierungen benutzt. Ein Callback-Orchestrator plus Mock-Test ist FAIL.

---

# 3. Recovery-/Remote-Trust-Boundary vollständig schließen – KRITISCH

## Aktueller Fortschritt

PR #16 entfernt die öffentlich subclassbare `ProviderBoundRemoteTransport`-Basis und bindet `IndependentBootstrapAuthority` konkret an `GoogleSheetsSingleWriterTransport`.

Das ist eine Verbesserung, aber noch keine ausreichende Trust-Grenze.

## Verbleibendes Problem

`GoogleSheetsSingleWriterTransport` hat weiterhin einen öffentlichen Konstruktor mit caller-geliefertem:

- `GoogleApiClient`;
- `GoogleTransportBinding`;
- `ownerPermissionId`;
- `googleAccountBinding`.

`authenticatedAccountBinding()` leitet den Hash aus dem **bereits caller-gelieferten** `ownerPermissionId` ab und vergleicht ihn mit dem ebenfalls caller-gelieferten Binding.

Ein konkreter Klassenname allein beweist also noch nicht, dass `permissionId` wirklich aus der aktuell authentifizierten Google-Identity-Session stammt.

`GoogleApiClient.identity()` ist für diese Vertrauensentscheidung derzeit nicht die nachgewiesene Quelle.

Zusätzlich darf der normale Sync-Service seinen `FullRemoteVerifier` nicht aus frei caller-gelieferten erwarteten Trust-Werten zusammensetzen (siehe Abschnitt 1).

## Änderung

Schaffe eine echte produktive Provider-Identity-Grenze:

- produktiver Google-Transport/Recovery-Authority kann nur über eine Factory erzeugt werden, die an die tatsächlich authentifizierte Provider-Session gebunden ist;
- `permissionId` wird innerhalb dieser Grenze über die authentifizierte Provider-API bestimmt/verifiziert;
- normative `google_account_binding` wird dort intern abgeleitet;
- allgemeiner App-Code kann `ownerPermissionId` oder Account Binding nicht als vertrauenswürdige Tatsache einspeisen;
- Discovery und spätere Snapshot-Loads verwenden dieselbe authentifizierte Provider-Session und konkrete Resource-ID;
- kein frei injizierbarer Recovery-Loader;
- kein öffentlich konstruierbares Objekt mit selbst gewählten Strings darf dieselbe Authority erzeugen;
- Backup-Authority darf nur aus vollständig verifiziertem Backup-Import entstehen.

Der separate produktive Auth-Origin darf extern geblockt bleiben. Die **interne Trust-API und deren lokale Testbarkeit** müssen trotzdem vollständig implementiert sein.

## Adversarial Tests

Der folgende Angriff MUSS scheitern:

1. Recovery Artifact + korrekte URS öffnen.
2. Diary/Epoch/Key/Fingerprint/AccountBinding/Anchor/Commitment aus Candidate übernehmen.
3. eigenen API-/Transport-artigen Stub mit passenden Antworten bauen.
4. selbst gewählte `permissionId` und passendes Binding einsetzen.
5. eigene Resource/Snapshot liefern.
6. versuchen, daraus eine akzeptierte Bootstrap-Authority und Recovery-Aktivierung zu erzeugen.

Zusätzlich darf allgemeiner Caller-Code keinen normalen `FullRemoteVerifier` mit frei überschriebenem erwarteten Fingerprint/Key/Recovery/Binding in den produktiven Google-Sync-Pfad einschleusen können.

## Positivtest

Mit einer kontrollierten Test-Provider-Identity-Grenze:

- Identity-/Permission-ID wird innerhalb der Provider-Grenze bestimmt;
- Binding intern abgeleitet;
- Discovery bindet konkrete Resource;
- vollständiger Manifest-/Anchor-/Envelope-/Graph-Verify erfolgreich;
- Recovery-Aktivierung danach erfolgreich.

Echte Google-Credentials sind für diesen lokalen Architekturtest nicht nötig. Live-Google-Validierung bleibt zusätzlich `BLOCKED_EXTERNAL`.

### Acceptance

Recovery- und normaler Sync-Trust stammen aus authentifizierter Provider-/Local-State-Herkunft, nicht aus passenden Werten, die ein Caller selbst zusammensetzen kann.

---

# 4. Fehlende Fault-Injection-/Crash-/Race-Matrix vollständig nachholen – KRITISCH

PR #16 nennt diese Lücke selbst ausdrücklich. Der Auftrag ist nicht fertig, solange die Matrix fehlt.

## 4.1 Create/Reconcile

Tests mindestens für:

- Crash/Reload nach jeder persistenten Creation-Phase;
- Create Request serverseitig erfolgreich, Response verloren;
- Crash direkt nach serverseitigem Create;
- bereits existierender empty Candidate bei Resume -> kein zweiter Create;
- Manifest Write erfolgreich, Response verloren;
- Crash nach Manifest Write vor State-Commit;
- Property PATCH erfolgreich, Response verloren;
- Crash nach Property PATCH vor State-Commit;
- Orphan PATCH erfolgreich, Response verloren;
- zwei empty Candidates;
- canonical + empty;
- zwei partial;
- zwei manifesttragende;
- conflicting + expected;
- final `bound` nur bei exakt einem nicht-getrashten canonical Candidate;
- stale `operation_generation` vor/nach Remote-I/O fail-closed.

## 4.2 Legacy Migration

Tests mindestens für:

- Crash vor Backfill;
- Crash nach Ziel-Envelope vor `completedKeys`;
- Reload/Resume ohne zweite semantische Revision;
- Crash während Verify;
- Crash unmittelbar vor Cutover;
- paralleler Feature-Write;
- stale Generation;
- manipuliertes Migration-State-Objekt;
- falscher State-Hash/Ref;
- gefälschtes `verified:true`;
- Activity-Type-LocalStorage enthalten;
- ID-Kollision fatal.

## 4.3 Outbox / Coordinator

Mit echtem `IndexedDbCoordinatorStore`:

- Crash nach `prepared`;
- Crash nach `pending` vor Append;
- Append Unknown Outcome;
- `remote_seen` persistiert;
- Crash nach `remote_seen` vor finalem Verify/Durable;
- Reload und korrekter Resume;
- 3+ Envelopes;
- stale Generation;
- Same-ID/different-bytes;
- fehlendes/manipuliertes Outbox-Flag rekonstruiert;
- Anchor + Durable-Ack atomar.

## 4.4 Rotation

Die vollständige Matrix aus Abschnitt 2, einschließlich Reload nach jeder persistenten Phase.

## 4.5 Recovery

- echter Self-Confirmation-Angriff mit passenden Candidate-Werten scheitert;
- selbst gebauter providerähnlicher Stub kann keine trusted Authority erzeugen;
- normaler produktiver Sync kann keinen caller-gefälschten `TrustedRemoteContext` einschleusen;
- positiver kontrollierter Provider-Bootstrap gelingt.

## 4.6 Google Transport lokal

Beibehalten/ergänzen:

- bound Read ohne Protocol-AppProperties fatal;
- pre-bound Candidate Inspection separat;
- falsche/zusätzliche AppProperties fatal;
- `epoch_locator` exakt;
- nichtstandardmäßige Sheet IDs;
- `startRow != 0`;
- physische Lücke;
- Pagination;
- 21.936-Byte-Row-Grenze;
- 134.217.728 Gesamtbytes;
- 100.000 physische Rows;
- byteidentisches Retry zählt physisch mehrfach.

### Acceptance

Keine Security-DONE-Behauptung beruht nur auf Happy-Path- oder Mock-Tests.

---

# 5. Finaler adversarialer Abschlussreview und Gates – ZWINGEND

Erst wenn Abschnitte 1–4 PASS sind:

## Adversarialer Review des gesamten kumulativen Checkouts

Frage explizit und belege mit Code/Test:

- Wird der sichere Single-Writer-Service vom realen Data-/App-Lifecycle benutzt?
- Existiert irgendein erreichbarer Legacy-Whole-Table-Remote-Writer?
- Kann allgemeiner Caller-Code sicherheitskritische Verifier-Erwartungen selbst setzen?
- Kann allgemeiner Caller-Code eine Recovery-Authority aus selbst gewählten Providerwerten bauen?
- Werden Write-Parents ausschließlich aus verifizierten immutable Envelopes bestimmt?
- Prüfen normale Reads Journal + State-MAC?
- Kann ein manipuliertes Outbox-Flag ein Envelope verschwinden lassen?
- Funktioniert `prepared -> pending -> remote_seen -> durable` nach Crash/Reload?
- Läuft Create nach Unknown Outcome ohne Duplikatbildung weiter?
- Bleibt vor `bound` exakt ein Candidate?
- Läuft Migration unter Lock und crash-idempotent?
- Ist Freeze persistent, bevor der finale Rotation-Snapshot gelesen wird?
- Benutzt Produktcode echte Rotation-Dependencies?
- Erfolgt Switch nur nach durable Announcement?
- Sind Recovery + Backup vor Announcement erfolgreich getestet?
- Kann stale Generation irgendeinen neueren Security-State überschreiben?

Wenn eine Antwort nicht eindeutig PASS ist: **nicht abschließen; beheben und erneut testen.**

## Qualitätsgates

Ausführen und exakt dokumentieren:

- `npm run build`
- vollständiges `npm test`
- Argon2id Golden Vector ohne Skip
- gezieltes ESLint für `src/data`, `src/security`, `src/sync`, relevante Tests
- `npm run lint:css`
- `npm run build-storybook`, sofern weiterhin Repository-Gate
- `git diff --check`

Keine Lint-/Style-/Test-Regeln abschwächen.

Globale bestehende UI-Lint-/E2E-Baselinefehler dürfen nur als Baseline dokumentiert werden, wenn sie nachweislich unabhängig sind. Relevante UI-Smokes für geänderte Data-/Sync-Pfade trotzdem ausführen.

## Dokumentation

Erst nach erfolgreichem Code-/Test-Abschluss aktualisieren:

- `docs/security/IMPLEMENTATION_AUDIT_SINGLE_WRITER_V1.md`
- `docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md`
- `docs/security/PRODUCTION_SECURITY_RELEASE_GATES.md`

`TODO_INTERNAL: none` nur, wenn Abschnitt 1–5 vollständig PASS ist.

`SECURITY/SPEC DECISION REQUIRED: none` nur, wenn keine echte ungelöste Normlücke gefunden wurde.

Zulässige `BLOCKED_EXTERNAL` sind ausschließlich:

- separater produktiver Auth-Origin;
- echte Google-Testcredentials/Testkonto für Live-Provider-Validierung;
- reale WebAuthn-PRF-Hardware-/Browsermatrix;
- Produktionshosting/CSP/Header;
- externer Security-/Crypto-Audit.

Ein fehlender interner Caller, Adapter, Provider-Factory, Rotation-Service, Test oder Crash-/Resume-Pfad ist **niemals** `BLOCKED_EXTERNAL`.

---

# Definition of Done

Der Auftrag ist erst fertig, wenn ALLE Aussagen wahr sind:

1. Der sichere Single-Writer-Service ist der intern tatsächlich verwendete App-/Data-Sync-Pfad.
2. Sicherheitskritische `FullRemoteVerifier`-Erwartungen stammen aus authentifizierter lokaler/Provider-Herkunft und sind nicht frei caller-setzbar.
3. Rotation besitzt konkrete produktive Implementierungen, einen echten Aufrufer und End-to-End-Crash/Resume-Tests.
4. Recovery Authority kann nicht durch selbst gewählte Providerwerte/API-Stubs gefälscht werden.
5. Create/Migration/Outbox/Rotation/Recovery besitzen die verlangte Fault-Injection-/Adversarial-Abdeckung.
6. Alle internen Findings des finalen adversarialen Reviews sind behoben.
7. Qualitätsgates wurden nicht abgeschwächt.
8. Dokumentation entspricht dem tatsächlichen Code.

Erwarteter Endzustand:

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`

Nur echte `BLOCKED_EXTERNAL` gemäß obiger Liste.

Kein Merge.
