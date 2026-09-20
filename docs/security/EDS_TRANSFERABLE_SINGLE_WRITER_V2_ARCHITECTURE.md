# EDS Diary – Transferable Single Writer v2

Status: **ARCHITEKTURRAHMEN DEFINIERT / EXAKTES v2-PROTOKOLL IN EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md EINGEFROREN / NOCH NICHT IMPLEMENTIERT**

Stand: 20.09.2026

Normative Konkretisierung: Byte-, Wire-, Signatur-, Recovery-Takeover- und State-Details sind in `EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md` festgeschrieben. Wo dieses Architekturpapier noch alternative Konstruktionen oder eine spätere Festlegung erwähnt, gilt die Exact-Protocol-Datei.

## 1. Ziel

EDS Diary soll mehrere bereits eingerichtete Geräte für dasselbe Tagebuch
unterstützen, aber zu jedem logischen Zeitpunkt genau **einen** aktiven Writer
haben.

Beispiel:

```text
t1:
Laptop = writer_active
Pixel  = read_only

Writer-Wechsel

t2:
Laptop = read_only / fenced
Pixel  = writer_active
```

Das ist ausdrücklich **kein Multi-Writer-Profil**. Es gibt keine automatische
gleichzeitige Schreibkonvergenz zweier Geräte. Der bestehende Single-Writer-Kern
bleibt die Grundlage; ergänzt wird eine übertragbare, remote verifizierte
Writer-Authority mit Fencing-Generation.

## 2. Bereits vorhandener Plan und notwendige Abweichung

Das bestehende Profil `google-sheets-single-writer-v1` enthält bereits eine
Mehrgeräte-Annahme:

- „Single Writer bedeutet nicht Single Device“;
- stale/offline Geräte dürfen lokal weiterarbeiten;
- spätere parallele fachliche Heads werden explizit gemergt.

Das ist für das hier gewünschte Produktverhalten **zu permissiv**. Ein Gerät,
das nicht aktueller Writer ist, soll keine neuen fachlichen Commits erzeugen.

Deshalb wird v1 nicht in-place umgedeutet. Alte v1-Clients verstehen keine
Writer-Generation und könnten sonst weiter schreiben. Die strengere Semantik
erfordert eine neue Epoche mit einem neuen Profil:

```text
sync_profile = "google-sheets-transferable-single-writer-v2"
```

Die bestehende v1-Epoche bleibt unverändert interpretierbar und wird bei der
Migration normal retired.

## 3. Sicherheitsziel und Grenze

### 3.1 Garantiertes Protokollziel

Für jeden akzeptierten Remote-Log-Prefix existiert genau eine kanonische
Writer-Authority:

```text
(writer_generation, writer_grant_id, writer_device_id)
```

Eine fachliche Revision ist nur dann semantisch gültig, wenn ihre
Writer-Provenienz exakt zur an ihrer physischen Row-Position gültigen Authority
passt.

Nach einem Writer-Wechsel können Envelopes eines alten Writers physisch noch
beim Provider ankommen, sie werden aber **nicht mehr als gültige
Tagebuch-Revisionen akzeptiert**.

### 3.2 Keine Provider-seitige Geräte-ACL

Alle Geräte verwenden dasselbe Google-Konto und damit dieselbe
`drive.file`-Autorisierung. Google kann deshalb das alte Gerät nicht anhand
unserer lokalen `device_id` von der Datei-API aussperren.

Ohne eigenen Token-Broker/Backend ist die Garantie daher
**protokollseitiges Fencing**, nicht providerseitige Token-Revocation.

Ein kompromittierter Client, der weiterhin Root-Key und ein gültiges Google-
OAuth-Credential besitzt, kann weiterhin providerseitig erlaubte API-Mutationen
ausführen. Dazu können nicht nur zusätzliche physische Rows, sondern – soweit
der bestehende Google-API-Capability-/Kontozugriff dies zulässt – auch
Überschreiben, Trunkieren oder Löschen der gemeinsam verwendeten Ressource
gehören. v2 schützt daher die **semantische Integrität akzeptierter Commits**,
nicht die Verfügbarkeit der Google-Ressource. Der gemeinsame Root-Key allein darf deshalb **keine
Writer-Authentizität** verleihen: jedes Gerät kennt den Root-Key und könnte sonst
einen bloßen `writer_context` des aktuellen Writers nachbilden.

v2 benötigt daher zusätzlich eine **gerätegebundene Signatur-Authority**. Ein
fachlicher oder writer-autorisierter Control-Commit ist nur gültig, wenn er mit
dem aktuell gebundenen Writer-Schlüssel signiert ist. Nach einem Handoff kann ein
kompromittiertes Altgerät mit altem Geräteschlüssel und gemeinsamem Root-Key
keinen gültigen Commit des neuen Writers fälschen.

Eine echte providerseitige Sperre des alten Google-OAuth-Credentials bleibt
trotzdem unmöglich. Das Altgerät kann die Remote-Ressource weiterhin stören,
verändern oder löschen; solche providerseitigen Mutationen dürfen aber keine
semantisch gültigen Writer-Commits werden.

Eine echte providerseitige Sperre pro Gerät wäre ein separates späteres
Architekturprofil mit Backend/Token-Broker und ist nicht Teil von v2.


### 3.3 Freshness-/Rollback-Grenze des Fencings

Das v2-Fencing ist eine **Integritätsgarantie relativ zu einem verifizierten
Remote-Prefix und den unabhängig erhaltenen neueren Anchors/Backups**. Es ist
keine globale Freshness-Oracle.

Ein Gerät, das einen späteren Handoff/Forced-Takeover-Grant bereits gesehen oder
einen Anchor auf/ nach diesem Grant persistiert hat, darf einen Provider-Rollback
vor diesen Grant nicht akzeptieren.

Ein sehr altes Gerät, das den neuen Grant **nie** gesehen hat und nur einen
älteren, damals gültigen Anchor besitzt, kann dagegen einen ehrlichen alten
Prefix nicht kryptographisch von einer bösartigen Provider-/Datei-Rücksetzung
auf genau diesen alten Prefix unterscheiden. In diesem Split-View-Fall kann ein
rein clientseitiges System ohne zusätzlichen unabhängigen Freshness-Dienst keine
globale Aktualität beweisen.

Daraus folgen verbindlich:

- neuere lokale Anchors, Recovery-Artefakte und verifizierte Backups dürfen nicht
  still auf ältere Zustände zurückgesetzt werden;
- Geräte, die einen Writer-Wechsel beobachtet haben, persistieren den Verlust der
  alten Authority fail-closed;
- ein altes Gerät darf aus bloßer Abwesenheit eines ihm unbekannten neueren Grants
  keine globale Aussage ableiten, dass kein Takeover stattgefunden hat;
- andere Geräte mit einem neueren Anchor müssen einen zurückgerollten Provider
  ablehnen;
- sind **alle** unabhängigen neueren Freshness-Belege verloren und liefert der
  Provider nur einen historisch gültigen alten Prefix, ist globale Freshness nicht
  rekonstruierbar.

Eine stärkere Anti-Equivocation-/Global-Freshness-Garantie benötigt einen
zusätzlichen unabhängigen Koordinations-/Freshness-Dienst und ist nicht Teil von
v2.

## 4. Kein Offline-Writer im strikten v2-Profil

Die gewünschte Aussage „das andere Gerät ist geblockt“ ist unter
Netzwerkpartitionen nur haltbar, wenn ein Gerät ohne frische Remote-Authority
keinen neuen fachlichen Commit erzeugt.

Deshalb gilt für v2 zunächst:

- Lesen aus bereits verifiziertem lokalem Zustand darf offline bleiben.
- Formulardaten dürfen transient als UI-Draft existieren.
- Eine neue Fachrevision wird erst persistiert, wenn die aktuelle
  Writer-Authority remote verifiziert wurde.
- Ist Google nicht erreichbar oder die Writer-Authority nicht frisch
  verifizierbar, ist das Tagebuch **read-only**.
- Ein späteres optionales „Offline Writer Window“ wäre eine bewusst schwächere
  Betriebsart und gehört nicht zum strikten v2-Profil.

Damit wird Verfügbarkeit bewusst zugunsten der eindeutigen Writer-Eigenschaft
eingeschränkt.

## 5. Geräteidentität

Jede Browser-/App-Installation erhält beim Einrichten für ein bestehendes
Tagebuch eine neue Geräteidentität **und ein eigenes Signaturschlüsselpaar**:

```text
writer_device_id
writer_signing_public_key
writer_signing_private_key
```

Der exakte v2-Wire-Stand legt Ed25519 mit 32-Byte-Raw-Public-Key und 64-Byte-Signatur fest. Anforderungen:

- neue zufällige Geräteidentität pro Installation;
- kein Ableiten aus Hardwaremerkmalen;
- keine globale Wiederverwendung;
- Public Key eindeutig an die `writer_device_id` gebunden;
- Private Key ausschließlich als nicht extrahierbarer Ed25519-`CryptoKey`
  persistiert; kein Raw-/PKCS#8-Fallback für Writer-Keys; unterstützt die
  Plattform dies nicht persistent, ist v2-Writerbetrieb dort nicht verfügbar;
- lokaler Security-State bindet Device-ID und Key-ID per State-MAC;
- Public Key darf im verschlüsselten Writer-Control-Payload liegen;
- Private Key verlässt das Gerät nicht.

Ein optionaler benutzerdefinierter Gerätename wie „Pixel“ oder „Laptop“ darf
verschlüsselt gespeichert werden, ist aber keine Sicherheitsidentität.

Der Geräteschlüssel ist **nicht optional**: Weil alle berechtigten Geräte den
Diary-Root-Key kennen, könnte der Root-Key allein keine Writer-Provenienz
beweisen.


### 5.1 Grenze der physischen Gerätebindung

Die Writer-Signatur beweist die Kontrolle über den aktuell autorisierten
**Writer-Private-Key**. Ein generischer Browser-`CryptoKey` darf dabei nicht als
beweisbar hardware- oder physisch gerätegebunden beschrieben werden.

Insbesondere gilt:

- `extractable:false` verhindert den normalen API-Export, ist aber keine
  allgemeine Garantie gegen Browserprofil-Kompromittierung, Profilkopie oder
  plattformspezifische Schlüssel-Replikation;
- besitzen zwei laufende Instanzen denselben aktuellen Writer-Private-Key und
  dieselbe `writer_device_id`, sind sie protokollseitig dieselbe Writer-Authority
  und können nicht voneinander gefenced werden;
- v2 garantiert daher ohne zusätzliche Plattformprimitive **eine kanonische
  Writer-Key-Authority**, nicht kryptographisch die Einzigartigkeit eines
  physischen Geräts;
- alte Writer-Keys bleiben nach einem Grant-Wechsel trotzdem wirksam gefenced,
  solange der aktuelle Writer-Key nicht ebenfalls kompromittiert/geklont ist.

Soll echte Anti-Cloning-/Hardware-Gerätebindung zum Produktionsziel werden,
benötigt das Profil eine separat evaluierte, auf den Zielplattformen belastbar
nicht exportierbare Signaturprimitive oder einen externen Geräte-/Token-Broker.
Dies ist nicht implizit durch WebCrypto `extractable:false` erfüllt.

## 6. Writer-Authority

Der vollständige lokale Security-State wird um mindestens folgende Felder
erweitert:

```text
writer_device_id
writer_signing_key_id
writer_status
writer_generation
writer_grant_id
writer_verified_anchor: RemoteAnchorV2
```

Zusätzlich darf v2 die historische v1-Namensunschärfe
`remote_binding.provider_id == sync_profile` **nicht** fortführen. Im
`EpochLocalSecurityStateV6` werden Provider und Protokollprofil semantisch
getrennt gebunden, z. B.:

```text
remote_binding.storage_provider_id
remote_binding.sync_profile
remote_binding.remote_resource_id
remote_binding.remote_identity_binding
```

Die exakten Feldnamen werden im v2-State-Schema eingefroren. Ein
Google-Provider-Identifier und
`google-sheets-transferable-single-writer-v2` sind unterschiedliche
Begriffe, auch wenn v1 sie historisch in einem Feld vermischt.

`writer_status` ist im persistierten exakten V6-State ausschließlich:

```text
read_only
writer_active
```

`writer_candidate`, `writer_stale` und `writer_conflict` bleiben rein transiente
UI-/Operationsklassifikationen und werden nicht als persistierter writer_status
gespeichert.

Nur `writer_active` darf Fachrevisionen erzeugen.

`writer_active` ist kein UI-Flag. Der Status darf nur nach vollständiger
Remote-Verifikation, `source_epoch_sealed=false` und exakter Übereinstimmung von
lokaler Device-ID, Generation, Grant-ID und Anchor gesetzt werden.


### 6.1 RemoteAnchorV2

v2 verwendet einen eigenen exakt versionierten Anchor-Typ:

```json
{
  "anchor_profile": "google-sheets-transferable-single-writer-v2",
  "covered_row_count": 123,
  "prefix_hash": "<32-byte base64url>"
}
```

`RemoteAnchorV1` wird nicht in-place erweitert oder als v2-State gespeichert.
Die physische Prefix-Hash-Mechanik kann als Primitive wiederverwendet werden;
ob v2 dieselbe Hash-Rekurrenz mit neuer Profilbindung oder eine neue
Domain-Tag-Version verwendet, wird im exakten v2-Wire-Profil festgeschrieben und
mit eigenen Golden Vectors abgesichert.

## 7. Writer-Control-Record

v2 erhält ein neues Control-Schema, beispielsweise:

```text
writer-grant-sw-v2
```

Architektur-Payload; die **exakte geschlossene Wire-Fassung einschließlich
writer_key_id und authorization** steht ausschließlich in
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`:

```json
{
  "grant_id": "<32-byte base64url>",
  "writer_generation": 7,
  "writer_device_id": "<device-id>",
  "writer_signing_public_key": "<canonical public-key encoding>",
  "previous_grant_id": "<32-byte base64url|null>",
  "previous_writer_generation": 6,
  "recovery_generation": 3,
  "reason": "initial|handoff|forced_takeover",
  "authority_anchor": {
    "anchor_profile": "google-sheets-transferable-single-writer-v2",
    "covered_row_count": 123,
    "prefix_hash": "<32-byte base64url>"
  }
}
```

Regeln:

1. `writer_generation` startet bei 1. Für Gen‑1 gilt
   `previous_grant_id = null` und `previous_writer_generation = 0`.
2. Jeder gültige Wechsel erhöht exakt um 1.
3. `previous_grant_id` und `previous_writer_generation` müssen danach exakt
   die aktuell kanonische Authority referenzieren.
4. `authority_anchor` bindet den Grant an den vollständig verifizierten
   Remote-Prefix, auf dessen Basis die Übernahme beschlossen wurde.
5. Ein normaler Handoff-Grant muss zusätzlich vom **bisher aktuellen
   Writer-Schlüssel** über einen domainspezifischen kanonischen Grant-Signing-
   Input signiert sein.
6. Ein Forced-Takeover-Grant muss stattdessen einen im exakten v2-Profil
   definierten **Recovery-Takeover-Proof** über denselben semantischen
   Grant-Kontext tragen. Dessen Verifikationsauthority
   ist an Manifest und Recovery-Generation gebunden; Root-Key-Besitz allein
   reicht ausdrücklich nicht.
7. Ein Grant darf nur dann neue Authority erhalten, wenn sein Authority-Anchor
   exakt dem physischen Prefix **unmittelbar vor seiner Row** entspricht und die
   Vorgänger-/Recovery-Authority dort noch current ist.
8. Ein bereits vorbereiteter Grant, dessen Anchor durch irgendeine weitere Row
   historisch geworden ist, erhält später niemals mehr Authority; er wird stale.
   Das gilt auch, wenn derselbe Vorgänger-Writer noch current ist.
9. Bei parallelen g+1-Claims kann deshalb nur der zuerst linearisiert appended
   Claim gewinnen; weitere gegen denselben alten Prefix vorbereitete Claims sind
   stale.
10. Handoff-Signatur bzw. Recovery-Proof müssen mindestens
    `diary_id`, `epoch_id`, `grant_id`, neue Writer-Generation,
    Vorgänger-Grant/-Generation, Recovery-Generation am Anchor,
    Ziel-Device-ID, Ziel-Public-Key, Reason und Authority-Anchor binden.
11. Ein Grant mit Zukunftsgeneration, falscher Vorgängerbindung, unpassendem
    Anchor oder ungültiger Autorisierung ist ein Security-/Conflict-Zustand; er
    wird nie automatisch „latest-wins“ ausgewählt.

Der Control-Record läuft durch denselben verschlüsselten Envelope-Pfad wie
andere Control-Records. Es ist keine zusätzliche Klartext-Steuerdatei nötig.

Das exakte v2-Wire-Profil legt fest, wie der Recovery-Takeover-Proof erzeugt und
verifiziert wird. Er hängt von einer Recovery-Authority ab, die ein
kompromittiertes Gerät mit Root-Key und Google-Zugriff **ohne aktuellen
Recovery-Nachweis** nicht nachbilden kann.

Normative Architekturgrenze dafür:

- das v2-Manifest bindet den **Recovery-Startzustand der Epoche**; eine spätere
  RecoveryAuthorityTransitionV2 darf Recovery-Generation, URS-Commitment und
  Takeover-Verifikationsmaterial innerhalb derselben unsealed Epoche
  writer-autorisiert fortschreiben;
- der Recovery-Key bzw. das mit ihm entschlüsselbare RecoveryArtifact muss die
  dazugehörige **Takeover-Signier-/Proof-Capability** freischalten;
- diese Capability wird nicht als normaler lokaler Writer-State persistiert;
- Root-Key allein darf sie nicht rekonstruieren;
- Recovery-Rekey aktiviert die neue Takeover-Authority zuerst auf der noch
  aktiven Source-Epoche über RecoveryAuthorityTransitionV2; ab durable
  Transition ist die alte Recovery-Generation auch innerhalb derselben Source
  für neue Takeovers ungültig.

Das exakte Profil legt hierfür pro Recovery-Generation ein separates
Ed25519-Takeover-Schlüsselpaar fest: der Epoch-Start-Public-Key liegt im
geschützten Manifest; spätere same-epoch Keys werden durch
RecoveryAuthorityTransitionV2 gebunden. Der exportierte Private Key liegt
ausschließlich im URS-verschlüsselten RecoveryArtifactV6; Forced Takeover
importiert ihn nur transient als nicht extrahierbaren Signing-Key. Eine bloße
UI-Abfrage des Recovery-Keys genügt nicht.

## 8. Writer-Provenienz jeder Revision

Jede v2-Revision, die einen fachlichen oder normalen Control-Zustand verändert,
trägt zusätzlich:

```json
{
  "writer_context": {
    "writer_generation": 7,
    "writer_grant_id": "<grant-id>",
    "writer_device_id": "<device-id>",
    "writer_key_id": "<key-id>"
  },
  "writer_signature": "<signature over the canonical v2 revision signing input>"
}
```

Der `writer_context` und die Signatur liegen im verschlüsselten
Revision-Payload. Envelope-AEAD schützt Vertraulichkeit und Integrität gegen
Außenstehende; die zusätzliche Gerätesignatur beweist Writer-Provenienz auch
gegenüber einem anderen berechtigten Gerät, das denselben Root-Key kennt.

Das exakte Signatur-Input-Format muss kanonisch, domainspezifisch und gegen
Cross-Epoch-/Cross-Grant-Replay gebunden sein. Mindestens Diary-ID, Epoch-ID,
Revision-ID, Writer-Generation, Grant-ID und der vollständige signierte
Revision-Kern müssen gebunden werden.

Ausnahmen sind ausschließlich die exakt spezifizierten Writer-Grant-
Control-Records selbst; diese besitzen ihre oben definierte Handoff- bzw.
Recovery-Autorisierung.

## 9. Sequenzielle Remote-Verifikation

Der Full Verifier verarbeitet `_r` weiterhin in physischer Reihenfolge und
führt zusätzlich einen Writer-Authority-Automaten.

Für jede Row:

1. Envelope strukturell und kryptographisch öffnen.
2. Bei `writer-grant-sw-v2` Vorgänger, Generation und Authority-Anchor prüfen.
3. Aktuelle kanonische Writer-Authority fortschreiben, falls Grant gültig.
4. Bei Fachrevision:
   - `writer_context == current authority` **und** Writer-Signatur gegen den
     im Grant gebundenen Public Key gültig -> akzeptiert;
   - ältere Generation bzw. alter Grant -> `stale_writer_rejected`;
   - gleiche Generation mit anderer Grant-/Device-/Key-ID -> fatal;
   - ungültige oder fehlende Writer-Signatur -> fatal;
   - zukünftige Generation ohne gültigen vorherigen Grant -> fatal.
5. Nur akzeptierte Revisionen gehen in den fachlichen Revision-Graph ein.

Physisch vorhandene stale Rows bleiben Bestandteil des Prefix-Hash/Anchors, damit
die append-only Historie stabil bleibt. Sie werden semantisch nicht angewendet.

Stale Rows zählen vollständig gegen bestehende physische Row-/Byte-Limits.
Dadurch kann ein stale oder kompromittierter Client keinen unbegrenzten
kostenlosen Müllpfad erzeugen.

## 10. Initiale Remote-Aktivierung und Trust-Root

Beim ersten Wechsel von `local_offline` nach v2:

1. lokales Tagebuch vollständig verifizieren;
2. aktuelles Gerät erzeugt seine neue Writer-Geräteidentität und das
   Writer-Signaturschlüsselpaar;
3. für die aktuelle Recovery-Generation wird eine
   Recovery-Takeover-Verifikationsauthority festgelegt;
4. Successor-v2-Manifest erzeugen und darin mindestens binden:
   - initiale `writer_device_id`;
   - initialen Writer-Public-Key / Key-ID;
   - `writer_generation = 1`;
   - Recovery-Generation;
   - Recovery-Takeover-Verifikationsmaterial;
5. initialen `writer-grant-sw-v2` mit Generation 1 erzeugen; er muss exakt zur
   manifestgebundenen initialen Writer-Authority passen;
6. Fach-Heads und Migration unter dieser Authority signiert schreiben;
7. Successor vollständig verifizieren;
8. Recovery und Backup einschließlich Takeover-Recovery-Material testen;
9. erst danach atomar auf v2 umschalten.

Der Gen‑1-Grant vertraut also **nicht** auf eine frei im Log auftauchende
Self-Signature. Seine Authority ist über den kryptographisch verifizierten
v2-Manifest-Fingerprint festgelegt.

Bei v1→v2-Migration wird genau dieser Successor-Manifest-Fingerprint zusätzlich
durch den normalen v1-Rotation-Announcement-/Switch-Pfad gebunden.

Es darf keine v1-Epoche nachträglich mit Writer-Feldern erweitert werden.

## 11. Zweites Gerät hinzufügen

Ein zweites Gerät darf **nicht** als neues `remote_enablement` eines
eigenständigen lokalen Tagebuchs behandelt werden.

Der Join-Pfad lautet:

1. Google authentifizieren.
2. Recovery-Key eingeben.
3. das **v2-versionierte** Remote RecoveryArtifact laden und das zur aktuellen
   Recovery-Generation gehörende Recovery-/Takeover-Material verifizieren;
4. aktuellen Remote-Epoch-Kandidaten unabhängig entdecken und vollständig
   verifizieren.
5. Root-Key nur nach Recovery-Bootstrap aktivieren.
6. neue lokale `writer_device_id` und Writer-Signaturschlüssel erzeugen.
7. Profil als `read_only` persistieren.
8. URS und eine gegebenenfalls für den Bootstrap abgeleitete
   Recovery-Takeover-Signier-/Proof-Capability unmittelbar nach erfolgreichem
   Bootstrap aus dem normalen Sitzungszustand verwerfen; für einen späteren
   Forced Takeover muss der Recovery-Key erneut eingegeben werden.
9. erst nach einem gültigen Writer-Grant darf dieses Gerät schreiben.

Für einen **normalen** Handoff muss der aktuelle Writer den Public Key des
Zielgeräts authentisch erhalten. v2 verwendet dafür zunächst einen expliziten
Out-of-Band-Transferdescriptor, z. B. QR-/Kopiercode mit
`sync_profile + diary_id + epoch_id + writer_device_id + writer_key_id + public_key + nonce + possession_signature`, den das Zielgerät anzeigt und der
aktuelle Writer bestätigt. Der aktuelle Writer muss dabei Profil, Diary-ID und
Epoch-ID exakt gegen seinen verifizierten aktuellen Kontext prüfen; ein
Descriptor aus einer anderen oder bereits rotierten Epoche wird abgelehnt. `possession_signature` ist eine domainspezifische Signatur des Ziel-Private-Keys über die kanonischen übrigen Descriptorfelder; der aktuelle Writer verifiziert sie vor Grant-Erzeugung. Dadurch muss ein read-only Gerät keine
autoritätsverändernde Remote-Row schreiben, nur um als Handoff-Ziel bekannt zu
werden.

Ein späteres Remote-Join-Request-Protokoll wäre möglich, wäre aber ein eigener
Control-Typ und darf niemals selbst Writer-Authority verleihen.

Damit existiert für Laptop und Pixel **ein Tagebuch und eine Remote-Epoche**,
nicht je Gerät eine unabhängig erzeugte Google-Epoche.

Hat das zweite Gerät bereits ein unabhängiges lokales Tagebuch mit eigenen
nicht synchronisierten Fachrevisionen, darf Join diese Daten nicht still
überschreiben oder automatisch in das andere Tagebuch schieben. Dafür ist ein
separater expliziter Import-/Merge-Pfad erforderlich.

## 12. Normaler Writer-Wechsel A -> B

Voraussetzung: B ist bereits als read-only Gerät mit derselben aktuellen Epoche
vollständig verifiziert.

Ablauf:

1. A pullt und full-verifiziert Remote.
2. A muss alle eigenen Pending-Envelopes remote durable machen.
3. Solange Pending-Daten existieren, ist „Writer übertragen“ blockiert.
4. A verifiziert Bs Out-of-Band-Transferdescriptor und bindet
   `writer_device_id + writer_signing_public_key`.
5. A erzeugt Grant `g+1` für B, gebunden an aktuellen Anchor und Grant `g`,
   und signiert ihn mit As aktuellem Writer-Schlüssel.
6. A appendet exakt diesen Grant.
7. A liest Remote vollständig zurück.
8. Nur wenn der Grant kanonisch und die Handoff-Signatur gültig ist, persistiert
   A lokal `read_only`.
9. B pullt vollständig.
10. Nur wenn derselbe Grant kanonisch ist und dessen Public Key Bs lokalem
    Private Key entspricht, setzt B lokal `writer_active`.

Crash-Sicherheit:

- Crash vor Schritt 5: A bleibt Writer.
- Unknown outcome in Schritt 6: Discovery/Readback entscheidet; niemals blind
  zweiten semantisch anderen Grant erzeugen.
- Crash nach durable Grant, aber vor lokalem Demote: A muss vor dem nächsten
  Fachwrite erneut Authority prüfen und wird dadurch read-only.
- B wird nie aufgrund eines lokalen Buttons Writer, sondern erst nach
  Remote-Readback.

## 13. Erzwungene Übernahme bei verlorenem Gerät

Ein read-only Gerät darf eine erzwungene Übernahme nur nach besonders deutlicher
Ceremony starten:

1. den konfigurierten RootWrap-Modus erfolgreich entsperren; Best-Effort ist
   zulässig, bleibt aber ausdrücklich schwächerer lokaler At-rest-Schutz als
   PRF/Passphrase;
2. Google Account Binding;
3. Recovery-Key erneut eingeben;
4. aktuelles Remote vollständig verifizieren und `source_epoch_sealed=false`
   verlangen;
5. Warnung, dass auf dem alten Gerät noch ausschließlich lokale, nie
   synchronisierte Änderungen existieren könnten;
6. Recovery-Takeover-Authority für die **aktuelle Recovery-Generation**
   nachweisen;
7. Grant `g+1` mit `reason = "forced_takeover"`, neuem Geräte-Public-Key und
   gültigem Recovery-Takeover-Proof erzeugen;
8. append + vollständiger Readback;
9. nur bei kanonischem eigenen Grant `writer_active`.

Ein kompromittiertes Altgerät mit Root-Key und Google-Credential, aber ohne
gültige Recovery-Takeover-Authority, darf dadurch keinen Forced Takeover
fälschen. Ist auch die aktuelle Recovery-Authority kompromittiert, besteht
bewusst keine kryptographische Trennung mehr; Recovery-Rekey muss deshalb die
Takeover-Authority mitrotieren.

## 14. Gleichzeitige Takeover-Versuche

Zwei Geräte können denselben Grant `g` sehen und nahezu gleichzeitig
`g+1` beanspruchen.

Beide Control-Envelopes dürfen physisch im append-only Log landen.

Der Remote-Verifier verarbeitet die endgültige physische Row-Reihenfolge:

```text
Grant g
Claim B: previous=g, generation=g+1   -> gültig
Claim C: previous=g, generation=g+1   -> stale, weil current bereits B/g+1
```

Nur B darf nach Full Readback `writer_active` werden.

Kein Client darf aus einem erfolgreichen HTTP-Response auf Writer-Authority
schließen.

Diese Regel benötigt einen Live-Google-Test mit parallelen
`AppendCellsRequest`-Aufrufen. Falls Google keine für diesen Zweck ausreichend
stabile beobachtbare Row-Reihenfolge liefert, ist das Profil ohne zusätzlichen
Koordinationsdienst **nicht freigabefähig**.

## 15. Fachwrite im v2-Profil

Vor jedem neuen Fachcommit:

1. den konfigurierten RootWrap-Modus erfolgreich entsperren; Best-Effort ist
   zulässig, bleibt aber ausdrücklich schwächerer lokaler At-rest-Schutz als
   PRF/Passphrase;
2. Google-Session vorhanden;
3. Writer-Authority remote gegen aktuellen Anchor verifizieren und
   `source_epoch_sealed=false` verlangen;
4. lokale `writer_device_id`, Generation und Grant-ID müssen exakt matchen;
5. erst dann Revision mit `writer_context` erzeugen, kanonisch mit dem
   aktuellen Geräte-Private-Key signieren und als Envelope lokal persistent
   vorbereiten;
6. signiertes Envelope pushen;
7. Readback;
8. Writer-Authority und gesamten Remote-Zustand erneut full-verifizieren;
9. nur bei unveränderter Authority als durable/committed markieren.

Wenn zwischen Schritt 3 und dem Remote-Append ein anderer Grant gewinnt, wird
die alte Revision beim Readback als stale erkannt und **nicht** als fachlicher
Commit übernommen. Lokal wird sie in einen quarantinierten
`stale_writer_pending`-Zustand verschoben.

Sie darf niemals automatisch unter der neuen Generation erneut verschlüsselt
oder gepusht werden.

## 16. Umgang mit lokalen stale Pending-Daten

Nach einem Writer-Wechsel kann ein altes Gerät noch vorbereitete lokale Daten
besitzen.

Diese werden sichtbar als:

```text
„Dieses Gerät hat N Änderungen aus einer alten Writer-Sitzung.
Sie wurden nicht in das gemeinsame Tagebuch übernommen.“
```

Erlaubte Aktionen:

- verschlüsselt exportieren;
- nach erneuter Writer-Übernahme explizit einzeln übernehmen;
- explizit verwerfen.

Verboten:

- automatischer Push;
- Timestamp/latest-wins;
- stilles Umschreiben auf die neue Writer-Generation.

## 17. Rotation unter v2

Normale Epoch-Rotation ist nur dem aktuellen Writer erlaubt.

Das geschützte v2-Manifest übernimmt zusätzlich einen Snapshot der aktuellen
Writer-Authority:

```text
writer_generation
writer_grant_id
writer_device_id
```

Der Successor startet mit exakt dieser Authority; eine normale Rotation ist
kein Gerätewechsel. Das v2-Manifest bindet deshalb Writer-Generation, Grant-ID,
Device-/Key-ID und den aktuellen Writer-Public-Key sowie die zur aktuellen
Recovery-Generation gehörende Takeover-Verifikationsauthority.

Writer-Transfer und Epoch-Rotation dürfen auf **einem Gerät** nicht gleichzeitig
laufen; dafür bleiben lokale `operation_generation`-/Maintenance-Gates
zuständig.

Über **mehrere Geräte** reicht lokales `operation_generation` nicht. Die
Remote-Reihenfolge muss deterministisch sein:

- jedes v2-Rotation-Announcement trägt deshalb einen
  `source_anchor_before_announcement`, der **exakt** dem physischen Prefix
  unmittelbar vor seiner eigenen Row entsprechen muss;
- landet irgendeine physische Row vor dem vorbereiteten Announcement, wird
  dessen Anchor historisch. Das Announcement ist dann stale und darf die Source
  **nicht** versiegeln – auch dann nicht, wenn die Writer-Authority durch diese
  Row unverändert blieb;
- landet ein gültiger Takeover-Grant vor dem Rotation-Announcement, ist das
  vorbereitete Announcement dadurch ebenfalls stale und der Successor darf nicht
  aktiviert werden;
- landet das anchor-exakte gültige Rotation-Announcement zuerst, ist die
  Source-Epoche ab dieser kanonischen Row **versiegelt**; spätere Fachwrites,
  Writer-Grants und andere authority-mutierende Controls auf der Source sind
  semantisch ungültig. Recovery/Takeover muss dann gegen den kanonischen
  Successor erfolgen.

Rotation-Announcement und andere autoritätsverändernde Control-Records sind
damit sowohl an die Writer-/Recovery-Authority als auch an den exakten
Entscheidungs-Prefix gebunden.

Recovery-Rekey ändert den Writer nicht automatisch. Die neue
Recovery-Authority wird zuerst auf der **noch aktiven, unsealed Source** durch
einen writer-signierten `RecoveryAuthorityTransitionV2` aktiviert. Das neue
RecoveryArtifactV6 wird bereits davor unter dem neuen URS publiziert und bindet
die exakt vorbereiteten Transition-Envelope-Bytes. Nach Crash darf Recovery diese
Bytes nur fertig appendieren, wenn die Source noch exakt am gebundenen Anchor
steht; jede intervenierende Row macht den vorbereiteten Rekey stale.

Nach durable Transition ist die alte Recovery-Generation auch innerhalb
derselben Source für neue Forced Takeovers ungültig. Ein obligatorisches
activated Source-Backup muss erfolgreich getestet sein, bevor eine
recovery_rekey-Epoch-Rotation beginnt. Der Successor übernimmt anschließend die
bereits aktuelle Recovery-Generation; die Rotation erhöht sie nicht noch einmal.

Aktivierung über mehrere Epochen wird durch `ActivationLineageV2` transitiv
bewiesen. Das aktuelle RecoveryArtifact trägt unter dem aktuellen URS die
begrenzte, geordnete Kette der historischen Source-RKs und der dazugehörigen
v1→v2-/v2→v2-Aktivierungsbeweise. Jeder Link wird vom Root nach vorn gegen die
jeweilige echte Source-Historie geprüft; ein gültiger direkter Link heilt keinen
älteren ungültigen oder fehlenden Link.

Jeder nicht-native Link verlangt zusätzlich **exakt ein**
`epoch-migration-sw-v2` im Successor. Dessen Source-Semantic-/Lineage-Hashes
werden gegen den verifizierten Source-Graph am gebundenen Source-Anchor
nachgerechnet; Result-Semantic-Hash und Head-Counts gegen den Successor-Graph
unmittelbar vor der Migration-Control-Row. Aktivierungsproof ohne korrekte
Migration-Integrität genügt nicht. Dadurch kann ein kryptographisch korrekt
aktivierter, aber unvollständig kopierter Successor nicht kanonisch werden.

Ein unter RK_epoch verschlüsselter `ActivationLineageCacheV2` hält diese
Lineage lokal für Rotation/Rekey verfügbar, auch wenn der alte URS verloren ist.
Er besitzt einen eigenen Cache-Identifier/Cache-Hash und ist **kein**
Operation-State. Kompromittierung des aktuellen URS offenbart bewusst die im
RecoveryArtifact enthaltenen historischen Root-Keys; kompromittiertes RK_epoch
**plus Zugriff auf den lokalen Lineage-Cache** offenbart dieselben historischen
Keys ebenfalls.

**Bewusste Recovery-Rekey-Grenze:** Weil der alte Recovery-Key gerade verloren
sein darf, reicht zur Recovery-Authority-Transition die aktuell kanonische
Writer-Authority zusammen mit RK_epoch und Google-Mutationszugriff. Ein
Angreifer, der alle drei gleichzeitig kontrolliert, kann die Recovery-Authority
auf eigenes Material umstellen. Ein stärkeres Modell benötigt einen zusätzlichen
unabhängigen Recovery-Zweitfaktor und eine neue Protokollversion.

Jede Rotation besitzt einen persistenten Crash-Resume-State mit den exakten
one-shot Announcement-/Grant-Bytes. Die Stage-Reihenfolge ist geschlossen:
Successor verifizieren -> Announcement one-shot vorbereiten ->
Activation-Evidence/Lineage bilden -> RecoveryArtifact -> staged Backup ->
Announcement append/readback -> activated Backup -> Switch. Das Announcement
muss **vor** RecoveryArtifact/Backup vorbereitet sein, weil diese seine exakten
Bytes kryptographisch binden. Vor dem finalen lokalen Switch ist neben dem
staged Backup zwingend ein **activated SyncBackupV6** zu erzeugen und per
Test-Restore zu prüfen. Ein Backup kann Daten/Schlüssel offline wiederherstellen;
remote-active Writer-Recovery benötigt weiterhin die historische
Activation-Lineage-Source-Kette.
## 18. Migration v1 -> v2

Migration wird auf dem aktuell vertrauenswürdigen v1-Gerät gestartet:

1. v1 Source full-verifizieren, finalen Source-Anchor und
   Semantic-/Lineage-Snapshots berechnen und Writes einfrieren;
2. neue v2-Successor-Epoche + initialen Writer Grant Generation 1 planen;
3. Fach-Heads kopieren und exakt eine v2 Migration-Control schreiben. Deren
   Source-Snapshot-Hashes müssen gegen den v1-Prefix und deren Result-Hash/Counts
   gegen den Successor-Graph unmittelbar vor der Control-Row nachgerechnet
   werden;
4. Successor full-verifizieren und die Migration-Integritätsprüfung vollständig
   bestehen;
5. v1 Rotation Announcement exakt one-shot vorbereiten und daraus den
   ProfileUpgrade-ActivationLineage-Eintrag erzeugen;
6. RecoveryArtifactV6 publizieren und staged Recovery testen;
7. staged SyncBackupV6 read-only Test-Restore;
8. exakt das vorbereitete v1 Rotation Announcement durable machen;
9. ActivationLineage **einschließlich Migration-Integrität** vollständig prüfen;
10. **obligatorisch** activated SyncBackupV6 erzeugen und Test-Restore;
11. ActivationLineageCacheV2 mit eigenem Cache-ID/Hash
    persistieren/readback-verifizieren;
12. erst danach atomar auf v2 umschalten und v1 retire.

Alte v1-Geräte sehen das Announcement und dürfen die alte Epoche nicht weiter
als aktiv behandeln.

## 19. UI-Zustände

### Aktiver Writer

```text
Dieses Gerät darf Einträge erfassen.
Writer: Pixel
Generation: 7
```

### Read-only

```text
Dieses Tagebuch wird derzeit von „Laptop“ bearbeitet.
Auf diesem Gerät kannst du lesen, aber keine neuen Einträge speichern.
[Schreibzugriff übernehmen]
```

### Writer-Wechsel

Auf aktuellem Writer:

```text
Schreibzugriff an „Pixel“ übertragen
```

Transfer ist deaktiviert, solange lokale Änderungen noch nicht remote durable
sind.

### Forced Takeover

Explizite Warnung mit Recovery-Key-Ceremony. Kein unscheinbarer
„Trotzdem fortfahren“-Button.

### Stale Pending

Eigener Problemzustand; nicht als normaler Sync-Konflikt darstellen.

## 20. Provider-/API-Auswirkungen

Für die bevorzugte v2-Variante bleibt der Writer-Control-Log im bestehenden
verschlüsselten `_r`-Log.

Daher sind voraussichtlich:

- kein zusätzlicher Google-OAuth-Scope;
- keine neue Google-Datei;
- keine neue Google-API-Endpunktfamilie

notwendig.

Die aktuelle Drive-v3-`files.update`-Schnittstelle bietet Patch-Semantik für
Dateimetadaten und `appProperties`, aber das v2-Design verlässt sich bewusst
nicht auf einen undokumentierten providerseitigen Compare-and-Swap.

Sheets-`spreadsheets.batchUpdate` bleibt der Mutationspfad. Ein einzelner
Batch ist atomar, aber Writer-Authority entsteht ausschließlich aus
append-only Control-Row + anschließendem vollständigem Readback.

Das logische RecoveryArtifactV6 kann durch ActivationLineageV2 größer als eine
einzelne Sheets-Zelle werden. Die exakte v6-Speicherrepräsentation chunked
`wrapped_payload` deshalb über mehrere Zellen eines strikt geschlossenen
Recovery-Grids; Header, Chunkzahl, Länge und SHA-256 werden vollständig
readback-verifiziert. Das logische RecoveryArtifact-/Backup-Wireformat bleibt
von dieser Provider-Repräsentation getrennt.

## 21. Tests vor Implementierungsfreigabe

Mindestens:

1. A Writer, B read-only.
2. B kann keine Fachrevision erzeugen.
3. normaler A->B Transfer.
4. A nach durable Transfer vor lokalem Demote crasht.
5. B nach Grant vor lokalem Promote crasht.
6. A besitzt Pending -> Transfer blockiert.
7. forced takeover B, A später wieder online.
8. A appendet stale Fachrow nach Takeover -> Row physisch vorhanden, semantisch
   verworfen, Remote bleibt weiter lesbar.
9. zwei gleichzeitige Takeover-Claims -> exakt ein kanonischer Writer.
10. Claim mit falschem predecessor -> nicht akzeptiert.
11. Claim mit übersprungener Generation -> fail-closed.
12. gleiche Generation, falsche Grant-ID bei Fachrow -> fatal.
13. Rotation während Transfer -> gegenseitig blockiert.
14. Recovery-Rekey während Transfer -> gegenseitig blockiert.
15. Browser-/PWA-Neustart auf beiden Geräten in jeder Transferphase.
16. echtes Pixel + Laptop gegen Live-Google.
17. Netzwerkverlust vor Append, nach Append, vor Readback und nach Readback.
18. zweites Gerät mit unabhängigem lokalem Tagebuch -> kein stiller Join/Overwrite.
19. stale/kompromittiertes Altgerät mit Root-Key kann aktuellen
    `writer_context` ohne neuen Writer-Private-Key nicht fälschen.
20. Handoff-Grant ohne Signatur des bisherigen Writers -> abgelehnt.
21. Forced-Takeover ohne gültigen Recovery-Takeover-Proof -> abgelehnt.
22. Rotation vs. Forced-Takeover in beiden Remote-Reihenfolgen -> exakt ein
    kanonischer Fortsetzungszustand.
23. Recovery-Rekey vs. Forced-Takeover -> alte Recovery-Generation kann keinen
    neuen Takeover autorisieren.
24. Transferdescriptor-Key stimmt nicht mit Zielgerät überein -> kein Promote.
25. Transferdescriptor mit falschem Profil/Diary/Epoch -> Handoff wird vor Grant-Erzeugung abgelehnt.
26. Transferdescriptor ohne gültigen Proof-of-Possession des Ziel-Private-Keys -> Handoff wird abgelehnt.
27. Provider-Rollback vor einen dem Gerät bereits bekannten Writer-Grant -> fail-closed gegen den neueren Anchor.
28. Vollständiger Verlust aller neueren Freshness-Belege -> als explizite nicht lösbare globale Freshness-Grenze dokumentiert; kein erfundener "latest"-Zustand.
29. vorbereiteter Handoff-/Takeover-Grant, danach beliebige andere Row bei
    unverändertem Writer -> alter Grant bleibt stale und darf später keine
    Authority übertragen.
30. recovery_rekey mit verlorenem altem URS: neues same-epoch RecoveryArtifact
    publiziert, Crash vor Transition -> Recovery mit neuem URS darf exakt die
    vorbereitete Transition nur bei unverändertem Anchor fertig appendieren.
31. recovery_rekey: fremde Row überholt Transition-Anchor -> neue
    Recovery-Authority bleibt staged/read-only.
32. durable RecoveryAuthorityTransitionV2 -> alte Recovery-Generation kann
    keinen neuen Forced Takeover autorisieren.
33. zweifache v2→v2-Rotation: nur direkter ActivationProof gültig, älterer
    Lineage-Link manipuliert -> Recovery fail-closed.
34. staged Successor -> Fachwrite, Handoff und Forced Takeover blockiert.
35. Gen-1-Grant fehlt oder erste semantische Row ist kein manifestgebundener
    Gen-1-Grant -> fail-closed.
36. Unknown Outcome nach Source-Seal -> kein Retry auf versiegelter Source.
37. Crash/Neustart in jeder WriterGrant-, RecoveryRekey- und
    RotationOperationStateV2-Stage.
38. Rotation-Switch ohne activated Successor-Backup -> blockiert.
39. activated Backup bei fehlender historischer Source -> nur offline/read-only,
    niemals erfundene Writer-Authority.
40. vorbereitete v2-Rotation, danach beliebige stale physische Source-Row,
    danach altes Announcement -> stale_rotation_announcement_rejected und Source
    bleibt unsealed.
41. Rotation-Announcement mit falschem from_epoch_id, self-successor oder
    falscher recovery_transition_id -> fail-closed.
42. Successor mit fehlendem/zusätzlichem Fach-Head trotz gültigem
    ActivationProof -> Migration-Integrität schlägt fehl, keine Aktivierung.
43. manipulierte source_semantic/source_lineage_snapshot_hash oder
    Result-Head-Counts -> fail-closed.
44. gültiger direkter ActivationProof, aber fehlende/zweite EpochMigrationV2 ->
    keine Aktivierung.
45. ActivationLineageCacheV2 cache_id/ref/hash mismatch -> fail-closed; kein
    Rotation/Rekey-Start.
46. profile_upgrade/normal/recovery_rekey durch alle erlaubten
    RotationOperationStateV2-Stages; übersprungene oder unmögliche
    Null/non-null-Kombination -> security_blocked.
47. Recovery-Rekey-Rotation bindet exakt die durable
    RecoveryAuthorityTransitionV2.transition_id in Announcement, Proof und
    Migration-Control.

## 22. Nicht-Ziele

Nicht Teil von v2:

- gleichzeitiges Schreiben zweier Geräte;
- automatische fachliche Merge-Konvergenz konkurrierender Writer;
- providerseitige Device-ACL bei demselben Google-Konto;
- Offline-Fachwrites im strikten Profil;
- automatische Übernahme stale lokaler Änderungen;
- Änderung der bestehenden v1-Semantik in-place.

## 23. Implementierungsreihenfolge

1. v2 Protokoll-/Schema-Definition exakt festschreiben. **Abgeschlossen; normative Quelle ist EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md.**
2. Writer-Provenienz in Revision/Verifier.
3. Writer-Grant-Control-Automat.
4. lokale Security-State-Erweiterung und fail-closed Writer-Gate.
5. v1->v2 Epoch-Migration.
6. read-only Join eines bestehenden Tagebuchs.
7. kooperativer Writer-Transfer.
8. forced takeover + stale-pending quarantine.
9. UI.
10. Unit-/Fault-/Browsermatrix.
11. Live-Google-Konkurrenztest.
12. erst danach produktive Freigabe des Mehrgerätepfads.

## 24. Architekturentscheidung

Für EDS Diary wird **Transferable Single Writer** als Zielmodell gewählt:

- mehrere Geräte dürfen dasselbe Tagebuch besitzen und lesen;
- exakt eine kanonische Writer-Key-Authority pro Remote-Log-Prefix; ohne zusätzliche hardwaregebundene Primitive ist dies nicht gleichbedeutend mit beweisbar genau einem physischen Gerät;
- Writer-Wechsel über monotone Generation + Grant-ID + Anchor-Bindung;
- alte Writer werden relativ zum kanonisch beobachteten/verankerten Writer-Grant protokollseitig gefenced; globale Freshness gegen einen Provider-Rollback ohne erhaltenen neueren Beleg ist ausdrücklich nicht garantiert;
- read-only ist der Normalzustand aller anderen Geräte;
- kein implizites Multi-Writer-Merge;
- keine In-place-Änderung des bestehenden v1-Profils;
- striktes v2 opfert Offline-Schreiben, um die Writer-Eigenschaft belastbar zu
  halten.


## 25. Implementierungsgrenze gegenüber bestehendem v1-Code

v2 ist **architektonisch getrennt**, aber nicht als vollständig neue Anwendung neben
v1 implementierbar. Mehrere heute gemeinsam genutzte Kernmodule enthalten
v1-spezifische Annahmen und müssen versioniert/erweitert werden.

Die Regel lautet:

> Bestehende v1-Bytes, v1-State-Schemas, v1-Verifierregeln und v1-Laufzeitsemantik
> bleiben unverändert. Gemeinsame APIs dürfen erweitert werden, aber ein alter
> v1-Datensatz muss nach dem v2-Refactoring exakt wie vorher gelesen, geprüft und
> geschrieben werden.

### 25.1 Muss erweitert werden

#### `src/sync/core/contracts.ts`

Heute existiert der konkrete konstante Wert:

```text
google-sheets-single-writer-v1
```

Die Transport-/Codec-Interfaces sind bereits weitgehend profilneutral, die
Konstante selbst jedoch nicht.

Für v2:

- v1-Konstante unverändert lassen;
- neue v2-Profilkonstante ergänzen;
- gemeinsame Interfaces weiter profilneutral halten;
- `VerifiedRemoteState` muss seine `profileId` tragen und darf
  profil-spezifischen, bereits verifizierten Zustand nur als klar abgegrenzten
  `profileState` an die Authority-Schicht weiterreichen;
- Anchor-Erzeugung und Prefix-Fortschrittsprüfung gehören in den
  `TransportProfileCodec`, nicht in den gemeinsamen Coordinator;
- niemals eine v2-Epoche über einen v1-Codec oder einen Verified-State eines
  anderen Profils akzeptieren.

#### `src/security/revisions.ts`

Der aktuelle Revision-Wrapper verlangt eine **exakte** Property-Menge. Ein
zusätzliches `writer_context` würde deshalb v1-Revisionen bzw. deren exakte
Wrapperdefinition verändern.

Nicht erlaubt:

```text
Revision v1 einfach um optional writer_context erweitern
```

Bevorzugt:

```text
RevisionV1  -> bestehendes Format unverändert
RevisionV2  -> eigenes exaktes Wrapperformat mit writer_context
```

Ein profilabhängiger Validator wählt anhand der verifizierten Epoche die richtige
Revision-Version. v1-Envelopes behalten damit exakt ihre bisherigen Plaintext-
Bytes und Validierungsregeln.

#### `src/security/localState.ts`

Der aktuelle lokale Security-State ist exakt `local_state_version: 5` und das
`remote_binding.provider_id` ist auf v1 typisiert.

Writer-Authority darf nicht als optionale v2-Erweiterung in denselben exakten
v5-State geschoben werden.

Bevorzugt:

```text
EpochLocalSecurityStateV5  -> unverändert
EpochLocalSecurityStateV6  -> v2 + writer fields
```

Die aktive Epoche entscheidet, welcher State-Typ zulässig ist. Die Migration
v1 -> v2 geschieht durch Epoch-Rotation, nicht durch Mutation des vorhandenen
v1-Stateobjekts.

#### `src/sync/core/remoteVerifier.ts`

Der aktuelle Full Verifier kennt:

- v1-Profil;
- v1-Control-Schemas;
- v1-Anchorprofil;
- v1-Revisionwrapper.

Für v2 wird kein großer `if (v2)`-Block im bestehenden Verifier bevorzugt.

Bevorzugte Aufteilung:

```text
RemoteVerifierCore
  - Envelope-/Row-/AEAD-/Bounds-Prüfung
  - gemeinsame Prefix-/Anchor-Helfer

SingleWriterV1Verifier
  - heutige v1-Regeln unverändert

TransferableSingleWriterV2Verifier
  - Writer-Grant-Automat
  - Writer-Provenienz
  - stale-writer filtering/fencing
```

Recovery muss den passenden Verifier aus dem kryptographisch verifizierten
`sync_profile` wählen und darf kein Profil erraten.

#### `src/sync/core/coordinator.ts`

Der heutige Coordinator setzt nach Pull/Verify lokal `writer_active`.
Das reicht für v2 nicht, weil Writer-Authority eine zusätzliche verifizierte
Remote-Eigenschaft ist.

Gemeinsame Push-/Readback-/Generation-Mechanik kann wiederverwendet werden.
Der Coordinator darf dabei weder `RemoteAnchorV1` noch v1-Prefix-Helper kennen:
er delegiert Anchor-Erzeugung/-Fortschrittsprüfung an den aktiven Profilcodec.
Die Schreibfreigabe läuft zusätzlich über eine profilabhängige
Authority-Schnittstelle, z.B.:

```text
WriteAuthority {
  canPrepareDomainWrite(...)
  verifyBeforePush(...)
  verifyAfterReadback(...)
}
```

v1 bekommt eine Adapterimplementierung mit exakt bisheriger Semantik. v2 prüft
Grant/Generation/Device-ID.

#### `src/data/localDatabase.ts`

Der aktuelle Fachwrite-Pfad erzeugt sofort eine v1-Revision, sobald die lokale
Epoche nicht eingefroren ist.

Für v2 muss vor dem **Persistieren einer neuen Fachrevision** Writer-Authority
geprüft werden. Außerdem müssen v2-Revisionen ihren `writer_context` erhalten.

Der bestehende v1-Pfad soll nicht verändert werden; stattdessen wird anhand des
aktiven Epoch-Profils auf einen v1- oder v2-Write-Policy/Revision-Builder
dispatcht.

Auch `bindRemote` darf den Provider/Profile-Identifier nicht länger intern
fest auf v1 setzen.

### 25.2 Kann weitgehend wiederverwendet werden

Folgende Bausteine sollen nicht neu erfunden werden:

- Root-Key-/RootWrap-Architektur;
- Envelope-AEAD und Bucket/Padding;
- kanonische JCS-Serialisierung;
- immutable Envelope-Store;
- lokales Journal;
- Outbox/Durable-Readback-Grundmechanik;
- `operation_generation`;
- Web Locks;
- Google Auth-Bridge und Token-Isolation;
- Google Drive/Sheets Low-Level-RPC;
- Recovery-Key-KDF;
- Backup-/Recovery-**Mechanik** (KDF/AEAD, Bounds, Readback, Test-Restore) als
  Implementierungsbausteine; die v5-Artefakt-Schemas selbst bleiben eingefroren;
- der v2-spezifische Recovery-Aktivierungsnachweis ist dagegen neu und darf
  nicht aus v1 implizit abgeleitet werden;
- Creation-/Unknown-Outcome-Grundmaschine;
- Epoch-Rotation als Migrationsmechanismus.

### 25.3 Muss neu hinzukommen

Neue, klar abgegrenzte v2-Komponenten:

```text
TransferableWriterAuthority
RemoteAnchorV2
WriterDeviceKeyV2
WriterSignatureV2
RecoveryTakeoverAuthorityV2
RecoveryAuthorityTransitionV2
RecoveryAuthorityTransitionProofV2
RecoveryActivationProofV2
ActivationLineageV2
ActivationLineageCacheV2
WriterGrantOperationStateV2
RecoveryRekeyOperationStateV2
RotationOperationStateV2
SyncBackupV6
RecoveryArtifactV6
WriterGrantV2
WriterGrantStateMachine
TransferableSingleWriterV2Verifier
RevisionV2 / RevisionV2Validator
EpochLocalSecurityStateV6
DeviceJoinService
WriterHandoffService
ForcedTakeoverService
StaleWriterQuarantine
V1ToV2Migration
```

Die **Low-Level-Google-RPC-/Grid-Implementierung** kann weitgehend gemeinsam
bleiben. Die heutige `GoogleSheetsSingleWriterTransport`-Klasse ist jedoch
selbst mit dem v1-`profileId` gebunden und darf daher nicht unverändert als
v2-Transport ausgegeben werden. Vor v2 gibt es zwei saubere Optionen:

- gemeinsamen Google-Transportkern extrahieren und dünne v1-/v2-Profiladapter
  davor setzen; oder
- einen eigenen v2-Transportadapter bauen, der dieselben Low-Level-Helfer nutzt.

Transport, Profilcodec und Verifier müssen an jeder produktiven Konstruktion
dieselbe `profileId` tragen. v2 muss außerdem `providerId` und `profileId`
als getrennte Identitäten behandeln; das historisch missverständlich benannte
v1-`remote_binding.provider_id` bleibt nur aus Kompatibilitätsgründen
eingefroren.


### 25.3a Backup- und Recovery-Artefakte

Die aktuellen Artefakte sind **v1/v5-spezifische, exakt geschlossene Wire-Schemas**:

- `SyncBackupV5` bindet `RemoteAnchorV1`;
- `sync-recovery-v5` besitzt ein exaktes Recovery-Payload ohne
  Writer-Key-/Takeover-Authority.

v2 darf diese Formate nicht durch optionale Felder erweitern. Es benötigt neue
versionierte Artefakte/Validatoren (Arbeitsnamen `SyncBackupV6` und
`RecoveryArtifactV6`), die mindestens das v2-Profil, den v2-Anchor bzw. die
verifizierte Writer-Authority und das zur Recovery-Generation gehörende
Takeover-Recovery-Material korrekt binden.

Die kryptographischen Grundprimitive und die Test-Restore-/Readback-Mechanik
können wiederverwendet werden; die Wire-Version bleibt getrennt.

### 25.4 Was ausdrücklich nicht geändert werden darf

Für bestehende v1-Epochen bleiben unverändert:

- `sync_profile = google-sheets-single-writer-v1`;
- v1-Manifeststruktur und Fingerprint;
- v1-Revisionwrapper;
- v1-Control-Allowlist;
- v1-`RemoteAnchorV1` einschließlich `anchor_profile`;
- v1-`local_state_version: 5`;
- `SyncBackupV5` / `sync-backup-v5` einschließlich
  `remote_anchor_at_export: RemoteAnchorV1`;
- `RecoveryArtifact` / `sync-recovery-v5` und dessen exaktes
  `RecoveryPayload`;
- v1-Recovery-/Backup-Interpretation;
- die bisherige stale/offline-Fork-Semantik;
- bestehende Testvektoren und kryptographische Byte-Ausgaben.

Ein v2-Refactoring gilt als Regression, wenn irgendein bestehender v1-Testvektor
oder eine bestehende v1-Datei danach anders interpretiert wird.

### 25.5 Praktische Konsequenz

Die Einführung von v2 ist daher **kein Rewrite**, aber auch kein rein additives
Feature in einem isolierten Ordner.

Erwartete Struktur:

```text
shared crypto/storage/transport primitives
        |
        +-- single-writer-v1 policy + verifier       (frozen behavior)
        |
        +-- transferable-single-writer-v2 policy
             + writer authority
             + join
             + handoff
             + takeover
             + stale quarantine
```

Die meisten sicherheitskritischen Änderungen bestehen darin, heutige
v1-spezifische Entscheidungen aus gemeinsam genutzten Modulen herauszulösen und
hinter profilabhängige Policies/Validatoren zu stellen. Das muss **vor** der
eigentlichen Writer-Handoff-Implementierung geschehen.

## 26. Empfohlene Refactoring-Reihenfolge ohne Verhaltensänderung

Vor v2-Funktionalität war ein eigener vorbereitender Refactoring-PR verlangt.
PR #36 ist gemergt und die vollständige Security Validation auf dem kombinierten
Stand war grün; diese Vorentkopplung ist damit abgeschlossen:

1. aktuelle v1-Konstanten und Typen explizit als V1 benennen;
2. `RevisionV1` und `EpochLocalSecurityStateV5` als eingefrorene Typen
   herausziehen;
3. v1-Verifier hinter eine profilbezogene Verifier-Schnittstelle setzen;
4. Coordinator-Schreibfreigabe hinter eine profilneutrale
   `WriteAuthority`-Policy mit `writer | read_only` ziehen; diese Policy
   gehört in den Protokoll-/lokalen State-Layer, **nicht** in den
   Google-Provider;
5. `VerifiedRemoteState` an `profileId` binden und einen abgegrenzten
   `profileState` für spätere v2-Authority-Daten vorsehen;
6. auch `RemoteAnchorV1` explizit als eingefrorenes v1-Wireformat benennen und
   Anchor-Policy aus dem gemeinsamen Coordinator in den Profilcodec verschieben;
7. Remote-Binding/Profile-ID aus fest codierten lokalen Persistenzstellen
   entfernen;
8. **keine** Writer-v2-Funktion hinzufügen;
9. vollständige bestehende Security-/Rotation-/Recovery-/Browsermatrix muss
   byte- und verhaltensgleich grün bleiben.

Erst danach folgt der eigentliche v2-Implementierungsstack.

Dadurch ist der riskanteste Schritt – Architekturentkopplung – separat reviewbar
und kann gegen die komplette bestehende v1-Assurance geprüft werden.
