# EDS Diary – Normatives Kryptographieprofil v5

Stand: 15.09.2026

Status: **NORMATIV für die Implementierung des Single-Writer-Syncprofils.**

Dieses Dokument extrahiert die kryptographisch relevanten Regeln aus dem ausführlich geprüften v5-Sicherheitsentwurf. Codex darf diese Regeln nicht vereinfachen, umbenennen oder durch „äquivalente“ Eigenkonstruktionen ersetzen. Bei einer notwendigen Abweichung: `SECURITY/SPEC DECISION REQUIRED` melden und die Implementierung an dieser Stelle fail-closed lassen.

## 1. Sicherheitsmodell

EDS Diary verarbeitet sensible Gesundheitsdaten. Remote-Speicher, Browser-Storage, importierte Daten und Providerantworten sind untrusted. Die Providerintegrität ist **keine** kryptographische Vertrauenswurzel.

Ein kompromittiertes Produktions-JavaScript, eine kompromittierte Browsererweiterung oder ein kompromittiertes Betriebssystem kann während einer entsperrten Sitzung Klartext und Schlüsselmaterial exfiltrieren. CSP, Origin-Isolation, Dependency-/Build-Härtung und kurze Unlock-Sitzungen sind deshalb Teil des praktischen Sicherheitsmodells.

JavaScript kann keine zuverlässige RAM-Zeroization garantieren.

## 2. Epoch Root Key

Für jede Epoche wird genau ein neuer Root Key erzeugt:

```text
RK_epoch = 32 kryptographisch zufällige Bytes
```

Erzeugung ausschließlich über `crypto.getRandomValues`/WebCrypto-CSPRNG.

`RK_epoch` wird niemals als Klartext dauerhaft persistiert oder remote gespeichert.

Eine kompromittierte `RK_epoch` kompromittiert sämtliche Daten und authentifizierbaren Kontrollobjekte dieser Epoche. Per-Envelope-Schlüssel sind **keine Forward Secrecy** gegenüber Root-Key-Kompromittierung. Rotation begrenzt nur zukünftige Exposition.

## 3. Epoch Salt

```text
epoch_salt = SHA-256(
  UTF8("eds-diary/hkdf-salt/v5") || 0x00 || diary_id_bytes || epoch_id_bytes
)
```

`diary_id` und `epoch_id` müssen kanonisch und eindeutig bytekodiert werden. Keine implizite JavaScript-Stringkonkatenation für kryptographische Inputs.

## 4. Envelope-ID und Envelope-Key

Jedes neue Envelope erhält **vor der Verschlüsselung** eine neue zufällige ID:

```text
envelope_id = 32 CSPRNG-Bytes
```

Der Schlüssel lautet:

```text
K_env(envelope_id) =
  HKDF-SHA-256(
    IKM  = RK_epoch,
    salt = epoch_salt,
    info = UTF8("eds-diary/envelope-key/v5") || 0x00 || envelope_id_bytes,
    L    = 32
  )
```

### INV-CRYPTO-ENV-001 – One-shot-ID

Eine `envelope_id` wird lokal persistent reserviert, **bevor** unter dem daraus abgeleiteten Schlüssel verschlüsselt wird.

Unter derselben `envelope_id` darf exakt eine neue AES-GCM-Verschlüsselung stattfinden.

Retry bedeutet niemals Neuverschlüsselung, sondern erneutes Senden exakt derselben bereits persistierten Bytes.

Gleiche `envelope_id` mit abweichenden gespeicherten/remote Bytes ist ein fataler Integritätsfehler.

## 5. AEAD

Für Envelopes:

```text
AES-256-GCM
IV: 96 Bit / 12 zufällige Bytes
Tag: 128 Bit
```

Der IV wird bei der einmaligen Envelope-Verschlüsselung kryptographisch zufällig erzeugt und gemeinsam mit Ciphertext persistiert.

Da jede neue `envelope_id` einen separaten `K_env` erzeugt, ist IV-Gleichheit über unterschiedliche Envelope-IDs keine GCM-Nonce-Wiederverwendung unter demselben Key. Beobachtete IV-Gleichheit soll dennoch als RNG-Anomalie diagnostiziert/fail-closed behandelt werden, nicht als Anlass zum stillen Re-Encrypt.

## 6. AAD / kanonische Serialisierung

Alle authentifizierten Strukturen verwenden die im v5-Protokoll definierte kanonische Bytekodierung. JSON, das kryptographisch gebunden oder gehasht wird, muss strikt deterministisch kanonisiert werden; keine Abhängigkeit von Property-Insertion-Order, Locale oder plattformspezifischer Stringdarstellung.

Für neue kryptographisch relevante Strukturen muss vor Implementierung feststehen:

- exakte Feldmenge,
- exakte Feldtypen,
- exakte Bytekodierung,
- Domain-Separator,
- Version,
- AAD.

Keine kryptographische Struktur darf ad hoc aus `JSON.stringify()` eines beliebigen Runtime-Objekts entstehen.

## 7. Revisionen und fachliche Daten

Remote fachliche Daten werden ausschließlich innerhalb authentifiziert verschlüsselter Envelopes gespeichert.

Die fachliche Revisionsstruktur bleibt erhalten:

```text
revision_id
record_id
record_type
record_schema
record_status
parent_revision_ids
migration_origin
record_data
```

Physische Sheet-Reihenfolge ist niemals fachliche Konfliktentscheidung. Kein `latest timestamp wins`.

Mehrere fachliche Heads können auch im Single-Writer-Remoteprofil entstehen, wenn mehrere Geräte nacheinander offline auf demselben Parent arbeiten. Solche Konflikte werden explizit gemergt.

## 8. Recovery – URS

Recovery verwendet **keine menschliche Passphrase** als langfristigen Recovery-Schlüssel.

```text
URS = 32 CSPRNG-Bytes
```

URS muss für den Nutzer als Recovery Secret sicher exportierbar/darstellbar sein, darf aber nicht als Klartext regulär in IndexedDB/localStorage persistiert werden.

Ableitung:

```text
K_recovery = HKDF-SHA-256(
  IKM  = URS,
  salt = recovery_salt_32_random_bytes,
  info = UTF8("eds-diary/recovery-wrap/v5"),
  L    = 32
)
```

Recovery-Artefakte verwenden AES-256-GCM.

### Recovery-URS-Commitment

Zur Verhinderung der alten Self-Confirmation-Lücke muss die Recovery-Linie an die bereits bestätigte URS gebunden werden:

```text
recovery_urs_commitment = Base64URL(
  HMAC-SHA-256(
    key  = URS_32_bytes,
    data = UTF8("eds-diary/recovery-urs-commitment/v5") || 0x00 ||
           diary_id_bytes || uint64_be(recovery_generation)
  )
)
```

Dieses Commitment ist Bestandteil des verschlüsselten/authentifizierten Recovery-/Manifestzustands und **kein öffentlicher Passwortverifier**.

Fortsetzung derselben `recovery_generation` ist nur erlaubt, wenn eine erneut eingegebene URS exakt das bereits authentifizierte Commitment reproduziert.

## 9. Lokale Sicherheitsmodi

### 9.1 Best-Effort

Ein non-extractable `CryptoKey` und damit gewrappter Root Key im selben Browserprofil ist **keine starke At-rest-Sicherheitsgrenze gegen vollständige Profilkopie**.

Die UI darf diesen Modus nicht als starken Schutz gegen Profilkopie bezeichnen.

### 9.2 Strong: WebAuthn PRF

Bevorzugter starker Modus, sofern Browser/Authenticator die PRF-Erweiterung tatsächlich unterstützen.

Pflichtregeln:

- exakte EDS `rp.id`,
- `userVerification: "required"`,
- exakte Credential-ID,
- 32-Byte zufälliger `prf_eval_input`,
- tatsächliche Post-Enrollment-Assertion zur Verifikation der PRF-Unterstützung,
- PRF-Output wird über context-bound HKDF in einen lokalen KEK überführt,
- synced Passkeys dürfen nicht als zwingend hardwaregebunden dargestellt werden.

### 9.3 Strong fallback: Passphrase

Passphrase-KDF:

```text
Argon2id v0x13
memory      = 64 MiB
iterations  = 3
parallelism = 1
output      = 32 bytes
```

Danach context-bound HKDF zum lokalen KEK.

Eingaberegeln:

- mindestens 15 Unicode-Codepoints,
- maximal 1024 UTF-8-Bytes,
- kein `trim`,
- keine stille Unicode-Normalisierung,
- lokale kompromittierte/common-Passphrase-Blockliste.

Die Anwendung muss klar machen, dass menschliche Passphrase-Entropie die Sicherheitsgrenze bestimmt. Wo sinnvoll, darf eine generierte Mehrwort-Passphrase angeboten werden.

## 10. Pairing

Geräte-Pairing bleibt vom Single-Writer-Remoteprofil unberührt.

Baseline:

- ephemeral P-256 ECDH,
- private Keys non-extractable,
- 32-Byte single-use Session-ID,
- Public Keys exakt SEC1 uncompressed, 65 Byte,
- kanonischer Transcript mit beiden Public Keys + Rollen + Session,
- HKDF-Domaintrennung zwischen `K_pair` und `K_sas`,
- AES-GCM für Pairing-Payload,
- 8-stellige SAS unbiased/rejection sampling,
- SAS-Mismatch beendet Session vollständig; neuer Versuch braucht frische Session und frische ephemeral Keys.

P-256 ist nicht post-quantum. Pairing-Suite muss versionierbar/agil bleiben; keine unversionierte Kryptosuite.

## 11. Backup

Backup ist **separat vom Sync**.

Ein Google Sheet ist der aktive Remote-Speicher/Sync-Layer, nicht das Backup-Artefakt. Backup bleibt eigenes verschlüsseltes Format mit strikten Größen-/Parsergrenzen und Restore-Verifikation.

Remote-Sync darf Backup-Invarianten nicht schwächen.

## 12. Lokale Persistenz

Zielzustand: keine fachlichen Gesundheitsdaten im Klartext dauerhaft in Browser-Storage.

Insbesondere nicht neu persistieren in:

- IndexedDB,
- localStorage,
- sessionStorage,
- Cache Storage,
- URL/Query/Fragment,
- Logs,
- Analytics,
- Error Reporting.

Historische Legacy-/Prototype-Stände enthielten Klartextpersistenz. Diese bleibt ausschließlich Migrationsquelle und Regressionstest-Gegenstand, **nicht Zielarchitektur**; der aktuelle Produktpfad darf keine fachlichen Gesundheitsdaten neu im Klartext persistieren.

Neue sichere Stores müssen verschlüsselte immutable Envelopes, technische Indizes/Referenzen und authentifizierten lokalen Security-State verwenden.

## 13. Authentifizierter lokaler Zustand

Sicherheitsrelevante lokale Metadaten müssen über einen vom Epoch-Key domain-separated abgeleiteten MAC-Key authentifiziert sein. Manipulierte Sicherheitsmetadaten dürfen nicht still akzeptiert werden.

Vor Schreibfreigabe nach Unlock sind mindestens zu verifizieren:

- Epoch Security State MAC,
- lokales Envelope-Journal,
- referenzierte Rotation-/Migration-State-Hashes,
- Remote Binding / Anchor soweit vorhanden.

Lokale sicherheitsrelevante Mutationen erfolgen unter diary-spezifischem Web Lock mit Re-Read nach Lock-Erwerb. Nach Netz-I/O darf ein veralteter Callback keinen neueren lokalen Zustand überschreiben; Generation/Token erneut prüfen.

## 14. Providergrenze

Providerneutrale Kernlogik kennt keine Google-SDK-Typen, Tokens oder API-Response-Objekte.

Normative Grenze:

```text
AuthProvider
RemoteTransport
TransportProfileCodec
```

Google bleibt Referenzadapter:

```text
provider_id = "google-sheets-single-writer-v1"
```

Bestehende/legacy Google-Wire-Namen dürfen innerhalb des Google-Codecs erhalten bleiben, aber nicht in den providerneutralen Core lecken.

Providerwechsel wird niemals als In-place-Umdeutung einer bestehenden Epoche durchgeführt. Er erfolgt über neue Epoche und `Copy -> Verify -> Switch`.

## 15. Supply Chain / Hosting

Produktionshosting muss Security Header setzen können. Kein Produktionsbetrieb auf einem Host, bei dem die erforderlichen CSP-/Security-Header nicht kontrollierbar sind.

Google Identity/runtime JavaScript darf nicht unkontrolliert im selben sensiblen Origin wie entsperrter Klartext und Root Keys laufen. Bestehende v5-Entscheidung zur Auth-Origin-Isolation ist zu respektieren.

Keine Runtime-CDN-Abhängigkeiten für sicherheitskritische Kryptobibliotheken. Dependencies pinnen/reviewen und reproduzierbare Builds anstreben.

## 16. Implementierungsverbote

Codex darf insbesondere **nicht**:

- AES-GCM durch eigene Kryptographie ersetzen,
- Retry neu verschlüsseln,
- Envelope-IDs nach der Verschlüsselung erzeugen/reservieren,
- Root Keys oder URS im Klartext persistieren,
- Recovery nur durch „AEAD decrypt succeeded“ als gültig erklären,
- Passphrase und URS gleichsetzen,
- Provider-Metadaten als Integritätsbeweis verwenden,
- remote physische Reihenfolge als fachliches Last-Write-Wins verwenden,
- Tests/Golden Vectors ändern, nur damit Implementierung passt.

## 17. Sicherheitsbehauptung

Zulässige Beschreibung:

> Konservativer clientseitiger Kryptographieentwurf mit expliziten Threat-Model-Grenzen; nicht extern auditiert.

Nicht behaupten:

- formal bewiesene Kryptographiesicherheit,
- Schutz bei kompromittiertem entsperrtem Browser/JS,
- globale Freshness bei vollständigem Verlust aller unabhängigen Anchor-/Backup-Kopien,
- Forward Secrecy innerhalb einer kompromittierten Epoche.
