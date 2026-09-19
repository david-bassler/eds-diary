# EDS Diary – Assurance- und Testplan für Google Sheets Single-Writer v1

Stand: 15.09.2026

Status: **NORMATIV für die Implementierungsfreigabe.**

Dieser Plan ersetzt nicht die Security-Spezifikation. Er definiert die Nachweise, die eine Implementierung liefern muss.

## 1. Grundsatz

Tests beweisen keine Kryptographiesicherheit. TLA+/State-Machine-Modelle beweisen nur Eigenschaften des modellierten Zustandsraums. Golden Vectors beweisen Byte-Kompatibilität, nicht Kryptanalyse.

Die Implementierung darf trotzdem erst als abgeschlossen gelten, wenn die hier definierten Gates erfüllt sind.

## 2. Baseline vor Änderung

Codex muss vor größeren Änderungen mindestens ausführen und Ergebnis dokumentieren:

```bash
npm install
npm run build
npm run lint
npm run build-storybook
npm run test:e2e
```

Falls ein Befehl aus Umweltgründen nicht ausführbar ist, Ursache dokumentieren und alle unabhängigen Checks trotzdem ausführen.

Bestehende Fehler werden als Baseline dokumentiert und nicht dem neuen Code zugeschrieben.

## 3. Normative Testkategorien

### A. Crypto / Byte-Level

Pflicht:

- HKDF-Domainseparation für Envelope Keys,
- ein Golden Vector für `epoch_salt`,
- ein Golden Vector für `K_env`,
- AES-GCM Envelope Golden Vector inkl. AAD,
- kanonische Envelope-/Wrapper-Serialisierung,
- Recovery-URS-Commitment Golden Vector,
- Prefix-Hash Golden Vector,
- Anchor-Encoding Golden Vector,
- Rotation-Announcement Golden Vector.

Wenn bestehende normative v5 Golden Vectors verfügbar sind, müssen diese unverändert übernommen werden. Änderungen nur nach `SECURITY/SPEC DECISION REQUIRED`.

### B. Envelope one-shot

Tests:

1. Envelope-ID wird vor Verschlüsselung persistent reserviert.
2. Retry sendet exakt dieselben IV/Ciphertext-Bytes.
3. Derselbe Envelope-Key darf nicht für neue Verschlüsselung wiederverwendet werden.
4. Gleiche `envelope_id` + andere Bytes -> fatal.
5. Crash nach Reservierung, vor Verschlüsselung -> sichere Fortsetzung oder bewusst orphaned; niemals Wiederverwendung für anderen Klartext.
6. Crash nach Verschlüsselung, vor Remote-Append -> dieselben persistierten Bytes werden später gesendet.

### C. Create/Reconciliation

Mindestens:

1. Create erfolgreich + Antwort erfolgreich.
2. Create erfolgreich + Antwort verloren.
3. Create nicht erfolgt + Antwort verloren.
4. Retry nach `creation_pending` reconciliiert zuerst.
5. genau ein authentisch passender Kandidat -> bind.
6. kein Kandidat -> weiterhin pending / sicherer Retry.
7. zwei authentisch plausible Kandidaten -> ambiguous/fail-closed.
8. Kandidat mit falschem Manifest/Fingerprint -> nicht binden.
9. Titel/modifiedTime allein entscheidet niemals.

### D. Pull-before-Push

Mindestens:

1. Connect löst keinen direkten Push aus.
2. Online-Event löst keinen direkten Push vor erfolgreicher Remote-Verifikation aus.
3. stale lokaler Anchor -> Pull/Verify vor Push.
4. manipuliertes Manifest -> writer bleibt disabled.
5. manipulierte/fehlende/geänderte geankerte Zeile -> writer bleibt disabled.
6. Rotation Announcement -> alte Epoche writer disabled.

### E. Append / Unknown Outcome

Mindestens:

1. Append + 200 + Readback.
2. Append serverseitig erfolgreich + Client Timeout -> Readback findet identische Zeile -> Erfolg.
3. Append serverseitig nicht erfolgt + Timeout -> Readback leer -> exakt dieselben Bytes erneut appendieren.
4. Retry erzeugt kein neues Envelope/IV/Ciphertext.
5. mehrere byteidentische physische Duplikate -> fachlich einmal, Prefix enthält alle.
6. gleiche Envelope-ID mit anderen Bytes -> fatal.
7. Provider 429/5xx -> technische Retry-Policy ohne semantische Neuverschlüsselung.

### F. Remote Anchor

Mindestens:

1. Anchor wird erst nach finalem vollständigem Prefix-Read geschrieben.
2. Anchor + Outbox Durable-Status in einer lokalen atomaren Transaktion.
3. fehlende geankerte Zeile -> fatal rollback/integrity.
4. geänderte geankerte Bytes -> fatal.
5. umgeordnete Zeile -> Prefix mismatch.
6. zusätzlicher legitimer Nachfolgerprefix -> zulässig nach vollständiger Verifikation.
7. kein stilles Downgrade auf älteren Anchor.

### G. Single-Writer-Verletzung

Simulierter unerwarteter Remote-Zustand, der unter eigenem Ablauf nicht erklärbar ist:

- keine automatische latest-wins-Reparatur,
- `writer_active=false`,
- expliziter Security/Disaster-Status,
- lokale pending Daten bleiben erhalten.

### H. Offline fachlicher Konflikt

Szenario:

```text
R5
A offline -> R6A
B remote  -> R6B
A später online
```

Erwartung:

- beide Heads bleiben erhalten,
- keine Timestamp-/Row-order-Entscheidung,
- Merge-Revision referenziert beide Parents,
- alter Klartext/alte Envelopes bleiben immutable.

### I. Rotation

Mindestens Crash-/Resume-Punkte:

1. vor `RK_new` persistiert,
2. nach `RK_new` wrapped/readback,
3. nach Successor-Create unbekanntes Ergebnis,
4. nach Bindung, vor Copy,
5. während Copy,
6. nach Copy, vor Verify,
7. nach Verify, vor Recovery,
8. nach Recovery, vor Backup/Test-Restore,
9. nach Announcement-Append unknown outcome,
10. nach Announcement durable, vor lokalem Switch,
11. nach lokalem Switch.

Pflicht:

- alter funktionierender Zustand wird vor Switch nicht destruktiv gelöscht,
- Successor enthält vollständigen semantischen Live-State,
- normale Rotation erhält semantischen Snapshot,
- Recovery auf frischem Profil ohne alten RK funktioniert,
- stale Gerät schreibt nach Announcement nicht in alte Epoche.

### J. Recovery

Mindestens:

- korrekte URS -> Commitment match,
- falsche 32-Byte-URS darf sich nicht selbst bestätigen,
- Recovery-Artefakt AEAD allein aktiviert RK nicht,
- Remote/Backup-Bootstrap wird vollständig verifiziert,
- manipuliertes Recovery-Artefakt -> fail-closed,
- falscher Remote Anchor -> fail-closed.

### K. Lokale Sicherheitsmodi

Best-Effort:

- UI behauptet keine starke Profilkopie-Sicherheit.

WebAuthn PRF:

- Unsupported PRF wird tatsächlich erkannt,
- `userVerification=required`,
- falsche Credential-ID fail-closed,
- PRF post-enrollment verification vorhanden.

Passphrase:

- Argon2id Parameter exakt,
- kein trim/normalization,
- Mindest-/Maximalgrenzen,
- falsche Passphrase durch AEAD/State-Verifikation abgelehnt.

### L. Legacy-Migration

Die historische Vor-v1-Ausgangsbasis enthielt Klartext-IndexedDB und Whole-Table-Google-Sync. Der heutige Zielpfad ist bereits auf verschlüsselte Envelopes migriert; diese Tests bleiben als Regression-/Fresh-Profile-Gate verbindlich und müssen beweisen:

1. alle bestehenden fachlichen Stores werden inventarisiert,
2. Migration verliert keine Records,
3. während Backfill neu eingehende Änderungen werden nicht verloren,
4. Ziel ist verschlüsselt,
5. alter Klartextpfad wird nach Cutover nicht mehr weitergeschrieben,
6. keine Klartext-Zwischendateien,
7. Migration ist wiederanlaufbar nach Crash,
8. UI zeigt nicht fälschlich „sicher migriert“, bevor Verify abgeschlossen ist.

### M. Provider-Abstraktion

Static/architecture tests:

- kein Google SDK/Token/API-Type im providerneutralen Core,
- keine direkten Sheets-Aufrufe außerhalb des Google-Adapters,
- Fake/In-Memory Transport für Core-Tests,
- Contract Tests für Google Adapter,
- Google Wire/Transport Profile getrennt vom fachlichen Core.

### N. Sensitive Data Leakage

Tests/Static checks soweit praktikabel:

- kein fachlicher Klartext in `localStorage`,
- kein fachlicher Klartext in neuen Ziel-IDB-Stores,
- kein Klartext in URL/Query/Fragment,
- keine Access Tokens/URS/RK in Logs,
- keine fachlichen Strings an Analytics/Error Reporting,
- kein `dangerouslySetInnerHTML` für fachliche Strings ohne separate Sanitizer-Entscheidung.

## 4. Formales Modell

Die alte v5-Multi-Writer-TLA+-Suite bleibt historische Assurance-Referenz, ist aber nicht 1:1 der neue normative State-Machine-Nachweis.

Für Single-Writer v1 soll mindestens ein kleines neues Modell oder äquivalenter exhaustive state-machine test die folgenden Invarianten abdecken:

### ASSUMPTION-SW-001 – One Remote Writer

v1 **erzwingt** über mehrere Geräte keinen exklusiven Writer-Lease. Das formale
v1-Normalmodell nimmt deshalb für Remote-Mutationen höchstens einen konformen
aktiven Remote-Writer gleichzeitig an. Stale/offline Geräte dürfen lokale Forks
besitzen; nach erneutem Pull können fachliche Forks explizit gemergt werden.

Wird die Single-Remote-Writer-Annahme bei Control-/Epoch-Operationen verletzt,
muss v1 fail-closed gehen. Kryptographisch gefencete geräteübergreifende
Writer-Exklusivität ist ausdrücklich Ziel von
`google-sheets-transferable-single-writer-v2`, nicht eine bereits erfüllte
v1-Invariante.

### INV-SW-002 – Pull-before-Push

Kein Remote Append aus einem Zustand, der nicht zuvor denselben aktuellen Remote-Prefix/Anchor verifiziert hat.

### INV-SW-003 – Durable Ack

`durable` impliziert byteidentische Remote-Existenz + final verifizierten Prefix + atomar persistierten Anchor.

### INV-SW-004 – Unknown Outcome Safety

Timeout kann zu Retry derselben Bytes führen, niemals zu neuer Verschlüsselung unter derselben Envelope-ID.

### INV-SW-005 – Rotation Safety

Vor Switch ist alter Zustand weiterhin recoverbar; nach verifiziertem Announcement darf kein konformer stale Client fachlich in die alte Epoche pushen.

### INV-SW-006 – No Silent Conflict Loss

Offline entstandene parallele fachliche Heads werden nicht durch physische Reihenfolge/Timestamps entfernt.

### INV-SW-007 – Fail-closed unexpected fork

Nicht aus dem eigenen verifizierten Ablauf ableitbarer Remote-Zustand deaktiviert Writer statt latest-wins.

## 5. CI Gates

Mindestens folgende Checks müssen in CI oder reproduzierbaren npm-Scripts verfügbar sein:

```text
build
typecheck
eslint
stylelint
unit tests
crypto/golden-vector tests
provider architecture/static tests
sync state-machine tests
Playwright critical journeys
```

Falls Vitest/Jest o.ä. noch nicht vorhanden ist, darf Codex eine kleine, gut begründete Testabhängigkeit hinzufügen. Keine große Frameworkmigration.

## 6. Security Review Checklist vor Abschluss

Codex muss am Ende explizit beantworten:

1. Kann irgendein Retry neu verschlüsseln?
2. Kann irgendein Connect/Online-Event vor Pull+Verify pushen?
3. Kann fachlicher Klartext neu persistent gespeichert werden?
4. Kann ein Google API Type in den Core gelangen?
5. Wird HTTP 200 irgendwo als alleiniger Durable-Ack behandelt?
6. Kann ein falscher/älterer Anchor still akzeptiert werden?
7. Kann Rotation vor Verify/Recovery/Backup-Test aktivieren?
8. Kann ein stale Gerät nach Announcement in die alte Epoche schreiben?
9. Kann eine falsche URS sich selbst bestätigen?
10. Kann physische Sheet-Reihenfolge einen fachlichen Konflikt entscheiden?
11. Werden bestehende Nutzeränderungen/Legacy-Daten bei Migration erhalten?
12. Wurde irgendein Security-Test oder Golden Vector abgeschwächt, um Code grün zu bekommen?

Jede `Ja`-Antwort auf 1–10 oder 12 ist Release-Blocker. Punkt 11 muss `Ja, erhalten` lauten.

## 7. Definition of Done

Nicht „Code kompiliert“, sondern:

- normative Specs umgesetzt,
- Legacy-Persistenz kontrolliert migriert,
- verschlüsselter lokaler Zielzustand,
- Google Single-Writer Remote-Sync funktioniert,
- Unknown Outcomes crashsicher,
- Anchor/Rollback-Erkennung implementiert,
- Recovery/Rotation/Backup-Gates implementiert,
- Providergrenze vorhanden,
- relevante Tests grün,
- finaler Implementation-vs-Spec-Bericht erstellt,
- offene Security-Abweichungen = 0 oder klar als nicht implementiert/fail-closed blockiert.
