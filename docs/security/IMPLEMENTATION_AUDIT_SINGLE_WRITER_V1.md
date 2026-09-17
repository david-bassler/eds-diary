# Implementierungsaudit – Single Writer v1

Stand: 16.09.2026 (finaler Integrationsstand PR #20)

## Adversarialer Produktpfad-Review

| Prüfpunkt | Ergebnis |
|---|---|
| Helper vorhanden, aber nicht produktiv benutzt | Die Feature-Repositories laufen über `localDatabase` auf dem entschlüsselten Head des Envelope-/Revision-Graphen. Nach dem authentifizierten Provider-Handoff baut `installAuthenticatedGoogleSession` den Service aus dem MAC-gebundenen aktiven Epoch-State neu auf; Dirty- und Full-Trigger besitzen nur noch diesen Coordinator-Slot. Legacy-Whole-Table-Synchronizer werden beim App-Start nicht registriert und ihre Registrierung schlägt geschlossen fehl. |
| Alter Source-of-Truth-Pfad | `secureRecords` existiert nicht mehr. Die alten Klartext-Stores und der historische Activity-Type-LocalStorage-Key werden ausschließlich nichtdestruktiv inventarisiert und migriert. |
| Lokale Manipulation | Root-Wrap und `epoch_local_security_state`/State-MAC werden beim Laden geprüft. Jeder normale Fach-Read prüft zusätzlich die vollständige Journalfolge, exakte Rowbytes, Count und Hashkette; State- und Journal-Manipulation sind fatal. |
| Lokaler Root-Wrap | `best-effort`, Argon2id-Passphrase und WebAuthn-PRF besitzen getrennte Wrap-Pfade. Der WebAuthn-Browserpfad verlangt UV, exakte Credential-ID und eine 32-Byte-Post-Enrollment-PRF-Assertion; Unsupported-/Mismatch-Fälle schlagen geschlossen fehl. Reale Authenticator-/Browservalidierung bleibt externes Release-Gate. |
| Crash zwischen lokalen Phasen | Envelope-ID-Reservation ist eine eigene persistente Phase. Envelope, Revision, Journal, exakte Rowbytes und Outbox werden danach atomar geschrieben; eine verwaiste Reservation wird nie wiederverwendet. |
| Create Unknown Outcome | `planned`, Discovery, `create_pending`, Candidate, Manifest, Properties, Final-Reconcile und `bound` werden persistiert/readback-verifiziert. Auch beim Resume aus `create_pending` läuft Discovery vor einem weiteren Create. Vor `bound` wird exakt ein Candidate verlangt. |
| Generation Race / Durable | Jede Envelope-Operation erfasst ihre eigene aktuelle `operation_generation`; `prepared`, `pending`, `remote_seen` und `durable` werden persistiert. Anchor und `durable` werden in derselben IDB-Transaktion gespeichert. |
| Same-ID/different-bytes / IV reuse | Der Full-Verifier verwirft beides; byteidentische physische Retries bleiben Bestandteil des Prefix. |
| Mutation nach Freeze | Alle Phasen ab `source_frozen_verified` blockieren Feature-Mutationen persistent. |
| Switch vor Announcement | Die Rotation orchestriert Copy, Full Verify, Semantic-Gleichheit, Recovery-Bootstrap, Backup-Test-Restore und Announcement-Full-Verify; Switch ist nur nach `announcement_durable` erreichbar. |
| Recovery Self-Confirmation | `recoverRootKeyCandidate` aktiviert nichts. Der Google-Transport besitzt keinen öffentlichen Konstruktor, akzeptiert weder Permission-ID noch Account-Binding und kann nur mit einem von der Auth-Grenze ausgegebenen Client entstehen. Er liest die Permission-ID selbst über `drive.about`, gleicht sie mit der unveränderlichen Session-Identity ab und leitet das Binding intern ab. Ein selbst bestätigender Stub und ein frei gebauter Loader werden abgelehnt. |
| Produktive Recovery-Aktivierung | Der dedizierte frische Recovery-Modus parst URS und Artefakte strikt, legt Google-Ressourcen ausschließlich durch authentifizierte Discovery fest oder bindet ein unabhängig ausgewähltes Backup und persistiert erst nach Full Verify mit vollständigem Readback. |
| Fachkonflikte | Die Konfiguration zeigt alle Heads und Tombstones ohne automatische Gewinnerwahl. Das ausdrücklich bearbeitete Ergebnis läuft über `mergeRecord` und damit auch bei 9/17 Heads über gestufte, protokollbegrenzte Merge-Revisionen. |
| Auth-Origin | `/google-auth/` ist ein eigener statischer Build-Entry. Return-Origin-Allowlist, Opener, Action-ID und MessagePort werden gebunden; Google Runtime und Tokens verlassen diesen Origin nicht. |

## Lokale Architektur

Der aktive Diary-/Epoch-Kontext verweist auf einen v5-Root-Wrap. Im
Best-Effort-Modus wird dessen AES-256-GCM-Wrapping-Key nicht extrahierbar im
Browserprofil gehalten; starke lokale Modi verwenden stattdessen den normativen
Argon2id-Passphrase-KEK oder einen WebAuthn-PRF-abgeleiteten KEK. Immutable
Envelopes und Revisionen, Reservationen, Journalsequenz/-hash, exakte kanonische
Remote-Rowbytes, Outboxstatus sowie der MAC-gebundene Security-State liegen in
getrennten IndexedDB-Stores. Feature-Lesen rekonstruiert und validiert den
Revision-Graphen; Schreiben erzeugt stets eine neue Revision und ein einmal
verschlüsseltes Envelope. Legacy-Quellen bleiben bis nach Zielverifikation
unverändert.

## Ergebnis

`TODO_INTERNAL: Dedizierte Browser-E2E-Abdeckung der neuen Recovery-, Re-Export- und Auth-Origin-Flows ausstehend.`

`SECURITY/SPEC DECISION REQUIRED: none`

Externe Freigabegrenzen stehen ausschließlich in
`PRODUCTION_SECURITY_RELEASE_GATES.md`; dieses Audit ist keine Aussage über
Live-Google, reale Authenticatoren, Produktionshosting oder externen Audit.
