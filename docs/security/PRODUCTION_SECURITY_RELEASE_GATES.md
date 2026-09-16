# Production Security Release Gates

Stand: 16.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-Kern | Erfüllt | Envelope-/Revision-Cutover, persistente Create-/Reconcile-State-Machine, App-verdrahteter Coordinator, aus authentifiziertem Local-State abgeleitete Verifier-Erwartungen, produktive Rotation/Migration, provider-authentifizierte Recovery-Bootstrap-Vertrauensgrenze sowie lokale Best-Effort-/Passphrase-/WebAuthn-PRF-Root-Wraps sind implementiert; lokale Build-, Security-/Sync-Test- und gezielte Lint-Gates bleiben grün. |
| Google Auth-Origin | **BLOCKED_EXTERNAL** | Separater statischer Origin, action-gebundener replay-resistenter Handoff; kein Google Runtime JS im Diary-Origin. |
| Live Google Contract | **BLOCKED_EXTERNAL** | Hostile-Grid-/Permission-/Unknown-Outcome-Suite gegen dediziertes Google-Testkonto. |
| WebAuthn PRF | **BLOCKED_EXTERNAL** | Der interne Browser-Adapter erzwingt `userVerification:"required"`, exakte Credential-ID und eine 32-Byte-Post-Enrollment-PRF-Assertion; vor Produktionsfreigabe bleibt die reale Authenticator-/Browsermatrix einschließlich Enrollment-, Unlock- und Recovery-Ceremony auf Zielgeräten zu validieren. |
| Hosting | **BLOCKED_EXTERNAL** | CSP, `Referrer-Policy: no-referrer`, minimale Permissions Policy, COOP/Frame-Schutz und Source-Map-/Logprüfung. |
| Externer Audit | **BLOCKED_EXTERNAL** | Unabhängiger Kryptographie-, Protokoll- und Anwendungsaudit ohne kritische offene Findings. |

## Zulässige Aussage

„Konservativer clientseitiger Kryptographieentwurf mit fail-closed Produktgrenzen; nicht extern auditiert und nicht für Produktion freigegeben.“

## Interner Status

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`
