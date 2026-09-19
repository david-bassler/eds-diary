# Implementierungsaudit – Single Writer v1

Stand: 19.09.2026 (v1/v2-Grenzreview; Recoverability-Basis PR #30)

## Adversarialer Produktpfad-Review

| Prüfpunkt | Ergebnis |
|---|---|
| Helper vorhanden, aber nicht produktiv benutzt | Die Feature-Repositories laufen über `localDatabase` auf dem entschlüsselten Head des Envelope-/Revision-Graphen. Nach dem authentifizierten Provider-Handoff baut `installAuthenticatedRemoteSession` den Service aus dem MAC-gebundenen aktiven Epoch-State neu auf; Dirty- und Full-Trigger besitzen nur noch diesen Coordinator-Slot. Legacy-Whole-Table-Synchronizer werden beim App-Start nicht registriert und ihre Registrierung schlägt geschlossen fehl. |
| Alter Source-of-Truth-Pfad | `secureRecords` existiert nicht mehr. Die alten Klartext-Stores und der historische Activity-Type-LocalStorage-Key werden ausschließlich nichtdestruktiv inventarisiert und migriert. |
| Lokale Manipulation | Root-Wrap und `epoch_local_security_state`/State-MAC werden beim Laden geprüft. `EpochContext`, MAC-State und RootWrap müssen in Diary-, Epoch-, Key-, Manifest- und Wrap-Identität übereinstimmen. Jeder normale Fach-Read prüft zusätzlich vollständige Journalfolge, exakte Rowbytes, Count und Hashkette; State-, Context- und Journal-Manipulation sind fatal. |
| Lokaler Root-Wrap | `best-effort`, Argon2id-Passphrase und WebAuthn-PRF besitzen getrennte Wrap-Pfade. Der WebAuthn-Browserpfad verlangt UV, exakte Credential-ID und eine 32-Byte-Post-Enrollment-PRF-Assertion; Unsupported-/Mismatch-Fälle schlagen geschlossen fehl. Passphrase-/PRF-Modi bleiben über Rotation erhalten. Reale Authenticator-/Browservalidierung bleibt externes Release-Gate. |
| Crash zwischen lokalen Phasen | Envelope-ID-Reservation ist eine eigene persistente Phase. Envelope, Revision, Journal, exakte Rowbytes und Outbox werden danach atomar geschrieben; eine verwaiste Reservation wird nie wiederverwendet. |
| Create Unknown Outcome | `planned`, Discovery, `create_pending`, Candidate, Manifest, Properties, Final-Reconcile und `bound` werden persistiert/readback-verifiziert. Auch beim Resume aus `create_pending` läuft Discovery vor einem weiteren Create. Vor `bound` wird exakt ein Candidate verlangt. |
| Generation Race / Durable | Jede Envelope-Operation erfasst ihre eigene aktuelle `operation_generation`; `prepared`, `pending`, `remote_seen` und `durable` werden persistiert. Anchor und `durable` werden in derselben IDB-Transaktion gespeichert. |
| Same-ID/different-bytes / IV reuse | Der Full-Verifier verwirft beides; byteidentische physische Retries bleiben Bestandteil des Prefix. |
| Mutation nach Freeze | Alle Phasen ab `source_frozen_verified` blockieren Feature-Mutationen persistent. |
| Switch vor Announcement | Die Rotation orchestriert Copy, Full Verify, Semantic-Gleichheit, Recovery-Bootstrap, Backup-Test-Restore und Announcement-Full-Verify; Switch ist nur nach `announcement_durable` erreichbar. |
| Recovery Self-Confirmation | `recoverRootKeyCandidate` aktiviert nichts. Der Google-Transport besitzt keinen öffentlichen Konstruktor, akzeptiert weder Permission-ID noch Account-Binding und kann nur mit einem von der Auth-Grenze ausgegebenen Client entstehen. Er liest die Permission-ID selbst über `drive.about`, gleicht sie mit der unveränderlichen Session-Identity ab und leitet das Binding intern ab. Ein selbst bestätigender Stub und ein frei gebauter Loader werden abgelehnt. |
| Produktive Recovery-Aktivierung | Der dedizierte frische Recovery-Modus prüft URS und importierte JSON-Dokumente strikt, legt Google-Ressourcen ausschließlich durch authentifizierte Discovery fest oder bindet ein unabhängig ausgewähltes Backup und persistiert erst nach Full Verify mit vollständigem Readback. Frühere pretty-printed App-Exporte bleiben importierbar, Duplicate Keys und nicht-I-JSON-konforme Werte bleiben verboten. |
| Backup-Restore -> Remote-Aktivierung | Ein unabhängig verifizierter Backup-Restore ohne Remote-Binding wird als `local_offline` persistiert und kann danach ausschließlich über den vorhandenen authentifizierten `remote_enablement`-Epoch-Wechsel an Google gebunden werden. |
| Recovery-Artefakt nach Restore | Das verifizierte Recovery-Artefakt wird epochgebunden unabhängig von `rotation_state_ref` gespeichert und readback-verifiziert. Der Re-Export ist nach Reload und bereits vor erneuter Google-Aktivierung produktiv erreichbar. |
| Recovery-Key-Verlust | Ein noch entsperrtes und authentifiziertes Profil kann ohne Kenntnis des alten URS auf einen neuen zufälligen Recovery-Key wechseln. Dies läuft als vollständige `recovery_rekey`-Epoch-Rotation mit erhöhter Recovery-Generation; alte authentifizierte Remote-Epochen werden als retired bei Recovery abgelehnt. |
| Remote Recovery-Artefakt | Das verschlüsselte Recovery-Artefakt wird owner-only in Google unter einem aus dem 32-Byte-URS abgeleiteten opaken Locator gehalten, bei normaler Rotation monoton fortgeschrieben und vor Freigabe readback-verifiziert. Frische Google-Recovery kann dadurch das Artefakt allein aus Konto + URS finden. |
| Lokale Verlustsicht | `navigator.storage.persist()` wird best-effort angefordert und der reale Persistenzstatus angezeigt. Die UI zählt ausschließlich lokal vorhandene Änderungen aus der persistenten Outbox; ein Reload verliert diese Warnung nicht. |
| Origin-Wechsel | Ein `eds-origin-migration-v1`-Paket bündelt verifiziertes Backup und Recovery-Artefakt, niemals den URS. Restore auf einem frischen Origin läuft über denselben Backup-/Recovery-Verify-Pfad und vermeidet Abhängigkeit von alter IndexedDB- oder WebAuthn-RP-ID. |
| Backup-Export | Remote-bound Backups lesen und full-verifizieren die aktuelle Remote-Sicht erneut, prüfen Account-Binding und nehmen lokale pending Envelopes auf; Restore-Test läuft vor Ausgabe. |
| Fachkonflikte | Die Konfiguration zeigt alle Heads und Tombstones ohne automatische Gewinnerwahl. Das ausdrücklich bearbeitete Ergebnis läuft über `mergeRecord` und damit auch bei 9/17 Heads über gestufte, protokollbegrenzte Merge-Revisionen. |
| Auth-Origin | `/google-auth/` ist ein eigener statischer Build-Entry. Return-Origin-Allowlist, Opener/Parent, Action-ID und MessageChannels werden gebunden; das OAuth-Credential wird nach dem Popup-Handoff in einem langlebigen Auth-Bridge-Frame gehalten und nicht an den Diary-Code übergeben. RPC wird auf die tatsächlich benötigten Drive-/Sheets-Pfade und Methoden begrenzt. Die derzeitige GitHub-Pages-Testbereitstellung ist **noch same-origin**; echte Origin-Isolation bleibt deshalb ein externes Deployment-Gate. |
| Produktpfad-Testabdeckung | Dedizierte Browser-Szenarien laufen in Desktop- und Mobile-Projekten für Recovery-Import, Restore-Artefakt-Re-Export, Recovery-Navigation, Konfliktbereich und fail-closed Auth-Origin. Ergänzende Unit-Regressionen prüfen Legacy-JSON-Kompatibilität, Duplicate-Key-Reject, Restore-Status/Artefakt-Readback und RPC-Allowlist. Live-Google und reale WebAuthn-Hardware bleiben bewusst extern. |
| Mehrgeräte-Writer-Wechsel | **Nicht Bestandteil von v1.** Die bestehende v1-Spezifikation erlaubt stale/offline lokale Forks, besitzt aber keinen produktiven Same-Diary-Join/Handoff für ein zweites Gerät. Ein zweites Gerät darf daher nicht durch erneutes `remote_enablement` eines eigenen lokalen Zustands als vermeintlicher Join verwendet werden. Die strengere Zielarchitektur mit read-only Zweitgeräten, Writer-Generation, Gerätesignaturen und Fencing ist in `EDS_TRANSFERABLE_SINGLE_WRITER_V2_ARCHITECTURE.md` gerahmt; exaktes v2-Protokoll und Implementierung stehen noch aus. |

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

`TODO_INTERNAL: transferable-single-writer-v2 not implemented`

`SECURITY/SPEC DECISION REQUIRED: v2 exact wire/schema/signature profile and recovery-takeover authority before implementation`

Externe Freigabegrenzen stehen ausschließlich in
`PRODUCTION_SECURITY_RELEASE_GATES.md`; dieses Audit ist keine Aussage über
Live-Google, reale Authenticatoren, Produktionshosting oder externen Audit.
