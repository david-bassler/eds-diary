# Production Security Release Gates

Stand: 16.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-Kern | Teilweise | Der kryptographische Kern bleibt fail-closed. Lokale Passphrase-/WebAuthn-PRF-Modi sind produktiv erreichbar, der App-Start sperrt Fachzugriffe bis zum Unlock, Context/State/RootWrap-Identitäten sind gebunden und Konflikt-Merges unterstützen gestufte Parent-Gruppen. Die unten genannten Produktintegrationen bleiben intern offen. |
| Google Auth-Origin | Implementiert / Deployment **BLOCKED_EXTERNAL** | Separat baubares `/google-auth/`-Artefakt mit erlaubtem Return-Origin, einmaliger Action-Bindung, MessagePort-RPC, minimalen Google-API-Zielen und Token-Isolation. Deployment auf einen zweiten Origin und echte Credentials bleiben extern. |
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
- Recovery-Oberfläche für unabhängig authentifiziertes Google oder ein unabhängig
  ausgewähltes Backup mit vollständigem Bootstrap-Verify und Persistenz-Readback.
- Dauerhafter Recovery-Artefakt- und vollständig verifizierter Backup-Export.
- Explizite Fachkonflikt-Oberfläche, die alle aktiven und Tombstone-Heads zeigt
  und ausschließlich den sicheren gestuften Merge-Pfad verwendet.
- Separat statisch baubares Auth-Origin-Gegenstück unter `/google-auth/`.

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

`TODO_INTERNAL: Die neuen Recovery-/Export-/Auth-Origin-Produktpfade müssen noch um dedizierte Browser-E2E-Abdeckung ergänzt werden.`

`SECURITY/SPEC DECISION REQUIRED: none`
