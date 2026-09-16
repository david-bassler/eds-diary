# Codex Remediation – PR #15 Final Closure

Status: **VERBINDLICHER ABSCHLUSSAUFTRAG** für den kumulativen Stand von PR #15.

Dieser Auftrag ersetzt die frühere Fassung dieser Datei. Viele Einzelprobleme aus PR #14 wurden inzwischen verbessert. Der Stand ist aber **noch nicht intern abgeschlossen**. Die unten aufgeführten Punkte sind konkrete, im Repository lösbare Restblocker. Solange auch nur einer davon offen ist, sind die Aussagen `TODO_INTERNAL: none`, `DONE` oder „final“ unzulässig.

Nicht mergen.

## Normative Priorität

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_DOMAIN_SCHEMAS_V1.md`
3. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
4. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
5. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
6. diese Datei
7. bestehender Code

Bestehender Code, PR-Beschreibung, Tests und Implementierungsberichte sind **nicht** Source of Truth.

---

# 0. Arbeitsregel – nicht verhandelbar

Arbeite Abschnitt **1 bis 9 in Reihenfolge** ab.

Für jeden Abschnitt:

1. Ist-Zustand im Produktpfad nachvollziehen.
2. Produktcode vollständig korrigieren/verdrahten.
3. Geforderte positive, negative und Crash-/Race-Tests schreiben.
4. Gezielt ausführen.
5. Abschnitt erst `PASS` nennen, wenn die Acceptance Criteria tatsächlich erfüllt sind.

Ein Helper, Interface, abstrakter Callback, Test-Double oder isolierter Service zählt **nicht** als produktive Implementierung, solange kein realer Produktpfad ihn benutzt.

Ein grüner Mock-Test ist kein Nachweis für einen produktiven End-to-End-Pfad.

Wenn beim Self-Review ein weiterer intern lösbarer Fehler gefunden wird, ist er Teil dieses Auftrags und muss vor Abschluss behoben werden.

---

# 1. Sicheren Single-Writer-Sync wirklich in den Produktpfad verdrahten – KRITISCH

## Aktuelles Problem

`initializeDataLayer()` initialisiert weiterhin nur den alten `syncManager`.

Der `syncManager` verwaltet Feature-Handler/Dirty-Flags, registriert aber keinen produktiven `SingleWriterCoordinator`, keinen produktiven `CoordinatorStore` für die Envelope-Outbox und keinen produktiven sicheren Google-Transport/Codec-Pfad.

Der alte `googleSheets.ts`-Pfad existiert weiterhin; `connectGoogle()` ist aktuell absichtlich gesperrt. Dass der getrennte Auth-Origin extern fehlt, ist zulässig. Dass der **interne sichere Sync-Pfad nicht produktiv verdrahtet ist**, ist dagegen ein internes TODO.

## Änderung

Implementiere einen konkreten produktiven Single-Writer-Sync-Service und verdrahte ihn in den Data-Layer.

Er muss intern mindestens verbinden:

- aktive Diary-/Epoch-Identität aus der lokalen Source of Truth;
- produktiven `CoordinatorStore` auf Basis von `localDatabase`;
- `pendingEnvelopes(...)` aus immutable Envelopes;
- `transitionOutbox(..., 'pending', ...)`;
- `transitionOutbox(..., 'remote_seen', ...)`;
- `commitDurableAck(...)`;
- `SingleWriterCoordinator`;
- produktiven `GoogleSheetsSingleWriterTransport`;
- produktiven `GoogleSheetsSingleWriterProfileCodec` + `FullRemoteVerifier`;
- persistentes Remote Binding / Anchor / Generation;
- Pull-before-Push vor Writer-Autorität.

Der Service darf wegen fehlendem produktiven Auth-Origin **fail-closed** bleiben, muss intern aber vollständig verdrahtet und mit einem InMemory-/Test-Provider ausführbar sein.

Der alte Values-/Whole-table-Pfad darf nicht wieder zum produktiven Writer werden.

## Tests

Mindestens ein Integrationstest muss den echten produktiven Store-Adapter + echten Coordinator + echte Envelope-Outbox verwenden:

1. 3 gültige lokale Envelopes erzeugen;
2. Pull/Verify;
3. `prepared -> pending -> remote_seen -> durable` für alle drei tatsächlich in IndexedDB persistieren;
4. Generation korrekt fortschreiben;
5. Anchor atomar aktualisieren;
6. Reload;
7. keine bereits durable Row erneut als pending behandeln.

Zusätzlich:

- Unknown Outcome bei Envelope 2;
- stale Generation zwischen Remote-Read und Durable-Commit;
- Same-ID/different-bytes;
- fehlendes/manipuliertes Outbox-Flag wird aus immutable Envelopes korrekt rekonstruiert.

### Acceptance

Der sichere Coordinator ist nicht mehr nur Bibliothekscode/Testcode, sondern der interne Produkt-Sync-Pfad. Fehlender externer Auth-Origin blockiert lediglich das echte Google-Login, nicht die interne Implementierung.

---

# 2. Rotation wirklich produktiv implementieren und aufrufen – KRITISCH

## Aktuelles Problem

`runRotation()` ist weiterhin ein Orchestrator aus Dependency-Callbacks.

Das ist als Struktur zulässig, aber im Produkt existiert weiterhin kein nachgewiesener konkreter Satz produktiver Dependencies und kein echter Produkt-Aufrufer. Der bestehende Test ersetzt die kritischen Operationen weiterhin durch triviale Mock-Callbacks.

Damit ist der frühere Punkt „Rotation besitzt konkrete produktive Dependencies und einen echten Aufrufer“ **nicht erfüllt**.

## Änderung

Implementiere konkrete produktive Rotation-Dependencies und einen echten Produkt-Service/API, der `runRotation()` tatsächlich aufruft.

Die konkreten Dependencies müssen reale Operationen ausführen:

- Successor RK erzeugen;
- Successor Root-Wrap erzeugen und readback-verifizieren;
- Freeze persistent + readback VOR finalem Source-Snapshot;
- finalen Source-State aus verifizierten immutable Envelopes lesen;
- Source Full Verify / Anchor / Lineage-/Semantic-Snapshot;
- Successor planned state;
- Successor über die **produktive** `runCreationStateMachine` + IndexedDB CreationPersistence erzeugen/binden;
- aktive und Tombstone-Heads wirklich als neue Revisionen/Envelopes kopieren;
- echtes `epoch-migration-sw-v1` erzeugen;
- Successor mit echtem `FullRemoteVerifier` vollständig prüfen;
- Semantic Snapshot Gleichheit erzwingen;
- echtes Recovery Artifact erzeugen und über den produktiven unabhängigen Bootstrap prüfen;
- echtes v5 Backup erzeugen und über den produktiven Verifier test-restoren;
- echtes verschlüsseltes `rotation-announcement-sw-v1` in der alten Epoche erzeugen;
- über den echten Coordinator/Transport append + Readback + Full Verify;
- `announcement_durable` erst danach persistieren;
- aktiven Epoch-Kontext atomar auf Successor schalten;
- Source `retired` setzen.

Keine dieser Operationen darf nur durch einen Callback-Namen behauptet werden.

## Tests

Mindestens ein integrierter Rotationstest mit:

- fake IndexedDB;
- echten Crypto-/Envelope-/Revision-Komponenten;
- echten Creation-/Rotation-Persistences;
- echtem Coordinator;
- InMemoryTransport nur als externe Providergrenze.

Fault Injection/Reload nach **jeder** persistenten Rotationphase.

Zusätzlich beweisen:

- Mutation nach persistiertem Freeze schlägt fehl;
- finaler Snapshot erfolgt erst nach Freeze;
- kein Switch vor durable Announcement;
- kein Abort nach durable Announcement;
- Resume ist idempotent und erzeugt keine zweiten Successor-/Announcement-Artefakte.

### Acceptance

`runRotation()` wird von realem Produktcode mit konkreten normativen Implementierungen aufgerufen. Ein reiner Callback-Orchestrator-Test reicht nicht.

---

# 3. Recovery Bootstrap Authority wirklich unabhängig und nicht forgebar machen – KRITISCH

## Aktuelles Problem

`IndependentBootstrapAuthority` ist verbessert, aber die Factory erhält weiterhin `authenticatedAccountBinding` als frei vom Caller gelieferten String.

Außerdem ist `ProviderBoundRemoteTransport` öffentlich exportiert und beliebiger Anwendungscode kann eine eigene Subklasse bauen. Ein `instanceof ProviderBoundRemoteTransport` beweist daher nicht, dass das Account Binding tatsächlich aus einem authentifizierten Provider-Identity-Pfad stammt.

Der aktuelle Test beweist nur, dass ein nacktes Objekt nicht als Authority akzeptiert wird. Er beweist nicht den eigentlichen Angriff mit passenden Recovery-Werten + selbst gebautem providerähnlichem Transport.

## Änderung

Die Recovery Authority muss ausschließlich aus einer **vertrauenswürdigen produktiven Provider-Identity-Grenze** entstehen.

Erforderliche Invariante:

- der Caller darf `authenticatedAccountBinding` nicht als vertrauenswürdige Tatsache einspeisen;
- die Authority liest/erzeugt das Account Binding selbst aus dem aktuell authentifizierten Provider-Identity-Ergebnis (`permissionId` -> normative Binding-Ableitung);
- `remote_resource_id` stammt aus Discovery innerhalb derselben Authority/Provider-Session;
- Snapshot wird intern über genau diese Resource geladen;
- kein frei injizierbarer Loader;
- kein öffentlich subclassbares nominales Basiskonstrukt darf allein die Trust-Grenze darstellen;
- Backup-Authority analog nur aus einem vollständig verifizierten Backup-Importpfad.

Geeignete Lösungen sind z.B. module-private Capability/Brand + Factory innerhalb des produktiven Google-Provider-Moduls oder eine gleichwertige Grenze. Keine Security-Semantik erfinden; entscheidend ist, dass beliebiger App-Code die Authority nicht mit selbst gewählten Strings/Loadern erzeugen kann.

## Adversarial Test – zwingend

Dieser Angriff muss scheitern:

1. Recovery Artifact + korrekte URS öffnen;
2. alle passenden Candidate-Werte übernehmen;
3. einen eigenen Transport/Provider-ähnlichen Loader bauen;
4. passendes Account Binding selbst einsetzen;
5. eigene Remote-Ressource/Snapshot liefern;
6. versuchen, eine akzeptierte Bootstrap-Authority zu erzeugen.

MUSS scheitern.

Positivtest:

- echte Test-Provider-Identity liefert `permissionId`;
- Authority leitet Binding selbst ab;
- Discovery bindet konkrete Resource;
- vollständiger Manifest/Anchor/Envelope/Graph-Verify;
- erst danach Recovery-Aktivierung erfolgreich.

---

# 4. Write-Pfad darf den separaten `revisions`-Store nicht als Source of Truth verwenden – KRITISCH

## Aktuelles Problem

Normale Reads rekonstruieren den Graph inzwischen aus verifizierten immutable Envelopes.

`persistRevision()` bestimmt Parents/Heads aber weiterhin aus `STORES.revisions`.

Dieser Store ist nicht die kryptographische Source of Truth. Wird er gelöscht/manipuliert, kann ein neuer Write auf einem falschen Parent-Graphen aufbauen, obwohl das Envelope-Journal korrekt ist.

## Änderung

Vor jeder Fachmutation unter dem Diary-Lock:

1. State-MAC prüfen;
2. vollständige Envelope-Journalintegrität prüfen;
3. immutable Envelopes öffnen;
4. Revision-Graph daraus rekonstruieren/validieren;
5. Parents/Heads **ausschließlich daraus** bestimmen;
6. erst dann neue Revision validieren/reservieren/encrypten/persistieren.

`STORES.revisions` darf höchstens Cache/Index sein.

Wenn er behalten wird:

- vollständig gegen Envelope-Graph beweisen oder bei Abweichung rekonstruieren;
- niemals zur alleinigen Parent-/Head-Entscheidung verwenden.

## Tests

- `revisions`-Store vollständig löschen, Envelopes intakt -> nächster Write verwendet trotzdem korrekten Parent;
- Revision-Cache mit falschem Head manipulieren -> keine falsche Branch-Erzeugung;
- Journal-/Envelope-Manipulation -> Write fail-closed;
- normaler Update erzeugt Parent auf dem tatsächlichen Envelope-Head.

---

# 5. Legacy-Migration vollständig unter Diary-Lock + Generation absichern – KRITISCH

## Aktuelles Problem

Migration-State ist jetzt gehasht und über `migration_state_ref` gebunden. `migrateLegacy()`/`saveMigration()` laufen aber nicht als vollständig serialisierte Security-Mutation unter dem diary-spezifischen Web Lock.

`persistRevision()` wird von normalen Feature-Writes unter Lock aufgerufen, von der Migration aber direkt.

Damit bleiben konkurrierende lokale Mutationen/Generation-Races während Migration möglich.

## Änderung

Migration muss dieselbe Security-Mutationsgrenze verwenden wie normale Writes:

- diary-spezifischer Exclusive Web Lock;
- innerhalb des Locks State neu lesen;
- State-MAC/Journal verifizieren;
- Migrationsphase + Ref/Hash + Generation atomar fortschreiben;
- per-Source Zielpersistenz idempotent;
- vor/nach jeder Phase Generation konsistent;
- keine parallele Fachmutation darf den Migrationssnapshot unbemerkt verändern.

Deadlocks vermeiden: ggf. locked/unlocked interne Varianten definieren; nicht denselben Lock rekursiv anfordern.

## Tests

- konkurrierender Feature-Write während Backfill;
- Crash nach Ziel-Envelope vor completed marker;
- Resume erzeugt keine zweite Revision;
- stale Migration callback kann neueren State nicht überschreiben;
- manipulierter Migration-State/Ref/Hash fatal;
- Activity-Type-LocalStorage weiterhin enthalten.

---

# 6. Creation-Persistence an authentifizierte Generation binden – KRITISCH

## Aktuelles Problem

`CreationState.operationGeneration` existiert, aber `runCreationStateMachine()` vergleicht ihn nicht zuverlässig vor und nach Remote-I/O mit dem aktuellen MAC-authentifizierten Epoch-State.

`indexedDbCreationPersistence.write()` erhöht `operation_generation`, gibt die neue Generation aber nicht an die State Machine zurück. Damit kann der CreationState einen veralteten Generation-Wert tragen.

## Änderung

Creation-State/Persistence-API so ändern, dass jede persistierte Phase an die **aktuelle authentifizierte Epoch-Generation** gebunden ist.

Vor jedem mutierenden Remote-Schritt:

1. unter Lock State lesen;
2. Creation-Intent + erwartete Generation atomar persistieren/readback-verifizieren;
3. Lock lösen;
4. Remote-I/O;
5. Lock neu erwerben;
6. State neu lesen;
7. nur wenn erwartete Generation noch gültig ist, Outcome/Reconcile-State committen;
8. sonst stale callback fail-closed.

Creation-Persistence muss Operation-State-Hash und Generation gemeinsam beweisen.

## Tests

- lokale Fachmutation zwischen Manifest-Write und Reconcile;
- lokale Security-State-Mutation zwischen Property-PATCH und Reconcile;
- stale Create callback nach neuerem Creation-State;
- manipuliertes Operation-State-Objekt/Hash;
- Reload behält korrekte Generation-Bindung.

---

# 7. Outbox-Phasen mit echtem IndexedDB-CoordinatorStore beweisen – HOCH

## Aktuelles Problem

Der neue Coordinator unterstützt `markPending` und `markRemoteSeen`. Die vorhandenen Mehrfach-Envelope-Tests verwenden aber einen Fake-Store, der diese Hooks gar nicht implementiert.

Damit ist die reale produktive Kette

`prepared -> pending -> remote_seen -> durable`

mit `transitionOutbox()` und `commitDurableAck()` noch nicht end-to-end bewiesen.

## Änderung

Implementiere/exportiere einen konkreten `CoordinatorStore`-Adapter über `localDatabase`, der mindestens nutzt:

- aktuellen Anchor;
- `pendingEnvelopes(remoteRows)` bzw. normativ äquivalente Rekonstruktion;
- authentifizierte Generation;
- `transitionOutbox(...,'pending',...)`;
- `transitionOutbox(...,'remote_seen',...)`;
- `commitDurableAck(...)`.

Dieser Adapter muss der produktive Sync-Service aus Abschnitt 1 verwenden.

## Tests

Mit echter fake-IDB:

- jede Phase im Store inspizieren und beweisen;
- Crash nach `pending`;
- Crash nach `remote_seen`;
- Reload setzt korrekt fort;
- fehlendes Outbox-Flag wird aus immutable Envelopes rekonstruiert;
- stale Generation blockiert;
- 3+ Envelopes vollständig durable.

---

# 8. Fehlende Fault-Injection-/Adversarial-Matrix vervollständigen – KRITISCH

Die derzeit 36 Tests sind kein ausreichender Nachweis für die DONE-Behauptungen.

Mindestens folgende Fälle müssen als echte Tests vorhanden sein:

## Create/Reconcile

- Crash/Reload nach jeder persistenten Phase;
- verlorene Create-Response;
- Crash direkt nach serverseitigem Create;
- verlorene Manifest-Write-Response;
- Crash direkt nach Manifest-Write;
- verlorene Property-PATCH-Response;
- Crash direkt nach Property-PATCH;
- verlorene Orphan-PATCH-Response;
- zwei empty candidates;
- bound + empty;
- partial + empty;
- zwei partial;
- zwei manifesttragende;
- conflicting + expected;
- exakt ein nicht-getrashter Candidate vor `bound`.

## Local/Outbox

- Envelope löschen -> normaler Read und Write fail-closed;
- `local_seq` manipulieren;
- Rowbytes manipulieren;
- State-MAC manipulieren;
- Revision-Cache manipulieren;
- 3+ Envelopes mit echten Outbox-Phasen;
- Generation Race;
- Unknown Outcome bei mittlerem Envelope;
- fehlendes Outbox-Flag.

## Migration

- Crash nach jedem relevanten persistierten Schritt;
- insbesondere nach Ziel-Envelope vor completed marker;
- Concurrent Feature Mutation;
- State-Ref/Hash-Tamper;
- idempotenter Resume.

## Rotation

- echter integrierter Produktpfad, nicht Callback-Mock;
- Crash/Reload nach jeder persistenten Phase;
- Freeze vor Snapshot;
- Concurrent Mutation nach Freeze abgelehnt;
- Successor Verify Fehler;
- Recovery Bootstrap Fehler;
- Backup Restore Fehler;
- Announcement Unknown Outcome;
- kein Switch vor durable;
- kein Abort danach.

## Recovery

- self-confirmation mit korrekten Candidate-Werten + selbst gebautem providerähnlichem Transport scheitert;
- positiver echter providergebundener Bootstrap gelingt.

## Google

- strict bound read ohne Properties fatal;
- pre-bound inspection separat;
- zusätzliche/falsche Properties;
- nichtstandardmäßige Sheet IDs;
- `startRow != 0`;
- physical gap;
- Discovery/Permissions Pagination;
- Row exakt 21936 akzeptiert, darüber fatal;
- Gesamtlimit exakt akzeptiert, darüber fatal;
- Retry-Duplikat zählt physisch mehrfach.

Tests dürfen nicht bloß interne Helper aufrufen, wenn die Anforderung einen Produktpfad betrifft.

---

# 9. Finaler Self-Review, Dokumentation und Abschlussgate – ZWINGEND

Erst nachdem 1–8 PASS sind:

## Adversarialer Self-Review

Beantworte anhand des Codes, nicht anhand der Dokumentation:

- Gibt es einen produktiven Aufruf von `SingleWriterCoordinator` mit echtem Local Store Adapter?
- Gibt es einen produktiven Aufruf von `runRotation()` mit konkreten Dependencies?
- Kann beliebiger App-Code eine Recovery Authority mit selbst gewähltem Account Binding erzeugen?
- Bestimmt irgendein Write Parents/Heads aus einem nicht verifizierten Cache statt aus Envelopes?
- Läuft jede Security-Mutation unter dem Diary-Lock?
- Kann ein stale Creation-/Migration-/Sync-Callback neueren State überschreiben?
- Werden Outbox-Zwischenzustände wirklich persistiert und nach Reload fortgesetzt?
- Existiert vor `bound` garantiert genau eine kanonische Remote-Datei?
- Ist der alte Google Values-Pfad garantiert kein produktiver Writer?

Wenn eine Antwort problematisch ist: weiterarbeiten, nicht abschließen.

## Qualitätsgates

Ausführen und exakte Ergebnisse dokumentieren:

- `npm run build`
- vollständiges `npm test`
- Argon2id Golden Vector ohne Skip
- gezieltes ESLint für Data/Security/Sync/Test
- `npm run lint:css`
- Storybook Build, sofern Repository-Gate
- `git diff --check`

Keine Regeln abschwächen.

GitHub-CI fehlt derzeit; lokale Ergebnisse ausdrücklich als lokal bezeichnen.

## Dokumentation

Erst jetzt aktualisieren:

- `docs/security/IMPLEMENTATION_AUDIT_SINGLE_WRITER_V1.md`
- `docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md`
- `docs/security/PRODUCTION_SECURITY_RELEASE_GATES.md`

`TODO_INTERNAL: none` ist ausschließlich zulässig, wenn **alle Abschnitte 1–8 PASS** sind.

---

# Definition of Done

Der Auftrag ist erst fertig, wenn gleichzeitig gilt:

1. sicherer Single-Writer-Sync ist intern produktiv verdrahtet;
2. echter IndexedDB-CoordinatorStore ist produktiv in Benutzung;
3. Outbox-Phasen sind end-to-end bewiesen;
4. Rotation besitzt konkrete produktive Dependencies + realen Aufrufer;
5. Recovery Authority kann nicht durch beliebigen App-Code selbst erzeugt werden;
6. Write-Parents stammen aus verifizierten immutable Envelopes, nicht aus einem unverifizierten Revision-Cache;
7. Migration läuft vollständig unter authentifizierter Lock-/Generation-Grenze;
8. Creation Remote-I/O ist gegen authentifizierte Generation/stale callbacks gebunden;
9. geforderte Fault-Injection-/Adversarial-Tests sind vorhanden und grün;
10. Self-Review findet keinen intern lösbaren Restpunkt;
11. Dokumentation behauptet nur tatsächlich nachgewiesene Eigenschaften.

Erwarteter Abschluss:

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`

`BLOCKED_EXTERNAL` darf ausschließlich enthalten:

- separater produktiver Auth-Origin;
- echte Google-Testcredentials/Testkonto;
- reale WebAuthn-PRF-Hardware-/Browsermatrix;
- Produktionshosting/CSP/Header;
- externer Security-/Crypto-Audit.

Ein fehlender produktiver interner Aufruf, Adapter, Test oder Wiring-Pfad ist **niemals** `BLOCKED_EXTERNAL`.

## Abschlussbericht – verpflichtendes Format

- verwendeter Branch + PR + Head SHA;
- Abschnitt 1: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 2: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 3: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 4: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 5: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 6: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 7: PASS/FAIL + konkrete Dateien + Tests;
- Abschnitt 8: PASS/FAIL + konkrete Tests;
- Abschnitt 9: PASS/FAIL + ausgeführte Gates;
- `TODO_INTERNAL`;
- `SECURITY/SPEC DECISION REQUIRED`;
- `BLOCKED_EXTERNAL`.

Wenn irgendein Abschnitt 1–8 `FAIL` ist, darf der Task **nicht** freiwillig als abgeschlossen markiert werden. Arbeite weiter.

Kein Merge.