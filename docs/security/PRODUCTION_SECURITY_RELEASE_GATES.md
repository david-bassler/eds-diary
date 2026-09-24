# Production Security Release Gates

Stand: 24.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-v1-Kern | **IMPLEMENTED / INTERN VALIDATED** | Kryptographischer Kern und produktive Integrationspfade sind fail-closed implementiert und automatisiert validiert. Der v1-Cutover verlangt einen vollständig durablen Freeze-Prefix, das Announcement als einzige unmittelbare Folgerow und einen final unveränderten retired Source-Anchor vor lokalem Switch. Widersprüchliche Multi-Client-Evidenz führt zum Fail-Stop. v1 setzt weiterhin die Single-Remote-Writer-Betriebsannahme voraus und bietet kein geräteübergreifendes kryptographisches Fencing; dieses gehört zum separaten v2-Gate. |
| Transferable Single Writer v2 | **V2-01…V2-06 INTERN IMPLEMENTIERT / GESAMTPFAD NOCH NICHT FREIGEGEBEN** | Implementiert und intern validiert sind v2 Typen/Krypto/Signaturen, kanonischer Verifier/WriterGrant-State-Machine, StateV6 + Writer-Key-Store + fail-closed Write-Gate, ManifestV6/Google-v2/RecoveryArtifactV6/SyncBackupV6, produktiver v1→v2-Profile-Upgrade sowie kryptographischer read-only Join. Noch offen sind produktive Cooperative-Handoff- und Forced-Takeover-Orchestrierung, native v2→v2 Rotation einschließlich zweiphasigem Recovery-Rekey, V2-App-/UI-/Fachmaterialisierungs-Wiring und insbesondere das Live-Google-Parallel-Append-Gate. Ein generischer Browser-`CryptoKey` allein beweist nicht die Einzigartigkeit eines physischen Geräts. |
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
- **Im implementierten Single-Writer-v1-Pfad** kann der Recovery-Schlüssel bei
  noch entsperrtem, authentifiziertem Profil ohne Kenntnis des alten
  Recovery-Schlüssels über eine vollständige `recovery_rekey`-Epoch-Rotation
  ersetzt werden. Die Recovery-Generation wird erhöht; Umschaltung erfolgt erst
  nach Full Verify, Recovery-Bootstrap und Backup-Test-Restore. Die hiervon
  getrennte zweiphasige v2-RecoveryAuthorityTransition/Pending-Rekey-Fence-
  Konstruktion ist Bestandteil des oben als **NICHT IMPLEMENTIERT**
  ausgewiesenen Transferable-Single-Writer-v2-Gates.
- Das verschlüsselte Recovery-Artefakt wird bei normaler v1-Rotation und
  recovery_rekey zunächst one-shot lokal persistiert und bootstrap-verifiziert.
  Vor dem Source-Announcement darf die secret-derived owner-only Recovery-
  Ressource bereits leer und eindeutig vorgebunden werden; staged Successor-
  Artifact-Bytes werden dort noch nicht gespeichert. Die Zulässigkeit exakt
  dieses staged Artifacts gegen einen eventuell bereits belegten Slot wird vorab
  mit denselben Diary-/Generation-/Ordering-Regeln wie beim Publish geprüft und
  unmittelbar vor dem Source-Append erneut verifiziert. Erst nach durablem,
  race-geprüftem Source-Announcement wird exakt das lokale Artefakt hineingeschrieben
  und per Readback verifiziert. Remote-Enablement ist die ausdrückliche Ausnahme
  ohne vorherige Remote-Source. Dadurch liegen Create-/Discovery-/Replacement-
  Fehler soweit ohne CAS möglich vor dem Cutover-Point-of-no-return, ohne einen
  staged Successor vorzeitig recoverbar zu machen.
- Bei normaler v1-Rotation mit unveränderter Recovery-Generation bleibt die
  bestehende Same-Generation-Rollback-Sperre des Google-Recovery-Stores erhalten.
  Das neue RecoveryArtifact übernimmt einen monotonen Zeit-Floor aus dem
  kryptographisch geöffneten und exakt an die aktive Source gebundenen bisherigen
  Remote-Artefakt; eine rückwärts laufende Geräteuhr kann die legitime Rotation
  dadurch nicht mehr blockieren.
- Recovery-Persistenz und normaler Datenlayer verwenden denselben unterstützten
  IndexedDB-Bereich (Version 9/10; >10 fail-closed). Der Recovery-Pfad erzeugt keine
  Legacy-Klartext-Stores mehr und führt die Fresh-Profile-Prüfung nicht-destruktiv
  aus: ein historischer `revisions`-Store oder ein bestehendes Legacy-/Fremdschema
  wird vor Löschung bzw. Versionsupgrade abgelehnt. Nur eine ausschließlich aus
  den Secure-Recovery-Stores bestehende, bereits von diesem Bootstrap angelegte
  sub-v9-DB darf nach Crash auf den Floor weitergehoben werden. Vorhandene
  Legacy-Stores bleiben Teil der Fresh-Profile-Prüfung und verhindern bei Inhalt
  eine Wiederherstellung in ein nicht frisches Profil. Taucht nach dem
  v10-Schema-Fence nur der alte localStorage-Key erneut auf, wird er entfernt,
  ohne dafür eine unzulässige Version 11 zu erzeugen.
- Der Browser-Persistenzstatus wird über die Storage API angefordert und angezeigt;
  die Zahl ausschließlich lokal vorhandener Änderungen wird aus der persistenten
  Envelope-Outbox statt aus flüchtigem UI-Zustand ermittelt.
- Für spätere Origin-/Hosting-Wechsel gibt es ein exportierbares
  `eds-origin-migration-v1`-Paket aus verifiziertem Backup und Recovery-Artefakt;
  der Recovery-Key bleibt separat und wird nicht in das Paket aufgenommen.
- Import akzeptiert auch frühere von der App pretty-printed exportierte JSON-Dateien,
  bleibt aber strikt gegen Duplicate Keys und nicht-I-JSON-konforme Werte; alle
  kryptographischen Vergleiche verwenden weiterhin kanonische JCS-Bytes.
- Nach verifiziertem Legacy-Cutover werden die ursprünglichen Klartext-Fachstores
  readback-verifiziert geleert, der Legacy-localStorage-Wert entfernt und die
  IndexedDB-Version als Schema-Fence erhöht. Diese App akzeptiert Version 9
  (Secure Floor) und Version 10 (post-Legacy-Destruction); Version 8 war der
  letzte Legacy-Client, Versionen >10 werden als zukünftiges inkompatibles
  Schema fail-closed abgelehnt. Die Klartext-Stores werden gelöscht und vom
  aktuellen Schema nicht wieder angelegt. Ein alter offener Tab darf den Fence
  blockieren, aber nicht still umgangen werden.
- Aktuelle Remote-Backups werden vor Export vollständig verifiziert, enthalten
  lokale pending Envelopes und werden nicht aus einer bereits retired Epoche
  erzeugt. Der normale Backup-Recovery-Pfad lehnt retired Epochen ebenfalls ab;
  historischer Rollback ist kein impliziter Standard-Recovery-Modus.
- Explizite Fachkonflikt-Oberfläche, die alle aktiven und Tombstone-Heads zeigt
  und ausschließlich den sicheren gestuften Merge-Pfad verwendet.
- Separat statisch baubares Auth-Origin-Gegenstück unter `/google-auth/`; die
  RPC-Capability ist auf die tatsächlich verwendeten Drive-/Sheets-Endpunktfamilien
  und Methoden begrenzt.

- **V2-01…V2-06:** eingefrorene v2 Wire-/Schema-/Signaturprimitiven, kanonischer
  Verifier mit Writer-/Recovery-Authority-Replay, StateV6/WriterDeviceKeyV2,
  fail-closed normaler Domain-Write-Gate, striktes Google-v2-Profil,
  RecoveryArtifactV6/RecoveryTakeoverStagingV2/SyncBackupV6, produktiver
  crash-resumabler v1→v2-Profile-Upgrade und Recovery-Key-basierter read-only
  Second-Device-Join. Diese Services sind noch nicht in den normalen
  App-/Settings-Datenpfad verdrahtet; daraus folgt keine UI-/Release-Freigabe.

## TESTED

- Passphrase-/PRF-Lock und Fail-closed-Unlock.
- Manipulation jedes separat gespeicherten Context-Identitätsfelds.
- Konflikt-Merges mit 2, 8, 9 und 17 Heads einschließlich vollständiger
  Vorfahrenabdeckung.
- Recovery-/Backup-/Fresh-Profile-Bootstrap einschließlich RootWrap-, State-MAC-,
  Journal- und Envelope-Readback sowie **v1**-Recovery-Key-Rekey und remote
  Recovery-Artefakt-Readback.
- v1-Rotation mit zusätzlicher physischer Source-Row zwischen Freeze und
  Announcement => Fail-Stop; staged RecoveryArtifact-Bytes bleiben bis zum
  durablen Announcement unveröffentlicht. Ein nach frühem Slot-Prebind
  manipulierter/belegter Recovery-Slot wird unmittelbar vor dem Source-Append
  erneut geprüft und blockiert den Append.
- Zweite normale v1-Rotation bei rückwärts gesetzter Geräteuhr => RecoveryArtifact
  bleibt same-generation rollback-geschützt und erhält dennoch einen strikt
  monotonen created_at-Wert.
- Recovery-Profil-Opener auf einer unterstützten höher versionierten Produktions-DB
  (9/10) => kein VersionError und keine Neuerzeugung von Legacy-Klartext-Stores;
  Version 11+ => fail-closed als zukünftiges Schema. Historische `revisions`-
  Daten sowie ein belegtes v8-Legacy-Profil werden abgelehnt, ohne Store-Löschung,
  Datenänderung oder Versionsupgrade.
- Legacy-Migration mit konkurrierendem Legacy-Write => Catch-up bis stabil,
  anschließend Entfernung der Klartext-Stores und Schema-Fence.
- Kryptographisch gültiges Backup einer per Rotation retired Epoche => normales
  Backup-Recovery wird abgelehnt.
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

- **Produktiver v1→v2-Profile-Upgrade:** vollständige Crash-Matrix,
  staged Recovery/Backup, Source-/Successor-Cutover-Races, Unknown Outcomes,
  byte-identische Control-Retries, post-activation Fachrow/WriterGrant,
  RecoveryTransition-/Seal-Supersession und finaler Pre-Switch-Verify.
- **V2 read-only Join:** native-v2- und produktive v1→v2-Lineage,
  Recovery-Family-Discovery, Fresh-Profile-Schutz, atomarer lokaler Bundle-Commit,
  Crash-Resume mit identischer Geräte-/Key-Identität sowie finale erneute
  Recovery-/canonical_full-Verifikation vor lokalem Switch.

## BLOCKED_EXTERNAL / PRODUCTION RELEASE GATES

- Echte Google-Credentials und ein dediziertes Live-Testkonto einschließlich
  Account-Wechsel, Logout, Permission-, Netzwerk- und Hostile-Grid-Fällen.
- Deployment der Diary- und Auth-Anwendung auf getrennten Origins; der eigentliche
  Hostwechsel bleibt extern, der verschlüsselte Benutzer-Handoff ist implementiert.
- Reale WebAuthn-Geräte-/Browsermatrix.
- Produktions-CSP/-Header, Source-Map-/Logprüfung und externer Security-/Crypto-Audit.

## Interner Status

`SECURITY/DECISION: single-writer-v1 production hardening rationale frozen in EDS_SINGLE_WRITER_V1_HARDENING_DECISIONS.md`

`TODO_INTERNAL: transferable-single-writer-v2 remaining slices — Cooperative Handoff, Forced Takeover/stale quarantine, native v2→v2 Rotation + Recovery-Rekey, App/UI integration, Live-Google Parallel-Append-Gate`

`SECURITY/SPEC DECISION: exact transferable-single-writer-v2 wire, signature and recovery-takeover protocol frozen in EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`
