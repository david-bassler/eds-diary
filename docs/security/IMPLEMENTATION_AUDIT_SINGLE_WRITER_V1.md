# Implementierungsaudit – Single Writer v1

Stand: 15.09.2026

## Inventar

| Bereich | bestehende Datei(en) | Ist-Zustand vor Änderung | Ziel | Maßnahme |
|---|---|---|---|---|
| Fachliche IndexedDB-Daten | `src/data/localDatabase.ts` | Vier fachliche Stores und `settings` enthielten Klartext. | Verschlüsseltes Ziel als Source of Truth. | Schema v6 ergänzt `secureRecords`, non-extractable Best-Effort-Key und nicht-destruktiven, verifizierten Cutover. Legacy-Stores bleiben nur Migrationsquelle. |
| Fachliche Browser-Settings | `src/features/activity/activityRepository.ts` | Aktivitätstypen lagen als Klartext in `localStorage`. | Verschlüsselter Settings-Store. | In verschlüsselte IDB-Settings verschoben. |
| Google-Konfiguration | `src/data/googleSheets.ts` | Sheet-ID in `localStorage`, Access Token RAM-only. | Nur nicht-sensitive Discovery-Konfiguration persistent; Token RAM-only. | Tokenpersistenz war nicht vorhanden. Legacy-Google-Login ist bis zum separaten Auth-Origin gesperrt. |
| Google Runtime | `index.html` | GIS-Script lief im sensiblen Hauptorigin. | Separater Auth-Origin. | Script entfernt; Integration fail-closed gesperrt. |
| Remote-Daten | `src/data/googleSheets.ts`, `src/features/**/*Sync.ts` | Fachliche Klartexttabellen, Replace/Load und Timestamp-LWW. | `_m`/`_r`, append-only, Revision Graph. | Neuer isolierter Adapter/Core implementiert; der alte produktive Einstieg ist gesperrt. |
| Sync-Auslöser | `src/data/syncManager.ts` | Connect und Online konnten direkt pushen. | Pull → Verify → Reconcile → Writer. | Automatische Mutation entfernt; neuer Coordinator erzwingt Verify. |
| Entitäten | Pain, Medication, Prescription, Activity Repositories | CRUD direkt gegen Klartextstores. | Stabile UI-API über sicheren Store. | Bestehende APIs schreiben/lesen nun ausschließlich verschlüsselte Records. |
| Routing Storage | `src/routing/appHistory.ts` | `sessionStorage` enthält nur einen UI-Routenpfad. | Keine Gesundheitsdaten. | Unverändert; keine fachlichen Payloads. |
| Auth/Hosting | `index.html`, `.github/workflows/deploy-pages.yml` | GitHub Pages kann die erforderlichen Header nicht zuverlässig kontrollieren. | Kontrollierbare CSP/Header und Auth-Origin. | Als Release-Blocker dokumentiert. |
| Tests | `tests/*.spec.ts`, Stories | Playwright/Storybook vorhanden, keine Unit-Infrastruktur. | Crypto/Core/Architektur/Modelltests. | Vitest plus Fake Transport und statische Gates ergänzt. |

## Baseline vor Refactor

- `npm install`: erfolgreich; npm meldete 3 bekannte Vulnerabilities (1 moderate, 2 high).
- `npm run build`: erfolgreich; Vite warnte zum nicht als Modul bündelbaren lokalen QR-Script.
- `npm run lint`: fehlgeschlagen mit 15 bestehenden React-Hooks-Fehlern und 21 Warnungen.
- `npm run build-storybook`: erfolgreich mit Chunkgrößenwarnung.
- `npm run test:e2e`: bestehende Suite war bereits rot (u. a. Strict-Mode-Locator und Aktivitäts-/Bodymap-Flows); diese Fehler wurden vor dem Kernrefactor beobachtet.

## Sicherheitskritische Ausgangsbefunde

Klartext-Gesundheitsdaten in IndexedDB, Klartext-Aktivitätstypen in `localStorage`, direktes Google-JavaScript im entsperrten Hauptorigin, Whole-table-Replace, Timestamp-LWW und Push-on-connect waren release-blockierend. Der alte Google-Pfad ist deshalb nicht als Sicherheitskern übernommen worden.

## Remediation-Audit 15.09.2026

Der aktualisierte exakte Protokolltext wurde gegen den PR-Stand geprüft. Der vorherige Bericht hatte den Device-Key-Cipherrecord-Zwischenstand, das Envelopearray-Backup und die In-Memory-Rotation zu positiv als Zielarchitektur beschrieben. Der aktualisierte Implementierungsbericht klassifiziert diese Punkte nun ausdrücklich als interne Release-Blocker. Bytegenaue Abweichungen bei IDs, Prefix-Längenbindung, Padding/AAD, Recordwrapper, öffentlichem Recovery-Header, Passphrase-Kontext und sicherem Append wurden korrigiert. Die noch nicht implementierten Remediation-Punkte werden nicht als `SECURITY/SPEC DECISION REQUIRED` bezeichnet, weil die exakte Spezifikation sie hinreichend festlegt.
