# Codex Remediation Plan – PR #8 / Google Sheets Single-Writer v1

Stand: 15.09.2026

## Auftrag

Aktualisiere den **bestehenden Pull Request #8** (`codex/implement-plan-as-specified`) so, dass er die normativen Single-Writer-v1-Spezifikationen tatsächlich erfüllt.

**Keinen neuen parallelen Implementierungs-PR anlegen. PR #8 nicht selbst mergen.**

Vor Codeänderungen zuerst den aktuellen Stand von `main` in deinen PR-Branch übernehmen. Auf `main` wurde nach deinem ersten Durchlauf die bytegenaue normative Ergänzung `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md` hinzugefügt. Diese Datei wurde gerade deshalb erstellt, weil dein erster Durchlauf mehrere vorher nicht vollständig im Repo normierte Details selbst interpretieren musste.

---

# 1. Verbindliche Reihenfolge / Priorität

Lies vollständig:

1. `docs/security/EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`
2. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
3. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
4. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
5. `CODEX_IMPLEMENTATION_PLAN_SINGLE_WRITER_V1.md`
6. `AGENTS.md`
7. deinen bestehenden Diff in PR #8 und den relevanten aktuellen Repo-Code

Bei Widerspruch gilt genau diese Priorität.

Die neue Datei `EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md` enthält sowohl aus der vollständigen v5-Spezifikation wiederhergestellte Byte-Level-Regeln als auch ausdrücklich markierte neue Single-Writer-v1-Entscheidungen. Sie ist nicht optional und darf nicht durch die bereits in PR #8 implementierten Eigenkonstruktionen ersetzt werden.

Wenn nach vollständigem Lesen weiterhin eine echte Security-/Crypto-Entscheidung nicht spezifiziert ist: fail-closed lassen und im Abschlussbericht als `SECURITY/SPEC DECISION REQUIRED` markieren. **Nicht** einen bereits jetzt exakt spezifizierten Punkt weiterhin als offen deklarieren.

---

# 2. Ziel dieses Durchlaufs

Der erste PR-Durchlauf ist ein brauchbarer Architektur-Skeleton, aber nicht die abgeschlossene Implementierung. Dieser Durchlauf soll die bestehenden Komponenten **korrigieren, vollständig verdrahten und nachweisbar gegen die Spezifikation testen**.

Nicht ausreichend sind:

- nur Interfaces ohne produktive Implementierung;
- kleine Hilfsmodelle ohne persistente State-Machine;
- Unit-Tests, die nur den eigenen vereinfachten Code bestätigen;
- „fail-closed“ als Ersatz für eine Funktion, deren produktive Implementierung innerhalb des Repo-Scopes vollständig spezifiziert ist.

Externe Deployment-Abhängigkeiten dürfen weiterhin release-blocked bleiben, insbesondere:

- tatsächlich deployter separater Google-Auth-Origin;
- echte Live-Google-Credentials/Testkonto;
- externer Security-/Crypto-Audit.

Die **lokale und transportseitige Implementierung dahinter** muss trotzdem vollständig und testbar sein.

---

# 3. Kritische Befunde aus Review von PR #8

Alle folgenden Punkte sind mindestens zu korrigieren.

## 3.1 Pull-before-Push ist derzeit unvollständig

`SingleWriterCoordinator.pullVerify()` darf **nicht** `writer_active` setzen, nachdem nur Remote-Struktur, Manifest-Callback und Prefix-Anchor geprüft wurden.

Vor `writer_active` exakt die vollständige Verifikation aus `EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md` ausführen:

- Google Account / Remote Binding / Drive-Invarianten;
- strikte `_m`/`_r`-Gridstruktur;
- Manifest-Fingerprint + Manifest-AEAD + `sync_profile`;
- alten Anchor monoton prüfen;
- jede Remote-Zeile Base64URL-/Längen-/Bucket-validieren;
- jedes Envelope mit exakter AAD öffnen;
- Frame/Padding/JCS/Recordschema validieren;
- Duplicate-ID-/Byteidentität und IV-Anomalien prüfen;
- vollständigen Revision Graph rekonstruieren/validieren;
- Controls einschließlich `rotation_announcement` verarbeiten;
- lokale immutable Envelopes/Pending gegen Remote reconciliieren;
- Operation Generation / Maintenance State erneut prüfen;
- erst dann Writer aktivieren.

Erzeuge dafür einen klaren providerneutralen `VerifiedRemoteState`/äquivalenten Typ, damit „struktur gelesen“ nicht mit „kryptographisch verifiziert“ verwechselt werden kann.

## 3.2 Durable/Anchor ist derzeit unvollständig

Nach Append/Readback darf `commitDurable()` erst erfolgen, nachdem der **vollständige aktuelle Remotezustand erneut** wie oben verifiziert wurde.

Anchor und Delivery-Durable-State müssen atomar unter Web Lock + Generation-Recheck + State-MAC geschrieben werden.

Keine fremde/ungültige neue Zeile darf lediglich deshalb in einen neuen Anchor aufgenommen werden, weil der alte Anchor-Präfix noch stimmt.

## 3.3 Aktuelle lokale Persistenz ist nicht die Zielarchitektur

Der jetzige PR verschlüsselt mutable Fachrecords direkt mit einem persistenten non-extractable Device-AES-Key. Das darf nicht die neue Source of Truth bleiben.

Implementiere die spezifizierte Architektur:

```text
local protection mode -> wrapped RK_epoch
RK_epoch -> immutable v5 Envelopes
          -> authenticated local envelope journal
          -> revision graph
          -> delivery/outbox state
          -> authenticated epoch security state
```

Der Best-Effort-CryptoKey schützt den **Root-Wrap**. Er ist nicht Ersatz für per-Envelope-Schlüssel/Root-Key-Hierarchie.

Erforderliche persistente Stores/Records mindestens:

- local root wraps / mode metadata;
- immutable envelopes;
- envelope reservations / one-shot state;
- local envelope journal with `local_seq`;
- delivery/outbox state;
- epoch local security state + MAC tag;
- remote binding;
- remote anchor;
- creation state;
- rotation state;
- migration state;
- Recovery-Metadaten ohne URS/RK im Klartext.

Sicherheitsrelevante IDB-Mutationen über diary-spezifischen Web Lock + Re-Read + `operation_generation`.

## 3.4 Crypto-Core / Canonicalisierung korrigieren

Der aktuelle eigene `canonical.ts` ist kein ausreichender RFC-8785-/strict-I-JSON-Nachweis.

Implementiere oder nutze eine kleine lokal gebündelte, reviewbare RFC-8785-konforme Lösung; keine Runtime-CDN-Abhängigkeit. Ergänze Duplicate-Key-/I-JSON-Validierung an untrusted JSON-Grenzen.

Korrigiere insbesondere:

- `diary_id`/`epoch_id` sind 16 rohe Bytes, nicht beliebige UTF-8-Strings in KDFs;
- exakte ID-Längen/Base64URL-Kanonizität;
- Record-Padding-Frame 1/2/4/8/16 KiB;
- exakte Record-AAD;
- exakten common Recordwrapper;
- `record_schema` ist ein versionierter String;
- `record_status` unterstützt Control;
- genaue Parent-/Graphregeln;
- keine ad-hoc `JSON.stringify()`-Krypto-Payloads.

## 3.5 Machine-readable schemas / Registry Hash

Lege immutable maschinenlesbare Schema-Dateien für die in der exakten Spec definierte Single-Writer-Basis-Allowlist an.

Berechne und prüfe daraus deterministisch den `record_schema_registry_hash`.

Ein Manifest wird nicht aktiv, wenn Schema-IDs oder Registry-Hash nicht exakt zur lokal gebundelten Registry passen.

Multi-Writer-Control-Schemas (`remote-checkpoint/v1`, `rotation-fence/v1`, `rotation-abort/v1`) sind in Single-Writer v1 **verboten**.

## 3.6 Epoch Manifest vollständig implementieren

Implementiere ein one-shot prepared immutable Manifest gemäß exakter Spec:

- exakter protected payload inklusive `recovery_urs_commitment` und `sync_profile`;
- exakter `K_epoch_manifest`;
- exakte Manifest-AAD;
- exakter Public Fingerprint;
- Manifest-Bytes lokal one-shot persistieren und für Create/Backup wiederverwenden;
- nie bei Retry neu verschlüsseln.

## 3.7 Google Transport streng implementieren

Der sichere Google-Adapter darf für protokollkritische Struktur nicht nur die Values-API abstrahieren.

Pflicht:

- `spreadsheets.get` zur Tab/Grid-/Merge-/Dimensionsprüfung;
- Grid-/Cell-Reads über `userEnteredValue`;
- Formeln/Zahlen/Bool/Error-/berechnete Ersatzdarstellungen ablehnen;
- exakt `_m` + `_r`, keine extra Tabs/Merges;
- Writes ausschließlich `spreadsheets.batchUpdate` + `AppendCellsRequest`;
- **kein `spreadsheets.values.append`** im sicheren Profil;
- chunked/bounded Reads;
- Requestgrößenlimits;
- Drive-Dateiinvarianten + vollständig paginierte Permissions-Prüfung;
- `google_account_binding` gemäß Spec;
- providerneutrale Core-Typen erhalten.

## 3.8 Create/Reconciliation reparieren

Der derzeitige Ablauf „Create -> danach appProperties setzen -> Discovery nur über appProperties“ ist bei verlorener Create-Antwort nicht recoverbar.

Implementiere exakt den neuen `creation_locator`-/neutral-title-/candidate-classification-Ablauf aus der exakten Spec.

Testfälle zwingend:

- Create erfolgreich + Antwort erhalten;
- Create erfolgreich + Antwort verloren;
- Create nicht erfolgt + Timeout;
- Crash nach Create vor Manifest;
- Crash nach Manifest vor appProperties;
- Crash nach appProperties vor local bind;
- mehrere reine leere Retry-Duplikate;
- genau ein partial candidate;
- bound candidate + leere Duplikate;
- zwei manifesttragende plausible Kandidaten -> ambiguous;
- conflicting candidate -> fail-closed;
- niemals modifiedTime/latest-wins.

## 3.9 Fehlernormalisierung korrigieren

Nicht jeden Google-Fehler zu `unknown_outcome` mappen.

Mindestens exakte Kategorien aus der Spec abbilden. Bei Mutationen Netz/Timeout/unklare 5xx als unknown outcome + Reconciliation; bei Reads 5xx als temporary failure. 401/403/404/429 etc. sinnvoll getrennt.

## 3.10 Produktive Core-Verdrahtung herstellen

Implementiere produktiv, nicht nur in Tests:

- `CoordinatorStore`/äquivalente IDB-Implementierung;
- konkreten Google REST `GoogleApiClient` oder äquivalenten Adapter, der Access Token nur RAM-only erhält;
- Lifecycle vom Domain-Write über Revision -> Envelope -> local journal/outbox;
- Pull/Verify/Reconcile über Coordinator;
- Domain-Readmodell aus verifiziert entschlüsseltem Revision State;
- eindeutiges Verhalten für locked/local-only/authenticated/writer/security-blocked.

Der isolierte Auth-Origin darf weiterhin als Release-Blocker fail-closed bleiben. Aber die Sync-Architektur darf nicht nur deshalb „unverdrahtet“ bleiben.

## 3.11 Recovery korrigieren

Entferne `ursCommitment` aus dem **öffentlichen** Recovery-Artefakt.

Implementiere exakt:

- öffentlicher Recovery-Header;
- geschützter Payload;
- exakte AAD/KDF;
- URS-Commitment nur aus dem authentifizierten Manifest;
- recovered RK nach Unwrap nur als RAM-Kandidat;
- Root-Aktivierung erst nach vollständigem Remote- oder Backup-Bootstrap;
- Rollback-/Anchor-/Generation-Regeln;
- frisches Profil testbar wiederherstellbar.

Der Test „artifact.ursCommitment als expectedCommitment wieder hineinreichen“ ist kein ausreichender Continuity-Test und muss ersetzt werden.

## 3.12 Lokale Security Modes korrigieren/vollenden

Passphrase-KDF exakt gemäß neuer Spec; die derzeitige generische `context`-Konstruktion nicht beibehalten, wenn sie vom exakten v5-Kontext abweicht.

WebAuthn PRF:

- byteweiser Credential-ID-Vergleich;
- reales Enrollment/Get-Konzept;
- `userVerification:"required"`;
- Post-Enrollment-PRF-Verifikation;
- exakte HKDF-Bindung;
- kein stiller Best-Effort-Downgrade.

Best-Effort UI/State darf keine starke Profilkopie-Sicherheit behaupten.

## 3.13 Backup vollständig ersetzen

Der aktuelle `backup.ts` („Envelopearray unter einem beliebigen Key“) entspricht nicht dem v5-Backup.

Implementiere das exakte Backupformat der neuen Spec:

- one-shot `backup_id` + `K_backup`;
- geschütztes Backup-Manifest;
- eingebettete exakte immutable Manifest-Bytes;
- physische `record_rows`;
- vollständige `pending_outbox_rows` aus immutable Localbestand, unabhängig von Flags;
- Counts/Bytes/Hashes/Prefix/Anchor;
- strikte Bounds;
- Restore-Verifikation über Manifest/AEAD/Graph/Controls;
- kein destruktiver Restore;
- große Inputs nicht über unbounded Ganzdatei-Parse.

## 3.14 Rotation als echte persistente State-Machine

Die aktuelle kleine `RotationStep`-Hilfsdatei ist keine Implementierung der geforderten Rotation.

Implementiere die persistente Single-Writer-Rotation aus der exakten Spec:

- Maintenance/write freeze;
- Source final pull/anchor/snapshots;
- URS continuity;
- RK_new + verified local wrap vor remote create;
- one-shot Successor Manifest;
- create/reconcile;
- vollständige State-Copy mit neuen Successor-Revision-/Envelope-IDs;
- migration control;
- semantic snapshot equality;
- Recovery + full bootstrap test;
- Backup + full restore test;
- old-epoch `rotation_announcement`;
- announcement readback/full verification/new source anchor;
- atomic active/retired switch;
- crash/resume an jedem normativen Gate;
- abort nur vor announcement durable; staged successor orphaned;
- nach announcement durable alte Epoche niemals fachlich reaktivieren.

## 3.15 Legacy-Migration reparieren

Aktuell wird insbesondere `localStorage["eds-diary-activity-types-v1"]` logisch verloren.

Migration muss **alle** persistierten Quellen abdecken und in echte Revision/Envelope-Zielrecords überführen.

Nicht direkt vom Klartextstore in einen mutable Device-Key-Cipherstore schneiden.

Erforderlich:

- Baseline + dirty-generation/catch-up oder gleichwertiges Verfahren;
- deterministische Legacy Record IDs;
- Settings-Singletons;
- decrypt/readback/semantischer Vergleich;
- crash-resume;
- kein Cutover vor vollständigem Verify;
- Legacy danach read-only, noch nicht löschen;
- eigener späterer Purge-Gate.

## 3.16 Revision Graph korrigieren

Exaktes Wrapper-/Schemaformat übernehmen. Zusätzlich:

- `revision_id` 32 Byte Base64URL;
- Parent IDs 32 Byte;
- `record_id` 16 Byte;
- schema string;
- parent-before-child physisch prüfen;
- gleiche Revision-ID in unterschiedlichen Envelope-Bytes fatal;
- Controls nicht als fachliche Heads behandeln;
- mehrere Offline-Heads erhalten;
- Tombstone-/Merge-Verhalten gemäß Schema;
- iterative Bounds.

---

# 4. Tests / Assurance – diesmal vollständig gegen Norm

Die 17 bisherigen Tests sind nicht ausreichend. Erweitere sie systematisch nach `EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md` und dem Golden-Vector-Kapitel der neuen exakten Spec.

Mindestens zwingend grün:

### Byte-/Crypto-Vektoren

- epoch salt;
- K_env;
- K_epoch_manifest;
- AES-GCM Record-AAD + Padding-Frame Vector;
- Manifest-AAD Vector;
- URS/recovery commitment;
- Prefix H0/H1/H2 **inklusive uint32 length field**;
- Single-Writer Anchor JCS/hash;
- Legacy-/Singleton-IDs;
- Local journal / state MAC relevante Vektoren;
- Passphrase Argon/KDF Vector;
- Rotation Announcement Encoding.

Golden expected values werden aus der Spec übernommen, nicht durch den getesteten Code erzeugt.

### Security-/Protocol-Fälle

- crash nach Envelope reservation;
- crash nach encrypt vor append;
- retry exact bytes;
- duplicate id same bytes / different bytes;
- IV anomaly;
- manifest tamper;
- hostile grid/formula/gap/merge/extra tab;
- old anchor rollback/reorder/change;
- unknown outcome append present/absent;
- full final verification before durable;
- announcement blocks old writer;
- offline two-head conflict preserved;
- all Create/Reconcile crash cases;
- recovery correct/wrong URS and independent manifest commitment;
- recovered RK not activated before bootstrap;
- backup tamper/omission/order/anchor cases;
- migration write-during-backfill/catch-up;
- Web Lock/generation stale callback test;
- rotation crash/resume at every gate listed in Assurance plan;
- stale device after announcement;
- Google error normalization;
- architecture tests for no Google wire types in core, no secure `values.append`, no new plaintext health persistence.

### State-machine/model test

Ersetze/erweitere das jetzige triviale Boolean-Modell. Das Modell muss tatsächlich Zustände zulassen, die bei fehlerhafter Transition die Invarianten verletzen könnten, statt die Invariante bereits im Datentyp einzubauen.

Mindestens modellieren:

- verified remote generation/prefix;
- local operation generation;
- append outcome unknown/present/absent;
- final verification;
- atomic anchor+durable;
- announcement/retired;
- pending local heads;
- crash/reload.

Prüfe die INV-SW-001..007 aus dem Assurance-Plan.

---

# 5. Baseline / Regression

Vor Abschluss erneut ausführen und Ergebnisse exakt dokumentieren:

```bash
npm install
npm run build
npm run lint
npm run build-storybook
npm run test
npm run test:e2e
```

Bestehende unabhängige Baselinefehler dürfen dokumentiert bleiben, aber:

- keine **neu verursachten** Lint-/Type-/E2E-Fehler;
- relevante kritische Journeys müssen gezielt grün sein;
- wenn Alt-E2E-Erwartungen wegen bewusst geändertem sicheren Verhalten falsch geworden sind, Tests fachlich korrekt aktualisieren statt sie pauschal als Baselinefehler stehenzulassen.

Füge, falls im Repo noch nicht sauber vorhanden, reproduzierbare Scripts für Typecheck/Architecture/Crypto-Golden/critical Playwright hinzu.

---

# 6. Abschlussbericht aktualisieren

`docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md` nach der Nacharbeit vollständig aktualisieren.

Er muss unterscheiden:

1. **vollständig implementiert + getestet**;
2. **implementiert, aber Live-Provider/Browser-Integration noch nicht real getestet**;
3. **extern/deployment-bedingt release-blocked**;
4. echte verbleibende `SECURITY/SPEC DECISION REQUIRED`.

Die bisherigen Punkte „Manifest-AAD/Prefix nicht normiert“ dürfen nach Einzug der neuen exakten Spec nicht mehr als offen geführt werden.

Führe eine Tabelle `Spec requirement -> implementation files -> tests -> status` für die sicherheitskritischen Anforderungen ein.

---

# 7. Definition of Done für PR #8

PR #8 ist erst für Review bereit, wenn:

- aktuelles `main` mit der exakten Spec eingebunden ist;
- keine bekannte Abweichung aus Abschnitt 3 dieses Dokuments offen ist;
- neue lokale Source of Truth wirklich Revision/Envelope/RK-basiert ist;
- Pull-before-Push vollständig kryptographisch/semantisch verifiziert;
- Durable erst nach vollständigem finalen Pull + atomarem Anchor erfolgt;
- Create/Reconciliation den Lost-Create-Response-Fall sicher behandelt;
- Google Transport strikte Grid-/Drive-Invarianten nutzt und kein `values.append` enthält;
- Recovery RK nur nach vollständigem Bootstrap aktiviert;
- Backup und Rotation echte persistente implementierte Flows sind;
- Legacy-Aktivitätstypen und alle anderen Persistenzquellen erhalten bleiben;
- Golden Vectors und relevante Assurance-Fälle grün sind;
- der Produktpfad die neuen Komponenten tatsächlich nutzt;
- externe Auth-Origin-/Live-Google-Gates weiterhin ehrlich fail-closed dokumentiert sind;
- PR nicht selbst gemergt wurde.

Am Ende: pushe die Nacharbeit auf denselben PR-Branch und aktualisiere PR #8. Merge nichts.
