# EDS Diary – Normative Fachschemas v1

Stand: 15.09.2026

Status: **NORMATIV** für die sechs Fachschemas des Profils `google-sheets-single-writer-v1`. Diese Datei konkretisiert Abschnitt 4.2 von `EDS_SINGLE_WRITER_V1_EXACT_PROTOCOL.md`. Bei den hier definierten Fachfeldern, Typen und Limits hat diese Datei Vorrang vor bisherigem Anwendungscode und Placeholder-Schemas.

## 1. Grundregeln

Die sechs Schemas beschreiben ausschließlich `revision.record_data` für fachliche Revisionen mit `record_status="active"`. `record_id`, `revision_id`, `record_type`, `record_schema`, `record_status`, Parents, `migration_origin` und `protocol_created_at` gehören ausschließlich in den gemeinsamen verschlüsselten Revision-Wrapper und dürfen in `record_data` nicht dupliziert werden.

Für `record_status="deleted"` gilt unabhängig vom Fachschema zwingend `record_data=null`.

Alle sechs Schema-Dateien verwenden JSON Schema Draft 2020-12, exakt die unten angegebene `$id`, `type:"object"`, alle hier genannten Felder als `required` und `additionalProperties:false`.

Remote-/Backup-Verifikation ist **validierend, niemals normalisierend**: kein Trimmen, Case-Folding, Clamping, Datumsumbau, Defaulting oder stilles Entfernen unbekannter Felder. Normalisierung findet nur vor Erzeugung einer neuen lokalen Revision bzw. explizit während der Legacy-Migration statt.

Zeitstempel sind kanonische UTC-Zeitstempel im JavaScript-`toISOString()`-Format:

`YYYY-MM-DDTHH:mm:ss.SSSZ`

Regex: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`. Zusätzlich muss der Wert als reales Datum/Zeit interpretierbar sein und nach `new Date(value).toISOString()` bytegleich bleiben.

Kalenderdaten verwenden `YYYY-MM-DD` und müssen reale gregorianische Daten sein. Uhrzeiten verwenden `00:00` bis `23:59` oder exakt `24:00`.

Die Schema-Grenzen ersetzen nicht das globale Envelope-Maximum von 16380 Payload-Bytes.

## 2. `pain-entry/v1`

Exaktes `record_data`:

- `startedAt`: kanonischer UTC-Zeitstempel, erforderlich.
- `endedAt`: `""` oder kanonischer UTC-Zeitstempel. Wenn nicht leer: strikt später als `startedAt`.
- `locations`: Array, max. 64 Elemente. Elemente exakt `{view,regionId}` oder `{view,regionId,detailRegionIds}`.
  - `view`: `"front" | "back"`.
  - `regionId`: String, 1..120 Unicode-Codepoints, bereits getrimmt.
  - `detailRegionIds`: optionales Array, max. 64, eindeutige Strings mit 1..120 Unicode-Codepoints, bereits getrimmt.
  - `(view,regionId)` muss innerhalb von `locations` eindeutig sein.
- `intensity`: `null` oder endliche Zahl `0..10`.
- `qualities`: Array, max. 64, eindeutige Strings, je 1..60 Unicode-Codepoints, bereits getrimmt.
- `cause`: String, max. 240 Unicode-Codepoints, bereits getrimmt.
- `occursWhen`: String, max. 240 Unicode-Codepoints, bereits getrimmt.
- `note`: String, max. 2000 Unicode-Codepoints, bereits getrimmt.
- `createdAt`: kanonischer UTC-Zeitstempel.
- `updatedAt`: kanonischer UTC-Zeitstempel.

Für Protokollkompatibilität werden `locations=[]`, `qualities=[]` und `intensity=null` akzeptiert; strengere UI-Pflichten gelten nicht als Remote-Protokollschema.

Legacy-Migration: nichtleere historische `startedAt`/`endedAt`/`createdAt`/`updatedAt`-Werte müssen parsebar sein und werden einmalig zu `toISOString()` kanonisiert. Nicht parsebarer nichtleerer Wert ist ein Migrationsfehler; Quelle bleibt unangetastet. Keine stille Ersetzung durch aktuelle Zeit.

## 3. `activity-entry/v1`

Exaktes `record_data`:

- `date`: reales Kalenderdatum `YYYY-MM-DD`.
- `startTime`: `HH:MM`, `00:00..23:59` oder `24:00`.
- `endTime`: `""` oder dieselbe Uhrzeitform.
- `isOngoing`: Boolean.
- `activityName`: String, 1..120 Unicode-Codepoints, bereits getrimmt.
- `color`: exakt einer der Werte:
  `#f6cbd0`, `#f6d7bd`, `#f3e2b8`, `#dfe8bc`, `#cbe7ca`, `#c7e8dc`, `#c6e3ee`, `#cddbf2`, `#d8d0ef`, `#e5cdec`, `#efcde1`, `#ead5c7`.
- `note`: String, max. 2000 Unicode-Codepoints, bereits getrimmt.
- `createdAt`: kanonischer UTC-Zeitstempel.
- `updatedAt`: kanonischer UTC-Zeitstempel.

Semantik:
- `isOngoing=true` => `endTime=""`.
- `isOngoing=false` => `endTime` muss nichtleer sein und Minutenwert von `startTime` muss strikt kleiner als der von `endTime` sein.

## 4. `medication-entry/v1`

Exaktes `record_data`:

- `medicationName`: String, 1..120 Unicode-Codepoints, bereits getrimmt.
- `dose`: String, 1..80 Unicode-Codepoints, bereits getrimmt.
- `takenAt`: kanonischer UTC-Zeitstempel.
- `createdAt`: kanonischer UTC-Zeitstempel.
- `updatedAt`: kanonischer UTC-Zeitstempel.

## 5. `medication-prescription/v1`

Exaktes `record_data`:

- `medicationName`: String, 1..120 Unicode-Codepoints, bereits getrimmt.
- `prescribedOn`: reales Kalenderdatum `YYYY-MM-DD`.
- `prescriber`: String, max. 160 Unicode-Codepoints, bereits getrimmt.
- `reason`: String, max. 500 Unicode-Codepoints, bereits getrimmt.
- `createdAt`: kanonischer UTC-Zeitstempel.
- `updatedAt`: kanonischer UTC-Zeitstempel.

## 6. `pain-type-settings/v1`

Singleton-`record_id` gemäß `singleton-record-id/v5`. Exaktes `record_data`:

```json
{"values":["..."]}
```

- `values`: Array, max. 128 Strings.
- jeder String 1..60 Unicode-Codepoints, bereits getrimmt.
- Werte müssen bytegenau eindeutig sein und zusätzlich nach `toLocaleLowerCase("de")` eindeutig sein.
- Reihenfolge wird als Nutzdatenreihenfolge erhalten; Verifikation sortiert nicht.

Legacy-ID `"custom-pain-types"` ist kein Feld von `record_data`.

## 7. `activity-type-settings/v1`

Singleton-`record_id` gemäß `singleton-record-id/v5`. Exaktes `record_data`:

```json
{"values":[{"name":"...","color":"#..."}]}
```

- `values`: Array, max. 96 Elemente.
- jedes Element exakt `{name,color}`, keine weiteren Felder.
- `name`: String, 1..120 Unicode-Codepoints, bereits getrimmt.
- `color`: exakt einer der zwölf in Abschnitt 3 genannten Pastellwerte.
- Namen müssen bytegenau eindeutig sein und zusätzlich nach `toLocaleLowerCase("de")` eindeutig sein.
- Reihenfolge wird als Nutzdatenreihenfolge erhalten; Verifikation sortiert nicht.

Die historische LocalStorage-Struktur `eds-diary-activity-types-v1` wird bei der Legacy-Migration in genau dieses Singleton-`record_data` überführt.

## 8. JSON-Schema und zusätzliche semantische Checks

Die maschinenlesbaren JSON-Schemas müssen mindestens Typen, Required-Felder, `additionalProperties:false`, String-/Array-Grenzen, Enums, numerische Grenzen und reguläre Formate aus dieser Datei ausdrücken.

Regeln, die JSON Schema allein nicht zuverlässig abbildet, werden nach erfolgreicher Schema-Prüfung zusätzlich deterministisch geprüft, insbesondere:

- echte Kalenderdaten;
- kanonische `toISOString()`-Zeitstempel;
- `endedAt > startedAt`;
- Activity-Ongoing-/Zeitintervall-Invariante;
- Eindeutigkeit von Pain-Locations nach `(view,regionId)`;
- deutsche case-insensitive Eindeutigkeit der beiden Settings-Listen;
- Unicode-Codepoint-Längen, sofern die verwendete Schema-Engine nur UTF-16-Codeunits zählt.

Der produktive FullRemoteVerifier muss die vollständige Schema-Semantik ausführen. Ein Validator, der nur `type`, `required` und Top-Level-`additionalProperties` prüft, ist nicht ausreichend.

## 9. Mapping bestehender Fachobjekte zu Revisionen

Bei Erstellung/Migration gilt:

- bisheriges fachliches `id` -> deterministischer/gewählter Wrapper-`record_id`, nicht in `record_data`;
- bisheriges fachliches `status` -> Wrapper-`record_status`; bei `deleted` wird `record_data=null`;
- alle übrigen oben definierten Fachfelder -> `record_data`.

Die bestehende UI-/Repository-Normalisierung darf vor Erstellung einer neuen Revision weiterhin benutzt werden, sofern das Ergebnis exakt dieses Schema erfüllt. Remote-Daten werden niemals durch diese Normalizer „repariert“.