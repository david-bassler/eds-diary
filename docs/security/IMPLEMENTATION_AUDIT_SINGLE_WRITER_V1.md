# Implementierungsaudit – Single Writer v1

Stand: 16.09.2026 (finaler Integrationsstand PR #14)

## Adversarialer Produktpfad-Review

| Prüfpunkt | Ergebnis |
|---|---|
| Helper vorhanden, aber nicht produktiv benutzt | Die Feature-Repositories laufen über `localDatabase` auf dem entschlüsselten Head des Envelope-/Revision-Graphen. Legacy-Whole-Table-Synchronizer werden beim App-Start nicht mehr registriert. |
| Alter Source-of-Truth-Pfad | `secureRecords` existiert nicht mehr. Die alten Klartext-Stores und der historische Activity-Type-LocalStorage-Key werden ausschließlich nichtdestruktiv inventarisiert und migriert. |
| Lokale Manipulation | Root-Wrap und `epoch_local_security_state`/State-MAC werden beim Laden geprüft. Jeder normale Fach-Read prüft zusätzlich die vollständige Journalfolge, exakte Rowbytes, Count und Hashkette; State- und Journal-Manipulation sind fatal. |
| Crash zwischen lokalen Phasen | Envelope-ID-Reservation ist eine eigene persistente Phase. Envelope, Revision, Journal, exakte Rowbytes und Outbox werden danach atomar geschrieben; eine verwaiste Reservation wird nie wiederverwendet. |
| Create Unknown Outcome | `planned`, Discovery, `create_pending`, Candidate, Manifest, Properties, Final-Reconcile und `bound` werden persistiert/readback-verifiziert. Auch beim Resume aus `create_pending` läuft Discovery vor einem weiteren Create. Vor `bound` wird exakt ein Candidate verlangt. |
| Generation Race / Durable | Jede Envelope-Operation erfasst ihre eigene aktuelle `operation_generation`; `prepared`, `pending`, `remote_seen` und `durable` werden persistiert. Anchor und `durable` werden in derselben IDB-Transaktion gespeichert. |
| Same-ID/different-bytes / IV reuse | Der Full-Verifier verwirft beides; byteidentische physische Retries bleiben Bestandteil des Prefix. |
| Mutation nach Freeze | Alle Phasen ab `source_frozen_verified` blockieren Feature-Mutationen persistent. |
| Switch vor Announcement | Die Rotation orchestriert Copy, Full Verify, Semantic-Gleichheit, Recovery-Bootstrap, Backup-Test-Restore und Announcement-Full-Verify; Switch ist nur nach `announcement_durable` erreichbar. |
| Recovery Self-Confirmation | `recoverRootKeyCandidate` aktiviert nichts. Die Bootstrap-Authority ist eine opake, zur Laufzeit registrierte Capability, die nur nach Discovery über einen provider-eigenen Transport entsteht; ein frei gebauter Loader wird abgelehnt. |

## Lokale Architektur

Der aktive Diary-/Epoch-Kontext verweist auf einen nicht extrahierbaren
Best-Effort-Wrapping-Key und einen v5-Root-Wrap. Immutable Envelopes und
Revisionen, Reservationen, Journalsequenz/-hash, exakte kanonische Remote-Rowbytes,
Outboxstatus sowie der MAC-gebundene Security-State liegen in getrennten
IndexedDB-Stores. Feature-Lesen rekonstruiert und validiert den Revision-Graphen;
Schreiben erzeugt stets eine neue Revision und ein einmal verschlüsseltes
Envelope. Legacy-Quellen bleiben bis nach Zielverifikation unverändert.

## Ergebnis

`TODO_INTERNAL: none`

`SECURITY/SPEC DECISION REQUIRED: none`

Externe Freigabegrenzen stehen ausschließlich in
`PRODUCTION_SECURITY_RELEASE_GATES.md`; dieses Audit ist keine Aussage über
Live-Google, reale Authenticatoren, Produktionshosting oder externen Audit.
