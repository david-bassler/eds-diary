# Plan: Erweiterbare Domain-Kategorien mit generierter V2-Registry

Stand: 01.10.2026  
Projekt: EDS Diary

## 1. Ziel

Die bestehende Domain-/Schema-Infrastruktur soll so refaktoriert werden, dass neue fachliche Kategorien künftig hinzugefügt werden können, ohne den sicherheitskritischen V2-Unterbau an mehreren Stellen manuell zu verändern.

Diese Arbeit führt **keine neue fachliche Kategorie** ein. Die Erweiterbarkeit wird ausschließlich mit **synthetischen Testschemata und Test-Record-Typen** validiert.

Das Zielbild ist:

- Eine spätere neue Kategorie wird durch neue, isolierte Domain-Dateien beschrieben.
- Zentrale V2-Mappings, Schema-Allowlisten und Registry-Snapshots werden deterministisch generiert.
- Bestehende Registry-Snapshots und ihre Hashes bleiben unveränderlich.
- Alte Epochen bleiben vollständig verifizierbar.
- Eine neue Registry-Version wird erst durch eine explizite, sichere Epoch-Migration bzw. Rotation aktiv.
- Der bestehende Writer-/Recovery-/Rotation-/Backup-/Verifier-Kern bleibt unverändert.
- UI-Code bleibt bewusst außerhalb dieses Vorhabens.
- Die neue Mechanik wird vor einer realen Domain-Erweiterung vollständig mit Testschemata abgesichert.

Idealzustand für eine spätere neue Kategorie:

```text
neu:
  <category>.domain.ts
  <category>-entry.v1.schema.json
  <category>Entry.ts
  <category>Repository.ts
  UI-Dateien

danach:
  npm run domain:registry:new
  npm run domain:generate
```

Es soll keine bestehende zentrale Security-/Sync-Datei von Hand geändert werden müssen.

## 2. Nicht-Ziele

Diese Arbeit soll ausdrücklich nicht:

- eine neue reale fachliche Kategorie hinzufügen;
- Blutdruck, Herzfrequenz, Gewicht oder andere Gesundheitsdaten implementieren;
- neue Produkt-UI hinzufügen;
- das bestehende Wire-Format von EDS V2 rückwirkend verändern;
- bestehende Registry-Hashes neu berechnen oder überschreiben;
- `diary_id`, bestehende Control-Records oder Signaturformate umbenennen;
- WriterGrant-, Handoff-, Forced-Takeover-, Recovery- oder Rotation-Semantik verändern;
- Google als Provider neu abstrahieren;
- bestehende fachliche Schemas stillschweigend erweitern.

Die eingefrorene bestehende V2-Spezifikation bleibt für bereits erzeugte Epochen byte-identisch gültig.

## 3. Grundprinzip

Heute werden fachliche Record-Typen an mehreren Stellen manuell gepflegt, unter anderem in:

- `src/security/v2/types.ts`
- `src/security/v2/schemaRegistry.ts`
- `src/security/v2/domainWrite.ts`
- `src/data/applicationDataStore.ts`
- Manifest-/Registry-Validierung

Diese manuelle Mehrfachpflege soll durch eine einzige deklarative Quelle ersetzt werden.

Der Generator darf nur abgeleitete Artefakte erzeugen. Die fachliche Definition selbst bleibt handgeschrieben und reviewbar.

## 4. Domain-Descriptor

Jede bestehende und spätere Kategorie erhält eine eigene Descriptor-Datei, zum Beispiel:

```text
src/domain/records/pain-entry.domain.ts
src/domain/records/activity-entry.domain.ts
src/domain/records/medication-entry.domain.ts
```

Ein späterer neuer Record-Typ könnte nach demselben Muster beschrieben werden:

```ts
export default defineDomainRecord({
  recordType: 'example_entry',
  schemaId: 'example-entry/v1',
  schemaFile: '../../security/schemas/example-entry.v1.schema.json',
  localStore: 'exampleEntries',
  idPrefix: 'example',
  kind: 'entity',
})
```

Dieses Beispiel ist ausschließlich illustrativ. Im produktiven Code wird im Rahmen dieses Plans kein `example_entry` registriert.

### 4.1 Pflichtfelder

Mindestens:

```text
recordType
schemaId
schemaFile
localStore
kind
```

Je nach Typ zusätzlich:

```text
idPrefix
logicalId
migrationPolicy
```

### 4.2 Validierung

Der Generator muss abbrechen bei:

- doppeltem `recordType`;
- doppelter `schemaId`;
- ungültiger Schema-ID;
- fehlender Schema-Datei;
- Schema-`$id`, das nicht exakt `schemaId` entspricht;
- unbekanntem `localStore`;
- nicht geschlossenem JSON-Schema, soweit für Domain-Schemas vorgeschrieben;
- unzulässigen Änderungen an bereits veröffentlichten Registry-Snapshots.

## 5. Discovery

Die Descriptor-Dateien sollen automatisch gefunden werden.

Bevorzugt:

```text
scripts/generate-domain-registry.mjs
```

Das Script liest beispielsweise:

```text
src/domain/records/*.domain.ts
```

oder eine buildfreundliche, statisch auswertbare Descriptor-Form.

Der Generator darf keine Anwendungslogik ausführen. Die Descriptor-Struktur soll daher so einfach bleiben, dass sie deterministisch eingelesen werden kann.

Falls TypeScript-Import im Node-Script unnötige Build-Komplexität erzeugt, kann alternativ ein reines Datenformat verwendet werden, z. B. `*.domain.json`.

## 6. Generierte Artefakte

Der Generator erzeugt einen klar abgegrenzten Bereich:

```text
src/generated/domain/
```

Darin beispielsweise:

```text
recordTypes.ts
storeProfiles.ts
schemaRegistryCurrent.ts
registrySnapshots.ts
registryMetadata.ts
```

### 6.1 `recordTypes.ts`

Generiert die zentrale Zuordnung von Record-Typ zu Schema-ID und leitet daraus die TypeScript-Typen ab.

### 6.2 `storeProfiles.ts`

Generiert die Zuordnung von App-Store zu Record-Typ und Schema.

### 6.3 `schemaRegistryCurrent.ts`

Enthält die aktuelle vollständige Domain-Registry für neue Epochen.

Control-Schemas bleiben getrennt und werden weiterhin vom V2-Protokollkern verwaltet.

## 7. Immutable Registry-Snapshots

Dies ist der sicherheitskritisch wichtigste Teil.

Heute wird exakt ein Registry-Hash akzeptiert. Künftig müssen mehrere bekannte, unveränderliche Snapshots existieren können.

Beispiel:

```text
registry-v1
  heutige reale EDS-Domain-Schemas

registry-v2-test
  registry-v1
  + synthetisches Testschema
```

Der zweite Snapshot dient im Rahmen dieses Plans ausschließlich Tests und darf nicht als produktiv auswählbare Registry ausgeliefert werden.

Jeder Snapshot enthält:

```text
registryId
allowlist
schemaHashes
registryHash
```

### 7.1 Unveränderlichkeitsregel

Sobald ein Registry-Snapshot committed und von einer Epoche verwendet wurde:

- darf kein Schema darin verändert werden;
- darf kein Eintrag entfernt werden;
- darf kein Hash verändert werden;
- darf seine Sortierung/Kanonisierung nicht verändert werden.

Eine spätere fachliche Schemaänderung erzeugt stattdessen eine neue Schema-ID und einen neuen Registry-Snapshot.

## 8. Trennung von Control- und Domain-Schemas

Empfohlene Zielstruktur:

```text
V2_CONTROL_SCHEMA_REGISTRY
EDS_DOMAIN_REGISTRY_SNAPSHOTS
```

Control-Schemas bleiben exakt wie heute eingefroren:

```text
writer-grant-sw-v2
rotation-announcement-sw-v2
epoch-migration-sw-v2
recovery-authority-transition-sw-v2
successor-activation-confirmation-sw-v2
```

Domain-Schemas dürfen nur über versionierte Registry-Snapshots wachsen.

## 9. Manifest-Evolution

Der heutige Manifest-Verifier erwartet exakt die derzeitige Allowlist und den derzeitigen Registry-Hash.

Das soll so erweitert werden, dass:

1. das Manifest weiterhin einen exakten Registry-Hash bindet;
2. der Verifier anhand dieses Hashes einen bekannten immutable Snapshot auswählt;
3. unbekannte Registry-Hashes fail-closed abgelehnt werden;
4. jede Revision nur gegen das Schema validiert wird, das im Snapshot der aktuellen Epoche enthalten ist.

Keine Fallbacks und kein „latest schema wins“.

## 10. Bestehende Epochen

Bestehende V2-Epochen behalten ihre alte Allowlist, ihren alten Registry-Hash und ihre alten Schemas.

Sie müssen mit einer neuen App-Version weiterhin vollständig verifiziert, gelesen, gebackupt, recovered und rotiert werden können.

Ein Record-Typ, der nicht im Registry-Snapshot der aktiven Epoche enthalten ist, darf dort nicht geschrieben werden.

## 11. Validierung einer zukünftigen Registry-Erweiterung

Da im Rahmen dieses Plans keine reale neue Domain eingeführt wird, wird die Erweiterbarkeit mit einem ausschließlich testseitigen Schema validiert.

Beispiel:

```text
test-example-entry/v1
```

Das Testschema soll:

- nur unter `src/test` oder `tests/fixtures` liegen;
- niemals in die produktive aktuelle Registry aufgenommen werden;
- einen zweiten Registry-Snapshot nur für Tests erzeugen;
- alle Evolutionspfade beweisen, die später auch für eine reale Domain nötig wären.

## 12. Registry-Upgrade-Ceremony

Für reine Domain-Erweiterungen wird ein definierter Upgrade-Pfad benötigt.

Im Test wird folgende Sequenz synthetisch ausgeführt:

```text
current epoch
  ↓
fresh canonical verify
  ↓
plan successor epoch with test registry
  ↓
copy all existing accepted domain records
  ↓
verify semantic equivalence
  ↓
activate successor
  ↓
switch local selection
```

Die bestehenden Rotation-Invarianten gelten weiterhin:

- fresh WriterAuthority;
- crash-resumable;
- Unknown-Outcome-sicher;
- Source darf nicht still weiterlaufen;
- Successor muss vollständig verifiziert werden;
- Backup-/Recovery-Artefakte müssen korrekt gebunden sein;
- kein lokaler Switch vor finalem Verify.

## 13. Keine produktive Aktivierung des Testschemas

Der synthetische Registry-Snapshot darf in Unit-, Integrations- und kontrollierten Browsertests verwendet werden.

Er darf nicht:

- der Default für neue produktive Epochen werden;
- über die normale UI auswählbar sein;
- in reale Nutzerdaten geschrieben werden;
- als neuer produktiver EDS-Registry-Stand dokumentiert werden.

Der produktive Default bleibt während dieses gesamten Vorhabens der heutige Registry-Snapshot.

## 14. Lokale Stores

Heute sind lokale Stores teilweise statisch definiert.

Ziel:

- spätere neue fachliche Stores werden aus Domain-Deskriptoren abgeleitet oder
- es wird ein generischer V2-Domain-Store verwendet, sodass neue V2-Kategorien gar keinen neuen IndexedDB-Object-Store benötigen.

Langfristig ist ein generischer V2-Materialisierungs-Layer vorzuziehen.

Wichtig:

- keine neuen persistenten Klartext-Health-Stores;
- V2-Offline-Lesen weiterhin nur über verschlüsselte Envelopes plus authentifiziertes Read-Model;
- bestehende Legacy-v1-Stores nicht unnötig erweitern.

Da dieser Plan keine reale neue Domain einführt, soll auch kein neuer produktiver Legacy-Store entstehen.

## 15. Repository-API

Ein späterer einfacher Domain-Typ soll ein standardisiertes Repository-Grundgerüst nutzen können.

Der gemeinsame Teil kann übernehmen:

- `get`;
- `list`;
- `create`;
- `update`;
- `delete/tombstone`;
- v2 Write Dispatch;
- Konflikt-Weiterleitung;
- Materialisierung.

Die Kategorie selbst liefert nur Domain-Typ, Normalisierung, fachliche Validierung, Sortierung und ggf. Merge-Regeln.

Diese API wird im Rahmen des Plans mit Testtypen validiert.

## 16. Generator-Kommandos

Neue npm-Scripts:

```json
{
  "domain:generate": "node scripts/generate-domain-registry.mjs",
  "domain:check": "node scripts/generate-domain-registry.mjs --check"
}
```

`domain:generate` liest Descriptor-Dateien, validiert Schemas, erzeugt Registry-Dateien und berechnet kanonische Hashes.

`domain:check` verändert keine Dateien und schlägt fehl, wenn generierte Dateien veraltet oder historische Snapshots verändert wurden.

## 17. Registry-Snapshot-Erstellung

Ein neuer produktiver Snapshot darf nicht automatisch bei jedem Build entstehen.

Für spätere reale Erweiterungen soll es ein explizites Kommando geben:

```bash
npm run domain:registry:new
```

Das Script prüft ausschließlich erlaubte additive Änderungen, berechnet neue Schema-Hashes, erzeugt einen neuen Snapshot und lässt alte Snapshots unverändert.

Für diesen Plan wird dieser Mechanismus ausschließlich in Tests bzw. gegen eine temporäre Fixture-Registry ausgeführt.

## 18. CI-Gates

Die Security Validation soll mindestens ergänzen:

### 18.1 Generated-files gate

```bash
npm run domain:check
```

### 18.2 Immutable-registry gate

Prüft alle historischen Registry-Snapshots, ihre Allowlist, Schema-Hashes und Registry-Hashes.

### 18.3 Backward-verification test

Für jede bekannte produktive Registry-Version:

- Manifest/Fixture laden;
- Verifier muss sie akzeptieren;
- alle erlaubten Record-Typen müssen validieren.

Zusätzlich mit Testregistry:

- Testschema in alter Registry wird abgelehnt;
- Testschema in Testregistry wird akzeptiert;
- unbekannter Registry-Hash wird abgelehnt;
- manipulierter historischer Snapshot wird abgelehnt.

### 18.4 Upgrade test

Synthetischer Test:

```text
registry-v1 epoch
→ test-registry successor
→ bestehende Daten unverändert
→ Test-Record-Typ schreibbar
→ alter Source retired
```

### 18.5 Crash-/Resume

Registry-Upgrade an relevanten bestehenden Rotation-Fault-Points testen.

### 18.6 Production-default test

Explizit prüfen, dass der produktive Registry-Hash unverändert bleibt, solange keine reale Domain-Erweiterung beschlossen wurde.

## 19. Synthetische Testschemata

Vorgeschlagene Fixtures:

```text
tests/fixtures/domain-registry/
  test-example-entry.v1.schema.json
  test-example-entry-v2.v2.schema.json
```

Die Schemas sollten bewusst verschiedene Fälle abdecken:

- gültiges neues additives Schema;
- neue Version einer bestehenden Test-Schema-ID;
- unbekannte Zusatzfelder;
- ungültige Typen;
- zu große Payloads;
- falsches `$id`;
- absichtlich kollidierende `recordType`-/`schemaId`-Definitionen.

## 20. UI ist nicht Teil dieses Plans

Es wird keine neue UI implementiert.

Insbesondere keine neue Seite, Navigation, Form oder Visualisierung.

Die bestehende EDS-Oberfläche soll sich durch diese Infrastrukturarbeit funktional nicht verändern.

## 21. Umsetzung in Phasen

### Phase 1 – Bestehende Domain-Metadaten zentralisieren

1. Descriptor-Typ definieren.
2. Bestehende Domain-Typen als Deskriptoren abbilden.
3. Generator für Record-Typen und Store-Profile.
4. Bestehende produktive Nutzer auf generierte Dateien umstellen.
5. `domain:check` in CI.

Definition of Done:

- aktueller Registry-Hash bleibt byte-identisch;
- aktuelle V2-Golden-Vectors unverändert;
- keine neue Domain;
- Security Validation vollständig grün.

### Phase 2 – Registry-Snapshots einführen

1. bestehenden Registry-Stand als `registry-v1` festschreiben;
2. Registry-Lookup `hash → snapshot`;
3. Manifest-Verifier auf Snapshot-Lookup umstellen;
4. Domain-Write auf aktive Epoch-Registry binden;
5. Golden-/Backward-Tests.

Definition of Done:

- bestehende Epochen unverändert gültig;
- unbekannter Registry-Hash fail-closed;
- späterer Test-Record-Typ in alter Registry wird abgelehnt;
- produktiver Registry-Hash unverändert.

### Phase 3 – Test-Registry und Upgrade-Pfad

1. synthetisches Testschema anlegen;
2. rein testseitigen zweiten Registry-Snapshot erzeugen;
3. bestehende Rotation parametrisierbar machen;
4. Successor-Manifest mit Testregistry erzeugen;
5. bestehende Fachrevisionen migrieren;
6. semantischen Snapshot vor/nach Migration vergleichen;
7. Crash-/Resume-Abdeckung;
8. Backup-/Recovery-Kompatibilität prüfen.

Definition of Done:

- produktiver Registry-Stand bleibt unverändert;
- Test-Upgrade vollständig crash-resumable;
- keine Datenänderung bestehender Records;
- Test-Record-Typ erst nach Test-Cutover verfügbar;
- alte Epoche bleibt historisch verifizierbar.

### Phase 4 – Generator- und Missbrauchshärtung

Tests mindestens für:

- Duplicate `recordType`;
- Duplicate `schemaId`;
- falsches `$id`;
- Mutation eines historischen Registry-Snapshots;
- veraltete generierte Dateien;
- unbekannten Registry-Hash;
- Schema aus falscher Registry;
- Record-Typ aus falscher Epoche;
- nichtdeterministische Sortierung;
- Hash-Abweichung;
- ungültige Descriptor-Struktur.

Definition of Done:

- alle Fehler fail-closed;
- Generator deterministisch;
- historische Registry unverändert;
- kein produktiver Domain-Zuwachs.

## 22. Erwartete Dateiauswirkung nach Abschluss

Nach Einführung der Generator-/Registry-Infrastruktur soll eine spätere einfache Kategorie typischerweise nur noch neue Dateien benötigen.

Beispiel abstrakt:

```text
NEU:
src/domain/records/<category>.domain.ts
src/security/schemas/<category>-entry.v1.schema.json
src/features/<category>/<category>Entry.ts
src/features/<category>/<category>Repository.ts
src/features/<category>/...
```

Dann:

```bash
npm run domain:registry:new
npm run domain:generate
```

Bestehende Security-/Sync-Dateien:

```text
0 manuelle Änderungen
```

## 23. Optional: Navigation ebenfalls deklarativ

Eine spätere deklarative Navigation kann separat betrachtet werden. Sie ist nicht Teil dieses Plans.

## 24. Risiken

### 24.1 Unbeabsichtigte Änderung alter Registry-Bytes

Mitigierung: immutable Snapshots, Golden-Hash-Tests und `domain:check`.

### 24.2 Generator wird neue Quelle für Sicherheitsfehler

Mitigierung: klein, deterministisch, kein dynamisches Business-Verhalten, Output committed und reviewbar.

### 24.3 Registry-Upgrade schwächt Rotation

Mitigierung: vorhandene Rotation-/Recovery-Invarianten wiederverwenden, keine vereinfachte Parallelmigration.

### 24.4 Alte Epochen werden mit neuem Schema interpretiert

Mitigierung: Schemaauswahl ausschließlich anhand des im Epoch-Manifest gebundenen Registry-Hashes.

### 24.5 Test-Registry wird versehentlich produktiv

Mitigierung:

- Testschemas ausschließlich in Test-/Fixture-Pfaden;
- Architecture-Test gegen produktive Imports;
- expliziter Test des unveränderten Production-Default-Hashes;
- kein UI- oder Runtime-Pfad darf die Testregistry auswählen.

## 25. Sicherheitsinvarianten

1. Ein Epoch-Manifest bindet exakt eine bekannte Domain-Registry.
2. Unbekannte Registry-Hashes werden fail-closed abgelehnt.
3. Ein Record darf nur ein Schema verwenden, das in seiner Epoch-Registry enthalten ist.
4. Bestehende Registry-Snapshots sind unveränderlich.
5. Schema-Evolution erfolgt durch neue Schema-ID, nicht durch Mutation alter Schemas.
6. Eine spätere neue Kategorie wird erst nach erfolgreicher Epoch-Migration/Rotation schreibbar.
7. WriterAuthority bleibt Voraussetzung jedes Domain-Writes.
8. Registry-Evolution verändert keine Writer-/Recovery-/Control-Semantik.
9. Historische Epochen werden immer gegen ihre historische Registry verifiziert.
10. Die kryptographische Runtime-Verifikation bleibt maßgeblich.
11. Keine spätere neue Kategorie darf neue persistente Klartext-Gesundheitsdaten einführen.
12. Synthetische Testregistries dürfen niemals als produktiver Default verwendet werden.

## 26. Definition of Done für die Gesamtarbeit

Die Generator-/Registry-Evolution gilt als abgeschlossen, wenn:

- alle bestehenden Domain-Typen deklarativ beschrieben sind;
- zentrale Domain-Mappings nicht mehr manuell mehrfach gepflegt werden;
- der heutige Registry-Stand als immutable Snapshot erhalten bleibt;
- mehrere Registry-Snapshots sicher parallel verifiziert werden können;
- unbekannte/mutierte Snapshots fail-closed sind;
- eine Registry-Migration über die bestehende sichere Epoch-Mechanik mit einem synthetischen Testschema funktioniert;
- keine neue reale Domain hinzugefügt wurde;
- der produktive Registry-Hash weiterhin exakt dem heutigen Stand entspricht;
- für eine spätere neue Kategorie keine bestehende Security-/Sync-Datei geändert werden muss;
- Golden Vectors und bestehende EDS-V2-Daten kompatibel bleiben;
- Unit-, Security-, generative und Browser-E2E-Gates vollständig grün sind;
- ein adversarialer Review speziell Registry-Evolution, historische Verifikation, Migration, Test-/Produktions-Trennung und Generator-Manipulation erneut geprüft hat.

## 27. Empfohlene Reihenfolge

```text
1. Domain-Descriptor
2. Generator
3. Bestehende Mappings auf Generator umstellen
4. Bestehenden Registry-Stand als v1 einfrieren
5. Multi-Registry-Verifikation
6. Synthetische Testregistry
7. Registry-Upgrade über Epoch-Rotation im Test
8. Crash-/Resume- und Missbrauchstests
9. vollständige Security Validation
10. adversarialer Abschlussreview
```

Erst nach erfolgreichem Abschluss dieses Plans sollte separat entschieden werden, ob und welche reale neue Domain-Kategorie tatsächlich in EDS Diary aufgenommen wird.
