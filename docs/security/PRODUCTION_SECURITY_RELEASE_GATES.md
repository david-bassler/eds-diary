# Production Security Release Gates

Stand: 16.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-Kern | Teilweise | Der kryptographische Kern bleibt fail-closed. Lokale Passphrase-/WebAuthn-PRF-Modi sind produktiv erreichbar, der App-Start sperrt Fachzugriffe bis zum Unlock, Context/State/RootWrap-Identitäten sind gebunden und Konflikt-Merges unterstützen gestufte Parent-Gruppen. Die unten genannten Produktintegrationen bleiben intern offen. |
| Google Auth-Origin | **BLOCKED_EXTERNAL** | Separater statischer Origin, action-gebundener replay-resistenter Handoff; kein Google Runtime JS im Diary-Origin. |
| Live Google Contract | **BLOCKED_EXTERNAL** | Hostile-Grid-/Permission-/Unknown-Outcome-Suite gegen dediziertes Google-Testkonto. |
| WebAuthn PRF | **BLOCKED_EXTERNAL** | Der interne Browser-Adapter erzwingt `userVerification:"required"`, exakte Credential-ID und eine 32-Byte-Post-Enrollment-PRF-Assertion; vor Produktionsfreigabe bleibt die reale Authenticator-/Browsermatrix einschließlich Enrollment-, Unlock- und Recovery-Ceremony auf Zielgeräten zu validieren. |
| Hosting | **BLOCKED_EXTERNAL** | CSP, `Referrer-Policy: no-referrer`, minimale Permissions Policy, COOP/Frame-Schutz und Source-Map-/Logprüfung. |
| Externer Audit | **BLOCKED_EXTERNAL** | Unabhängiger Kryptographie-, Protokoll- und Anwendungsaudit ohne kritische offene Findings. |

## Zulässige Aussage

„Konservativer clientseitiger Kryptographieentwurf mit fail-closed Produktgrenzen; nicht extern auditiert und nicht für Produktion freigegeben.“

## IMPLEMENTED

- Produktiver lokaler Sicherheitsbereich für Passphrase, WebAuthn PRF, Lock und
  Unlock sowie ein App-Start-Gate für gesperrte starke RootWraps.
- Explizite Bindung aller `EpochContext`-Identitätsfelder an MAC-authentifizierten
  State und geladenen RootWrap.
- Protokollkonformer gestufter Merge für mehr als acht Konflikt-Heads.
- CI führt die vollständige konfigurierte Playwright-Projektmatrix aus.

## TESTED

- Passphrase-/PRF-Lock und Fail-closed-Unlock.
- Manipulation jedes separat gespeicherten Context-Identitätsfelds.
- Konflikt-Merges mit 2, 8, 9 und 17 Heads einschließlich vollständiger
  Vorfahrenabdeckung.

## BLOCKED_EXTERNAL / PRODUCTION RELEASE GATES

- Echte Google-Credentials und ein dediziertes Live-Testkonto.
- Deployment der Diary- und Auth-Anwendung auf getrennten Origins.
- Reale WebAuthn-Geräte-/Browsermatrix.
- Produktions-CSP/-Header und externer Security-/Crypto-Audit.

## Interner Status

`TODO_INTERNAL: Produktive Recovery-UI (Google und Backup), spätere verifizierte Artefakt-Re-Exports, fachliche Konfliktauflösungs-UI sowie das getrennt deploybare Auth-Origin-Gegenstück fehlen noch.`

`SECURITY/SPEC DECISION REQUIRED: none`
