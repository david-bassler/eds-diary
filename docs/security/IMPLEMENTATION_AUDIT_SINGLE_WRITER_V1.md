# Implementierungsaudit – Single Writer v1

Stand: 15.09.2026 (PR-#9-Remediation)

## Geprüfte Angriffsflächen

| Bereich | Ergebnis |
|---|---|
| Manifest | Zentrale bytegenaue Fingerprint-Implementierung; Format, Version, IV, Base64URL und Ciphertextgröße werden vor Hash/AEAD geprüft. |
| Untrusted JSON | Duplicate-Key-Walk vor Materialisierung, fataler UTF-8-Decoder, I-JSON-Prüfung und JCS-Bytegleichheit. |
| Remote-Vertrauen | Nur `FullRemoteVerifier` im Produktkern erzeugt den verifizierten Zustand; Test-Doubles sind sichtbar als Testcode isoliert. |
| Google Grid | `spreadsheets.get`, rohe `userEnteredValue.stringValue`, Struktur-/Merge-/Bounds-Prüfung; dynamische Record-Sheet-ID. |
| Drive | Owner, Sharing, Shared-Drive, App-Authorization, MIME, Trash und vollständig paginierte Permissions werden geprüft. |
| Append/Durable | AppendCells mit gespeicherten Bytes; Unknown Outcome wird gelesen/reconciliert; kompletter finaler Verify vor Anchor/Durable. |
| Lokaler State | v5 Root-Wrap, nicht-extractable Best-Effort-Key-Grenze, State-MAC, Journalhash und Web Lock sind implementiert. |
| Recovery/Backup/Rotation | Kandidat-vor-Aktivierung, gebundener v5-Backup-Restore und persistente Freeze-/Announcement-Statefolge. |
| Legacy | Sämtliche IDB-Fachstores, Settings und historischer Activity-Type-Key wurden inventarisiert; keine neuen LocalStorage-Fachwrites. Deterministische IDs sind golden getestet. |

## Negative Assurance

Tests decken Duplicate Keys (top-level/verschachtelt), noncanonical JSON, unpaired surrogate, Parent-Reihenfolge, Duplicate Revision, Anchorrollback, byteabweichende Envelope-ID, verlorene Append-Antwort, Fingerprint-Einmaligkeit und Rotationsfreeze ab. Der Adapter ist statisch gegen Values-Append und Google-Runtime im Hauptorigin gegated.

## Externe Grenzen

Live-Google-Vertrag, Auth-Origin, WebAuthn-Hardwarematrix, Hostingheader und unabhängiger Audit konnten im Checkout nicht erbracht werden. Sie sind Release-Gates, keine behaupteten Testergebnisse. Es liegen keine `SECURITY/SPEC DECISION REQUIRED`-Punkte vor.

## Adversarialer kumulativer Self-Review (15.09.2026, aktueller Checkout)

Die frühere DONE-Einstufung oben ist durch diesen kumulativen Review überholt. Der
Checkout darf nicht als intern vollständig oder produktionsreif bezeichnet werden.

| Anforderung | Implementierung / Test | Status |
|---|---|---|
| Begrenzter Google-Grid-Read, Offsets, dynamische IDs | `GoogleSheetsSingleWriterTransport`; Unit-/Build-Gates | **PASS** (lokal), Live-Vertrag **BLOCKED_EXTERNAL** |
| Exakte Epoch-/Owner-/Account-Bindung und Pagination | `GoogleSheetsSingleWriterTransport` | **PASS** (lokal), Live-Vertrag **BLOCKED_EXTERNAL** |
| Same envelope ID/different bytes, IV-Wiederverwendung, Control-Bindungen | `FullRemoteVerifier`; Security-Tests | **PASS** |
| Nicht frei ausstellbarer Recovery-Nachweis | Aktivierung verlangt konkrete `FullRemoteVerifier`-Instanz und erneute Vollverifikation; kein exportierter Issuer | **PASS** |
| Backup-Vertrauensgrenze | Restore verlangt konkrete `FullRemoteVerifier`-Instanz; Schema, Counts, Hashes, Anchor und Union werden vor Aktivierung geprüft | **PASS** |
| Lokale normative Envelope-Source-of-Truth | Produktive Repositories verwenden weiterhin `secureRecords` in `localDatabase.ts` | **FAIL** |
| Vollständige Create-/Reconcile-State-Machine | Manifestwrite ist noch an `create()` gekoppelt; persistenter Planned-/Candidate-/Patch-State fehlt | **FAIL** |
| Sechs normative Fachschemas | Normtexte benennen IDs und Registrybindung, definieren aber keine zulässigen Fachfelder/Typen/Limits; vorhandene Dateien sind Placeholder | **SECURITY/SPEC DECISION REQUIRED** |
| Vollständige produktive Rotation/Migration | Persistente Phasenhelfer existieren, vollständige Orchestrierung und Repository-Cutover fehlen | **FAIL** |

Der Self-Review hat somit interne FAILs festgestellt. Release bleibt fail-closed; diese
Datei ist kein Freigabenachweis.
