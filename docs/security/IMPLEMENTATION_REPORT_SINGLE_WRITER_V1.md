# Implementierungsbericht – Google Sheets Single Writer v1

Stand: 15.09.2026 (Remediation-Durchlauf PR #8)

## Ergebnis und Einordnung

Dieser Durchlauf korrigiert mehrere bytegenaue Abweichungen des ersten PR-Standes. Er macht **keinen Produktionsfreigabe-Claim**. Insbesondere ist die vollständige Produktverdrahtung der neuen lokalen Source of Truth, das vollständige Google-Grid/Drive-Protokoll sowie Backup, Migration und Rotation noch nicht vollständig implementiert. Diese bekannten Lücken sind release-blockierend und werden nicht als externe Abhängigkeiten umetikettiert.

| Spec requirement | Implementierung | Tests | Status |
|---|---|---|---|
| RFC 8785 / striktes I-JSON | `src/security/crypto/canonical.ts` | Crypto-/Protokolltests | Implementiert; Duplicate-Key-Erkennung an allen untrusted Grenzen noch offen |
| rohe 16-Byte Diary-/Epoch-IDs, kanonisches Base64URL | `bytes.ts`, `core.ts`, `prefix.ts` | normative HKDF-/Prefix-Vektoren | Vollständig implementiert + getestet |
| Record-AAD, 1/2/4/8/16-KiB-Frame | `envelopes.ts` | fester AES-GCM-/Frame-Vektor | Vollständig implementiert + getestet |
| exakter Recordwrapper / Parent-before-child / Controls | `revisions.ts` | Graph-/Head-Tests | Basis implementiert + getestet; fachliche JSON-Schemas noch nicht zur Laufzeit ausgewertet |
| immutable Schema-Registry | `src/security/schemas/*.json`, `manifest.ts` | Build | Dateien und Hashfunktion implementiert; Registry-Golden-/Schema-Validierung offen |
| Manifest AEAD/AAD/Fingerprint | `manifest.ts` | Build | Implementiert; Lifecycle/one-shot IDB noch offen |
| vollständiger Pull-before-Push | `contracts.ts`, `coordinator.ts`, Codec-Verifiergrenze | Sync-Tests | Finaler Vollverifier ist vor Writer und Durable zwingend; produktiver Decrypt-/Graph-Verifier noch nicht verdrahtet |
| Prefix/Anchor mit uint32-Länge | `prefix.ts` | H0/H1/H2/Anchor-Golden | Vollständig implementiert + getestet |
| Recovery ohne öffentliches Commitment | `recovery.ts` | unabhängiger Manifest-Commitment-Test | Artefakt/Unwrap-Kandidat implementiert; vollständiger Bootstrap-Aufrufer offen |
| Google AppendCells statt Values append | Google-Transport | Architekturtest | Implementiert; exakte Grid-/Drive-/Permission-Prüfung und dynamische `_r.sheetId` offen |
| lokale Root-Wrap/Journal/State-MAC-Source-of-Truth | `localDatabase.ts` | bestehender Migrationstest | **Nicht erfüllt**; bestehender Device-Key-Cipherrecord-Pfad ist weiterhin nur Zwischenstand |
| vollständiges v5 Backup | `backup.ts` | alter Roundtrip-Test | **Nicht erfüllt** |
| persistente Rotation | `rotation.ts` | Gate-Test | **Nicht erfüllt**; weiterhin nur Hilfszustände |
| vollständige Legacy-Migration inkl. Activity Types | `localDatabase.ts` | Teiltest | **Nicht erfüllt** |
| Create/Lost-response Candidate-Klassifikation | `creation.ts`, Google-Transport | Teiltest | **Nicht erfüllt** |
| Google-Fehlernormalisierung | Google-Transport | Build | Statusklassen verbessert; vollständige Assurance-Matrix offen |

## Implementiert, aber nicht live integriert getestet

Die korrigierten Kryptoprimitiven, Manifestfunktionen, Recovery-Kandidatenphase und die providerneutrale Vollverifiergrenze sind lokal implementiert. Es gab keinen echten Google-Account, kein Test-Spreadsheet und keinen realen WebAuthn-Authenticator. Deshalb wurde keine Live-Provider-/Browser-Integrationsaussage getroffen.

## Extern/deployment-bedingt release-blocked

- Separater statischer Google-Auth-Origin inklusive sicherem Handoff.
- Kontrollierbare Security-Header des Hostings.
- Live-Google-Credentials/Testkonto.
- Externer Security-/Crypto-Audit.

## Weitere interne Release-Blocker

Die als **nicht erfüllt** oder **offen** markierten Tabellenzeilen sind interne Implementierungslücken. Besonders kritisch bleiben die lokale RK-/Envelope-Source-of-Truth, vollständige Remoteverifikation, strikter Google-Adapter, Recovery-Bootstrap, v5-Backup, crashsichere Rotation und vollständige Legacy-Migration. Das Produkt muss hierfür fail-closed bleiben.

## SECURITY/SPEC DECISION REQUIRED

Keine neue Security-Semantik wurde erfunden. Es wurde keine noch offene Security-Entscheidung identifiziert; verbleibende Punkte sind Implementierungsarbeit beziehungsweise externe Deployment-Gates.

## Durchgeführte Checks

Die exakten Resultate der Abschlussläufe werden in der Commit-/PR-Zusammenfassung und der Agentenantwort ausgewiesen. Die Tests enthalten feste, aus der exakten Spezifikation übernommene HKDF-, AES-GCM-/Padding-, Recovery-, Prefix- und Anchor-Werte; erwartete Werte werden nicht aus dem getesteten Code erzeugt.

### Abschlusslauf 15.09.2026

- `npm install`: erfolgreich; npm meldet fünf bekannte Dependency-Audit-Funde (2 moderate, 2 high, 1 critical).
- `npm run build`: erfolgreich (Vite warnt weiterhin vor dem klassischen QR-Code-Script).
- `npm run lint`: fehlgeschlagen mit der bereits dokumentierten unabhängigen UI-Baseline (15 React-Hook-Fehler, 21 Warnungen); `npx eslint src/security src/sync src/test` ist erfolgreich.
- `npm run build-storybook`: erfolgreich mit Chunkgrößen-/fehlender-MDX-Warnung.
- `npm test -- --run`: 9 Dateien / 21 Tests erfolgreich.
- `npm run test:e2e`: fehlgeschlagen; unter anderem bestehende Locator-/UI-Erwartungen in `activity-help.spec.ts` und `activity-page.spec.ts`. Keine geänderte Datei dieses Remediation-Durchlaufs ist Teil dieser Journeys.
