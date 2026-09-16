# Codex Remediation – PR #14 Final Integration

Status: **VERBINDLICHER RESTAUFTRAG** auf dem kumulativen Stand von PR #14.

Ziel: Die derzeitige Implementierung ist erstmals weitgehend architektonisch vorhanden, enthält aber noch konkrete Integritäts-, Crash-/Resume- und Wiring-Fehler. Diese Datei ist als **Schritt-für-Schritt-Checkliste** abzuarbeiten. Nicht mergen. Nicht mit noch offenen intern lösbaren Punkten beenden.

## Normative Priorität

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_DOMAIN_SCHEMAS_V1.md`
3. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
4. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
5. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
6. diese Datei
7. bestehender Code

Der vorhandene Code ist nicht Source of Truth. Keine Security-Semantik erfinden.

---

# 0. Arbeitsweise – zwingend

Arbeite die Abschnitte **in Reihenfolge** ab. Nach jedem Abschnitt:

1. Code ändern;
2. die dort verlangten Tests hinzufügen;
3. gezielte Tests ausführen;
4. den Abschnitt erst als erledigt betrachten, wenn die Acceptance Criteria erfüllt sind.

Danach vollständigen adversarialen Self-Review des kumulativen Checkouts durchführen.

Ein Helper, Interface oder Callback zählt **nicht** als produktive Implementierung, solange kein echter Produktpfad ihn mit konkreten produktiven Implementierungen benutzt.

Erwarteter Abschluss:

- `TODO_INTERNAL: none`
- `SECURITY/SPEC DECISION REQUIRED: none`

Nur echte externe Gates dürfen verbleiben.

---

# 1. Lokale Fachrevisionen VOR Persistenz strikt validieren – KRITISCH

## Problem

`src/data/localDatabase.ts` erzeugt neue Revisionen/Envelopes aus beliebigen Objekten, ohne `record_data` vorher gegen die normativen Fachschemas und Semantikregeln zu validieren.

Der aktuelle Test speichert sogar einen `pain-entry` nur als `{id, note}`. Das ist nach `pain-entry/v1` ungültig. So kann die lokale Source of Truth einen Zustand erzeugen, den der eigene `FullRemoteVerifier` später beim Sync ablehnt.

## Änderung

Vor `prepareEnvelope()` und vor jeder irreversiblen Reservation/Persistenz:

- `record_data` aus dem UI-/Repository-Objekt bilden;
- zu `record_schema` das gebundelte normative Schema laden;
- `validateDomainData(schema, record_data)` ausführen;
- bei `record_status="deleted"` exakt `record_data=null` erzwingen;
- Wrapper-Felder ebenfalls strikt prüfen;
- erst **danach** Envelope-ID reservieren und verschlüsseln.

Lokale Normalisierung darf ausschließlich vor dieser Validierung stattfinden. Remote-/Backup-Daten niemals normalisieren.

Legacy-Migration darf die normativ erlaubten einmaligen Migrationstransformationen durchführen; danach muss das Ergebnis dieselbe Validation bestehen.

## Tests

- gültiger vollständiger Pain-Record wird akzeptiert;
- `{id,note}` als Pain-Record wird abgelehnt und erzeugt **keine** Reservation, Revision, Envelope oder Outbox-Zeile;
- fehlende Required-Felder für Activity/Medication/Prescription/Settings werden abgelehnt;
- deleted erzeugt `record_data=null`;
- Legacy-normalisierte Daten werden validiert, bevor ein Envelope entsteht.

### Acceptance

Kein lokal erzeugtes fachliches Envelope kann allein aufgrund seines Fachschemas später vom FullRemoteVerifier verworfen werden.

---

# 2. Coordinator / `operation_generation` über mehrere Pending-Envelopes korrigieren – KRITISCH

## Problem

`SingleWriterCoordinator.pushPending()` merkt sich einmal `expectedGeneration`.

`commitDurableAck()` erhöht jedoch `operation_generation` bei jedem erfolgreichen Durable-Ack. Beim zweiten Pending-Envelope ist die Generation deshalb absichtlich anders und der Coordinator blockiert sich selbst.

## Änderung

Die Generation-Semantik muss exakt der Spec entsprechen:

- vor jedem Netz-I/O aktuelle erwartete Generation unter Lock lesen/merken;
- Netz-I/O ohne Lock;
- vor lokalem Commit Lock neu erwerben;
- State neu lesen;
- nur committen, wenn Generation dem für **diese Operation** erwarteten Wert entspricht;
- erfolgreicher atomarer Security-State-Mutation erhöht Generation genau einmal;
- für das nächste Pending-Envelope die neue Generation erneut als Basis erfassen.

Nicht eine einzige Generation für die gesamte Outbox-Schleife festhalten.

Dabei Writer-Autorität nicht still erneuern: nach einer lokalen Änderung, die den bereits vollständig verifizierten Zustand semantisch verändert, muss klar zwischen eigener erwarteter State-Fortschreibung und unerwarteter Konkurrenz unterschieden werden.

## Tests

- mindestens 3 Pending-Envelopes werden nacheinander erfolgreich durable;
- jeder Durable-Ack erhöht Generation genau einmal;
- fremde lokale Mutation zwischen Remote-Read und Commit blockiert den Commit;
- stale Callback darf keinen neueren Anchor/State überschreiben;
- Unknown-Outcome + Retry funktioniert auch bei mehreren Pending-Envelopes.

### Acceptance

Ein normaler Push kann mehr als ein Pending-Envelope verarbeiten, ohne sich nach dem ersten Ack selbst zu blockieren.

---

# 3. Outbox-Zustände tatsächlich implementieren – HOCH

## Problem

Outbox definiert `prepared | pending | remote_seen | durable`, der aktuelle Produktpfad persistiert praktisch `prepared` und springt später direkt auf `durable`.

## Änderung

Normative Zustände produktiv verwenden:

- `prepared`: Envelope lokal vollständig vorbereitet;
- `pending`: persistierte Absicht vor dem mutierenden Remote-Append;
- `remote_seen`: exakte Zeile wurde durch Readback byteidentisch remote beobachtet;
- `durable`: finaler Full Verify + neuer Anchor erfolgreich und Anchor + Ack atomar persistiert.

Unknown Outcome muss von `pending` über Readback zu `remote_seen` oder byteidentischem Retry führen.

Wichtig: Outbox-Flags sind rekonstruierbar und nicht alleinige Wahrheit. Jedes lokale immutable Envelope, das remote nicht byteidentisch vorkommt, muss für Sync/Backup wieder erkannt werden, selbst wenn ein Flag fehlt/manipuliert wurde.

## Tests

Crash/Reload in jedem Zustand; fehlendes/inkonsistentes Outbox-Flag; Same-ID/different-bytes fatal.

---

# 4. Journalintegrität als verpflichtende normale Vertrauensgrenze – KRITISCH

## Problem

`verifyLocalIntegrity()` prüft Journal Count/Hash nur bei explizitem Aufruf. Normale Reads (`getAllRecords`/`readValues`) rekonstruieren den Graph aus vorhandenen Envelopes, ohne vorher zu beweisen, dass Count/Hash zur vollständigen Journalfolge passen.

Wird ein ganzes Envelope aus IndexedDB entfernt, darf der Record nicht einfach verschwinden und der normale Read weiterlaufen.

## Änderung

Vor Nutzung des lokalen Envelope-/Revision-State als fachliche Source of Truth:

- State-MAC prüfen;
- Envelope-Journal vollständig gegen `local_seq`, exakte Rowbytes, Count und Hashkette verifizieren;
- Revisionen aus den verifizierten Envelopes öffnen;
- Graph prüfen;
- optional persistierten Revision-Index nur als Cache behandeln und gegen Envelopes beweisen oder rekonstruieren.

Normale produktive Reads müssen fail-closed sein, wenn Journal/State nicht konsistent sind.

## Tests

- Envelope löschen -> `getAllRecords()` schlägt fehl;
- lokale Sequenz ändern -> fatal;
- Rowbytes ändern -> fatal;
- State-Count/Hash manipulieren -> fatal;
- Revision-Cache manipulieren -> darf Wahrheit aus Envelopes nicht ersetzen.

---

# 5. Legacy-Migration authentifizieren und crash-idempotent machen – KRITISCH

## Probleme

1. Migrationsfortschritt liegt separat im Migration-Store; `epoch_local_security_state.migration_state_ref` wird nicht als authentifizierte Bindung des aktuellen Migrationszustands verwendet.
2. Crash nach `persistRevision()` aber vor `completedKeys` kann dieselbe Legacy-Quelle beim Resume erneut als neue Revision migrieren.
3. Ein manipuliertes `verified:true` darf den Cutover nicht vortäuschen.

## Änderung

- persistenter Migrations-State erhält eigenen kanonischen Hash;
- `migration_state_ref` im MAC-geschützten Epoch-State bindet Operation-ID, Phase und State-Hash;
- jede Phasenmutation readback-verifizieren und State-Ref + Generation atomar fortschreiben;
- pro Legacy-Quelle deterministische Migration-Identität / idempotente Zielerkennung verwenden, sodass Resume nach Crash kein zweites semantisch neues Revision-Envelope erzeugt;
- Shadow/Backfill/Verify/Cutover gemäß Spec;
- Quelle vor vollständig verifiziertem Cutover nicht destruktiv verändern;
- historische Activity Types vollständig einbeziehen;
- Kollisionen fatal.

## Tests

Crash:

- vor Backfill;
- nach Envelope-Persistenz, vor Source-completed-Mark;
- während Verify;
- unmittelbar vor Cutover;
- manipuliertes Migration-State-Objekt / falscher Hash;
- gefälschtes `verified:true`.

### Acceptance

Jede Legacy-Quelle erzeugt trotz beliebiger Resume-Punkte höchstens die normativ vorgesehene Migration und der Cutover ist an authentifizierten State gebunden.

---

# 6. Create/Reconcile: Discovery MUSS vor jedem erneuten Create laufen – KRITISCH

## Problem

Beim Resume aus `create_pending` ruft `runCreationStateMachine()` derzeit unmittelbar `transport.create()` auf und entdeckt erst danach Kandidaten.

Crash-Fall:

1. Create serverseitig erfolgreich;
2. Response verloren / App crasht;
3. lokaler Zustand bleibt `create_pending`;
4. Reload;
5. Code erstellt erneut eine Datei;
6. erst danach Discovery.

Das verletzt die Spec.

## Änderung

`create_pending` bedeutet nicht automatisch "jetzt Create senden".

Vor **jedem** möglichen Create-Request:

1. Discovery über exakten neutralen Dateinamen;
2. alle Kandidaten klassifizieren;
3. wenn Kandidat existiert: reconciliieren, **kein neuer Create**;
4. nur wenn nach vollständiger Discovery wirklich kein Kandidat existiert: persisted intent/readback -> Create senden;
5. nach Create unabhängig vom HTTP-Ergebnis wieder Discovery.

Es muss explizit modellierbar sein, ob ein Create-Versuch bereits gesendet wurde, ohne dass sein Ergebnis bekannt ist.

## Tests

Fault Injection:

- Response verloren direkt nach serverseitigem Create;
- Crash direkt nach serverseitigem Create;
- Reload aus `create_pending` mit bereits existierendem empty candidate -> **kein zweiter Create**;
- Zähler beweist genau einen Create-Request in diesem Szenario.

---

# 7. Create/Reconcile: Kandidatenliste und Orphaning nach Unknown Outcome korrigieren – KRITISCH

## Problem

`candidateIds` stammt teilweise aus einer früheren Discovery. Kandidaten, die bei/seit einem unklaren Create entstanden sind, werden nicht zuverlässig in die Orphan-/Auswahlentscheidung aufgenommen.

Final Reconcile akzeptiert derzeit außerdem zusätzliche leere Kandidaten, solange genau ein `expected-manifest` existiert. Vor `bound` verlangt die Norm jedoch genau **eine** nicht-getrashte kanonische Datei.

## Änderung

- Jede Discovery ersetzt die Candidate-Sicht vollständig durch die **aktuell** beobachtete Menge.
- Wenn genau ein bound/partial canonical candidate gegen reine leere Duplikate gewinnt, müssen die leeren Duplikate nach sicherer Auswahl geordnet orphan/trashed werden.
- Danach erneut Discovery durchführen.
- `bound` nur wenn exakt ein nicht-getrashter canonical candidate existiert und **keine** weiteren empty/partial/conflicting Candidates.
- mehrere manifesttragende / partial Kandidaten -> ambiguous/fail-closed;
- irgendein conflicting candidate -> fail-closed.

Orphan PATCH Unknown Outcome ebenfalls per Readback/Discovery reconciliieren, nicht blind als erledigt betrachten.

## Tests

- zwei empty duplicates -> lexikographisch kleinster gewinnt, anderer wird orphaned, anschließende Discovery genau eins;
- bound candidate + empty duplicate -> empty wird orphaned, erst danach bound;
- orphan-response lost -> Readback löst auf;
- zwei partial / zwei manifesttragende -> ambiguous;
- conflicting + expected -> ambiguous/security stop.

---

# 8. Pre-bound Candidate-Inspection von normalem streng gebundenem Remote-Read trennen – KRITISCH

## Problem

Für Create/Reconcile müssen empty/partial Candidates **vor** Setzen der App-Properties inspectierbar sein. Der normale produktive `read()` muss bei gebundenen Remotes dagegen exakt die normativen Properties verlangen.

Die bisherige Lockerung `if (keys.length && ...)` in `verifyDrive()` lässt fehlende Properties auch bei normalen gebundenen Reads passieren und ist damit zu permissiv.

## Änderung

Zwei klar getrennte Vertrauensgrenzen:

### Normaler produktiver `read(remoteId)`

MUSS exakt verlangen:

- genau `app_format="sync-v5"`;
- exakt erwarteter `epoch_locator`;
- keine zusätzlichen Protocol-AppProperties;
- alle übrigen Drive-/Permission-/Account-Binding-Invarianten.

Leere Properties sind hier fatal.

### Creation Candidate Inspection

Dedizierter API-/Transportpfad, nur für die persistente Creation-State-Machine:

- neutrale Discovery-ID;
- Ownership/MIME/trashed/shared/permissions/GRID-Struktur strikt;
- erlaubt exakt den normativen pre-bound Zustand: keine Protocol-Properties;
- klassifiziert leer/partial/bound/conflicting;
- darf niemals Writer-Autorität oder normalen VerifiedRemoteState erzeugen.

Nicht den normalen `read()` allgemein lockern, nur um Creation zu ermöglichen.

## Tests

- normaler bound read mit `{}` AppProperties -> fatal;
- pre-bound candidate inspection mit `{}` -> nur als empty/partial klassifizierbar;
- zusätzliche AppProperty -> conflicting/fatal;
- falscher epoch_locator -> conflicting/fatal.

---

# 9. Google Remote-Byte-Limits exakt umsetzen – HOCH

## Problem

Die Norm verlangt u.a.:

- `max_remote_physical_rows = 100000`
- `max_remote_physical_canonical_bytes = 134217728`
- `max_canonical_row_bytes = 21936`

Aktueller Read summiert rohe Zellstringbytes und prüft nur ein globales 128-MiB-Limit. Das ist nicht dieselbe Definition.

## Änderung

Für jede physische Protokollzeile:

```text
row_i = UTF8(JCS([envelope_id, iv, ciphertext]))
```

- `row_i.length <= 21936` prüfen;
- Summe dieser kanonischen `row_i`-Bytes <= 134217728;
- max 100000 physische Zeilen;
- keine Lücke vor last_protocol_row;
- physische byteidentische Retry-Duplikate zählen jeweils für Prefix und physische Limits.

Keine abweichende Rohstring-Summenmetrik als Ersatz.

## Tests

- einzelne Row über 21936 -> fatal;
- Summe über Gesamtlimit -> fatal;
- genau an Grenzen akzeptieren;
- Retry-Duplikat zählt physisch zweimal.

---

# 10. Rotation: Freeze-Reihenfolge korrigieren – KRITISCH

## Problem

`runRotation()` ruft aktuell `verifyAndFreezeSource()` auf, während der persistierte State noch `root_wrap_verified` ist. Erst NACH Rückkehr wird `source_frozen_verified` persistiert.

Die lokale Mutation-Sperre greift aber erst ab `source_frozen_verified`.

Damit kann während des vermeintlich finalen Source-Snapshots noch eine Fachmutation stattfinden.

## Änderung

Normative Reihenfolge:

1. Root-Wrap vorbereitet/verifiziert;
2. persistenten Maintenance-/Freeze-State setzen und readback-verifizieren;
3. dieser persistierte State blockiert reale Feature-Mutationen;
4. erst danach finalen Source-State erneut lesen;
5. vollständiger Pull/Verify + Source Anchor + Lineage/Semantic Snapshot;
6. diese Snapshotwerte persistent an die Rotation binden.

Wenn dafür ein zusätzlicher persistenter Schritt nötig ist, darf ein bestehender Step nur normkonform konkretisiert werden; keine unspezifizierte Sicherheitssemantik erfinden. Die zentrale Invariante ist: **Freeze persistent vor finalem Snapshot**.

## Test

Eine gleichzeitig versuchte Fachmutation zwischen Freeze-Persistenz und finalem Snapshot MUSS fehlschlagen und darf den Snapshot nicht verändern.

---

# 11. Rotation: Orchestrator tatsächlich an produktive Implementierungen verdrahten – KRITISCH

## Problem

`runRotation()` besteht aktuell aus Dependency-Callbacks. Das ist als Orchestrator okay, aber im PR existiert kein nachgewiesener echter Produktpfad, der diese Dependencies mit den normativen Operationen implementiert und `runRotation()` tatsächlich benutzt. Der Test verwendet ausschließlich trivialen Mock-Callbacks.

## Änderung

Erstelle konkrete produktive Rotation-Services/Dependencies und verdrahte den echten Produktpfad.

Jede Dependency muss reale normative Operationen ausführen:

- `createAndVerifyRootWrap`: echten Successor-RK/Wrap erzeugen + Readback;
- Freeze + final source verify;
- Recovery Secret Prüfung;
- Successor planned state;
- Successor über **produktive** `runCreationStateMachine` + durable CreationPersistence;
- aktive/tombstone Heads und `epoch-migration-sw-v1` tatsächlich als Revisionen/Envelopes kopieren/erzeugen;
- Successor mit echtem FullRemoteVerifier prüfen;
- Semantic Snapshot vergleichen;
- echtes Recovery Artifact erzeugen + unabhängigen Bootstrap erfolgreich testen;
- echtes v5 Backup erzeugen + echten Test-Restore;
- echtes verschlüsseltes `rotation-announcement-sw-v1` in alter Epoche erzeugen;
- über Coordinator/Transport append, readback, Full Verify;
- danach durable Announcement persistieren;
- atomar aktiven Epoch-Kontext auf Successor schalten + Source retired;
- Resume nach jedem Schritt idempotent.

Der Produktionscode muss `runRotation()` tatsächlich aufrufen. Ein ausschließlich in Tests instanziierter Orchestrator ist nicht DONE.

## Tests

Mindestens ein integrierter Rotationstest mit echten lokalen Stores + echten Crypto-/Envelope-/Revision-/Creation-Komponenten und InMemoryTransport. Mocks nur für externe Google-Netzgrenze, nicht für die gesamte Semantik.

Fault Injection/Reload nach jeder persistierten Rotationsphase.

---

# 12. Recovery Bootstrap Authority unforgeable machen – KRITISCH

## Problem

`RecoveryBootstrapVerifier` ist verbessert, akzeptiert aber öffentlich eine caller-konstruierte `authority` mit:

- `authenticatedAccountBinding`;
- beliebigem `remoteResourceId`;
- frei geliefertem `load(): Promise<RemoteSnapshot>`.

`remoteResourceId` ist derzeit nicht kryptographisch/transportseitig mit dem geladenen Snapshot verbunden. Ein Caller kann daher weiterhin eine "independent authority" selbst zusammenbauen.

Der aktuelle Negative-Test verwendet absichtlich ein falsches Account Binding; er beweist nicht, dass ein Angreifer mit den aus dem Recovery-Payload übernommenen passenden Werten und einer selbst gebauten `load()`-Funktion scheitert.

## Änderung

Ein Recovery-Bootstrap-Verifier darf seine Authority nicht aus beliebigem Produktcode übernehmen.

Geeignete Architektur:

- Authority/Bootstrap-Handle wird nur von einem produktiven, providergebundenen Discovery-/Identity-Verifikationspfad erzeugt;
- Remote-Handle bindet konkrete `remote_resource_id` + aktuell authentifizierte `permissionId`/Account Binding;
- Snapshot wird **innerhalb** dieser Authority über genau diese Resource geladen; kein frei injizierter `load`-Callback;
- Backup-Authority analog nur aus vollständig verifiziertem Backup-Importpfad;
- Konstruktor/Factory für trusted authority nicht allgemein mit beliebigen Strings/Callbacks aufrufbar (opaque/branded/module-private capability);
- erst danach Candidate-Werte gegen authentifiziertes Manifest prüfen.

## Adversarial Tests

Angriff muss scheitern:

1. Artifact + URS entschlüsseln;
2. Diary/Epoch/Key/Fingerprint/AccountBinding/Anchor/Commitment aus Candidate übernehmen;
3. selbst passenden Snapshot/Loader konstruieren;
4. versuchen, trusted Authority/Verifier zu bauen;
5. Aktivierung MUSS unmöglich/abgelehnt sein.

Positivtest:

- Authority aus echtem providergebundenem InMemory-/Test-Transport-Discovery/Identity-Pfad;
- vollständiger Manifest/Prefix/Envelope/Graph Verify;
- danach Aktivierung erfolgreich.

---

# 13. Creation- und Rotation-Persistence an State-MAC/Generation vollständig binden – HOCH

## Änderung/Review

Prüfe für `indexedDbCreationPersistence()` und `indexedDbRotationPersistence()`:

- jede erfolgreiche Security-State-Mutation erhöht `operation_generation` genau einmal;
- Operation-State-Record besitzt eigenen kanonischen Hash, sofern durch Spec/Ref vorgesehen;
- Security-State-Ref bindet Operation-ID/Phase/Hash;
- readback verifiziert State + Ref konsistent;
- stale Operation kann neueren State nicht überschreiben;
- Creation `operationGeneration` darf nicht nur im CreationState mitgeführt, sondern muss vor Remote-Schritt und nach Rückkehr gegen den authentifizierten Epoch-State geprüft werden.

Tests für manipulierten Operation-State, falschen Ref-Hash und stale Resume.

---

# 14. Backup/Outbox-Rekonstruktion gegen immutable Envelopes prüfen – HOCH

Die Spec verlangt für `pending_outbox_rows` jedes lokale immutable Envelope, das nicht byteidentisch in `record_rows` vorkommt – nicht nur Rows mit einem bestimmten Outbox-Flag.

Nach der neuen lokalen Architektur sicherstellen:

- Backup-Erzeugung bekommt die vollständige immutable lokale Envelope-Menge;
- fehlende/manipulierte Outbox-Flags dürfen kein lokales Envelope aus Backup/Sync verschwinden lassen;
- Same-ID/different-bytes bleibt fatal.

Tests entsprechend ergänzen.

---

# 15. Tests – keine Behauptung ohne adversarial Nachweis

Der bestehende Testbestand ist für die neuen DONE-Behauptungen nicht ausreichend.

Mindestens neu/erweitert:

## Create

- Crash/Resume an jeder persistenten Phase;
- verlorene Create-Response;
- Crash nach serverseitigem Create;
- verlorene Manifest-Write-Response;
- verlorene Property-PATCH-Response;
- verlorene Orphan-PATCH-Response;
- mehrere empty candidates;
- bound + empty;
- partial + empty;
- conflicting candidate;
- endgültig exakt ein Candidate vor bound.

## Local State

- 3+ Pending Envelopes push;
- Generation Race;
- Journal deletion/tamper bei normalem Read;
- State-MAC;
- Reservation vor Encryption;
- lokale Schema-Validation vor Reservation;
- fehlendes Outbox-Flag rekonstruierbar.

## Migration

- Crash direkt nach Ziel-Envelope vor completed marker;
- idempotenter Resume;
- State-Ref/Hash-Tamper;
- Activity-Type-LocalStorage;
- collision fatal.

## Rotation

- integrierter echter Produktpfad;
- Freeze vor Snapshot;
- Mutation während Freeze blockiert;
- Crash/Resume jede Phase;
- Announcement erst nach Recovery+Backup;
- Switch nur nach durable Announcement;
- kein Abort danach.

## Recovery

- echte self-confirmation attack mit passenden Candidate-Werten + selbst gebautem Loader scheitert;
- echter providergebundener Bootstrap gelingt.

## Google

- bound Read ohne AppProperties fatal;
- pre-bound Candidate inspection separat möglich;
- Row 21936 Grenze;
- Gesamtbytegrenze;
- falsche/zusätzliche Properties;
- nichtstandardmäßige Sheet IDs;
- startRow != 0;
- physical gap;
- Pagination.

---

# 16. Qualitäts- und Abschlussgates

Vor Abschluss ausführen und Ergebnisse dokumentieren:

- `npm run build`
- vollständige Vitest Security-/Sync-/Data-Suite
- Argon2id Golden Vector ohne Skip
- gezielter ESLint für Security/Sync/Data/Test
- `npm run lint:css`
- Storybook Build, sofern weiterhin Repository-Gate
- `git diff --check`

Keine Lint-/Style-/Test-Regel abschalten, um grün zu werden.

E2E-Baselinefehler dürfen nur als unabhängig dokumentiert werden, wenn sie nicht aus den neuen Datenpfadänderungen stammen. Bei veränderten Repository-/Persistence-Pfaden relevante UI-Smoke-Tests erneut prüfen.

GitHub-CI fehlt derzeit; lokale Testbehauptungen daher exakt als lokal kennzeichnen.

---

# 17. Dokumentation erst NACH erfolgreichem Code-/Test-Abschluss aktualisieren

Aktualisiere:

- `docs/security/IMPLEMENTATION_AUDIT_SINGLE_WRITER_V1.md`
- `docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md`
- `docs/security/PRODUCTION_SECURITY_RELEASE_GATES.md`

Erst nachdem alle obigen Acceptance Criteria erfüllt sind.

`TODO_INTERNAL: none` darf nur stehen, wenn wirklich kein oben genannter interner Punkt mehr offen ist.

`SECURITY/SPEC DECISION REQUIRED: none` nur wenn keine echte ungelöste Normlücke gefunden wurde.

Nur folgende Arten dürfen `BLOCKED_EXTERNAL` bleiben:

- produktiver separater Auth-Origin;
- echte Google-Testcredentials/Testkonto;
- reale WebAuthn-PRF-Hardware-/Browsermatrix;
- Produktionshosting/CSP/Header;
- externer Security-/Crypto-Audit.

Keine intern fehlende Implementierung als extern deklarieren.

---

# 18. Finaler adversarialer Self-Review – zwingend

Nach allen Änderungen den **gesamten kumulativen Checkout** erneut prüfen, insbesondere:

- Kann lokaler Code invalides `record_data` persistieren?
- Kann ein Journal-Envelope verschwinden, ohne dass ein normaler Read stoppt?
- Kann eine Migration durch Crash doppelte Revisionen erzeugen?
- Kann Create nach lost response einen zweiten Candidate erzeugen?
- Bleibt vor `bound` irgendein zweiter nicht-getrashter Candidate übrig?
- Kann normaler Remote-Read fehlende appProperties akzeptieren?
- Kann Recovery Authority vom Caller selbst gefälscht werden?
- Ist Freeze wirklich persistent, bevor der finale Source Snapshot beginnt?
- Wird `runRotation()` wirklich von produktivem Code mit echten Implementierungen aufgerufen?
- Kann der Coordinator 3+ Envelopes durable machen?
- Werden `pending` und `remote_seen` tatsächlich persistiert?
- Werden exakte normative Row-/Gesamtbyte-Limits verwendet?
- Sind Operation-State/Refs und Generation gegen stale callbacks geschützt?

Wenn eine Antwort problematisch ist: im selben Auftrag beheben und relevante Tests erneut ausführen.

---

# 19. Definition of Done

Der Auftrag ist **nicht** fertig, bis ALLE folgenden Aussagen wahr sind:

1. lokale Fachrevisionen werden vor Reservation/Encryption normativ validiert;
2. normale lokale Reads prüfen State-MAC + vollständige Journalintegrität;
3. mehrere Pending-Envelopes synchronisieren ohne Generation-Selbstblockade;
4. Outbox `prepared -> pending -> remote_seen -> durable` ist produktiv;
5. Migration ist authentifiziert und crash-idempotent;
6. vor jedem wiederholten Create läuft Discovery;
7. Unknown-Outcome-Candidates werden vollständig neu entdeckt/reconciliert;
8. vor `bound` existiert exakt ein nicht-getrashter kanonischer Candidate;
9. pre-bound Inspection und normaler strict bound Read sind getrennt;
10. Google-Properties und Byte-Limits sind exakt normativ;
11. Rotation friert persistent VOR finalem Source-Snapshot ein;
12. Rotation besitzt konkrete produktive Dependencies und einen echten Aufrufer;
13. Recovery Authority ist für beliebigen Caller nicht forgebar;
14. Backup/Sync verlieren kein immutable Envelope wegen Outbox-Flag-Manipulation;
15. Fault-Injection-/Crash-/Adversarial-Tests sind vorhanden und grün;
16. Qualitätsgates wurden nicht abgeschwächt;
17. Dokumentation entspricht dem tatsächlichen Code.

Abschlussbericht exakt mit:

- tatsächlich verwendetem Branch/PR;
- Abschnitt 1–19 jeweils `PASS` oder echter `BLOCKED_EXTERNAL` (für 1–15 ist `BLOCKED_EXTERNAL` grundsätzlich nicht zulässig, außer echte Provider-Live-Validierung zusätzlich zum lokalen PASS);
- ausgeführten Befehlen und exakten Ergebnissen;
- `TODO_INTERNAL`;
- `SECURITY/SPEC DECISION REQUIRED`;
- `BLOCKED_EXTERNAL`.

Erwartet:

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`

Kein Merge.