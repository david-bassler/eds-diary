# EDS v5 – Historischer Assurance-Report v6

Stand der referenzierten Baseline: 15.09.2026

Status: **HISTORISCHE REFERENZ, NICHT normative Single-Writer-State-Machine.**

Die ursprüngliche v5-Spezifikation besaß 27 zentrale `INV-*`-Invarianten und 12 `REQ-*`-Requirements. Sie modellierte den vollständigen Multi-Writer-Google-Sheets-Fall inklusive Remote-Checkpoints, Forks, Rotation-Fence und Konvergenz.

Für die erste Implementierung wird bewusst das vereinfachte Profil `google-sheets-single-writer-v1` verwendet. Die kryptographischen Grundentscheidungen, Recovery-/Backup-Sicherheitsregeln, Providergrenze und viele Failure-Handling-Prinzipien bleiben erhalten; die Multi-Writer-spezifischen Remote-State-Machines werden nicht implementiert.

## Historischer Ergebnisstand

Der statische Spezifikationscheck der vollständigen v5-Spezifikation war **PASS**. Die damaligen 12 TLA+-Module / 14 TLC-Läufe waren grün. Insgesamt wurden 31 TLA+/CFG/Runner/JAR-Artefakte bytegenau gegen die grüne v5-Baseline verglichen; 0 Abweichungen.

Wichtig: Diese Ergebnisse dürfen **nicht** als formaler Nachweis für die neue Single-Writer-Implementierung ausgegeben werden. Dafür definiert `EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md` neue, kleinere Invarianten und Tests.

## Historische Provider-Regeln, weiterhin relevant

### INV-PROVIDER-001 – Core/Adapter-Trennung

Providerneutrale Logik sieht nur normalisierte Bindings/Fehler und `AuthProvider`-/`RemoteTransport`-/`TransportProfileCodec`-Verträge. Rohe Provider-Tokens und SDK-Objekte bleiben im Adapter.

### INV-PROVIDER-002 – semantische Transport-Conformance

Ein Remote-Adapter muss die für sein Profil spezifizierten Sicherheitssemantiken reproduzieren oder fail-closed abgelehnt werden. Fehlende Providerfähigkeiten dürfen keine Core-Invariante schwächen.

### INV-PROVIDER-003 – kein In-place-Providerwechsel

Ein bestehendes Epoch-Manifest wird niemals für einen anderen Provider umgedeutet. Wechsel erfolgt über neue Epoche und `Copy -> Verify -> Switch`.

### REQ-012 – Provider-independent auth/storage core

Die Implementierung weist die Trennung durch statische Importtests, Fake-Adapter und Adapter-Contract-Tests nach.

## Historische Assurance-Kategorien

Die vollständige v5-Baseline deckte u.a. ab:

- Create/Reconciliation,
- Checkpoint-Liveness,
- Rotation/Restore,
- Backup-Limits,
- Auth-/Legacy-Handoffs,
- 2-/3-Geräte-Forks,
- 2-/3-Zweig-Konvergenz,
- komponierten Lifecycle,
- Anchor <-> Backup <-> Recovery.

Für Single-Writer v1 bleiben besonders relevant:

- idempotente Create-Reconciliation,
- Unknown Outcome Handling,
- immutable Retries,
- Anchor/Backup/Recovery-Kopplung,
- Recovery-URS-Continuity,
- Auth-Origin-Isolation,
- lokale State-Integrität,
- Provider-Abstraktion.

## Historische Referenz-Hashes

Vollständige alte v5-Spezifikation:

```text
SHA-256 040c20684d465faaafe6c2425912853f543135c16df15f21cefdf456a2f90e14
5112 Zeilen
```

Diese große historische Spezifikation ist **nicht erforderlich**, um den aktuellen Codex-Auftrag auszuführen. Die für die erste Implementierung normativen Regeln sind vollständig in folgenden Repo-Dateien konsolidiert:

- `docs/security/EDS_CRYPTO_PROFILE_V5.md`
- `docs/security/EDS_GOOGLE_SHEETS_SINGLE_WRITER_V1_SPEC.md`
- `docs/security/EDS_ASSURANCE_TEST_PLAN_SINGLE_WRITER_V1.md`

## Assurance-Grenze

Formalmodelle sind State-Machine-Nachweise für modellierte Eigenschaften, keine Kryptanalyse. Golden Vectors sind Byte-Kompatibilitätsnachweise. Die gesamte Implementierung bleibt bis zu einem unabhängigen externen Security-/Crypto-Review als **nicht extern auditiert** zu kennzeichnen.
