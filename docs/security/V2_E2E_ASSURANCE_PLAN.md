# V2 End-to-End Assurance Plan

Stand: 26.09.2026

## 1. Zweck und Status

Dieses Dokument ist die verbindliche Arbeitsgrundlage fuer den noch fehlenden
End-to-End-Assurance-Track des Transferable-Single-Writer-v2-Stacks.

Ziel ist nicht lediglich mehr Testabdeckung. Ziel ist, dass die
sicherheitskritischen produktiven Lebenszyklen der Anwendung weitgehend
automatisiert gegen ihre Protokoll- und Sicherheitsinvarianten geprueft werden
koennen, ohne einen Menschen als interaktiven Browser-Debugger einzusetzen.

Dieses Dokument erteilt **keine Produktionsfreigabe**. Insbesondere bleiben
echte Google-Provider-Verifikation, getrenntes produktionsnahes
Auth-Origin-Deployment, reale WebAuthn-/Browser-/Geraetematrix und externer
Kryptographie-/Security-Audit eigenstaendige externe Gates.

## 2. Ausloeser / Assurance-Luecke

Beim ersten realen lokalen Google-Login konnte der OAuth-Teil erfolgreich bis
zum Zustand `Identitaet wird gebunden ...` gelangen, der anschliessende
Popup/Bridge/MessagePort-Handoff wurde jedoch nicht abgeschlossen. Die
bestehende automatisierte Suite hatte diesen erfolgreichen Integrationspfad
nicht als End-to-End-Pfad bewiesen.

Vor einer Reparatur ist hierfuer ein neues Implementation-Assurance-Finding
anzulegen (naechste freie IA-Nummer; zum Zeitpunkt dieses Plans voraussichtlich
IA-089). Das Finding muss Beobachtung, Auswirkung, Root Cause, betroffene
Invariante, Regressionstest, Fix und Closure Evidence enthalten.

Konsequenz: Eine gruene Unit-/Browsermatrix gilt nicht als Beweis fuer einen
produktiven Integrationspfad, wenn dessen erfolgreicher End-to-End-Pfad nicht
tatsaechlich ausgefuehrt wird.

## 3. Nicht verhandelbare Arbeitsregeln

1. Vor Aenderungen sind die normativen V2-Spezifikationen, Security-/Assurance-
   Dokumente, Release-Gates und einschlaegigen bestehenden Tests zu lesen.
2. Bestehende Protokoll- und Sicherheitsentscheidungen sind normativ. Keine
   kryptographische oder protokollarische Semantik wird nur deshalb geaendert,
   damit ein Test gruen wird.
3. Neue sicherheitsrelevante Probleme werden **vor dem Fix** als Finding
   dokumentiert.
4. Kein automatisierbarer Fix ohne Regressionstest.
5. Kein Test-Bypass im kryptographischen Core, Verifier, WriterAuthority oder
   produktiven Write-Gate.
6. Assertions beruhen soweit moeglich auf kryptographisch verifiziertem
   Remote-/Persistenzzustand, nicht nur auf UI-Texten.
7. Simulator-/Mock-Evidenz darf niemals ein Live-Provider-Gate schliessen.
8. Testartefakte duerfen keine echten OAuth-Credentials, Recovery Keys oder
   Gesundheitsdaten enthalten.
9. Architektur-/Protokollabweichungen werden nicht stillschweigend repariert:
   Finding dokumentieren, normative Entscheidung explizit machen.
10. Nach jedem Implementierungsschritt: Tests, adversarial sibling review,
    Dokumentation dessen, was bewiesen und ausdruecklich nicht bewiesen ist,
    dann kleiner reviewbarer Commit.

## 4. Assurance-Ebenen

| Ebene | Zweck | Provider/Netz |
|---|---|---|
| L1 | Kryptographie und Protokoll | keines |
| L2 | Storage, Persistenz und Fault Injection | kontrolliert/simuliert |
| L3 | Vollstaendige Browser-E2E-App | kontrollierter Provider-Simulator |
| L4 | Live-Provider-Contract | echtes Google |
| L5 | Reale Plattform-/Hardware-/Deployment-Gates | Google, getrennte Origins, reales WebAuthn |

L3 ist die zentrale neue Ebene. Sie soll fast alle heute manuell
durchgefuehrten Browserablaeufe deterministisch automatisieren.

## 5. Zentrale Security-Invarianten

Mindestens folgende Invarianten sind zentral und stabil zu dokumentieren.
Security-E2E-Tests muessen auf die jeweils bewiesenen Invarianten verweisen.

- **INV-01:** Kein persistenter fachlicher Klartext.
- **INV-02:** Der Diary-Origin erhaelt kein OAuth-Credential.
- **INV-03:** Ein normaler Domain-Write benoetigt frische kanonische Authority.
- **INV-04:** Pro Generation existiert genau eine kanonisch akzeptierte WriterAuthority.
- **INV-05:** Ein retired/stale Writer kann nicht still wieder Writer werden.
- **INV-06:** Pending-Rekey erlaubt keine normalen Domain-Writes.
- **INV-07:** Manipulation wird vor fachlicher Materialisierung erkannt.
- **INV-08:** Unknown Outcome erzeugt keine unkontrollierte Wiederholung.
- **INV-09:** Recovery kann keine aeltere Authority still wiederherstellen.
- **INV-10:** Lock entfernt nutzbares lokales Schluesselmaterial.

Weitere Invarianten duerfen ergaenzt werden; bestehende duerfen nicht ohne
explizite normative Begruendung abgeschwaecht werden.

## 6. Provider-Simulator

An der bestehenden Provider-/Transport-Grenze ist ein kontrollierter
Google-aehnlicher Testprovider zu bauen. Er darf den produktiven
Kryptographie-/Authority-Pfad nicht umgehen.

Er muss mindestens unterstuetzen:

- Ressourcen anlegen und entdecken;
- Tabellen/Rows lesen und append-only schreiben;
- Metadaten und Provider-Identitaeten;
- mehrere getrennte Konten/Identitaeten;
- 401/403/429 und generische Providerfehler;
- Request kommt nie an;
- Remote-Effekt wird committed, Response geht verloren;
- Timeout/verzoegerte Antwort;
- Retry/Duplicate;
- konkurrierende Appends;
- Permission revoked;
- Account switch/wrong account;
- malformed/hostile remote data;
- externe Aenderungen zwischen Read und Write.

Der Simulator ist Testevidenz fuer Anwendungslogik, nicht fuer Googles reale
Semantik.

## 7. Erfolgreicher Auth-Origin-E2E als erster Meilenstein

Der erste neue E2E-Test muss den realen Browserfluss verwenden:

```
Diary Origin
  -> window.open(Auth Popup)
  -> OAuth-Testidentitaet
  -> eds-diary/google-auth-ready/v2
  -> Diary erzeugt/bindet Auth-Bridge iframe
  -> eds-diary/google-auth-bridge-ready/v2
  -> MessageChannels
  -> Credential Popup -> Bridge
  -> Provider-Identitaet wird bestaetigt
  -> RPC-Port wird aktiviert
  -> authenticate() resolved
  -> erster erlaubter Provider-RPC funktioniert
```

Direkte Instanziierung von `GoogleAuthProvider` oder einzelnen
Handshake-Komponenten ist kein Ersatz fuer diesen Browser-E2E.

Der Test muss ausserdem beweisen:

- INV-02: Credential erreicht nie den Diary-Origin;
- falscher Origin wird verworfen;
- falsche/stale `action_id` wird verworfen;
- Handoff hat eine endliche Timeout-Grenze;
- erfolgreicher Abschluss hinterlaesst genau einen gebundenen Client;
- Disconnect schliesst die Capability.

Der aktuell beobachtete Haenger ist zuerst reproduzierbar zu machen. Erst
danach darf der Produktcode repariert werden.

## 8. Adversarial Auth-Handoff

Automatisierte Varianten mindestens fuer:

- Popup geschlossen;
- Popup falscher Origin;
- Bridge falscher Origin;
- falsche, alte oder wiederverwendete `action_id`;
- manipuliertes `return_origin`;
- fehlender/zusaetzlicher MessagePort;
- Token fehlt;
- Permission-ID fehlt;
- Permission-ID aendert sich waehrend des Handoffs;
- Popup/Bridge senden Nachrichten doppelt;
- Nachrichten treffen in anderer Reihenfolge ein;
- Popup oder Bridge wird nie ready;
- fremdes Fenster sendet `ready`;
- RPC-Port stirbt;
- Timeout;
- Authorization-Header soll die RPC-Grenze ueberschreiten;
- Versuch, Credential an den Diary-Origin zu leaken.

Fail-closed bedeutet dabei mindestens: kein authentifizierter Client, keine
Writer-Freigabe, kein Remote-Write, kein Credential im Diary-Origin,
konsistenter lokaler Zustand und ein definierter erneuter Versuch.

## 9. Virtuelle Geraete

Playwright-BrowserContexts modellieren echte getrennte lokale Geraete:

```
Device A: eigener BrowserContext, IndexedDB, local/sessionStorage,
          WriterDeviceKey, Local Security State
Device B: eigener BrowserContext, IndexedDB, local/sessionStorage,
          WriterDeviceKey, Local Security State
```

Beide greifen nur ueber die produktive Provider-Grenze auf denselben
simulierten Remote-Zustand zu.

## 10. V2 Multi-Device Golden Path

Vollautomatischer Happy Path:

### Device A
1. neues Tagebuch;
2. Recovery-Key/RootWrap;
3. Provider verbinden;
4. Remote-Profil anlegen;
5. Domain-Datensatz schreiben;
6. Remote-Durability abwarten;
7. Reload;
8. Unlock;
9. Daten lesen;
10. weiteren Datensatz schreiben.

### Device B
1. frisches Browserprofil;
2. Provider verbinden;
3. bestehendes Diary entdecken;
4. read-only Join;
5. Recovery-Autorisierung;
6. Remote vollstaendig verifizieren;
7. lokalen State erzeugen;
8. Unlock;
9. Daten lesen.

### Cooperative Handoff A -> B
1. B erzeugt TransferDescriptor;
2. A verifiziert PoP/Descriptor;
3. A erzeugt WriterGrant g+1;
4. Remote append;
5. full verify;
6. A verliert WriterAuthority;
7. B fuehrt fresh canonical_full aus;
8. B erhaelt WriterAuthority.

Zwingende Postconditions: A kann nicht mehr schreiben; B kann schreiben;
Reload beider Geraete aendert dies nicht; beide lesen denselben kanonischen
Zustand.

## 11. Stale-Writer-Suite

Nach erfolgreichem Handoff muss A in folgenden Zustaenden einen normalen Write
fail-closed verweigern:

- ohne vorherige Synchronisierung;
- alter offener Tab;
- Browser aus Sleep;
- offline -> online;
- alter IndexedDB-State;
- altes Backup;
- alter WriterKey.

Vor jedem normalen Write muss die spezifizierte fresh-canonical-Authority-
Pruefung wirksam bleiben.

## 12. Forced Takeover / Pending-Rekey

Geraet A wird als verloren simuliert. B durchlaeuft:

Recovery-Key -> Forced Takeover -> RecoveryAuthorityTransition ->
Pending-Rekey -> maintenance-only Writer -> Phase-B-Rotation -> neue Epoche ->
normaler Writer.

Nach jedem persistierten Schritt wird der Remote-Zustand kanonisch verifiziert.
Insbesondere darf Pending-Rekey keinen normalen Domain-Write zulassen.

## 13. Recovery-Rekey

Automatisierter Ablauf:

1. Diary mit Recovery-Key R1;
2. Daten schreiben;
3. Recovery-Rekey starten;
4. Crash an jedem persistierten Uebergangspunkt;
5. Browser neu starten;
6. Unlock;
7. Operation resumieren;
8. R2 aktivieren;
9. Backup neu erzeugen/verifizieren;
10. R1 darf den neuen Zustand nicht autorisieren;
11. R2 funktioniert;
12. Fachdaten bleiben unveraendert;
13. WriterAuthority bleibt protokollkonform.

## 14. Generischer Crash-/Resume-Harness

Mehrstufige Operationen sollen benannte persistente Fault Points exponieren,
beispielsweise:

```
PREPARED
REMOTE_INTENT
REMOTE_APPEND_UNKNOWN
REMOTE_CONFIRMED
LOCAL_STAGED
LOCAL_SWITCHED
CLEANUP
```

Der Runner muss fuer jeden zulaessigen Punkt automatisiert
`kill -> restart -> unlock -> resume -> canonical verify` ausfuehren.

Anwenden mindestens auf Join, Handoff, Forced Takeover, Rotation,
Recovery-Rekey, v1->v2 Upgrade und Backup Restore.

## 15. Unknown-Outcome-Matrix

Mindestens:

A. Request erreicht Provider nicht.
B. Remote-Effekt committed, Response verloren.
C. Effekt committed, danach konkurrierender Remote-Write.
D. Retry bekommt erneut Timeout.
E. Retry erst nach Browser-Reload.

Die App darf weder blind doppelt schreiben noch einen unbekannten Ausgang als
sicher fehlgeschlagen behandeln.

## 16. Parallelitaet / Races

Zwei BrowserContexts fuehren kontrolliert konkurrierende Control-Operationen
aus. Assertions erfolgen auf den kanonisch verifizierten Remote-Bytes.

Abzudecken sind insbesondere konkurrierende g+1-Control-Transitions,
intervenierende Prefix-Aenderungen, Takeover/Handoff-Races und Supersession.

## 17. Remote-Tampering-Suite

Der Simulator stellt nur fuer Tests kontrollierte Mutatoren bereit:

- Row loeschen;
- Row duplizieren;
- Rows umordnen;
- fremde Row einfuegen;
- Ciphertext veraendern;
- Signatur/MAC veraendern;
- Writer-ID veraendern;
- Generation/Epoch veraendern;
- Journal truncaten;
- alte gueltige Snapshots zurueckspielen.

Jede Mutation muss vor unzulässiger fachlicher Materialisierung oder
Authority-Nutzung erkannt werden.

## 18. Kryptographie-Missbrauchstests

Fuer jedes kryptographische Objekt mindestens:

- falscher Key;
- falsches Diary;
- falsche Epoch/Generation/Writer-Bindung;
- falscher Nonce;
- manipuliertes AAD;
- Ciphertext-Bitflip;
- falsche Signatur/MAC;
- abgeschnittene/erweiterte Bytes;
- fehlende/unerwartete Felder;
- Duplicate JSON keys;
- nicht zulaessige JSON/I-JSON-Werte;
- Replay in anderem semantischem Kontext.

Leitinvariante: Ein kryptographisch gueltiges Objekt darf nicht in einem
anderen semantischen Kontext gueltig werden.

## 19. Plaintext-Persistence-Scanner

Golden-Path-Tests schreiben eindeutige synthetische Klartext-Sentinels. Nach
relevanten Operationen werden mindestens IndexedDB, localStorage,
sessionStorage, Cache Storage und sonstige persistente App-Speicher nach diesen
Sentinels durchsucht.

Erwartung: Kein fachlicher Klartext ausserhalb des bewusst entsperrten
fluechtigen Arbeitsspeichers. Dieser Scanner ist explizite Evidenz fuer INV-01.

## 20. Credential-Leak-Scanner

Test-Credentials tragen eindeutige Sentinel-Werte. Geprueft werden soweit
instrumentierbar Diary-DOM/State, IndexedDB, Web Storage, Requests vom
Diary-Origin, Logs und Fehlermeldungen.

Der Credential-Sentinel darf nur innerhalb der vorgesehenen Auth-Origin-/
Provider-Grenze existieren.

## 21. Lock, Passphrase und WebAuthn

### Lock/Unlock
Unlocked Write funktioniert; nach Lock sind geschuetztes Lesen, Schreiben,
Handoff und Recovery-Operationen blockiert. Richtiger Unlock stellt den
zulaessigen Zustand wieder her; falscher Unlock erzeugt keine partielle
Freischaltung.

### Passphrase
Enrollment, Reload, richtiger/falscher Unlock, Lock, Browserneustart,
beschaedigter RootWrap und falsche Context-Bindung.

### WebAuthn
Soweit Browser/CDP realistisch emulierbar: Credential-ID, UV required,
Enrollment, Assertion, falsches Credential, fehlendes/ungueltiges PRF, Cancel,
Reload. Reale Authenticator-/Browsermatrix bleibt L5 und wird nicht durch
virtuelle Tests geschlossen.

## 22. V1 -> V2 Browsermigration

Ein echtes V1-Profil wird ueber den produktiven Browserpfad erzeugt und
anschliessend ueber die V2-UI migriert. Zu pruefen:

- vollstaendige V1-Verifikation;
- Successor-Erzeugung;
- Recovery/Backup;
- Cutover;
- Source retired;
- V2 aktiv;
- Fachdaten identisch;
- keine Legacy-Klartextreste;
- Reload/Unlock/Write;
- anschliessender Join auf Device B.

## 23. Offline-Verhalten

Netzwerk kontrolliert abschalten. Bereits verifizierter akzeptierter Zustand
bleibt gemaess Spezifikation offline lesbar. Reconnect darf keine implizite
WriterAuthority annehmen; normale Writes muessen erneut die vorgeschriebene
frische kanonische Verifikation durchlaufen.

## 24. Security-UI

UI-Zustaende sind Teil der fail-closed Produktgrenze:

- read-only darf keinen normalen Write-Pfad anbieten;
- Pending-Rekey muss Maintenance-Zustand sichtbar machen;
- stale quarantine darf keinen Authority-Bypass anbieten;
- Lock entfernt sensible Darstellung;
- Unknown Outcome darf nicht faelschlich sicheren Fehlschlag behaupten.

UI-Assertions ergaenzen, ersetzen aber keine Protokoll-/Persistenzassertions.

## 25. Property-/generative Tests

Fuer den Protokollkern zufaellige gueltige und adversarielle Ereignisfolgen
erzeugen, z. B. Write, Handoff, Crash, Resume, Takeover, Tamper, Reload.

Nach jedem Schritt globale Invarianten pruefen. Seeds muessen bei Fehlern
reproduzierbar ausgegeben werden.

## 26. Diagnostische Testartefakte

Fehlgeschlagene E2E-Tests sollen redigierte Artefakte erzeugen, z. B.:

```
test-results/<scenario>/
  trace.zip
  remote-before.redacted.json
  remote-after.redacted.json
  device-a-state.redacted.json
  device-b-state.redacted.json
  console.redacted.log
```

Keine echten Secrets oder Gesundheitsdaten.

## 27. CI- und npm-Gates

Zielkommandos:

- `npm run test:security-e2e`
- `npm run test:release`
- sinnvolle kleinere Unterkommandos fuer schnelle Iteration.

CI-Stufen:

### PR-fast
TypeScript/build, lint, Unit/Krypto/Protokoll/Architektur und selektierte E2E.

### PR-security
Vollstaendige simulierte Browser-E2E-, Multi-Device-, Crash-, Tamper- und
Unknown-Outcome-Suite.

### Nightly
Groessere generative/protokollarische Sequenzen mit reproduzierbaren Seeds.

### Live
Nur bewusst gegen echte Provider/Deployments/Authenticators; nie durch Mock-
Evidenz ersetzbar.

## 28. Live-Google-Gates

Der vorhandene Live-Google Parallel-Append-Harness bleibt ein eigenstaendiges
echtes Provider-Gate.

Weitere Live-Contract-Faelle sollen schrittweise automatisiert werden:
Create/Discover, Sheet/Append/Readback, Permission, Account-Mismatch,
401/403/429, Hostile Grid, Netzwerk-/Unknown-Outcome-Faelle soweit realistisch.

Ausschliesslich dedizierte wegwerfbare Testressourcen ohne Nutzerdaten.

## 29. Echter OAuth-Schritt

Wo Google den interaktiven Login zwingend erfordert, darf der Runner auf genau
diese Benutzeraktion warten. Nach erfolgreicher Testkonto-Anmeldung soll der
restliche Provider-/Lifecycle-Test automatisiert weiterlaufen.

Es werden niemals Passwoerter, Access Tokens oder Recovery Keys in Chat,
Repository oder Testartefakte uebernommen.

## 30. Separate-Origin-Deployment

Vor Produktionsfreigabe ist ein echter Cross-Origin-Pfad zu testen, z. B.
Diary-Origin und separater Auth-Origin. Zu pruefen sind insbesondere CSP,
Referrer-Policy, Permissions Policy, COOP/Frame-Schutz, Popup/Bridge/
MessagePort, Credential-Isolation, Source Maps und sensitive Logs.

Localhost/Same-Origin-Evidenz ersetzt dieses Gate nicht.

## 31. Explizite Release-Gates

Die Release-Gate-Dokumentation soll mindestens folgende explizite Nachweise
unterscheiden:

- **GATE-E2E-01** Local full lifecycle
- **GATE-E2E-02** Two-device cooperative handoff
- **GATE-E2E-03** Forced takeover / Pending-Rekey
- **GATE-E2E-04** Recovery-Rekey
- **GATE-E2E-05** v1->v2 migration
- **GATE-E2E-06** Crash/resume matrix
- **GATE-E2E-07** Unknown outcomes
- **GATE-E2E-08** Remote tampering
- **GATE-E2E-09** No plaintext persistence
- **GATE-E2E-10** Successful Auth-Origin handoff
- **GATE-LIVE-01** Google provider contract
- **GATE-LIVE-02** Google parallel append
- **GATE-LIVE-03** Separate Auth-Origin deployment
- **GATE-LIVE-04** Real WebAuthn/browser/device matrix
- **GATE-AUDIT-01** Independent crypto/protocol/application audit

Die Formulierung `Playwright-Matrix gruen` allein ist kein hinreichender
Nachweis fuer diese Gates.

## 32. Finding-Lifecycle

Jedes neue Problem folgt:

```
Finding
-> Root Cause
-> affected INV-*
-> failing regression
-> fix
-> adversarial sibling review
-> closure evidence
```

Wenn ein Fix eine fruehere Designentscheidung aendert, muss dokumentiert
werden, warum die alte Entscheidung plausibel war, warum sie dennoch
unvollstaendig/falsch ist und welcher Test kuenftiges Hin-und-her-Reparieren
verhindert.

## 33. Verbindliche Implementierungsreihenfolge

1. aktuelles Auth-Handoff-Finding dokumentieren;
2. Fehler automatisiert reproduzieren;
3. Provider-Simulator/Testgrenze bauen;
4. erfolgreichen Popup/Bridge-E2E bauen;
5. Auth-Root-Cause fixen und Regression schliessen;
6. Multi-Context-Geraete-Harness;
7. V2 Golden Path;
8. Cooperative Handoff A->B;
9. stale-A write rejection;
10. Forced Takeover/Pending-Rekey;
11. Recovery-Rekey;
12. v1->v2 Browsermigration;
13. generischen Crash-/Resume-Harness;
14. Unknown-Outcome-Matrix;
15. Remote-Tamper-Matrix;
16. Plaintext-/Credential-Leak-Scanner;
17. Lock/Passphrase;
18. virtuelles WebAuthn soweit belastbar;
19. generative Protokolltests;
20. CI-/npm-Gates;
21. Live-Google-Suite;
22. separates Auth-Origin-Deployment;
23. reale WebAuthn-Matrix;
24. abschliessender adversarieller Gesamtreview;
25. externer Audit.

## 33a. Persistenter Implementierungs-Ledger

Dieser Ledger ist das dauerhafte Fortschrittsgedaechtnis fuer den gesamten in
Abschnitt 33 definierten Auftrag. Der Nenner ist **immer 25**. Er darf weder aus
dem aktuellen Prompt noch aus dem aktuellen Codex-Turn verkleinert werden.

Zulaessige Statuswerte: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`.
`BLOCKED` ist nur fuer eine konkret benannte Abhaengigkeit zulaessig. Intern
loesbare Fehler sind kein externer Blocker und bleiben `IN_PROGRESS`.

| # | Arbeitspaket | Status | Closure-/Blocker-Evidenz |
|---:|---|---|---|
| 1 | Aktuelles Auth-Handoff-Finding dokumentieren | DONE | IA-089 records the observed successful-OAuth/hanging-handoff gap, impact, affected INV-02/INV-03, required regression, fail-closed bounds, and evidence still required before closure. Documentation-only review; no protocol or crypto semantics changed. |
| 2 | Auth-Handoff-Fehler automatisiert reproduzieren | IN_PROGRESS | The controlled L3 suite deterministically reproduces the same post-OAuth binding symptom and finite timeout, but this does not establish that the historical real-Google incident had the same root cause. The historical live reproduction/causal attribution remains open and belongs with the provider/deployment evidence; simulated regression coverage remains green. |
| 3 | Provider-Simulator/Testgrenze bauen | DONE | `ControlledProviderSimulator` implements the production `RemoteTransport` boundary with shared resources, discovery, manifest/row reads, append-only writes, properties, isolated identities/accounts, permission revocation, 401/403/429/generic failures, request-not-received, committed-response-lost, delay, duplicate commit, concurrent append, intervening append, and controlled hostile mutation/replay primitives. Seven focused tests cover positive and adversarial siblings. It returns raw remote bytes only and grants no verified/Writer capability, so productive crypto/authority verification remains mandatory. Evidence: `npx vitest run src/test/controlledProviderSimulator.test.ts`; `npm run lint:js -- --quiet`; `npm run build`. This L2/L3 simulator does not prove Google semantics or close a Live gate. |
| 4 | Erfolgreichen Popup/Bridge-E2E bauen | DONE | Browser coverage now includes the real Settings UI entry (`/configuration` → Recovery acknowledgement → `Mit Google verbinden`) and drives the productive popup, hidden Bridge iframe and MessageChannel handoff. Lower-level adversarial siblings retain stale-action/origin/timeout/header/disconnect coverage. Credential sentinel scanning includes Diary DOM, Web Storage, every IndexedDB object-store value and Cache Storage. This proves the controlled L3 app path, not Google or separate-origin deployment. |
| 5 | Auth-Root-Cause fixen und Regression schliessen | IN_PROGRESS | The concrete simulated Bridge/Popup failure modes are fixed and regression-covered, including bounded provider reads and credential-free failure propagation. IA-090 is closed. IA-089's historical real-Google root cause is not proven by simulator evidence, so the overall root-cause package remains open pending live/provider/deployment evidence. |
| 6 | Multi-Context-Geraete-Harness | DONE | `MultiDeviceHarness` creates independent non-persistent BrowserContexts, runs the productive popup/Bridge/RPC authentication boundary separately in each, generates and persists distinct non-extractable WriterDeviceKeyV2 keys in each context, and exposes one shared provider-side remote only through authenticated allowlisted Google-RPC routes. Regression proves IndexedDB/Web Storage isolation, distinct Writer key IDs, shared ordered remote visibility, and absence of direct cross-context state copying. Evidence: `npx playwright test tests/multi-device-harness.spec.ts --project=chromium --reporter=line`; lint and build green. This is harness evidence only, not the V2 lifecycle proof assigned to #7. |
| 7 | V2 Golden Path | DONE | IA-091 closed and the five-case Chromium suite now drives: independent Auth-Origin sessions; strict V2 Google transport; ManifestV6/RecoveryArtifactV6/genesis; canonical_full; persisted RootWrapV6/StateV6/key; validated atomic native-genesis protocol selection; fresh-authority `V2DomainWritePreparer`; durable readback; reload/RootWrap open/read-model read/second write; full Device-B Recovery-authorized productive Join, selection/runtime refresh/repository materialization, distinct key and fail-closed write with unchanged remote. Unit siblings reject non-Writer native selection and conflicting selection. Proves INV-01 for encrypted journal/read model and INV-03 for normal writes. Evidence: five Chromium tests, 22 V2 local-state tests, lint, build. Does not prove Live Google, separate origins, crash/tamper/scanner or handoff gates. |
| 8 | Cooperative Handoff A->B | DONE | Sixth Chromium multi-device case runs the productive services across two isolated selected BrowserContexts: B creates a PoP-signed TransferDescriptor from its persisted read-only key; A verifies it, freshly verifies canonical authority, persists/signs the exact g+1 Handoff Grant, appends/readbacks canonical durability and demotes; B freshly verifies and adopts generation 2. Remote bytes contain exactly one Grant row. After reload/re-auth/RootWrap reopen, A remains read-only and its normal `V2DomainWritePreparer` call fails before append; B remains Writer and produces the next durable canonical domain row. Proves INV-03/04/05 and GATE-E2E-02 at L3. Evidence: six Chromium tests, lint, build. Does not prove Live Google or the broader stale-device matrix. |
| 9 | Stale-A Write Rejection | DONE | Seventh Chromium case restores a coherent pre-Handoff IndexedDB snapshot (State, reservations, envelope journal, outbox, read model and WriterGrant operations) while retaining A's old non-extractable Writer key, then exercises immediate unsynchronised write, delayed old-tab/sleep-wake equivalent, offline attempt and reconnect retry. Every attempt fails closed through the productive `V2DomainWritePreparer`/fresh-canonical-authority path and the shared remote row count remains byte-for-byte append-count stable. Package 8 additionally proves the stale role survives reload. This covers old local state/backup/key without copying authority or bypassing verification and proves INV-03/05 at L3. Evidence: seven-case `tests/multi-device-harness.spec.ts` Chromium suite, lint and build. It does not prove browser/OS process suspension or Live Google semantics. |
| 10 | Forced Takeover / Pending-Rekey | DONE | An eighth Chromium multi-device case loses A without Handoff, lets independently joined B execute `ProductiveForcedTakeoverV2Service` with the Recovery Key, canonically adopts generation 2, proves A cannot append and B can write normally. Productive-service integration siblings cover durable Pending-Rekey, maintenance-only Forced Takeover, lost-operation adoption, full replacement-device Join→Takeover→Phase-B rotation, wrong Recovery Key, prepared crash/resume and stale prefix races. Evidence: focused Chromium takeover case; `v2ReadOnlyJoin` (15 cases); 12-case Recovery-Rekey/Pending-Rekey integration selection. Proves INV-03/05/06 and GATE-E2E-03 across L3 browser takeover plus L2 productive Pending-Rekey orchestration. It does not prove provider/device loss on Live Google. |
| 11 | Recovery-Rekey | DONE | Productive integration matrix starts with R1 and domain data, creates and publishes exact R2 RecoveryArtifact bytes, persists/recovers prepared and publish-fence crash points, canonically commits RecoveryAuthorityTransition, enforces Pending-Rekey, produces/verifies the source backup, executes mandatory Phase-B native rotation, preserves domain materialization/WriterAuthority, rejects credential reuse and stale/superseded races, adopts after metadata/device loss, and validates old/new authority semantics. Evidence: `npx vitest run src/test/profileUpgradeV2Service.test.ts -t "Recovery-Rekey|Pending-Rekey"` (12 passed) plus focused read-only/takeover suite. Proves INV-03/06 and GATE-E2E-04 at productive L2; browser restart UI and Live Google remain outside this package's evidence. |
| 12 | v1->v2 Browsermigration | IN_PROGRESS | Extend the already productive crash-tested migration service evidence to the required browser/UI path, reload/unlock/write and Device-B Join assertions. |
| 13 | Generischen Crash-/Resume-Harness | NOT_STARTED | - |
| 14 | Unknown-Outcome-Matrix | DONE | Productive coordinator/ceremony tests cover request-not-received, commit-with-lost-response, committed exact bytes followed by an intervening remote append, repeated timeout/no-commit without blind looping, and exact-byte retry after recreated service state. Handoff, profile-upgrade Announcement/Confirmation, native rotation and Recovery-Rekey independently reconcile by fresh readback, never regenerate semantic control bytes and quarantine/supersede when the decision prefix changes. The controlled provider supplies deterministic no-commit, committed-response-lost, duplicate, delay and intervening-append faults. Evidence: 12 focused unknown/retry tests, seven provider-simulator tests and full 276-test release unit gate. Proves INV-03/04/05 and GATE-E2E-07 at productive L2; browser-process kill and Live Google uncertainty remain in #13/#21. |
| 15 | Remote-Tamper-Matrix | DONE | A Chromium case mutates the shared provider bytes after a canonical domain write: row deletion/truncation, row reordering, syntactically valid foreign insertion, ciphertext bit mutation and old-prefix replay all fail during the productive authenticated-session refresh before new materialization/authority use. Byte-identical duplicate physical retries remain normatively accepted but materialize the pain revision exactly once and preserve Writer status. The 38-case verifier/primitives/storage matrix rejects IV/revision-ID reuse, bad ciphertext/AAD/signatures, cross-type IDs, impossible generation/key/epoch/Writer bindings, missing genesis, malformed manifests/rows and changed migration semantics. Evidence: hostile-remote Chromium case and 38 focused protocol tests. Proves INV-01/03/04/05 and GATE-E2E-08 for controlled bytes; provider-hostile grid and Live Google remain #21. |
| 16 | Plaintext-/Credential-Leak-Scanner | DONE | The browser Golden Path now scans DOM, complete values from every IndexedDB database/object store, localStorage, sessionStorage and Cache Storage after authenticated canonical writes, reload, RootWrap reopen and a second durable write. Unique health (`synthetic-v2-golden-path`) and OAuth (`multi-device-oauth-sentinel`) sentinels are absent. The Auth handoff suite independently checks the credential sentinel during stalled, failed and successful Popup/Bridge flows and inspects Diary-origin requests/DOM/storage metadata. Proves INV-01 and GATE-E2E-09 for the controlled L3 path. It cannot inspect opaque browser internals, OS swap, provider-origin memory, production logs or source maps. |
| 17 | Lock/Passphrase | DONE | Productive RootWrap tests cover Argon2id enrollment, lock, correct/wrong unlock, reload persistence, corrupted wrap and exact diary/epoch/key/manifest context binding; WebAuthn-PRF primitives cover UV/PRF output and credential binding. Productive V2 integration siblings route protection to active RootWrapV6 plus retained same-diary v1 source, remain fail-closed during partial catch-up, and keep post-Join ceremonies usable after lock/unlock. Six Chromium security-product-flow cases cover user-facing recovery/configuration/fail-closed states. Evidence: `localRootWrap` + `webauthnPrf` (13 passed), security-product-flow Chromium (6 passed), and the focused strong-protection integration cases. Proves local INV-01/03 protection behavior; virtual/realtime authenticator coverage remains #18 and real hardware remains #23. |
| 18 | Virtuelles WebAuthn soweit belastbar | DONE | A Chromium CDP test installs a CTAP2.1 internal virtual authenticator with resident-key, automatic presence and required user verification, then invokes the productive `enrollWebAuthnPrf()` browser ceremony on a valid localhost RP. Current headless Chromium completes registration/assertion but exposes no PRF result, and the product deterministically fails closed with `WebAuthnPrfUnavailableError`; if Chromium begins exposing PRF, the same test requires non-empty credential binding and an exact 32-byte result. Unit siblings prove UV-required options, exact credential/RP/eval-input binding, success, wrong credential, missing/short PRF, absent API and insecure-context rejection. Evidence: Chromium virtual-authenticator case plus six `webauthnPrf` tests. This is the maximum credible virtual evidence and explicitly does not close real authenticator/browser/device matrix #23. |
| 19 | Generative Protokolltests | NOT_STARTED | - |
| 20 | CI-/npm-Gates | DONE | Added named `test:security-unit`, `test:security-e2e`, `test:security-generative` and aggregate `test:release` npm gates. The security workflow invokes the named unit/E2E gates and schedules the reproducible-seed model nightly while retaining typecheck, full unit, crypto/protocol, build, lint/stylelint, Storybook, complete configured Playwright and whitespace checks; Live Google remains an explicit opt-in command rather than silently using mocks. Evidence: `test:security-unit` (81 passed), `test:security-e2e` (20 passed), `test:security-generative` (2 passed), and full `npm run test:release` (lint/build, 276 unit, 20 Chromium, Storybook all green). CI execution on GitHub itself remains subject to the hosting service, but all repository-defined commands ran locally. |
| 21 | Live-Google-Suite | BLOCKED | Requires credentials for a dedicated disposable Google test account and consent to create/delete real Drive/Sheets resources. No credentials or production data may be committed or requested through repository fixtures. Once supplied out-of-band, run provider create/discover/read/append, permission/account/401/403/429/hostile-grid/unknown-outcome cases and `npm run test:live-google-parallel-append`. Simulator evidence cannot close this gate. |
| 22 | Separates Auth-Origin-Deployment validieren | BLOCKED | Requires actual deployed HTTPS Diary and Auth origins with production-equivalent DNS/headers. The repository can build both entry points, but localhost/same-origin routing cannot validate deployed CSP, COOP, frame, Referrer-/Permissions-Policy, source-map/log exposure or real cross-origin popup/iframe behavior. Deploy both origins, provide their public non-secret URLs, then execute the Auth suite and header/log review. |
| 23 | Reale WebAuthn-Matrix validieren | BLOCKED | Requires physical authenticators/passkey providers and real supported browser/device combinations. Chromium's CTAP2.1 virtual authenticator was exercised in #18 but currently exposes no PRF output and cannot establish platform/hardware PRF behavior. Execute enrollment/assertion/cancel/wrong-credential/reload across the normative real matrix; never substitute virtual evidence. |
| 24 | Abschliessender adversarieller Gesamtreview | NOT_STARTED | - |
| 25 | Externer Audit | BLOCKED | Requires an independent qualified crypto/protocol/application auditor, an agreed scope and delivery of a signed report with all release-blocking findings closed. Repository-local self-review cannot satisfy independence. |

### Ledger-Protokoll

- Vor Beginn eines Pakets: Status auf `IN_PROGRESS` setzen und committen oder im
  selben Commit mit der ersten substanziellen Arbeit nachvollziehbar aendern.
- Bei jedem neu entdeckten Unterproblem: Finding/Unteraufgabe dauerhaft
  dokumentieren, bevor der Fix erfolgt. Es darf nicht nur im Chat/Turn existieren.
- `DONE` verlangt die Definition of Done aus Abschnitt 34 und konkrete Evidenz in
  der letzten Spalte (Tests/Commit/Finding-Closure, nicht nur "implemented").
- Ein Paket mit fehlender erforderlicher Validierung bleibt `IN_PROGRESS`.
- `BLOCKED` verlangt den konkreten externen Blocker und die noch notwendige
  Benutzer-/Provider-/Hardwareaktion in der Evidenzspalte.
- Nach jedem Paket ist die Summenzeile unten zu aktualisieren.
- Codex muss nach einem `DONE` automatisch das naechste intern ausfuehrbare Paket
  auf `IN_PROGRESS` setzen und weiterarbeiten, solange der zugewiesene Lauf nicht
  technisch beendet wird oder eine echte normative/externe Entscheidung benoetigt.
- Ein neuer Codex-Lauf beginnt mit dem Lesen dieses Ledgers und setzt beim ersten
  `IN_PROGRESS`, sonst beim ersten intern ausfuehrbaren `NOT_STARTED` fort.
- Ein spaeterer Review darf ein `DONE` wieder auf `IN_PROGRESS` setzen, wenn die
  Closure-Evidenz widerlegt oder eine Regression gefunden wird. Dies ist keine
  Statusverschlechterung, sondern korrektes Assurance-Verhalten.

**Gesamtstatus (muss bei jeder Ledger-Aenderung aktualisiert werden):**
`DONE 15/25; IN_PROGRESS 3/25; BLOCKED 4/25; NOT_STARTED 3/25; remaining internally actionable: 6`

Die initiale Zahl `remaining internally actionable: 23` behandelt die reale
WebAuthn-Matrix (#23) und den externen Audit (#25) als von vornherein extern.
Andere Pakete duerfen erst dann aus dem intern ausfuehrbaren Rest herausfallen,
wenn ihr konkreter externer Blocker im Ledger dokumentiert ist.

## 34. Definition of Done fuer jeden Schritt

Ein Schritt ist erst abgeschlossen, wenn:

- der positive Pfad automatisiert reproduzierbar gruen ist;
- relevante negative/adversarielle Geschwisterfaelle getestet sind;
- betroffene INV-* dokumentiert sind;
- keine Test-only-Abkuerzung die produktive Sicherheitsgrenze umgeht;
- alle bestehenden relevanten Tests weiterhin gruen sind;
- Finding/Release-Gate-Dokumentation aktualisiert ist;
- klar dokumentiert ist, was der Schritt **nicht** beweist;
- der Commit klein genug fuer einen eigenstaendigen Review ist.

## 35. Arbeitsauftrag fuer Codex/automatisierte Implementierer

Arbeite selbststaendig entlang der Reihenfolge in Abschnitt 33. Beginne mit dem
aktuell beobachteten erfolgreichen OAuth-aber-haengenden Auth-Origin-Handoff.
Lies zuerst die normativen Spezifikationen und vorhandenen Assurance-Dokumente.
Dokumentiere das Finding vor dem Fix und reproduziere es automatisiert.

Aendere niemals stillschweigend Protokoll- oder Kryptographiesemantik, um einen
Test gruen zu bekommen. Bei einer echten Spezifikationsluecke: Finding
dokumentieren und die normative Entscheidung explizit zur Pruefung stellen.

Nach jedem Schritt Tests ausfuehren, adversarial nach Geschwisterfehlern suchen,
Evidenz und Restgrenzen dokumentieren und einen kleinen reviewbaren Commit
erstellen. Fahre danach mit dem naechsten Schritt fort, solange keine normative
Entscheidung oder ein externes Live-Gate menschliche Eingabe erfordert.
