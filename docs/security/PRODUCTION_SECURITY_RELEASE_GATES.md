# Production Security Release Gates

Stand: 20.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-v1-Kern | **IMPLEMENTED / INTERN VALIDATED** | Kryptographischer Kern und produktive Integrationspfade sind fail-closed implementiert und automatisiert validiert. v1 setzt für Remote-Mutationen jedoch die Single-Remote-Writer-Betriebsannahme voraus und bietet noch kein geräteübergreifendes kryptographisches Fencing; dieses gehört zum separaten v2-Gate. |
| Transferable Single Writer v2 | **ARCHITEKTUR + EXAKTES PROTOKOLL DEFINIERT / NICHT IMPLEMENTIERT** | Mehrere Geräte dürfen dasselbe Tagebuch lesen, aber nur eine remote verifizierte Writer-Key-Authority darf Fachcommits erzeugen. Das exakte v2 Wire-/Schema-/Signatur-/Recovery-Takeover-Profil einschließlich `RecoveryActivationProofV2` ist in `EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md` eingefroren. Vor produktiver Freigabe bleiben Implementierung, v1→v2-Migration, Join/Handoff/Fencing, Rotation-/Takeover-/Recovery-Aktivierungstests und insbesondere das Live-Google-Konkurrenzgate abzuschließen. Ein generischer Browser-`CryptoKey` allein beweist nicht die Einzigartigkeit eines physischen Geräts. |
| Google Auth-Origin | Implementiert / Deployment **BLOCKED_EXTERNAL** | Separat baubares `/google-auth/`-Artefakt mit erlaubtem Return-Origin, einmaliger Action-Bindung, Popup→Auth-Bridge-Handoff, MessagePort-RPC und exakt begrenzten Drive-/Sheets-Endpunkten. Das Credential wird nicht an Diary-Code übergeben. Die GitHub-Pages-Testbereitstellung bleibt same-origin; Deployment auf einen zweiten Origin und echte Credentials bleiben extern. |
| Live Google Contract | **BLOCKED_EXTERNAL** | Hostile-Grid-/Permission-/Unknown-Outcome-Suite gegen dediziertes Google-Testkonto. Zusätzlich ist der reale Mehrgerätefall ausdrücklich kein v1-Join-Pfad: ein zweites Gerät darf ein bestehendes Tagebuch erst mit v2 Join/Handoff verwenden; erneutes v1-`remote_enablement` ist dafür kein unterstützter Ersatz. |
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
- Der Recovery-Schlüssel kann bei noch entsperrtem, authentifiziertem Profil ohne
  Kenntnis des alten Recovery-Schlüssels über eine vollständige
  `recovery_rekey`-Epoch-Rotation ersetzt werden. Die Recovery-Generation wird
  erhöht; Umschaltung erfolgt erst nach Full Verify, Recovery-Bootstrap und
  Backup-Test-Restore.
- Das verschlüsselte Recovery-Artefakt wird vor der Umschaltung zusätzlich in
  einer privaten owner-only Google-Ressource unter einem aus dem Recovery-Key
  abgeleiteten opaken Locator gespeichert und per Readback verifiziert. Google-
  Recovery benötigt dadurch für neu gehärtete Epochen nur Konto + Recovery-Key.
- Der Browser-Persistenzstatus wird über die Storage API angefordert und angezeigt;
  die Zahl ausschließlich lokal vorhandener Änderungen wird aus der persistenten
  Envelope-Outbox statt aus flüchtigem UI-Zustand ermittelt.
- Für spätere Origin-/Hosting-Wechsel gibt es ein exportierbares
  `eds-origin-migration-v1`-Paket aus verifiziertem Backup und Recovery-Artefakt;
  der Recovery-Key bleibt separat und wird nicht in das Paket aufgenommen.
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
  Journal- und Envelope-Readback sowie Recovery-Key-Rekey und remote
  Recovery-Artefakt-Readback.
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
- Deployment der Diary- und Auth-Anwendung auf getrennten Origins; der eigentliche
  Hostwechsel bleibt extern, der verschlüsselte Benutzer-Handoff ist implementiert.
- Reale WebAuthn-Geräte-/Browsermatrix.
- Produktions-CSP/-Header, Source-Map-/Logprüfung und externer Security-/Crypto-Audit.

## Interner Status

`TODO_INTERNAL: transferable-single-writer-v2 implementation`

`SECURITY/SPEC DECISION: exact transferable-single-writer-v2 wire, signature and recovery-takeover protocol frozen in EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`
