# Production Security Release Gates

Stand: 17.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-Kern | **IMPLEMENTED / INTERN VALIDATED** | Kryptographischer Kern und produktive Integrationspfade sind fail-closed implementiert und automatisiert validiert. Externe Produktionsfreigaben bleiben separat blockiert. |
| Google Auth-Origin | Implementiert / Deployment **BLOCKED_EXTERNAL** | Separat baubares `/google-auth/`-Artefakt mit erlaubtem Return-Origin, einmaliger Action-Bindung, MessagePort-RPC, exakt begrenzten Drive-/Sheets-Endpunkten und Token-Isolation. Deployment auf einen zweiten Origin und echte Credentials bleiben extern. |
| Live Google Contract | **BLOCKED_EXTERNAL** | Hostile-Grid-/Permission-/Unknown-Outcome-Suite gegen dediziertes Google-Testkonto. |
| WebAuthn PRF | **BLOCKED_EXTERNAL** | Der interne Browser-Adapter erzwingt `userVerification:"required"`, exakte Credential-ID und eine 32-Byte-Post-Enrollment-PRF-Assertion; vor Produktionsfreigabe bleibt die reale Authenticator-/Browsermatrix einschließlich Enrollment-, Unlock- und Recovery-Ceremony auf Zielgeräten zu validieren. |
| Hosting | **BLOCKED_EXTERNAL** | CSP, `Referrer-Policy: no-referrer`, minimale Permissions Policy, COOP/Frame-Schutz und Source-Map-/Logprüfung. |
| Externer Audit | **BLOCKED_EXTERNAL** | Unabhängiger Kryptographie-, Protokoll- und Anwendungsaudit ohne kritische offene Findings. |

## Zulässige Aussage

„Konservativer clientseitiger Kryptographieentwurf mit fail-closed Produktgrenzen; intern automatisiert validiert, aber nicht extern auditiert und nicht für Produktion freigegeben.“

## IMPLEMENTED

- Produktiver lokaler Sicherheitsbereich für Passphrase, WebAuthn PRF, Lock und
  Unlock sowie ein App-Start-Gate für gesperrte starke RootWraps.
- Explizite Bindung aller `EpochContext`-Identitätsfelder an MAC-authentifizierten
  State und geladenen RootWrap.
- Protokollkonformer gestufter Merge für mehr als acht Konflikt-Heads.
- CI führt die vollständige konfigurierte Playwright-Projektmatrix aus.
- Recovery-Oberfläche für unabhängig authentifiziertes Google oder ein unabhängig
  ausgewähltes Backup mit vollständigem Bootstrap-Verify und Persistenz-Readback.
- Backup-Restore bleibt als `local_offline` sicher für eine spätere authentifizierte
  Remote-Aktivierung geeignet; es wird kein nicht unterstützter Zwischenstatus erzeugt.
- Recovery-Artefakte werden nach Restore unabhängig von einer lokalen
  `rotation_state_ref` dauerhaft gehalten und können bereits vor erneuter
  Google-Aktivierung wieder exportiert werden.
- Import akzeptiert auch frühere von der App pretty-printed exportierte JSON-Dateien,
  bleibt aber strikt gegen Duplicate Keys und nicht-I-JSON-konforme Werte; alle
  kryptographischen Vergleiche verwenden weiterhin kanonische JCS-Bytes.
- Aktuelle Remote-Backups werden vor Export vollständig verifiziert und enthalten
  lokale pending Envelopes.
- Explizite Fachkonflikt-Oberfläche, die alle aktiven und Tombstone-Heads zeigt
  und ausschließlich den sicheren gestuften Merge-Pfad verwendet.
- Separat statisch baubares Auth-Origin-Gegenstück unter `/google-auth/`; die
  RPC-Capability ist auf die tatsächlich verwendeten Drive-/Sheets-Endpunktfamilien
  und Methoden begrenzt.

## TESTED

- Passphrase-/PRF-Lock und Fail-closed-Unlock.
- Manipulation jedes separat gespeicherten Context-Identitätsfelds.
- Konflikt-Merges mit 2, 8, 9 und 17 Heads einschließlich vollständiger
  Vorfahrenabdeckung.
- Recovery-/Backup-/Fresh-Profile-Bootstrap einschließlich RootWrap-, State-MAC-,
  Journal- und Envelope-Readback.
- Regressionen für Legacy-Pretty-JSON-Import bei weiterem Duplicate-Key-Reject,
  Backup-Restore als erneut remote-aktivierbares Profil und dauerhaften
  Recovery-Artefakt-Readback.
- Exakte Auth-Origin-RPC-Allowlist: benötigte Drive-/Sheets-Aufrufe erlaubt,
  fremde Google-Endpunkte und falsche Methoden abgelehnt.
- Dedizierte Browserpfade auf Desktop und Mobile für Recovery-Import,
  wiederhergestellten Recovery-Artefakt-Re-Export, Recovery-Navigation,
  Konfliktbereich und fail-closed Auth-Origin ohne Deployment-Konfiguration.
- Vollständige konfigurierte Playwright-Matrix sowie TypeScript, Unit-/Security-
  Suites, Build, ESLint, Stylelint, Storybook und Whitespace-Check.

## BLOCKED_EXTERNAL / PRODUCTION RELEASE GATES

- Echte Google-Credentials und ein dediziertes Live-Testkonto einschließlich
  Account-Wechsel, Logout, Permission-, Netzwerk- und Hostile-Grid-Fällen.
- Deployment der Diary- und Auth-Anwendung auf getrennten Origins.
- Reale WebAuthn-Geräte-/Browsermatrix.
- Produktions-CSP/-Header, Source-Map-/Logprüfung und externer Security-/Crypto-Audit.

## Interner Status

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`
