# Production Security Release Gates

Stand: 28.09.2026

EDS Diary ist **nicht** als „production secure“ freigegeben.

| Gate | Status | Freigabekriterium |
|---|---|---|
| Interner Single-Writer-v1-Kern | **IMPLEMENTED / INTERN VALIDATED** | Kryptographischer Kern und produktive Integrationspfade sind fail-closed implementiert und automatisiert validiert. Der v1-Cutover verlangt einen vollständig durablen Freeze-Prefix, das Announcement als einzige unmittelbare Folgerow und einen final unveränderten retired Source-Anchor vor lokalem Switch. Widersprüchliche Multi-Client-Evidenz führt zum Fail-Stop. v1 setzt weiterhin die Single-Remote-Writer-Betriebsannahme voraus und bietet kein geräteübergreifendes kryptographisches Fencing; dieses gehört zum separaten v2-Gate. |
| Transferable Single Writer v2 | **V2-01…V2-10 INTERN IMPLEMENTIERT / GESAMTPFAD NOCH NICHT FREIGEGEBEN** | Implementiert und intern validiert sind v2 Typen/Krypto/Signaturen, kanonischer Verifier/WriterGrant-State-Machine, StateV6 + Writer-Key-Store + fail-closed Write-Gate, ManifestV6/Google-v2/RecoveryArtifactV6/SyncBackupV6, produktiver v1→v2-Profile-Upgrade, kryptographischer read-only Join, produktiver crash-resumabler Cooperative Handoff, Recovery-Key-autorisierter Forced Takeover einschließlich stale-pending quarantine/Pending-Rekey-maintenance-only-Fence, native v2→v2 Rotation und vollständige zweiphasige Recovery-Rekey-Orchestrierung sowie das normale App-/Settings-/Fachmaterialisierungs-Wiring. V2-Domainwrites laufen über fresh `canonical_full` + WriterAuthority, Offline-Lesen nutzt ausschließlich ein HMAC-authentifiziertes accepted encrypted Read-Model, read-only/Pending-Rekey/stale quarantine sind produktiv sichtbar und lokale Passphrase/PRF/Lock-Semantik schützt den ausgewählten RootWrapV6 fail-closed einschließlich retained-v1-source catch-up. Abgedeckt sind bounded Unknown-Outcome resume, Supersession, same-epoch Recovery-Backup und der Ersatzgerätepfad Join → Forced Takeover → Pending-Rekey-Adoption → Phase-B-Rotation. Die vollständige Browser-/End-to-End-Assurance ist weiterhin unvollständig: die offenen internen Pakete und ihre Evidenz stehen im verbindlichen 25er-Ledger unter `docs/security/V2_E2E_ASSURANCE_PLAN.md`. Das Live-Google-Parallel-Append-Gate ist eine gesonderte externe Providerprüfung; Deployment-/Authenticator-/Audit-Gates bleiben ebenfalls extern. Ein generischer Browser-`CryptoKey` allein beweist nicht die Einzigartigkeit eines physischen Geräts. |
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
  getrennte v2-RecoveryAuthorityTransition-/Pending-Rekey-Verifier- und
  Fence-Semantik sowie die produktive zweiphasige Recovery-Rekey-Orchestrierung
  sind im Transferable-Single-Writer-v2-Kern inzwischen vollständig
  implementiert und intern regressionsvalidiert.
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

- **V2-01…V2-10:** eingefrorene v2 Wire-/Schema-/Signaturprimitiven, kanonischer
  Verifier mit Writer-/Recovery-Authority-Replay, StateV6/WriterDeviceKeyV2,
  fail-closed normaler Domain-Write-Gate, striktes Google-v2-Profil,
  RecoveryArtifactV6/RecoveryTakeoverStagingV2/SyncBackupV6, produktiver
  crash-resumabler v1→v2-Profile-Upgrade, Recovery-Key-basierter read-only
  Second-Device-Join, Cooperative Handoff, Forced Takeover, native v2→v2
  Rotation und vollständige zweiphasige Recovery-Rekey-Orchestrierung sowie
  der normale App-/Settings-/Domain-Materialisierungspfad. Bestehende
  Fach-Repositories dispatchen anhand der aktiven Protokollselektion; V2-Writes
  benötigen fresh canonical_full + WriterAuthority und werden erst nach
  kanonischem Readback als erfolgreich behandelt. Verifizierte Remote-Daten
  werden nur als verschlüsselte EnvelopeV6 plus HMAC-authentifizierter accepted
  Read-Model-Index lokal gehalten, sodass bereits verifizierter Zustand offline
  lesbar bleibt ohne Klartext-Health-Cache. V2-Settings decken Upgrade, Join,
  Handoff, Forced Takeover, Recovery-Rekey/Pending-Rekey und Stale-Quarantine
  ab. Der lokale Passphrase-/PRF-/Lock-Pfad schützt den aktiven RootWrapV6 und
  bleibt bei noch best-effort geschütztem gleiches-Tagebuch-v1-Historienmaterial
  bis zum crash-resumierbaren Catch-up fail-closed locked. Der Geräteverlustfall
  nach durabler RecoveryAuthorityTransition bleibt end-to-end über Join,
  maintenance-only Forced Takeover, remote Pending-Rekey-Adoption und Phase B
  abgedeckt. Der vollständig grün validierte V2-10 Security-Codehead ist
  `d4bcd4753dfb23ffc03c0cccc7bde67d13bd36d9`.

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
- **V2 Cooperative Handoff:** produktiver A→B-Transfer mit PoP-validiertem
  TransferDescriptorV2, frischem Entscheidungs-Prefix, exakt persistiertem
  WriterGrantV2 g+1, bounded Unknown-Outcome-Retry, konkurrierenden g+1-/
  intervenierenden Prefix-Races, terminaler stale quarantine, Source-Demotion
  erst nach kanonischer Annahme und Target-Promotion erst nach eigenem frischen
  Full Verify.

## V2 END-TO-END ASSURANCE GATES

Verbindliche Gate-/Paket-DoDs: `docs/security/V2_E2E_ASSURANCE_PLAN.md`
(§§10–15, 19–21, 25–27, 31 und 33a). Ein grüner Playwright-Gesamtlauf
allein schließt kein Gate ohne die jeweils erforderlichen konkreten
Assertions, Fault Points und Sicherheitsgrenzen.

**Aktueller integrierter kontrollierter L3-Nachweis:** Der Code-Head
`d1bb713469688fef410fbe4bfd2e82e575294684` von PR #65 bestand
[Security Validation #1022](https://github.com/david-bassler/eds-diary/actions/runs/36451675685).
Alle fünf CI-Jobs waren grün: 284/284 Full-Unit-Tests, 84/84
Security-Unit-Tests, 30/30 Named Security E2E, konfigurierte Browser-Shards
(82 bestanden + 4 übersprungen in Chromium, 86 bestanden in Mobile-Chrome),
2/2 Seeded-Generative-Tests sowie TypeScript, Dependency Audit, Build, Lint,
Storybook und Whitespace. Der `npm run test:release`-Entrypoint wurde nicht
als einzelner zusammengefasster Befehl ausgeführt; seine Bestandteile wurden
auf demselben Code-Head unabhängig erfolgreich ausgeführt. Dokumentations-
Follow-up-Commits benötigen ihren eigenen CI-Check; diese Evidenz ist nicht
automatisch Evidenz für einen späteren SHA.

`GATE-E2E-01` ist für den kontrollierten Provider auf produktiver
Anwendungs-/Servicegrenze **L3 geschlossen**. Der Browser startet mit lokalem
v1, nutzt das normale authentifizierte v1-Remote-Enablement und anschließend
den produktiven v1→v2-Upgrade-Service statt test-erzeugter nativer
V2-Genesis-/Manifest-/WriterGrant-/RootWrap-Artefakte. Normale Domain-Writes,
kanonische Readbacks, Reload/Unlock und der geprüfte read-only Join auf einem
zweiten Browserprofil bestehen. Die ausdrücklich geforderte
**UI-gesteuerte** v1→v2-Migration bleibt als separater `GATE-E2E-05` offen.

`GATE-E2E-02` ist für den kontrollierten Provider auf L3 geschlossen.
Zwei isolierte Browserprofile durchlaufen TransferDescriptor-PoP,
kanonisch akzeptierten g+1-WriterGrant, Source-Demotion und Target-Adoption;
A ist nach Reload read-only, B schreibt Writer-authorisiert weiter.
Live Google bleibt separat offen.

`GATE-E2E-03` ist als **vollständige kombinierte Browserkette OPEN**.
Produktiver Forced Takeover auf dem Ersatzgerät, Fence des verlorenen Writers
und dessen neuer Writer-Write sind browserseitig bewiesen. Die separaten
Recovery-Rekey-Crash-Tests beweisen nun die nach Reload sichtbare durable
Pending-Rekey-Maintenance und den Normal-Write-Fence vor Phase B. Die
zusammenhängende Browsersequenz Forced Takeover -> RecoveryAuthorityTransition
-> Pending-Rekey -> Phase B -> neue normale Writer-Epoche mit kanonischer
Verifikation nach jedem persistierten Schritt ist noch nachzuweisen.
Service-/L2-Evidenz allein schließt diesen L3-Gesamtgate nicht.

`GATE-E2E-04` ist für die **beiden derzeit implementierten
Recovery-Rekey-Crash-Zeitpunkte L3-validiert, als vollständige §13-Matrix
weiter OPEN**. Nach `after-transition-durable` und `before-phase-b`
bestehen Browser-Reload, Re-Auth, sichtbarer UI-Unlock, Pending-Rekey-
Schreibsperre und Settings-Maintenance, Wiederaufnahme einschließlich
Source Backup/Phase B, canonical_full, aktive WriterAuthority und ein
anschließender produktiver durabler Write (Security Validation #1022 in
Chromium und Mobile-Chrome). Produktive L2-Regressionen decken darüber
hinaus R1→R2, Artefakt-/Backup-Verifikation und R1-Negativfälle ab.
Alle §13-persistierten Fault Points und die vollständigen expliziten
Browser-R1/R2-/Semantik-Assertions stehen noch aus.

`GATE-E2E-05` bleibt **OPEN**: Produktiver v1→v2-Service-Upgrade und
Reload/Write/Join sind durch kontrolliertes Browser-L3 belegt, aber die
explizite Migration über die V2-UI samt vollständiger §22-Assertions fehlt.

`GATE-E2E-06` bleibt **OPEN**: Ein wiederverwendbarer
`runPersistentCrashScenario` führt benannte unabhängige Browser-Fault-
Lifecycles für Profile Upgrade, Recovery-Rekey, Handoff, Forced Takeover und
Join erfolgreich aus. Weitere zulässige persistierte Punkte sowie normale
V2-Rotation und Backup Restore fehlen im vollständigen §14-Sieben-Ceremony-
Matrixnachweis. IA-104/IA-106 sind als engere Harness-Defekte geschlossen,
nicht als Erklärung, dass alle Crash-Gates schon vollständig wären.

`GATE-E2E-07` besitzt validierte L2-/L3-**Teilnachweise**, bleibt als
vollständige §15-Browsermatrix **OPEN**. Der produktive Browser-Providerpfad
beweist no-commit, committed-response-lost, physische Duplikate, verzögerte
Antworten und intervenierende Duplikate mit frischem Readback, kanonischem
Zustand und finalem Reload/Unlock. Spezifische konkurrierende Remote-Writes,
erneut unaufgelöste Timeouts und Restart direkt an der unbekannten
Append-Grenze sind noch separat browserseitig nachzuweisen.

`GATE-E2E-08` ist für kontrollierte Remote-Bytes geschlossen. Produktive
Browser-Refreshes verwerfen Löschung/Truncation, Umordnung, fremde Rows,
Ciphertext-Änderung und alte Prefix-Replays vor Materialisierung und
Authority-Nutzung. Byte-identische physische Retries bleiben
spezifikationsgemäß zulässig, werden aber semantisch nur einmal angewandt.
Hostile-Grid-Verhalten bei echtem Google ist ein getrenntes Live-Gate.

`GATE-E2E-09` bleibt **OPEN**. Fach- und Credential-Sentinels werden in
DOM, IndexedDB-Objektwerten, Web Storage und Cache Storage geprüft; bisherige
kontrollierte Assertions sind grün. Der Golden Path wertet jedoch die
instrumentierbaren Diary-origin Requests, Logs und Fehlermeldungen noch nicht
vollständig gegen diese Sentinels aus. Produktionslogs/Source Maps und
opaque OS-Speicher sind zusätzliche externe Prüfungen, kein Grund, die
intern instrumentierbaren Kanäle zu überspringen.

`GATE-E2E-10` ist auf L3 für den kontrollierten Auth-Provider
geschlossen: der produktive Browser-Einstieg durchläuft Popup,
Bridge-Iframe, beide MessageChannels, Identitätsbestätigung und den ersten
allowlisted RPC. Regressionen prüfen endliche Fehlergrenzen,
Origin-/Action-Bindung, Credential-Isolation und Disconnect-Revocation.
Die historische Ursache des realen Google-Handoffs ist dadurch nicht
bewiesen; Live Google und getrenntes HTTPS-Auth-Origin-Deployment bleiben
extern.

**Produktionsfreigabe bleibt ausgeschlossen.** Ein bestandener simulierter
Browser-/CI-Lauf ersetzt weder Live-Google-Verhalten, Deployment-/CSP-/
Auth-Origin-Prüfungen, echte WebAuthn-Geräte noch unabhängigen Audit.

## BLOCKED_EXTERNAL / PRODUCTION RELEASE GATES

- Echte Google-Credentials und ein dediziertes Live-Testkonto einschließlich
  Account-Wechsel, Logout, Permission-, Netzwerk- und Hostile-Grid-Fällen.
- Deployment der Diary- und Auth-Anwendung auf getrennten Origins; der eigentliche
  Hostwechsel bleibt extern, der verschlüsselte Benutzer-Handoff ist implementiert.
- Reale WebAuthn-Geräte-/Browsermatrix.
- Produktions-CSP/-Header, Source-Map-/Logprüfung und externer Security-/Crypto-Audit.

## Interner Status

`SECURITY/DECISION: single-writer-v1 production hardening rationale frozen in EDS_SINGLE_WRITER_V1_HARDENING_DECISIONS.md`

`TODO_INTERNAL: transferable-single-writer-v2 end-to-end assurance — complete the eight remaining internally actionable packages in V2_E2E_ASSURANCE_PLAN.md §33a (IN_PROGRESS #10/#11/#12/#13/#14/#16/#19; NOT_STARTED #24). Packages #2/#5 are now explicitly blocked on the live/deployed prerequisites shared with #21/#22 rather than misrepresented as repository-solvable historical attribution. IA-112 is closed by deterministic cryptographic-open call-count evidence. Packages #10/#16/#19 and the expanded Recovery-Rekey matrix have new local focused evidence but remain open pending final-head integrated CI; IA-121 updates Vitest tooling to 4.1.11 with a zero-vulnerability local high-severity audit; final-head CI is still required. The green configured PR-security CI does not close the other distinct DoDs.`

`BLOCKED_EXTERNAL: Live-Google Parallel-Append-Gate requires a disposable dedicated Google test spreadsheet/account with credentials supplied outside source control. Its harness is implemented (npm run test:live-google-parallel-append); controlled-provider CI cannot satisfy the real-provider gate. Separate-origin deployment, physical WebAuthn and independent audit remain additional external gates.`

`SECURITY/SPEC DECISION: exact transferable-single-writer-v2 wire, signature and recovery-takeover protocol frozen in EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`
