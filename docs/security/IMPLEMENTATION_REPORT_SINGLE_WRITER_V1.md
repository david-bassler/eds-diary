# Implementierungsbericht – Google Sheets Single Writer v1

Stand: 15.09.2026

## A. Ausgangszustand

Der Prototype speicherte fachliche Records in fünf Klartext-IDB-Stores, Aktivitätstypen in `localStorage`, lud Google GIS im sensiblen Hauptorigin, synchronisierte fachliche Tabellen per Replace und führte Timestamp-LWW aus. Connect/Online konnten ohne kryptographischen Pull einen Push starten. Details stehen im Implementierungsaudit.

## B. Architektur nach Implementierung

- `security/crypto`: CSPRNG, kanonisches JSON, SHA-256, HMAC, HKDF, AES-256-GCM, Argon2id-Parameter und Bytekodierung.
- `security/envelopes` und `security/revisions`: reservierungsbasierte One-shot-Envelopes sowie begrenzter immutable Revision Graph mit expliziten Merge-Heads.
- `data/localDatabase`: verschlüsselte Source of Truth mit non-extractable Best-Effort-Key und Legacy-Cutover.
- `sync/core`: providerneutrale Verträge, Create-Reconciliation, Prefix/Anchor und Pull-before-Push-Coordinator.
- `sync/google`: `_m`/`_r`-Codec, Sheets-/Drive-Adapter und gesperrte Auth-Origin-Schnittstelle.
- `security/recovery`, `rotation`, `backup`, `securityModes`: Recovery-Continuity, geordnete Rotation-Gates, begrenztes verschlüsseltes Backup und lokale KEK-Grundbausteine.

Der alte Google-Tabellenpfad bleibt nur als deaktivierter Legacy-Code zur UI-Kompatibilität. Ohne getrennten Auth-Origin kann kein Token erworben und damit keine alte Remote-Mutation ausgeführt werden.

## C. Migration

DB v6 legt einen nicht extrahierbaren AES-256-GCM-Key und `secureRecords` an. Beim ersten Zugriff werden alle fünf Legacy-Stores vollständig gelesen, recordweise mit Store und ID als AAD verschlüsselt und die Identifier im Ziel erneut geprüft. Erst danach wird der Cutover-Marker gesetzt. Der Quellbestand wird nicht gelöscht. Mutationen sind serialisiert und schreiben nach Cutover nur ins verschlüsselte Ziel. Die frühere Aktivitätstyp-`localStorage`-Quelle wurde nicht automatisch importiert: Dafür fehlt ein normatives, datenschutzgerechtes Purge-/Import-Gate; neue Aktivitätstypen werden verschlüsselt gespeichert.

## D. Kryptographie

WebCrypto implementiert SHA-256, HMAC-SHA-256, HKDF-SHA-256 und AES-256-GCM. IDs/IVs kommen ausschließlich aus `crypto.getRandomValues`. Envelope-ID-Reservierung geschieht vor der einzigen Verschlüsselung. Recovery nutzt eine zufällige 32-Byte-URS, HKDF, AEAD und das normative generation-bound Commitment. Argon2id wird lokal über `@noble/hashes` mit v0x13, 64 MiB, 3 Iterationen, Parallelität 1 und 32 Byte abgeleitet. Feste Golden Vectors decken Epoch Salt, Envelope Key und URS Commitment ab.

## E. Google Transport

Der Adapter erzeugt ausschließlich `_m` und `_r`, schreibt Manifestwerte als Strings und appended `_r` mit `RAW`. Discovery nutzt einen persistierten Locator nur als Kandidatenhilfe. Der Core bindet erst nach Manifestprüfung genau einen Kandidaten; null bleibt pending, mehrere werden ambiguous. Append-Timeouts werden per Readback reconciliiert; Retries verwenden dieselbe gespeicherte Zeile. Durable wird erst nach abschließendem Vollread, Prefixprüfung und atomarem Store-Callback gesetzt.

## F. Single-Writer-Grenze

`SingleWriterCoordinator` erlaubt `pushPending()` nur nach `pullVerify()` derselben lokalen Generation. Connect und Online invalidieren Autorität und mutieren nicht remote. Anchor-Rollback, abweichende Bytes unter gleicher Envelope-ID und Generation-Wechsel blockieren den Writer. Der Revision Graph bewahrt parallele fachliche Heads und kennt keine Timestamp-/Row-LWW-Regel.

## G. Recovery / Rotation / Backup

Recovery prüft das bereits authentisiert erwartete URS-Commitment und den erwarteten Anchor **vor** Root-Key-Aktivierung. Rotation ist als persistent abbildbare, strikt geordnete Zustandsmaschine modelliert; Switch ist erst nach Successor-Verify, Recovery, Backup-Test und durable Announcement möglich. Backup verschlüsselt den vollständigen übergebenen Envelopebestand, begrenzt Input vor Decode/Parse und unterstützt nicht-destruktiven Test-Restore.

Die vollständige UI-Orchestrierung und persistente Crash-Resume-Verkabelung dieser Grundbausteine ist noch nicht releasefähig und bleibt fail-closed.

## H. Tests

Vor Änderung: `npm install` PASS; `npm run build` PASS; `npm run lint` FAIL (15 bestehende Fehler/21 Warnungen); `npm run build-storybook` PASS; `npm run test:e2e` FAIL (bestehende UI-/Locatorfehler).

Nach Änderung wurden `npm run test`, `npm run build`, `npm run lint`, `npm run build-storybook` und `npm run test:e2e` erneut ausgeführt; Resultate sind im Commit-Abschluss und in der finalen Antwort exakt ausgewiesen. Unit-Abdeckung umfasst Golden Vectors, One-shot, Revision-Konflikte/Merge, Create-Ambiguität, Unknown Outcome, Pull-before-Push, Bytekonflikt, Recovery, Rotation, Backup, Architektur und ein exhaustives kleines Zustandsmodell.

## I. Security Review Checklist

1. Kann irgendein Retry neu verschlüsseln? **Nein** im neuen Core; nur persistierte Bytes werden erneut gesendet.
2. Kann Connect/Online vor Pull+Verify pushen? **Nein**; alte Callbacks mutieren nicht mehr, Coordinator blockiert.
3. Kann fachlicher Klartext neu persistent gespeichert werden? **Nein** über die Repository-APIs; sie schreiben in `secureRecords`.
4. Kann ein Google API Type in den Core gelangen? **Nein**; statischer Architekturtest prüft die Grenze.
5. Wird HTTP 200 allein als Durable-Ack behandelt? **Nein**; Readback, Vollprüfung und Anchor-Commit sind Pflicht.
6. Kann ein falscher/älterer Anchor still akzeptiert werden? **Nein**; gekürzter oder geänderter Prefix blockiert.
7. Kann Rotation vor Verify/Recovery/Backup-Test aktivieren? **Nein** in der Zustandsmaschine.
8. Kann ein stale Gerät nach Announcement in die alte Epoche schreiben? **Nein** im Rotationsmodell.
9. Kann eine falsche URS sich selbst bestätigen? **Nein**; ein bereits authentisiertes erwartetes Commitment ist erforderlich.
10. Kann physische Sheet-Reihenfolge fachliche Konflikte entscheiden? **Nein** im Revision Core.
11. Werden Legacy-Daten erhalten? **Ja, erhalten**; Migration ist nicht-destruktiv und prüft alle IDs.
12. Wurden Tests/Vektoren abgeschwächt? **Nein.** Es gab zuvor keine normativen Code-Vektoren im Repo.

## J. Offene Punkte / Release Blocker

- Separater Auth-Origin/Handoff und kontrollierbares Header-Hosting fehlen; Google ist deshalb in der UI fail-closed.
- Keine Live-Google-Tests ohne Credentials/Testprojekt.
- Manifest-AEAD muss durch den vom Codec zwingend verlangten Verifier an den Unlock-/Epoch-Lifecycle angebunden werden.
- Envelope-Journal, State-MAC, Remote Binding/Anchor und Rotation State sind als Core-Verträge/Modelle vorhanden, aber noch nicht vollständig in IDB/UI verdrahtet.
- WebAuthn-PRF benötigt reale Browser-/Authenticator-Enrollment- und Post-Assertion-Integration.
- Migration der alten Aktivitätstypen aus `localStorage` sowie ein getestetes explizites Purge-Gate fehlen.
- Die bestehende Playwright- und ESLint-Baseline enthält unabhängige Fehler.
- Externer Security-/Crypto-Review fehlt.

Damit ist dies eine fail-closed Sicherheitskern-Implementierung, **kein Produktionsfreigabe-Claim**.

## K. SECURITY/SPEC DECISION REQUIRED

- Exakte normative Feldmenge, AAD und Golden Vectors für Revision-Envelope und Manifest fehlen in den bereitgestellten Spezifikationen. Die implementierte Envelope-AAD ist versioniert und zentral, darf aber ohne normative Bestätigung nicht remote aktiviert werden.
- Exakte Prefix-Hash-Initialisierung/Verkettung wird nicht bytegenau normativ definiert. Die zentrale Implementierung bindet Domain, Diary, Epoche, Zeilennummer, Reihenfolge und JCS-Zeilen; Produktionsaktivierung benötigt einen bestätigten Golden Vector.
- Bestandsmigration des fachlichen `localStorage`-Werts benötigt eine normative Entscheidung zu Importbestätigung und sicherem Purge. Bis dahin entstehen dort keine neuen Writes.
