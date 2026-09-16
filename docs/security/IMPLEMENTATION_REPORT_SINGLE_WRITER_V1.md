# Implementierungsbericht – Google Sheets Single Writer v1

Stand: 16.09.2026 (finaler Integrationsstand PR #20)

## Produktiver Stand

### Lokale Source of Truth

`localDatabase.ts` verwendet Diary-/Epoch-Kontext, gewrappten Epoch-Root-Key,
immutable Revisionen/Envelopes, persistente One-shot-ID-Reservation, Journal mit
`local_seq`, Count und Hashkette, exakte Rowbytes, Outbox und MAC-gebundenen
Security-State. Pain, Activity, Medication, Prescriptions sowie beide Settings-
Singletons lesen und schreiben über diesen Head-Graph. `secureRecords` wurde
entfernt. Legacy-IDB und `eds-diary-activity-types-v1` sind nur noch
crash-resumable, nichtdestruktive Migrationsquellen.

Fach-Daten und Revision-Wrapper werden vor Reservation und Verschlüsselung mit
denselben gebündelten Schemas und Semantikregeln wie beim Full-Remote-Verify
geprüft. Normale Reads validieren State-MAC und das vollständige Envelope-Journal.
Der Migrationsfortschritt besitzt einen kanonischen Hash, ist über
`migration_state_ref` authentifiziert und verwendet je Quelle eine deterministische
Revision-ID für idempotentes Crash-Resume.

Der App-/Data-Lifecycle installiert nach einem authentifizierten Provider-Handoff
den `SingleWriterSyncService` selbst. Dessen Full-Verifier erhält Fingerprint,
Key-ID, Recovery-Generation/-Commitment, Anchor, lokale Envelopes und lokale
Heads ausschließlich aus MAC-/Journal-verifiziertem IndexedDB-State und die
Schema-Erwartung aus der statischen Registry. Die frühere frei caller-setzbare
Trust-Struktur ist aus `createGoogle` entfernt. Dirty- und manuelle Full-Syncs
laufen über denselben sicheren Coordinator; Legacy-Whole-Table-Handler können
nicht mehr registriert werden.

### Lokaler Root-Wrap

Der persistente v5-Root-Wrap unterstützt `best-effort`, `passphrase` und `prf`.
Passphrase-Wraps verwenden die normativen Argon2id-/HKDF-Parameter und werden
nach Lock nur mit erfolgreicher AEAD-/State-Verifikation wieder aktiviert.
PRF-Wraps binden Credential-ID, Evaluation-Input, RP-ID und separaten Wrap-Salt.
Der Browser-Adapter führt eine echte WebAuthn-Registrierung plus anschließende
Assertion über `navigator.credentials` aus, verlangt in Registrierung und
Assertion `userVerification:"required"`, beschränkt die Assertion auf die exakt
persistierte Credential-ID und akzeptiert nur eine echte 32-Byte-PRF-Ausgabe.
Unsupported PRF, falsche Credential-ID und fehlende/falsch lange Ergebnisse
schlagen geschlossen fehl. Die reale Authenticator-/Browsermatrix bleibt ein
externes Produktionsfreigabe-Gate.

### Create/Reconcile

Die persistente State Machine umfasst exakt:

`planned -> discovery_verified -> create_pending -> candidate_known ->
manifest_pending -> manifest_verified -> properties_pending ->
properties_verified -> final_reconcile -> bound`.

Jeder Remote-Mutation geht persistierte und readback-verifizierte Absicht voraus.
Discovery klassifiziert Empty/Expected/Partial/Conflicting, wählt unter rein
leeren Duplikaten deterministisch, schreibt die gespeicherten Manifestbytes
separat und patcht anschließend ausschließlich `app_format` und `epoch_locator`.
Unknown Outcomes werden nur per Readback/Discovery aufgelöst. Der Google-Create-
Request enthält kein Manifest mehr.

Der normale Google-Read verlangt die beiden exakten Protocol-AppProperties. Die
separate Candidate-Inspection erlaubt ausschließlich den ungebundenen Zustand.
Physische Zeilen werden als JCS-Tripel mit 21.936 Bytes pro Zeile, 100.000 Zeilen
und 134.217.728 kanonischen Gesamtbytes begrenzt.

### Rotation und Migration

`runRotation` ist die produktive, persistente Orchestrierung der normativen
Phasen. Sie erzeugt und prüft Root-Wrap, friert die Source dauerhaft ein, liest
den finalen Source-State, bindet Semantic-/Lineage-Snapshots, ruft die vollständige
Successor-Create/Reconcile-Grenze auf, kopiert Heads plus
`epoch-migration-sw-v1`, verlangt Full-Verify und Semantikgleichheit, testet
Recovery-Bootstrap und Backup-Restore, erzeugt das normale verschlüsselte
`rotation-announcement-sw-v1`, verlangt Append/Readback/Full-Verify und schaltet
erst danach atomar um. Ein Resume wiederholt ausschließlich die noch nicht
bestätigte idempotente Phase; nach durable Announcement gibt es keinen Abort.

### Recovery Trust Boundary

AEAD-Unwrap liefert nur einen `RecoveredRootCandidate`. Der normale
`FullRemoteVerifier` kann diesen nicht aktivieren. Der gesonderte
`RecoveryBootstrapVerifier` verlangt eine unabhängig festgelegte Remote-/Backup-
Resource-ID und authentifizierte Account-Bindung; erst danach authentifiziert er
Manifest, URS-Commitment, IDs, Generation, Fingerprint, Anchor, sämtliche
Envelopes, Graph und Controls und erlaubt die Root-Wrap-Persistenz.
Der produktive Google-Transport wird über eine authentifizierte Session-Factory
erzeugt. Die Factory fragt `drive.about.user.permissionId` innerhalb dieser
Session ab, vergleicht sie mit deren festem Subject und leitet
`google_account_binding` intern ab; allgemeiner App-Code kann diese Trust-Werte
nicht mehr an den Konstruktor übergeben.

## Abschlussstatus

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`

`BLOCKED_EXTERNAL`: separater Auth-Origin; echte Google-Testcredentials und
Testkonto; reale WebAuthn-PRF-Hardware-/Browsermatrix einschließlich
End-to-End-Ceremonies; Produktionshosting, CSP und Header; externer
Security-/Crypto-Audit.

Kein Merge wurde durchgeführt.
