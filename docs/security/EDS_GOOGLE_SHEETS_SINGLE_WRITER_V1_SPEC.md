# EDS Diary – Google Sheets Single-Writer Syncprofil v1

Stand: 15.09.2026

Status: **NORMATIV für die erste verschlüsselte Remote-Sync-Implementierung.**

Dieses Profil basiert auf dem geprüften v5-Sicherheitsentwurf, vereinfacht aber bewusst die Google-Sheets-Remote-State-Machine unter folgender Produktannahme.

## 1. Single-Remote-Writer-Annahme

Für ein Diary gilt:

> Zu jedem Zeitpunkt führt höchstens ein konformer EDS-Client Remote-Schreiboperationen aus. Mehrere Geräte dürfen dasselbe Diary nacheinander verwenden und offline lokale Änderungen halten, aber ein Client darf erst nach vollständigem Pull + Remote-Verifikation Remote-Schreibautorität aufnehmen.

Diese Annahme ist Teil des Protokollprofils und darf nicht still aufgeweicht werden.

Nicht garantiert wird in v1:

- gleichzeitiger Remote-Schreibbetrieb mehrerer Geräte,
- automatische Konvergenz paralleler Remote-Forks,
- parallele Rotation mehrerer Geräte.

Mehrere Geräte mit **offline entstandenen fachlichen Konflikten** werden weiterhin unterstützt. Deshalb bleibt der fachliche Revision Graph erhalten.

## 2. Profil-ID und Upgrade-Regel

```text
provider_id   = "google-sheets-single-writer-v1"
protocol_mode = "single-remote-writer"
```

Ein späteres Multi-Writer-Profil darf eine bestehende Epoche **nicht in-place** umdeuten.

Upgrade erfolgt:

```text
Single-Writer-Epoche
  -> neue Epoche
  -> Copy
  -> Verify
  -> Switch
  -> alte Epoche retired
```

## 3. Normative Abhängigkeit

Kryptographie, Recovery, lokale Sicherheitsmodi, Pairing, Backup und Supply-Chain-Regeln stehen in:

`docs/security/EDS_CRYPTO_PROFILE_V5.md`

Bei Widerspruch hat das Kryptographieprofil für kryptographische Details Vorrang.

## 4. Remote-Struktur

Eine aktive Google-Epoche besteht aus genau einer kanonisch gebundenen Spreadsheet-Datei mit genau zwei Protokoll-Sheets:

```text
_m  immutable Manifest
_r  append-only Envelope Log
```

### 4.1 `_m`

`_m` besitzt exakt vier Spalten und genau eine Protokollzeile:

```text
A1 = "sync-v5"
B1 = "5"
C1 = manifest_iv
D1 = manifest_ciphertext
```

Die vier Werte sind Strings. Keine Formeln, Zahlen, booleschen Ersatztypen oder zusätzlichen Protokollzeilen.

Manifest wird genau einmal geschrieben und danach nie aktualisiert.

### 4.2 `_r`

`_r` besitzt exakt drei Spalten, keine Headerzeile:

```text
A = envelope_id
B = iv
C = ciphertext
```

Das Protokolllog ist append-only.

Vor Verarbeitung wird die Struktur fail-closed geprüft:

- `rowCount` muss innerhalb eines festen Bounds liegen; v5-Baseline: max. 100000,
- `last_protocol_row` ist höchste physische Zeile mit Wert in A/B/C,
- jede Zeile `1..last_protocol_row` enthält A/B/C vollständig,
- ausschließlich Stringwerte,
- keine Lücke im Protokollbereich,
- keine Formeln/berechneten Ersatzrepräsentationen,
- keine stille Sortierung oder Deduplizierung vor Integritätsprüfung.

## 5. Google-Bindung

Der Client bindet eine Epoche an genau eine kanonische Remote-Datei und eine erwartete Google-Identität.

Die finale Bindung basiert nicht auf Titel oder modifiedTime, sondern auf:

- lokal erwarteter Epoche,
- erfolgreicher Manifest-AEAD-Prüfung,
- Manifest-Fingerprint,
- kanonisch persistierter `file_id`,
- Google-Identity-Binding aus dem Auth-/Transportprofil.

Google Dateititel, Suche und `appProperties` sind nur Discovery/Reconciliation-Hilfen, keine Authentisierung.

## 6. Create/Reconciliation

Spreadsheet-Create ist eine externe Mutation mit Unknown Outcome.

Beispiel:

```text
POST create
-> Google erstellt Datei
-> Antwort geht verloren
```

Ein Retry darf nicht blind eine zweite kanonische Datei erzeugen.

Daher bleibt das v5-Prinzip erhalten:

1. vor Create lokal `creation_locator` und erwartete Epoch-/Manifestdaten persistent festlegen,
2. Zustand `creation_pending`,
3. Create ausführen,
4. nach Erfolg oder unklarer Antwort Kandidaten deterministisch reconciliieren,
5. Kandidaten ausschließlich durch erwartete Metadaten + Manifest-AEAD/Fingerprint authentisieren,
6. exakt eine kanonische `file_id` atomar als `bound` persistieren,
7. solange Bindung nicht eindeutig ist: **keine Record-Appends**.

Mehrere passende oder widersprüchliche Kandidaten -> `ambiguous`/Security Stop. Nicht nach `modifiedTime`, „neueste Datei“ oder Dateiname raten.

## 7. Lokale Outbox

Jedes neue Remote-Envelope wird vor Netz-I/O lokal persistent vorbereitet:

```text
prepared/pending
  -> remote_seen
  -> durable
```

Die Multi-Writer-v5-Zustände `checkpointed` und `anchor_confirmed` entfallen in diesem Profil.

Die Outbox ist **nicht** die einzige Wahrheit über noch nicht synchronisierte lokale Daten. Das lokale immutable Envelope-Journal ist die Quelle. Nach Start/Unlock und nach erkannten Statusfehlern wird die Delivery-Sicht gegen Remote reconciliiert.

Verlust/Manipulation eines Outbox-Statusflags darf kein lokales Envelope dauerhaft vom Sync ausschließen.

## 8. Pull-before-Push

Bevor ein Client Remote-Schreibautorität erhält:

1. Auth/Binding prüfen,
2. Manifest vollständig lesen/verifizieren,
3. `_r` vollständig innerhalb der Bounds lesen,
4. jede Zeile strukturell und kryptographisch validieren,
5. Remote-Prefix gegen lokalen Anchor prüfen,
6. Revision Graph rekonstruieren/verifizieren,
7. Rotation-/Announcement-Zustand prüfen,
8. lokale pending Envelopes gegen Remote reconciliieren,
9. erst dann `writer_active`.

Ein Client darf beim Start, Online-Event oder nach Login **niemals blind seine lokale Outbox pushen**.

Der derzeitige Legacy-`syncManager`, der nach Connect automatisch `syncAll()` ausführt, ist deshalb nicht als Sicherheitskern wiederzuverwenden.

## 9. Normaler Append

Normaler Commit:

1. fachliche Änderung erzeugen,
2. neue `revision_id` und `envelope_id` erzeugen,
3. Envelope/AAD exakt einmal verschlüsseln,
4. immutable Envelope-Bytes + Hash + Outbox-Item atomar lokal persistieren,
5. sicherstellen, dass Client weiterhin `writer_active` und lokale Generation unverändert ist,
6. exakt diese gespeicherten Bytes appendieren,
7. unabhängig vom HTTP-Ergebnis Remote-Readback/Reconciliation,
8. bei byteidentischem Treffer `remote_seen`,
9. finalen Remote-Prefix erneut vollständig verifizieren,
10. neuen `remote_anchor` atomar zusammen mit `durable`-Status persistieren.

## 10. Unknown Outcome bei Append

Nach Timeout/Netzabbruch:

1. niemals neu verschlüsseln,
2. Remote nach `envelope_id` suchen,
3. genau ein oder mehrere byteidentische Vorkommen -> fachlich einmal akzeptieren; physisch alle Zeilen bleiben Bestandteil des Prefixes,
4. kein Treffer -> exakt gespeicherte Zeile erneut appendieren,
5. gleiche Envelope-ID mit anderen Bytes -> fataler Integritätsfehler.

Ein Netzwerkfehler darf niemals direkt in „fehlgeschlagen, neu erzeugen“ übersetzt werden.

## 11. Deduplizierung

Deduplizierung ausschließlich nach:

```text
envelope_id + Byteidentität
```

Keine Deduplizierung aufgrund gleicher fachlicher Inhalte.

Physische Duplikate nach Unknown Outcome sind zulässig, sofern byteidentisch; sie zählen vollständig zum physischen Prefix.

## 12. Remote Anchor ohne Checkpoint

Das Single-Writer-Profil verwendet keinen `remote_checkpoint`-Envelope.

Nach erfolgreich reconciliertem Append wird der **tatsächlich erneut gelesene und vollständig verifizierte physische Prefix** lokal/Recovery-/Backup-seitig verankert.

Normativer Anchor mindestens:

```text
remote_anchor = {
  anchor_profile: "google-sheets-single-writer-v1",
  covered_row_count,
  prefix_hash
}
```

Die konkrete serialisierte Form darf zusätzliche bereits authentifiziert gebundene Identitätsfelder enthalten, muss aber versioniert und Golden-Vector-getestet sein.

### Prefix Hash

Der Hash bindet Diary/Epoche, physische Zeilennummer, Reihenfolge und exakte kanonische Zeilenbytes. Keine Sortierung/Deduplizierung/Weglassung.

Kanonsiche Zeilenbytes:

```text
canonical_row_bytes = UTF8(JCS([envelope_id, iv, ciphertext]))
```

Die Hash-Kette/Hashdefinition ist exakt einmal zentral zu implementieren und mit Golden Vectors zu testen.

## 13. Warum Checkpoints entfallen

Die v5-Checkpoint-Adjazenz schloss primär das Rennen:

```text
Client A liest Prefix N
Client B appendiert N+1
Client A appendiert Checkpoint über N
```

Unter der normativen Single-Remote-Writer-Annahme ist dieses Rennen zwischen konformen Clients ausgeschlossen.

Daher entfallen:

- `remote_checkpoint`-Control-Envelopes,
- `checkpoint_physical_row == covered_row_count + 1`,
- zweiter Prefix-Read speziell zur Checkpoint-Adjazenz,
- `checkpointed`/`anchor_confirmed` getrennte Terminalstates,
- raced Checkpoint / Checkpoint-Liveness-Protokoll.

Der unabhängige Anchor selbst bleibt zwingend.

## 14. Stale/offline Geräte

Single Writer bedeutet nicht Single Device.

Beispiel:

```text
A offline: R5 -> R6A
B online:  R5 -> R6B -> remote durable
A später online
```

A führt zuerst Pull-before-Push aus und erkennt zwei fachliche Heads. R6A darf nicht verworfen oder durch Timestamp überschrieben werden.

Ergebnis:

```text
      R5
     /  \
   R6A  R6B
      \ /
      R7 merge
```

Revision Graph + expliziter Merge bleiben daher Pflicht.

## 15. Verstoß gegen Single-Writer-Annahme

Wenn Remote-Zustände beobachtet werden, die unter dem eigenen verifizierten lokalen Ablauf nicht möglich sein sollten, z.B. unerwartete nicht ableitbare parallele Control-/Epoch-Zustände:

```text
-> writer_active entziehen
-> Sync fail-closed stoppen
-> Security/Disaster-Zustand anzeigen
-> keine automatische latest-wins-Konvergenz
```

Ein späteres Multi-Writer-Profil kann dafür eine eigene Konvergenz-State-Machine definieren.

## 16. Rotation – Single Writer

Normale Rotation wird vereinfacht.

Pflichtprinzip bleibt:

```text
Copy -> Verify -> Recovery/Backup Test -> Switch
```

Ablauf:

1. lokalen diary-spezifischen Maintenance/Rotation Lock erwerben,
2. alte Epoche vollständig pullen + Anchor verifizieren,
3. lokale Writes während des kritischen Rotationsvorgangs kontrolliert einfrieren/serialisieren,
4. `RK_new` erzeugen und lokal gemäß Sicherheitsmodus gewrappt + Readback-verifiziert persistieren,
5. neue Successor-Epoche + Manifest vorbereiten,
6. Successor-Spreadsheet über Create/Reconciliation eindeutig binden,
7. vollständigen aktuellen semantischen Live-State + erforderliche Tombstones/sensitive Settings in neue Epoche kopieren,
8. Successor vollständig remote readback-verifizieren,
9. Source- und Result-Semantic-Snapshot-Hash vergleichen,
10. finales Recovery-Artefakt für Successor erzeugen und verifizieren,
11. Backup + Test-Restore verifizieren,
12. `rotation_announcement` in alter Epoche appendieren und alten Prefix neu verankern,
13. neue Epoche lokal atomar `active`, alte `retired`,
14. alte Remote-Daten zunächst erhalten; Purge nur nach separater Policy.

## 17. Was bei Rotation gegenüber Multi-Writer-v5 entfällt

Unter Single Writer nicht implementieren:

- `rotation_fence` als Remote-Control-Envelope,
- Fence-Checkpointing,
- `source_cutover_anchor` als Race-Grenze,
- Remote-Late-Branch-Race während Rotation,
- `rotation_abort` als Remote-Control-Envelope,
- parallele Successor-Claims,
- automatische Multi-Source Fork-Convergence.

Crash-Sicherheit bleibt trotzdem erforderlich: lokale Rotation-State-Machine muss erkennen, ob Successor nur staged, bereits gebunden, vollständig verifiziert oder bereits angekündigt/aktiviert ist.

## 18. Rotation Announcement

Der `rotation_announcement` in der alten Epoche bleibt erforderlich, damit ein später zurückkehrendes Gerät mit altem Epoch-Zustand erkennen kann, dass es **nicht mehr in die alte Epoche pushen darf**.

Ein stale Client:

1. pullt alte Epoche,
2. verifiziert Announcement,
3. friert alte Remote-Writes,
4. erwirbt `RK_new` ausschließlich über verifizierten Recovery-/Pairing-Pfad,
5. erhält seine lokalen noch nicht repräsentierten Änderungen,
6. rebased/mergt diese als **neue Envelopes der neuen Epoche**,
7. synchronisiert erst danach wieder.

## 19. Local-only -> Remote Enablement

Eine bestehende local/offline Epoche wird nicht nachträglich in-place an Google gebunden.

Remote Enablement ist Migration in neue Epoche:

```text
local/offline epoch
-> new RK / new epoch
-> create remote
-> copy
-> verify
-> recovery + backup test
-> switch
```

## 20. Legacy-Datenmigration

Der aktuelle Repository-Stand persistiert fachliche Records noch im Klartext in mehreren IndexedDB-Stores und synchronisiert Tabellen teilweise durch Replace-Operationen.

Diese Daten sind **Migrationsquelle**, nicht v1-Zielarchitektur.

Codex muss vor Migration alle tatsächlich persistierten Quellen inventarisieren, inklusive bestehender IndexedDB-Stores und jeglicher `localStorage`-fachlicher Settings.

Migration muss:

- nicht-destruktiv starten,
- keine fachlichen Records verlieren,
- Shadow-/Catch-up-Verfahren verwenden, falls die App während Backfill weiter Daten annehmen kann,
- Ziel-Envelopes verschlüsseln,
- Zielzustand verifizieren,
- Klartextquelle erst nach explizit erfülltem Cutover-Gate als Legacy behandeln,
- keine unverschlüsselte Export-/Zwischendatei erzeugen.

## 21. Providerabstraktion

Providerneutraler Core:

```text
AuthProvider
RemoteTransport
TransportProfileCodec
```

Google-spezifisch:

```text
GoogleAuthProvider
GoogleSheetsSingleWriterTransport
GoogleSheetsSingleWriterProfileCodec
```

Namen dürfen idiomatisch angepasst werden; Grenze nicht.

Core darf keine Google-SDK-/Response-Typen, Tokens, `spreadsheetId`, Google-Fehlerobjekte oder Sheets-Range-Konzepte als eigene Domänentypen kennen.

## 22. Fehlernormalisierung

Provideradapter normalisiert mindestens:

```text
auth_required
permission_denied
not_found
conflict_or_unexpected_remote_change
temporary_failure
rate_limited
unknown_outcome
integrity_failure
provider_incompatible
```

Keine rohe Providerantwort quer durch Core/UI.

## 23. Auth

Google Access Token bleibt RAM-only.

Der aktuelle Prototyp lädt Google Identity direkt in der App. Für die produktionsfähige Sicherheitsarchitektur gilt die bestehende Entscheidung: Auth-Flow/Google-JavaScript auf separaten statischen Auth-Origin isolieren; Hauptorigin enthält entsperrten Crypto-/Klartextzustand.

Auth-Handoff ist request-/action-gebunden, replay-resistent und darf keine medizinischen Daten, Root Keys oder URS transportieren.

## 24. Keine automatische Remote-Mutation beim Connect

Login/Connect bedeutet **nicht** Push.

Nach Connect:

```text
authenticated
-> remote binding discovery
-> full pull + verify
-> local/remote reconciliation
-> writer_active
-> optional pending push
```

Bestehendes `syncAll()`-on-connect Verhalten muss entsprechend ersetzt werden.

## 25. Provider-/User-Manipulation

Nutzer kann sein Sheet löschen, editieren, Zeilen verschieben oder Zellen manipulieren. Provider kann Daten auslassen/rollbacken.

EDS behandelt jede Remote-Struktur als untrusted.

- AEAD-Fehler -> stop,
- Manifest-Fingerprint mismatch -> stop,
- Prefix mismatch gegen gepinnten Anchor -> rollback/integrity stop,
- fehlende/umgeordnete/veränderte geankerte Zeile -> stop,
- keine automatische Rückkehr auf älteren Anchor.

Globale Freshness kann nicht garantiert werden, wenn sämtliche unabhängigen neueren Anchor-/Backup-/Gerätekopien verloren gehen.

## 26. Remote Purge / Delete

Normales fachliches Löschen ist Tombstone/Revision, kein physisches Entfernen alter Remote-Zeilen.

Kryptographischer Purge/Compaction ist separate Migration/Rotation und nicht Bestandteil des normalen Syncpfads.

## 27. Bounds / hostile input

Remote- und Importparser müssen harte Bounds besitzen. Keine angreiferkontrollierte unbounded Rekursion oder riesige JSON-/Grid-Allokation.

Revision Graph mindestens:

- max. 8 Parents pro Revision,
- keine Duplicate/Self-Parents,
- Cross-Type/Cross-Record-Parents ablehnen,
- doppelte `revision_id` in unterschiedlichen Envelopes fatal,
- Zyklen iterativ erkennen,
- max. 4096 Revisionen pro Record,
- max. Tiefe 4096.

## 28. Definition Remote Durable

Ein fachliches Envelope gilt in diesem Profil erst als remote durable, wenn:

1. dessen byteidentische Remote-Existenz reconciliert wurde,
2. danach der vollständige Remote-Prefix erneut gelesen und verifiziert wurde,
3. der neue Prefix-Anchor lokal authentifiziert atomar persistiert wurde.

HTTP `200` allein ist **kein Durable-Ack**.

## 29. Nicht-Ziele v1

Nicht implementieren, solange kein expliziter Folgeauftrag vorliegt:

- Multi-Remote-Writer-Support,
- Checkpoint-Control-Envelopes,
- Rotation Fence,
- parallele Successor-Konvergenz,
- automatische Fork-Reparatur,
- OneDrive/Dropbox/Firestore Transport,
- Providerwechsel innerhalb einer Epoche.

## 30. Upgradefähigkeit

Code muss so strukturiert sein, dass ein späteres `google-sheets-multi-writer-v2`-Profil neue Durability-/Checkpoint-/Rotation-Komponenten ergänzen kann, ohne Crypto Core, UI-Fachlogik oder bestehende Single-Writer-Epochen umzudeuten.
