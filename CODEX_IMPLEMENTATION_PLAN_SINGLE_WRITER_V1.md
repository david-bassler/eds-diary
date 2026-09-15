# Codex Implementation Plan – EDS Diary Google Sheets Single-Writer v1

Stand: 15.09.2026

## Auftrag

Arbeite diesen Plan vollständig ab.

Du arbeitest im Repository `eds-diary`, einer React-/TypeScript-Webanwendung für sensible Gesundheitsdaten. Ziel ist die **erste produktionsnahe Implementierung des verschlüsselten EDS-Syncs über Google Sheets im bewusst vereinfachten Single-Remote-Writer-Profil**.

Dieser Auftrag ist absichtlich so formuliert, dass keine zusätzliche mündliche Einweisung erforderlich ist.

---

# 1. Zuerst lesen – verbindliche Reihenfolge

Lies vollständig und halte dich an diese Reihenfolge:

1. `AGENTS.md`
2. `docs/security/EDS_CRYPTO_PROFILE_V5.md`
3. `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
4. `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`
5. `docs/security/LEGACY_V5_ASSURANCE_REPORT.md`
6. danach den relevanten bestehenden Code im gesamten Repo

## Priorität bei Widersprüchen

1. Security-/Crypto-Regeln in `EDS_CRYPTO_PROFILE_V5.md`
2. Single-Writer-Protokoll in `EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
3. Assurance-/Testplan
4. `AGENTS.md`
5. bestehender Code

Bestehender Code ist **nicht** automatisch Source of Truth. Der vorhandene Google-/Sync-/IndexedDB-Code ist teilweise ein Legacy-/Prototype-Pfad und muss kontrolliert migriert werden.

Wenn eine erforderliche Änderung eine nicht spezifizierte Security-/Crypto-Entscheidung braucht, erfinde keine neue Protokollregel. Markiere sie im Abschlussbericht als:

```text
SECURITY/SPEC DECISION REQUIRED
```

und implementiere an der Stelle fail-closed, soweit möglich.

---

# 2. Kernentscheidung dieses Auftrags

Die erste Remote-Sync-Version unterstützt mehrere Geräte **nacheinander**, aber nicht gleichzeitig schreibend.

Normative Annahme:

> Zu jedem Zeitpunkt besitzt höchstens ein konformer EDS-Client Remote-Schreibautorität für ein Diary. Vor jeder Aufnahme der Schreibautorität muss dieser Client den aktuellen Remote-Zustand vollständig pullen, kryptographisch verifizieren und gegen den lokalen Anchor reconciliieren.

Das Profil heißt:

```text
google-sheets-single-writer-v1
```

Nicht implementieren:

- Multi-Remote-Writer,
- Remote-Checkpoints,
- Checkpoint-Adjazenz,
- Rotation Fence,
- Remote-Late-Branch-Races,
- parallele Successor-Rotation,
- automatische Remote-Fork-Konvergenz.

Trotzdem beibehalten:

- fachlichen Revision Graph,
- mehrere fachliche Heads,
- explizite Merge-Revisionen,
- Offline-Konflikte zwischen Geräten,
- Pull-before-Push,
- immutable Envelopes,
- Unknown Outcome Reconciliation,
- Recovery,
- Backup,
- Rotation,
- Provider-Abstraktion.

---

# 3. Wichtiger Befund zum aktuellen Repository

Der bestehende Code enthält bereits einen Google-/Sync-Prototypen, insbesondere u.a.:

```text
src/data/googleSheets.ts
src/data/syncManager.ts
src/data/localDatabase.ts
src/features/**/**Sync.ts
```

Zum Zeitpunkt dieses Plans gilt insbesondere:

- `localDatabase.ts` persistiert fachliche Records in mehreren IndexedDB-Stores noch im Klartext;
- `googleSheets.ts` arbeitet mit normalen fachlichen Tabellen/Headers und Replace-/Load-Operationen;
- Google Access Token ist bereits RAM-only, was beibehalten werden soll;
- `syncManager.ts` kann nach Connect automatisch `syncAll()` auslösen;
- featurebezogene Sync-Module synchronisieren fachliche Tabellen, nicht das neue verschlüsselte Envelope-Protokoll.

Diese Pfade dürfen **nicht einfach weiterverwendet und nur oberflächlich verschlüsselt** werden.

Ziel ist ein kontrollierter Übergang zu:

```text
UI / Domain
   ↓
Revision + Envelope Layer
   ↓
Encrypted local persistence / Outbox
   ↓
Sync Coordinator
   ↓
RemoteTransport
   ↓
GoogleSheetsSingleWriterTransport
```

---

# 4. Arbeitsweise

Arbeite selbständig bis zum bestmöglichen vollständigen Ergebnis.

Nicht nach jeder Kleinigkeit um Bestätigung bitten.

Bei normalen Implementierungsdetails wähle eine kleine idiomatische Lösung passend zum bestehenden React-/TypeScript-/Vite-Projekt.

Bei Security-/Crypto-Semantik gilt dagegen strikt die Spezifikation.

Verändere keine fachlich unabhängigen UI-Features ohne Not.

Keine Frameworkmigration.

Keine unnötige Dependency-Welle.

Keine Tests löschen oder abschwächen, um grün zu werden.

Keine Golden Vectors ändern, nur damit Implementierung passt.

---

# 5. Phase A – Repository Audit

Bevor du den Kernrefactor beginnst:

1. gesamten `src/`-Baum erfassen,
2. alle Persistenzpfade finden,
3. alle `localStorage`-/`sessionStorage`-/IndexedDB-Nutzungen finden,
4. alle Google API-/GIS-Nutzungen finden,
5. alle Sync-Featuremodule finden,
6. alle fachlichen Entitäten/Repositories finden,
7. alle bestehenden Tests/Stories/Playwright-Journeys erfassen,
8. Hosting-/Auth-Origin-Konfiguration erfassen,
9. bestehende Build-/Lint-/Test-Baseline ausführen.

Erstelle während der Arbeit eine Datei:

```text
docs/security/IMPLEMENTATION_AUDIT_SINGLE_WRITER_V1.md
```

mit mindestens:

| Bereich | bestehende Datei(en) | Ist-Zustand | Ziel | Maßnahme |
|---|---|---|---|---|

Wenn du bereits vor dem Refactor einen sicherheitskritischen Verstoß findest, dokumentiere ihn dort ausdrücklich.

---

# 6. Phase B – Baseline ausführen

Mindestens:

```bash
npm install
npm run build
npm run lint
npm run build-storybook
npm run test:e2e
```

Wenn Playwright-Browser fehlen, installiere Chromium sofern die Umgebung das zulässt.

Dokumentiere bestehende Fehler vor deinen Änderungen.

Behaupte nie einen erfolgreichen Test, den du nicht wirklich ausgeführt hast.

---

# 7. Phase C – Sicherheitsarchitektur im Code einziehen

Zielgrenzen:

```text
Crypto Core
Revision/Envelope Core
Local Secure Store
Sync Coordinator
AuthProvider
RemoteTransport
TransportProfileCodec
Google adapter
```

Die genaue Ordnerstruktur darf an das Projekt angepasst werden. Bevorzuge klar benannte Feature-/Security-/Sync-Module statt eines riesigen `utils.ts`.

## Providergrenze

Der providerneutrale Core darf keine Google-spezifischen Typen/SDKs/Tokens/API-Responses kennen.

Mindestens konzeptionell:

```ts
interface AuthProvider {
  authenticate(...): Promise<...>
  getIdentityBinding(...): Promise<...>
  disconnect(...): Promise<void>
}

interface RemoteTransport {
  // providerneutrale Operationen für das aktive Transportprofil
}

interface TransportProfileCodec {
  // Mapping zwischen providerneutralem Core-Zustand und Google-Wireprofil
}
```

Keine Pflicht, exakt diese Signaturen zu übernehmen; semantische Grenze ist Pflicht.

Google-spezifischer Code bleibt im Adapter.

Füge Architektur-/Static-Tests hinzu, die direkte Google-Imports außerhalb des vorgesehenen Adapterbereichs erkennen.

---

# 8. Phase D – Kryptographie implementieren

Implementiere exakt nach:

`docs/security/EDS_CRYPTO_PROFILE_V5.md`

Pflichtbausteine mindestens:

- CSPRNG-Helfer,
- kanonische Bytekodierung,
- SHA-256,
- HMAC-SHA-256,
- HKDF-SHA-256,
- AES-256-GCM,
- Envelope-ID-Reservierung,
- per-Envelope-Key-Ableitung,
- one-shot Encrypt API,
- Recovery-URS-/Commitment-Grundbausteine,
- lokaler State-MAC-Key / State-Authentisierung,
- Golden-Vector-Tests.

Nutze WebCrypto für Standardprimitive.

Für Argon2id ist eine begründete, gepflegte, lokal gebündelte Implementierung zulässig; keine Runtime-CDN-Abhängigkeit.

## Absolute Verbote

- Re-encrypt on retry,
- `Math.random()` für Security IDs,
- Root Key Klartextpersistenz,
- URS Klartextpersistenz im normalen Profil,
- ad-hoc Crypto aus eigener Konstruktion,
- stilles Ändern von AAD/Domain-Separators.

---

# 9. Phase E – Revision-/Envelope-Modell

Führe einen providerneutralen fachlichen Revision Layer ein.

Er muss mindestens unterstützen:

- immutable revisions,
- `record_id`,
- `revision_id`,
- `parent_revision_ids`,
- Tombstones,
- Merge-Revisionen,
- mehrere Heads,
- Validierung/Beschränkung hostile graphs,
- keine LWW-Entscheidung nach Sheet Row oder Timestamp.

Bestehende UI-/Repository-APIs dürfen über Adapter vorerst möglichst stabil gehalten werden, aber die neue sichere Persistenz muss die Source of Truth werden.

---

# 10. Phase F – verschlüsselte lokale Persistenz

Aktueller Klartext-IDB-Zustand ist Legacy-Migrationsquelle.

Baue neue Stores/Schema für mindestens:

- verschlüsselte immutable Envelopes,
- Envelope Journal,
- technische Indizes,
- Outbox/Delivery State,
- Epoch Security State,
- Remote Binding,
- Remote Anchor,
- Rotation/Migration State,
- Recovery-Metadaten ohne Klartext-URS/RK.

Sicherheitsrelevanter lokaler State wird MAC-authentifiziert.

Alle sicherheitsrelevanten Mutationen unter diary-spezifischem Web Lock + Re-Read.

Nach asynchronem Netz-I/O Generation/State erneut prüfen, bevor Callback lokalen Security-State verändert.

---

# 11. Phase G – Legacy-Migration

Inventarisiere alle bestehenden Persistenzquellen, nicht nur die offensichtlichen Stores.

Beachte auch fachliche Settings in `localStorage`, falls vorhanden.

Migration muss crashsicher und nicht-destruktiv sein.

Wenn laufende UI-Schreibvorgänge während Backfill möglich bleiben, verwende Baseline + Dirty-Generation/Catch-up oder ein äquivalentes Verfahren, sodass keine Änderung zwischen altem und neuem Store verloren geht.

Nach erfolgreichem Cutover darf neue fachliche Persistenz nicht weiter in Legacy-Klartextstores schreiben.

Legacy-Daten nicht automatisch physisch löschen, solange kein explizites, getestetes Purge-Gate existiert.

---

# 12. Phase H – Google Auth

Behalte Least Privilege:

```text
https://www.googleapis.com/auth/drive.file
```

Access Token RAM-only.

Kein Token in localStorage/IndexedDB/URL.

Produktionsziel gemäß Security-Spec:

- Google Identity auf separatem statischem Auth-Origin,
- Hauptorigin bleibt frei von unnötigem Google-Runtime-JavaScript,
- request-/action-gebundener Handoff,
- keine Health-/Crypto-Secrets im Handoff.

Wenn die vollständige Origin-Aufteilung in der aktuellen Hostingumgebung nicht sinnvoll abschließbar ist, implementiere die Modulgrenze und fail-closed/feature-gated Integrationsstelle sauber und dokumentiere den verbleibenden Release-Blocker. Nicht still die Security-Anforderung löschen.

---

# 13. Phase I – Google Sheets Single-Writer Transport

Implementiere exakt das Profil aus:

`docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`

Remote-Struktur:

```text
_m = immutable Manifest
_r = append-only encrypted Envelope Log
```

Keine fachlichen Klartexttabellen mehr im neuen Remote-Profil.

Keine Whole-table-Replace-Semantik für sichere Syncdaten.

## Create/Reconciliation

Implementiere `creation_locator`-/Candidate-Reconciliation crashsicher.

Solange keine eindeutig authentisierte kanonische `file_id` gebunden ist, sind Record-Appends verboten.

## Append

Nur bereits lokal persistent vorbereitete Ciphertextbytes senden.

Nach jeder externen Mutation Unknown Outcome berücksichtigen.

HTTP 2xx allein ist kein Durable-Ack.

## Anchor

Nach Append:

- Remote vollständig innerhalb Bounds lesen,
- Struktur/AEAD/Graph verifizieren,
- exakten physischen Prefix hashen,
- Anchor + `durable` atomar lokal persistieren.

Keine Remote-Checkpoint-Envelopes in v1.

---

# 14. Phase J – Sync Coordinator

Ersetze die unsichere Semantik des aktuellen `syncManager`.

Zielzustände ungefähr:

```text
local_locked/local_only
authenticated
remote_verifying
remote_verified
writer_active
syncing
synced
conflict
security_blocked
error
```

Exakte Namen frei.

Wichtig:

```text
Google Connect != Push
Browser online != Push
```

Immer:

```text
Connect/Online
-> Pull
-> Verify
-> Reconcile
-> Writer aktivieren
-> dann erst Pending Push
```

Single Writer ist eine Protokollannahme, kein Mutex von Google. Bei beobachteter unerwarteter Remote-Fork-/Concurrency-Semantik fail-closed.

---

# 15. Phase K – Offline-Konflikte und Merge

Mehrere Geräte dürfen nacheinander verwendet werden und lokale Offline-Änderungen mitbringen.

Wenn nach Pull mehrere fachliche Heads existieren:

- alle bewahren,
- keine Row-/Timestamp-LWW-Regel,
- Merge explizit durch Domainlogik/UI soweit nötig,
- Merge-Revision hat alle relevanten Parent-IDs.

Wenn ein vollständig generischer Konflikt-UI-Flow den Scope sprengt, muss der Core den Konflikt sicher repräsentieren und Writes blockieren, bis eine vorhandene oder minimal implementierte Merge-Auflösung entscheidet. Niemals still Daten verlieren.

---

# 16. Phase L – Recovery

Implementiere/integriere die v5-Recovery-Regeln einschließlich:

- 256-Bit URS,
- Recovery KDF,
- Recovery AEAD,
- `recovery_urs_commitment`,
- Recovery Generation,
- vollständige Bootstrap-Verifikation vor Aktivierung eines RK,
- Remote Anchor Bindung für remote aktive Epoche,
- frisches Profil wiederherstellbar.

Ein beliebiger falscher 32-Byte-Wert darf niemals dadurch als gültige URS erscheinen, dass damit ein neues Artefakt erzeugt und selbst wieder entschlüsselt werden kann.

---

# 17. Phase M – lokale Sicherheitsmodi

Implementiere soweit im aktuellen Produktumfang sinnvoll:

1. Best-Effort,
2. Strong WebAuthn-PRF,
3. Strong Passphrase Fallback.

Keine falsche Security-Copy.

Best-Effort ist keine starke Grenze gegen vollständige Browserprofilkopie.

WebAuthn PRF muss nach Enrollment tatsächlich verifiziert werden.

Passphrase Argon2id exakt gemäß Crypto-Spec.

Wenn UI dafür neu nötig ist, halte sie funktional und zugänglich; kein unnötiges Redesign.

---

# 18. Phase N – Rotation

Implementiere die vereinfachte Single-Writer-Rotation:

```text
Pull/Verify old
-> create/wrap RK_new
-> create/reconcile successor
-> copy complete semantic state
-> verify successor
-> recovery verify
-> backup + test restore
-> append rotation_announcement to old
-> anchor old
-> atomic local switch
-> old retired
```

Nicht implementieren:

- rotation_fence,
- checkpointed fence,
- cutover race anchor,
- remote late-branch race,
- remote rotation_abort,
- parallel successor convergence.

Crash Resume State explizit persistieren und testen.

Stale Gerät nach Announcement: alte Writes stoppen, neuen RK verifiziert erwerben, eigene lokale nicht repräsentierte Änderungen in neuer Epoche neu envelopen/rebasen.

---

# 19. Phase O – Backup / Restore

Backup bleibt getrennt vom normalen Google Sync.

Behalte/implementiere:

- verschlüsseltes Backup,
- harte Größen-/Parsergrenzen,
- keine unbounded `Response.text()`/riesiges `JSON.parse()` für produktive große Backups,
- nicht-destruktiver Restore,
- Test-Restore als Rotation-/Release-Gate,
- vollständigen lokalen Envelope-Bestand berücksichtigen, nicht nur Outboxflags.

---

# 20. Phase P – Tests

Arbeite vollständig den Testplan ab:

`docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`

Füge eine kleine Unit-Test-Infrastruktur hinzu, falls noch keine existiert.

Erforderlich sind insbesondere:

- Crypto Golden Vectors,
- one-shot Envelope Tests,
- Create/Reconciliation Tests,
- Unknown Outcome Tests,
- Pull-before-Push Tests,
- Anchor/Rollback Tests,
- Offline-Conflict Tests,
- Rotation Crash/Resume Tests,
- Recovery Tests,
- Legacy Migration Tests,
- Provider-Architecture Tests.

Nutze Fake/In-Memory-Provider für Coretests.

Live-Google-Integrationstests klar separat markieren und nicht für normale CI voraussetzen.

---

# 21. Phase Q – State-Machine / formale Assurance

Die alte vollständige Multi-Writer-TLA+-Suite ist historische Referenz und muss für v1 nicht reaktiviert werden.

Erstelle stattdessen ein kleines, überprüfbares Single-Writer-State-Machine-Modell oder exhaustive model-based tests für mindestens:

- höchstens ein Writer,
- Pull-before-Push,
- Durable Ack nur nach Readback+Anchor,
- Unknown Outcome Retry derselben Bytes,
- Rotation ohne alten-epoch Push nach Announcement,
- kein stiller Verlust fachlicher Offline-Heads,
- fail-closed bei unerwarteter Fork-Semantik.

Wenn TLA+ Tooling im Repo/Environment praktikabel ist, darfst du TLA+ verwenden; sonst model-based exhaustive TypeScript Tests. Dokumentiere die Grenze ehrlich.

---

# 22. Phase R – Security- und Architektur-Gates

Füge statische oder Test-Gates hinzu für mindestens:

- keine Google-SDK-/API-Typen im Core,
- keine direkten Sheets-Aufrufe außerhalb Adapter,
- kein offensichtlicher neuer Klartext-Health-Storage-Pfad,
- keine Tokens/URS/RK in Logging,
- kein Re-encrypt-on-retry-Codepfad,
- keine direkte Remote-Mutation aus Connect/Online Callback vor Verify.

Bevorzuge robuste Architekturtests gegenüber fragiler bloßer Textsuche; einfache zusätzliche Grep-Gates sind als Defense-in-Depth okay.

---

# 23. Phase S – Production Security

Prüfe den aktuellen Hostingpfad.

Produktionsziel braucht kontrollierbare Security Header/CSP. Kein Release-Claim „production secure“, solange die erforderlichen Header/Origin-Isolation nicht umgesetzt sind.

Dokumentiere in:

```text
docs/security/PRODUCTION_SECURITY_RELEASE_GATES.md
```

mindestens:

- CSP,
- Auth-Origin,
- Dependency/Runtime JS,
- Referrer Policy,
- Permissions Policy soweit relevant,
- Build/Dependency Pinning,
- Source Maps/Logs,
- Token Storage,
- XSS-sensitive Rendering,
- noch offene Release-Blocker.

---

# 24. Kein unnötiges Redesign

Die existierende App-Funktionalität für Schmerzen, Aktivitäten, Medikamente usw. soll erhalten bleiben.

Neue Security-/Sync-UI nur dort, wo erforderlich:

- Lock/Unlock,
- Local Security Mode,
- Google Connect/Disconnect,
- Sync Status,
- Conflict/Security Block,
- Recovery,
- Backup/Restore,
- Rotation/Migration Status.

WCAG/AGENTS-Regeln beachten.

---

# 25. Definition of Done

Der Auftrag ist erst abgeschlossen, wenn soweit in der verfügbaren Umgebung realistisch:

- bestehende fachliche App weiterhin funktioniert,
- neuer sicherer lokaler Datenpfad Source of Truth ist,
- Legacy-Klartextpfad kontrolliert migriert wurde,
- neue fachliche Persistenz nicht mehr im Klartext erfolgt,
- Crypto-Profil implementiert und getestet ist,
- Google Sheets `_m`/`_r` Single-Writer-Profil implementiert ist,
- Pull-before-Push erzwungen wird,
- Unknown Outcome korrekt reconciliert wird,
- Anchor/Rollback-Erkennung funktioniert,
- Offline-Fachkonflikte erhalten bleiben,
- Recovery implementiert/getestet ist,
- Rotation Single-Writer crashsicher ist,
- Backup/Restore-Gates vorhanden sind,
- Provider-Abstraktion vorhanden ist,
- Security-/Architecture-Tests vorhanden sind,
- Build/Lint/relevante Tests grün sind,
- keine Tests künstlich abgeschwächt wurden,
- keine persönlichen/medizinischen Echtdaten oder Secrets committed wurden.

Wenn ein Teil wegen externer Credentials/Hosting nicht live testbar ist, muss die lokale/Fake-/Contract-Abdeckung vollständig sein und der verbleibende Live-Gate präzise dokumentiert werden.

---

# 26. Abschlussbericht

Erstelle am Ende:

```text
docs/security/IMPLEMENTATION_REPORT_SINGLE_WRITER_V1.md
```

Struktur:

## A. Ausgangszustand

Welche Legacy-/Prototype-Pfade waren vorhanden?

## B. Architektur nach Implementierung

Module und Verantwortlichkeiten.

## C. Migration

Welche Altstores/-pfade wurden migriert und wie crashsicher?

## D. Kryptographie

Welche v5-Bausteine sind implementiert? Welche Golden Vectors laufen?

## E. Google Transport

Create/Reconciliation, Append, Readback, Prefix, Anchor.

## F. Single-Writer-Grenze

Wie wird Pull-before-Push erzwungen? Wie wird unerwartete Concurrency behandelt?

## G. Recovery / Rotation / Backup

Konkreter Stand.

## H. Tests

Exakte ausgeführte Befehle und Resultate.

## I. Security Review Checklist

Die 12 Punkte aus `EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md` explizit beantworten.

## J. Offene Punkte / Release Blocker

Nichts verschweigen.

## K. SECURITY/SPEC DECISION REQUIRED

Falls leer, ausdrücklich `keine` schreiben.

---

# 27. Letzte Regel

**Implementiere die vorhandene Sicherheitsarchitektur; erfinde sie nicht während des Codings neu.**

Wenn ein einfacher Prototypweg der Spezifikation widerspricht, gewinnt die Spezifikation.

Wenn eine Funktion noch nicht sicher abschließbar ist, blockiere sie fail-closed und dokumentiere den Grund, statt eine unsichere Abkürzung einzubauen.
