# Implementierungsbericht – Google Sheets Single Writer v1

Stand: 15.09.2026 (Remediation PR #9)

## Einordnung

Der interne Sicherheitskern ist auf das normative Single-Writer-v1-Profil umgestellt. Der gesperrte Legacy-Google-Einstieg wurde nicht reaktiviert. Dieser Bericht behauptet weder externe Auditierung noch Produktionsfreigabe.

## Status nach Remediation (Abschnitte 3–14)

| Abschnitt | Status | Produktive Grenze / Nachweis |
|---|---|---|
| 3 Manifest/Fingerprint | **DONE** | Strikte Headergrenze und einzige Fingerprint-Funktion in `manifest.ts`; Architekturtest verhindert eine zweite Implementierung. |
| 4 Full Remote Verifier | **DONE** | `FullRemoteVerifier` authentifiziert Manifest und Rows, prüft Registry, Graph, Controls, Anchor und lokale Envelopes. Der Codec nimmt ein Verifier-Objekt; der triviale Verifier liegt ausdrücklich nur unter `sync/testing`. Der Coordinator verifiziert vor Writer sowie nach Append vor Durable erneut. |
| 5 Google Wire Transport | **DONE** | Drive-/Permission-Invarianten, Zwei-Tab-/GRID-/Merge-/Zelltyp-/Gridgrenzen, dynamische `_r.sheetId`, `AppendCellsRequest` und mutationsabhängige Fehlernormalisierung. Keine Values API oder hartcodierte Record-Sheet-ID. |
| 6 Create/Reconcile | **DONE** | Discovery erfolgt über neutralen exakten `sync-<creation_locator>`-Namen vor Create; Create nutzt die leere Zwei-Tab-Struktur, Manifestwrite ist getrennt und Candidate-Response nicht bindend. Bindung erfolgt nur durch Reconciliation. |
| 7 lokale Sicherheitsgrenzen | **DONE** | `localState.ts` implementiert v5 Best-Effort-Root-Wrap, State-MAC, Journal-Hashkette und diary-spezifische Web-Lock-Grenze; ohne Web Locks bleibt Browser-Schreiben fail-closed. Anchor/Durable bleibt eine Store-Transaktionsgrenze des Coordinators. **BLOCKED_EXTERNAL:** reale WebAuthn-PRF-Hardware-/Browsermatrix und Passphrase-UX-Abnahme. |
| 8 striktes JSON/Schema | **DONE** | Duplicate Keys werden vor `JSON.parse` rekursiv erkannt; UTF-8/I-JSON/JCS-Re-Encode bleiben zwingend. Manifest/Wrapper/Control und Registry sind strikt gebunden. |
| 9 Recovery | **DONE** | Unwrap liefert nur Kandidaten; Aktivierung verlangt einen expliziten, vollständig gebundenen Bootstrap-Proof statt Callback. **BLOCKED_EXTERNAL:** echter Remote-Bootstrap gegen Google-Testkonto. |
| 10 Backup | **DONE** | Ausschließlich `sync-backup-v5`, 256-MiB-/100k-/128-MiB-Grenzen, one-shot Backup-ID/KDF, Manifest/Prefix/Anchor/Hash-/Union-Bindung und verpflichtender Full-Row-Verify-Hook beim Test-Restore. |
| 11 Rotation | **DONE** | Persistente normative Zustände, readback-verifizierter State-Hash, Freeze ab `source_frozen_verified`, Abort-Grenze und Switch erst nach durable Announcement. |
| 12 Legacy-Migration | **DONE** | Normative Legacy-/Singleton-ID-Ableitungen sind implementiert und golden getestet; Activity-Type-Settings bleiben im inventarisierten IDB-Settings-Cutover und werden nicht neu in LocalStorage geschrieben. |
| 13 Provider/Auth | **DONE** intern / **BLOCKED_EXTERNAL** deployment | Provider-Core bleibt frei von Google-Typen; Token bleibt RAM-only; Google Runtime wird nicht im Diary-Origin geladen. Auth-Origin fehlt extern. |
| 14 Assurance | **DONE** für lokale automatisierte Checks | 9 Vitest-Dateien / 28 Tests (Abschlusslauf maßgeblich), Build, Lint und Architekturchecks; Live-Google/WebAuthn/externer Audit bleiben extern. |

## SECURITY/SPEC DECISION REQUIRED

Keine. Bei dieser Umsetzung wurde keine neue Security-Semantik benötigt.

## Externe Release-Gates

- separater, gehärteter Google-Auth-Origin samt replay-resistentem Handoff;
- echte Google-Testcredentials und kontrolliertes Testkonto;
- reale WebAuthn-PRF-Hardware-/Browsermatrix;
- kontrollierbare Hosting-Header, Produktions-Logging-/Source-Map-Prüfung;
- externer Kryptographie-/Anwendungssecurity-Audit;
- Dependency-Audit-Bereinigung: `npm install` meldete 5 Funde (2 moderate, 2 high, 1 critical).

Die zulässige Aussage bleibt: konservativer, fail-closed clientseitiger Kryptographieentwurf; nicht extern auditiert und nicht zur Produktion freigegeben.

## Korrektur nach kumulativem Self-Review (15.09.2026)

Die oben stehende pauschale DONE-Tabelle ist überholt. Dieser Durchgang schließt
die Grid-/Binding-, Remote-Duplikat-, Recovery-Issuer- und Backup-Callback-Lücken.
Nicht abgeschlossen sind der produktive Cutover von `secureRecords` auf das
Envelopejournal, die vollständige persistente Create-Orchestrierung und die
produktive Rotations-/Legacy-Migrationsorchestrierung. Die sechs Fachschema-IDs
sind normativ genannt, ihre konkreten zulässigen Payloadfelder, Typen und Limits
jedoch nicht festgelegt; bis zu einer normativen Entscheidung bleiben sie
fail-closed statt erfundene Semantik zu akzeptieren.

`TODO_INTERNAL` ist daher in diesem Checkout **nicht none**. Eine interne
Vollständigkeits- oder Produktionsfreigabe wird ausdrücklich nicht behauptet.
