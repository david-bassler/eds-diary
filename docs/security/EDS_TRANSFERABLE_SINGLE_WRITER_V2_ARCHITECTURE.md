# EDS Diary – Transferable Single Writer v2

Die Begründungen stabiler Sicherheitsentscheidungen und verworfener Alternativen stehen ergänzend in `EDS_TRANSFERABLE_SINGLE_WRITER_V2_DECISIONS.md`; spätere Reviews sollen dort zwischen neuer Erkenntnis und bloßem Design-Pendeln unterscheiden.

Status: **ARCHITEKTURRAHMEN DEFINIERT / EXAKTES v2-PROTOKOLL IN EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md EINGEFROREN / TEILWEISE IMPLEMENTIERT / PRODUKTIV NICHT FREIGEGEBEN**

Stand: 22.09.2026

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
writer_key_id
writer_public_key
private_key                 # ausschließlich lokaler non-extractable CryptoKey
```

`writer_key_id` ist exakt der im Exact Protocol definierte Hash von
`writer_public_key`; es gibt keinen separaten "signing key id"-Wire-Namespace.
Der exakte v2-Wire-Stand legt Ed25519 mit 32-Byte-Raw-Public-Key und
64-Byte-Signatur fest. Anforderungen:

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
  "writer_public_key": "<canonical public-key encoding>",
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

Für Crash-Resume eines staged Successors gibt es zusätzlich einen eng
operation-gebundenen Verify-Zweck: Nur bei MAC-authentifiziertem
RotationOperationStateV2 in `successor_bound|copying` darf ein noch fehlendes
EpochMigrationV2-Control als erwarteter Zwischenzustand gemeldet werden. Dieser
Modus verleiht **niemals** aktive Epoche, Writer-Authority, Recovery-Aktivierung
oder activated Backup-Status. Ab `successor_verified` ist wieder der
kanonische Full Verify mit verpflichtender Migration-Control erforderlich.

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
`sync_profile + diary_id + epoch_id + writer_device_id + writer_key_id + writer_public_key + nonce + possession_signature`, den das Zielgerät anzeigt und der
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
   `writer_device_id + writer_public_key`.
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
Recovery-Generation gehörende Takeover-Verifikationsauthority. Zusätzlich bindet
es den bei der Remote-Erzeugung verwendeten `creation_locator`; das
Rotation-Announcement muss denselben Wert als `successor_creation_locator`
tragen.

Writer-Transfer und Epoch-Rotation dürfen auf **einem Gerät** nicht gleichzeitig
laufen; dafür bleiben lokale `operation_generation`-/Maintenance-Gates
zuständig.

Über **mehrere Geräte** reicht lokales `operation_generation` nicht. Die
Remote-Reihenfolge muss deterministisch sein:

- jedes v2-Rotation-Announcement trägt deshalb einen
  `source_anchor_before_announcement`, der **exakt** dem physischen Prefix
  unmittelbar vor seiner eigenen Row entsprechen muss, **und** einen
  `successor_staging_anchor`, der den exakt geprüften Successor-Prefix direkt
  nach der Migration-Control bindet;
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

Für einen **nicht-nativen staged Successor** gilt zusätzlich ein
pre-migration Authority-Freeze: Vom Epoch-Start bis einschließlich der einen
EpochMigrationV2 darf sich seine Writer-/Recovery-Authority nicht verändern.
Beim v1→v2-Upgrade ist nur der manifestgebundene Gen-1-Bestätigungsgrant als
erste Row zusätzlich erlaubt. WriterGrant/Handoff/Forced-Takeover,
RecoveryAuthorityTransition, RotationAnnouncement oder
SuccessorActivationConfirmation vor der Migration-Control sind
`staged_pre_migration_control_forbidden` / security_blocked. Dadurch werden
alle kopierten Fach-Heads unter exakt der eingefrorenen Epoch-Start-Authority
signiert; ein A→B→A-Wechsel vor Migration kann die Prüfung nicht umgehen.

Die semantischen v2-Control-IDs `grant_id`, `rotation_id`, `migration_id`,
`transition_id` und `confirmation_id` teilen zusätzlich **einen gemeinsamen
epochweiten Bytewert-Namespace**. Derselbe CSPRNG-ID-Wert darf in keinem anderen
Envelope erneut als semantische Control-ID auftreten, auch nicht unter einem
anderen Feldtyp. Byte-identische Envelope-Retries bleiben die einzige erlaubte
Wiederholung; jede andere Wiederverwendung ist `protocol_id_collision` /
security_blocked. Die manifestgebundene Epoch-Start-Grant-ID gilt von Beginn an
als reserviert/belegt.

Recovery-Rekey ändert den Writer nicht automatisch. Die neue
Recovery-Authority wird zuerst auf der **noch aktiven, unsealed Source** durch
einen writer-signierten `RecoveryAuthorityTransitionV2` aktiviert. Das neue
RecoveryArtifactV6 wird bereits davor unter dem neuen URS publiziert und bindet
die exakt vorbereiteten Transition-Envelope-Bytes. Der **erste mutierende
Artifact-Publish-Versuch** ist der bewusste Point of no local return: Unmittelbar
davor wird `artifact_publish_attempted=true` persistent/readback-verifiziert.
Danach kann weder ein fehlender Erfolgs-Callback noch ein
`unknown_outcome` als lokaler Abort interpretiert werden; das Publish-Outcome
muss per Discovery/Grid-Readback reconciliiert werden. Existieren die exakten
Artifact-Bytes remote und steht die Source weiter am gebundenen Anchor, muss die
Transition fertiggestellt werden. Erst eine andere physische Source-Row macht
die vorbereitete Capability tatsächlich stale.

Jede akzeptierte RecoveryAuthorityTransitionV2 muss **frischen URS und frisches
Recovery-Takeover-Keypair** verwenden. v2 führt dafür ab seiner ersten
Aktivierung eine epochübergreifend fortgetragene
`recovery_credential_history`: der generationsunabhängige `recovery_urs_id`
und die recovery_takeover_key_id dürfen weder aktuell noch historisch bereits
vorgekommen sein. Das verhindert auch nach Epoch-Rotation ein K1→K2→K1 bzw.
U1→U2→U1. Vor-v2 Recovery-Credentials können mangels historischer v1-IDs nicht
rückwirkend erkannt werden; diese Legacy-Grenze ist ausdrücklich akzeptiert.

Nach durable Transition ist die alte Recovery-Generation auch innerhalb
derselben Source für neue Forced Takeovers ungültig. Gleichzeitig setzt der
Remote-Verifier einen **remote ableitbaren Pending-Rekey-Fence**:

~~~text
recovery_rekey_rotation_required = true
current_recovery_rekey_transition_id = durable transition_id
~~~

Dieser Zustand hängt nicht von IndexedDB oder dem ursprünglichen Gerät ab.
Solange er aktiv ist, sind Fachwrites, kooperativer Handoff und normale Rotation
semantisch blockiert. Zulässig bleiben nur Forced Takeover zur
Writer-Wiedergewinnung, eine weitere RecoveryAuthorityTransitionV2 zum
Superseden eines erneut kompromittierten Recovery-Keys und die verpflichtende
`recovery_rekey`-Rotation gegen die **jüngste** Transition-ID.

Damit kann auch ein Ersatzgerät nach vollständigem Geräteverlust den
unvollständigen Rekey erkennen, per neuem Recovery-Key/Forced Takeover einen
maintenance-only Writer erhalten und Phase B fortsetzen.

Das ist aber **noch nicht** der vollständige Recovery-Key-Wechsel: das alte
immutable RecoveryArtifact kann den bisherigen Source-RK weiterhin unter dem
alten URS offenlegen.

Deshalb ist anschließend zwingend:

1. activated Source-Backup unter der neuen Recovery-Authority testen;
2. eine `recovery_rekey`-Epoch-Rotation starten, die exakt die durable
   RecoveryAuthorityTransitionV2.transition_id bindet;
3. einen **neuen unabhängig erzeugten Successor-RK** erzeugen, der byteweise
   keinem direkten oder historischen `source_root_key` der resultierenden
   ActivationLineage entspricht; diese Freshness wird bei der Cross-Epoch-
   Aktivierung als `successor_root_key_reuse` fail-closed geprüft;
4. Migration-/Announcement-/Activation-Lineage- und activated-Backup-Gates
   vollständig durchlaufen;
5. erst nach dem atomaren Switch gilt der Recovery-Key-Wechsel als abgeschlossen.

Ein Ersatzgerät ohne ursprünglichen RecoveryRekeyOperationStateV2 darf nach
vollständiger Remote-Verifikation des Pending-Rekey-Fence einen neuen lokalen
Operation-State aus der durablen Transition und dem aktuellen RecoveryArtifact
**adoptieren** und ab `transition_durable` fortsetzen. Ein lokaler State ist
damit Resume-Hilfe, nicht die Sicherheitsquelle für die Rotationspflicht.

Soll während eines Pending-Rekey ein weiterer Recovery-Key-Wechsel die aktuelle
Transition superseden, gilt lokal eine zweiphasige State-Supersession: Vor der
neuen Remote-Transition wird ein readback-verifizierter neuer Rekey-State
persistiert und der einzige aktive `recovery_operation_state_ref` atomar auf
ihn umgebunden; der alte durable State bleibt suspendiert. Scheitert der neue
Versuch vor seiner durablen Transition, wird der alte Remote-Fence wieder
gebunden/adoptiert. Erst nachdem canonical_full die **neuere Transition durable**
als remote-current beweist, wird der alte State atomar terminal
`superseded` und mit der neuen transition_id verknüpft. Ein superseded State
darf nie wieder Resume-/Locking-Authority erhalten.

Der Successor übernimmt die bereits aktuelle Recovery-Generation; die Rotation
erhöht sie nicht noch einmal und startet wieder ohne Pending-Rekey-Fence. Der alte Recovery-Key kann danach den neuen
aktiven Successor-RK nicht ableiten. Historische Vertraulichkeit kann ein Rekey
nicht rückwirkend herstellen, wenn das alte Artifact bereits kopiert oder
kompromittiert wurde.

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
unmittelbar vor der Migration-Control-Row.

Zusätzlich wird die Cross-Epoch-Provenienz als **strikte Bijection** geprüft:
Jeder aktuelle Source-Fach-Head muss genau eine neue Successor-Genesis-Revision
mit gleicher Fachsemantik, leerem Parent-Array und einem singleton
`migration_origin` auf exakt Source-Epoche, `record_id` und Source-
`revision_id` besitzen; jeder Successor-Fach-Head muss genau einem solchen
Source-Head entsprechen. Damit schützt die Migration nicht nur den aktuellen
Wert, sondern auch die Herkunft konkurrierender Heads über Epoch-Grenzen.
Aktivierungsproof ohne korrekte Migration-Integrität und Provenienz genügt
nicht. Dadurch kann ein kryptographisch korrekt aktivierter, aber unvollständig
oder provenance-seitig falsch kopierter Successor nicht kanonisch werden.

Ein unter RK_epoch verschlüsselter `ActivationLineageCacheV2` hält diese
Lineage lokal für Rotation/Rekey verfügbar, ohne historische URSs erneut zu
benötigen. Er ersetzt aber nicht den **aktuellen** URS: Jede normale Rotation
muss den aktuellen URS erneut erhalten, das aktuelle Source-RecoveryArtifactV6
entschlüsseln und dessen Recovery-Takeover-Keypair prüfen, weil nur dort das
Takeover-Private-Key-Material liegt, das in das neue Successor-Artifact
übernommen werden muss. Auch ein **carried** Keypair wird für die konkrete
Successor-Epoche erneut als RecoveryTakeoverStagingV2 unter dem aktuellen URS
persistiert/readback-verifiziert; Crash-Sicherheit gilt nicht nur für neu
generierte Keypairs. Ist der aktuelle URS verloren, wird zuerst ein
recovery_rekey auf einen neuen URS durchgeführt; ein zusätzliches lokales
Private-Key-Escrow gibt es nicht. Der Cache besitzt einen eigenen
Cache-Identifier/Cache-Hash und ist **kein** Operation-State. Kompromittierung des aktuellen URS offenbart bewusst die im
RecoveryArtifact enthaltenen historischen Root-Keys; kompromittiertes RK_epoch
**plus Zugriff auf den lokalen Lineage-Cache** offenbart dieselben historischen
Keys ebenfalls.

**Bewusste Recovery-Rekey-Grenze:** Weil der alte Recovery-Key gerade verloren
sein darf, reicht zur Recovery-Authority-Transition die aktuell kanonische
Writer-Authority zusammen mit RK_epoch und Google-Mutationszugriff. Ein
Angreifer, der alle drei gleichzeitig kontrolliert, kann die Recovery-Authority
auf eigenes Material umstellen. Ein stärkeres Modell benötigt einen zusätzlichen
unabhängigen Recovery-Zweitfaktor und eine neue Protokollversion.

RecoveryRekeyOperationStateV2 bleibt während Phase B nicht-terminal. Deshalb
sperrt er normale Rotation, erlaubt in stage="successor_rotation_required" aber
exakt die zu seiner current transition_id passende
`recovery_rekey`-Rotation. Ein Ersatzgerät gewinnt bei Geräteverlust zuerst
per Forced Takeover einen maintenance-only Writer und legt **danach** einen
adoptierten Rekey-Operation-State an.

Jede Rotation besitzt einen persistenten Crash-Resume-State mit den exakten
one-shot Announcement-/Grant-Bytes. Nach erfolgreicher Migration wird zusätzlich
der **successor_staging_anchor** als exakter Successor-Prefix unmittelbar nach
der Migration-Control eingefroren. Announcement, Activation-Evidence/Lineage,
RecoveryArtifact und staged Cutover-Backup binden exakt diesen Anchor. Die
SuccessorActivationConfirmation bildet danach eine feste
`successor_activation_anchor`-Grenze. Das obligatorische activated
Cutover-Backup muss diese Grenze über die verifizierte ActivationLineage
reproduzieren und den **aktuellen vollständig verifizierten Successor-Prefix**
exportieren; existiert bereits ein gültiger post-activation Suffix, darf dieser
den activation anchor monoton erweitern. Vor der Confirmation bleibt jeder
andere Suffix ein Cutover-Race.

Die Stage-Reihenfolge ist geschlossen:
Successor verifizieren/staging anchor einfrieren -> Announcement one-shot
vorbereiten -> Activation-Evidence/Lineage bilden -> RecoveryArtifact -> staged
Backup -> Announcement append/readback -> Successor-Suffix ab staging anchor
klassifizieren -> fehlende SuccessorActivationConfirmation one-shot
append/readback bzw. bereits identische Confirmation reconciliieren ->
post-activation Suffix vollständig verifizieren -> Lifecycle-Reconciliation ->
activated Backup -> Switch **oder** terminal post_activation_superseded.
Das Announcement muss **vor** RecoveryArtifact/Backup vorbereitet sein, weil
diese seine exakten Bytes kryptographisch binden. Weicht der Successor nach
durable Source-Seal durch eine **andere erste Row als die exakt vorbereitete
Confirmation** vom staging anchor ab, endet der Vorgang terminal als
`cutover_race`; die Source bleibt versiegelt, aber es gibt keinen activated
Backup/Switch. Ist die erste neue Row exakt die vorbereitete Confirmation, wird
sie dagegen als bereits durable reconciliiert.

Nach Confirmation darf ein anderer legitimer Writer remote weiterarbeiten. Sind
das nur Fachrows/WriterGrants, kann der initiierende Cutover den finalen Prefix
in sein activated Backup aufnehmen und ggf. read_only wechseln. Hat der Suffix
aber die Recovery-Authority fortgeschrieben oder den Successor bereits durch
eine weitere Rotation versiegelt, ist die Remote-Historie gültig, der lokale
Operation-State aber **überholt**: `post_activation_superseded`, kein Backup
mit historischem RecoveryArtifact und kein automatischer lokaler Switch.

Vor einem normalen finalen lokalen Switch ist neben dem staged Backup zwingend
ein **activated SyncBackupV6** zu erzeugen und per Test-Restore zu prüfen. Sein
RemoteAnchor muss den successor_activation_anchor enthalten, darf ihn nur um
vollständig verifizierte post-activation Rows erweitern und sein
RecoveryArtifact muss exakt zum finalen Recovery-State dieser Rows passen.
**Unmittelbar vor dem lokalen Switch** folgt noch ein letzter canonical_full des
Successors. Recovery-State-Fortschritt oder erneutes Seal seit dem Backup =>
post_activation_superseded/kein Switch; reine Fachrows/WriterGrants bleiben
zulässig und der lokale Writerstatus wird aus dieser letzten Authority
abgeleitet. Zwischen diesem letzten Read und dem lokalen Commit bleibt mangels
providerseitigem CAS ein unvermeidbares Race-Fenster; es wird vor jeder späteren
Mutation durch das ohnehin verpflichtende frische Full Verify wieder erkannt.
Ein Backup kann Daten/Schlüssel offline wiederherstellen;
remote-active Writer-Recovery benötigt weiterhin die historische
Activation-Lineage-Source-Kette.
## 18. Migration v1 -> v2

Migration wird auf dem aktuell vertrauenswürdigen v1-Gerät gestartet.

**Einmalige v1-Grenze:** Das eingefrorene v1-Announcement besitzt keinen
Source-Anchor und v1 kennt keine Cross-Device-Writer-Fence. Deshalb kann das
Profilupgrade eine zusätzliche v1-Row zwischen letztem Source-Read und
Announcement-Append nicht kryptographisch per CAS ausschließen. Google Sheets
v4 garantiert Atomizität innerhalb eines Batch-Requests, aber keinen solchen
Compare-and-Swap gegen einen zuvor gelesenen Prefix. Das Upgrade setzt daher
explizit voraus, dass während des Cutovers kein anderer v1-Client schreibt.

Vor dem Upgrade müssen alle anderen v1-Geräte/Browserinstanzen geschlossen und
alle lokalen Pending/Unknown-Outcomes reconciliert sein. Nach der
Successor-Migration wird zusätzlich dessen `successor_staging_anchor`
eingefroren. Vor der SuccessorActivationConfirmation darf keine andere Row
erscheinen; nach exakt dieser Confirmation ist ein gültiger post-activation
Suffix zulässig und muss vollständig verifiziert werden.
Direkt vor dem Announcement werden **v1-Source und v2-Successor** erneut gelesen:
Source- und Staging-Anchor müssen jeweils exakt unverändert sein. Wird beim Readback danach dennoch eine zusätzliche Row zwischen
Anchor und Announcement erkannt, bleibt der v2-Successor staged/read-only und
der Vorgang geht in `profile_upgrade_source_race`; kein zweites Announcement
und kein automatisches Wegwerfen der v1-Daten.

Ablauf:

1. v1 Source full-verifizieren, finalen Source-Anchor und
   Semantic-/Lineage-Snapshots berechnen und Writes einfrieren;
2. neue v2-Successor-Epoche mit neuem RK_epoch, gebundenem creation_locator und
   initialem Writer Grant Generation 1 planen; der neue RK darf nicht dem
   v1-Source-RK entsprechen;
3. Fach-Heads als neue Successor-Genesis-Revisionen mit leerem Parent-Array und
   exakt singleton `migration_origin` auf den jeweils kopierten v1-Source-Head
   unter der eingefrorenen Gen-1-Authority übertragen und exakt eine v2
   Migration-Control schreiben. Vor dieser Migration-Control ist außer dem
   manifestgebundenen Gen-1-Grant keine Authority-mutierende Control-Row
   zulässig. Source-Snapshot-Hashes müssen gegen den v1-Prefix,
   Result-Hash/Counts gegen den Successor-Graph und die Head-Provenienz als
   vollständige Source↔Successor-Bijection unmittelbar vor der Control-Row
   nachgerechnet werden;
4. Successor full-verifizieren und die Migration-Integritätsprüfung vollständig
   bestehen; successor_staging_anchor einfrieren;
5. v1 Rotation Announcement **und** SuccessorActivationConfirmation exakt
   one-shot vorbereiten und beide Bytes in den
   ProfileUpgrade-ActivationLineage-Eintrag binden;
6. RecoveryArtifactV6 mit remote_anchor=successor_staging_anchor publizieren und
   staged Recovery testen;
7. staged SyncBackupV6 read-only Test-Restore mit exakt
   successor_staging_anchor;
8. v1-Source und Successor unmittelbar vor Append erneut vollständig lesen;
   Source- und Staging-Anchor müssen exakt unverändert sein. Bei Abweichung vor
   durable Announcement wird der bereits erzeugte Successor lokal
   `orphaned/read_only` und nie wieder für einen neuen Versuch verwendet;
9. exakt das vorbereitete v1 Rotation Announcement durable machen und **beide**
   Remotes sofort erneut lesen. Zusätzliche v1-Row zwischen Anchor und
   Announcement => `profile_upgrade_source_race`. Beim Successor gilt: exakt
   staging anchor => Confirmation fehlt; erste neue Row ist exakt die
   vorbereitete Confirmation => als durable reconciliieren; jede andere erste
   Row => `profile_upgrade_successor_cutover_race`;
10. fehlende SuccessorActivationConfirmation mit exakt den vorbereiteten Bytes
    appendieren/readback-verifizieren; successor_activation_anchor als feste
    Grenze durch diese Confirmation ableiten;
11. einen danach vorhandenen post-activation Suffix vollständig verifizieren
    und ActivationLineage einschließlich Migration-Integrität und Confirmation
    vollständig prüfen. Fortschreibung nur von Fachrows/WriterGrants ist
    integrierbar. Hat der Suffix den Recovery-State geändert oder den Successor
    bereits versiegelt, endet dieser lokale Upgrade-State
    `post_activation_superseded`: gültige Remote-Historie bleibt bestehen,
    aber kein stale RecoveryArtifact/Backup und kein automatischer Switch;
12. nur im nicht-supersedeten Fall obligatorisch activated SyncBackupV6 erzeugen
    und Test-Restore; sein RemoteAnchor muss den successor_activation_anchor
    enthalten, darf ihn nur um den vollständig verifizierten post-activation
    Suffix erweitern und das RecoveryArtifact muss zum End-Recovery-State passen;
13. ActivationLineageCacheV2 mit eigenem Cache-ID/Hash
    persistieren/readback-verifizieren;
14. unmittelbar vor dem lokalen Umschalten Successor erneut canonical_full
    prüfen. Recovery-State-Fortschritt/erneutes Seal seit Backup =>
    post_activation_superseded; reine Fachrows/WriterGrants bleiben zulässig und
    writer_status wird aus der letzten Authority abgeleitet;
15. erst danach atomar auf v2 umschalten und v1 retire. Die No-CAS-Restgrenze
    zwischen letztem Read und lokalem Commit bleibt bewusst bestehen; vor jeder
    späteren Mutation folgt erneut Full Verify.

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

### Recovery-Rekey muss abgeschlossen werden

Wenn canonical_full `recovery_rekey_rotation_required=true` liefert, zeigt die
App keinen normalen Writer-Zustand, auch wenn das Gerät per Forced Takeover die
aktuelle Writer-Authority besitzt:

```text
Recovery-Key-Wechsel ist noch nicht abgeschlossen.
Neue Einträge und Schreibzugriff-Übertragung sind gesperrt.
[Recovery-Key-Wechsel abschließen]
```

Nach Geräteverlust darf ein neues Gerät mit dem aktuellen Recovery-Key diesen
Maintenance-Zustand aus der Remote-Historie rekonstruieren und Phase B
fortsetzen.

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

Source- und Successor-Epoche liegen in **getrennten** Provider-Ressourcen.
Google liefert keine atomare Cross-Resource-Transaktion und keine
kryptographische gemeinsame Uhr. `successor_staging_anchor` bindet deshalb
exakt den vom Source-Cutover autorisierten Migrations-Prefix, und der ehrliche
Rotation-Service friert ihn ein und prüft ihn unmittelbar vor sowie nach dem
Source-Seal. Eine beobachtete Abweichung wird fail-closed als Cutover-Race
behandelt.

Nicht behauptet wird dagegen, dass ein Angreifer, der bereits den **aktuellen
Writer-Private-Key und RK_epoch** kontrolliert, kryptographisch daran gehindert
werden könne, eine für sich gültig signierte Successor-Row zeitlich vor dem
Source-Announcement zu erzeugen: Ohne externen Koordinationsdienst ist ihre
Cross-Resource-Zeitlage später nicht beweisbar. Solche Rows erhalten aber keine
Migration-Provenienz und müssen unabhängig durch die normale Writer-Authority
validieren; der Migrations-/Cutover-Basisprefix selbst bleibt durch
successor_staging_anchor unverändert gebunden. Eine stärkere globale
Cross-Resource-Causality-Garantie benötigt ein neues Koordinationsprimitive bzw.
eine neue Protokollversion.

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
43. Successor mit semantisch korrektem Head, aber migration_origin=null,
    falscher Source-Epoche/Record-/Revision-ID, mehreren Source-Revisionen oder
    doppelter Zuordnung desselben Source-Heads ->
    migration_provenance_mismatch; keine Aktivierung.
44. manipulierte source_semantic/source_lineage_snapshot_hash oder
    Result-Head-Counts -> fail-closed.
45. gültiger direkter ActivationProof, aber fehlende/zweite EpochMigrationV2 ->
    keine Aktivierung.
46. ActivationLineageCacheV2 cache_id/ref/hash mismatch -> fail-closed; kein
    Rotation/Rekey-Start.
47. profile_upgrade/normal/recovery_rekey durch alle erlaubten
    RotationOperationStateV2-Stages; übersprungene oder unmögliche
    Null/non-null-Kombination -> security_blocked.
48. Recovery-Rekey-Rotation bindet exakt die durable
    RecoveryAuthorityTransitionV2.transition_id in Announcement, Proof und
    Migration-Control.
49. Crash in successor_bound/copying vor EpochMigrationV2 -> operation-gebundener
    rotation_resume-Verify akzeptiert den erwarteten unvollständigen Prefix nur
    als staged; canonical_full bleibt migration_control_missing.
50. RecoveryAuthorityTransitionV2 durable, aber Successor-Rotation noch nicht
    abgeschlossen -> neuer URS kann Source recovern/takeovern; Rekey bleibt
    ausdrücklich unvollständig.
51. alter URS nach durable Transition, aber vor Successor-Switch -> darf keine
    Recovery-Takeover-Authority mehr erhalten, kann historischen Source-RK über
    altes Artifact aber noch lesen.
52. Rekey `completed` ohne geswitchte recovery_rekey-Successor-Epoche mit
    **neuem RK_epoch** -> security_blocked.
53. nach abgeschlossenem Rekey kann altes URS den neuen aktiven Successor-RK
    nicht aus altem RecoveryArtifact ableiten.
54. durable RecoveryAuthorityTransitionV2 + weiterhin derselbe Writer-Key +
    Fachwrite -> remote rekey_rotation_required_rejected; Fachgraph unverändert.
55. Pending-Rekey-Fence + Handoff -> abgewiesen; Forced Takeover bleibt
    zulässig und erzeugt nur maintenance-only Writer.
56. Geräteverlust nach durable Transition -> neues Gerät mit neuem URS erkennt
    recovery_rekey_rotation_required aus Remote-Historie, übernimmt per Forced
    Takeover und adoptiert Phase B ohne alten lokalen Operation-State.
57. zweite RecoveryAuthorityTransitionV2 während Pending-Rekey -> jüngste
    transition_id supersedet die ältere; nur sie darf die Rekey-Rotation binden.
    Lokaler recovery_operation_state_ref wird vor Remote-I/O auf den neuen
    readback-verifizierten State umgebunden; der alte durable State bleibt
    suspendiert. Erst nach durable neuer Transition wird er atomar terminal
    `superseded`; stale neuer Versuch fällt auf die weiterhin remote-current
    ältere Transition zurück.
58. Pending-Rekey + normal-Rotation -> kein Seal; ausschließlich
    recovery_rekey-Rotation mit aktueller transition_id zulässig.
59. v1→v2: zusätzliche v1-Row zwischen finalem Pre-Append-Read und Announcement
    -> profile_upgrade_source_race; Successor bleibt staged/read-only, kein
    zweites Announcement/kein stiller Datenverlust.
60. RecoveryArtifactV6 mit to-State vor durabler Transition -> nur mit gültigem
    RecoveryAuthorityTransitionProofV2 staged/read-only; niemals current Forced
    Takeover-Authority.
61. cache_id/rotation_id/migration_id/transition_id/confirmation_id/operation_id:
    exakte Decode-Länge und kanonisches Base64URL; falsche Länge oder
    nicht-kanonische Repräsentation -> fail-closed.
62. Recovery-Rekey verwendet einen seit der ersten v2-Aktivierung
    bereits bekannten URS oder Recovery-Takeover-Key erneut — auch aus einer
    Vorgänger-Epoche -> recovery_credential_reuse / security_blocked. Die
    v1→v2-Legacy-Grenze für historisch vor-v2 pensionierte Credentials bleibt
    ausdrücklich dokumentiert.
63. zweite Control-Row in anderem Envelope verwendet einen bereits belegten
    Control-ID-Bytewert erneut — auch cross-type zwischen
    grant_id/rotation_id/migration_id/transition_id/confirmation_id ->
    protocol_id_collision; byte-identischer Envelope-Retry bleibt No-op.
64. WriterGrant mit writer_key_id, das nicht aus writer_public_key gemäß §2
    ableitbar ist -> security_blocked.
65. v2→v2 Cutover: successor_staging_anchor exakt nach Migration-Control;
    Proof/Announcement/RecoveryArtifact/staged Cutover-Backup binden diesen
    Anchor. Die Confirmation definiert successor_activation_anchor; das
    activated Cutover-Backup exportiert den aktuellen vollständig verifizierten
    Prefix, der diesen Anchor ggf. um post-activation Rows erweitert.
66. andere erste Successor-Row nach staging-anchor-Freeze als die exakt
    vorbereitete Confirmation -> successor_cutover_race; Source-Seal nicht
    zurückrollen, kein Switch.
67. v1→v2 analog: andere erste Row vor Confirmation ->
    profile_upgrade_successor_cutover_race; kein Switch.
68. Source-Announcement durable, Crash vor Successor-Confirmation -> Recovery
    darf exakt die vorbereiteten Confirmation-Bytes bei unverändertem staging
    anchor appendieren; ist exakt diese Confirmation bereits erste Suffix-Row,
    wird sie reconciliiert.
69. SuccessorActivationConfirmation mit falschem Announcement-Hash, falscher
    Source-/Successor-Bindung oder nicht unmittelbarem staging anchor ->
    activation_confirmation_mismatch / keine Aktivierung.
70. normale Fachrow nach durabler Confirmation -> post-activation-Suffix und
    nur bei gültiger aktueller Writer-Authority akzeptiert.
71. WriterGrant/RecoveryAuthorityTransition/RotationAnnouncement/Confirmation
    vor EpochMigrationV2 im staged Successor ->
    staged_pre_migration_control_forbidden.
72. nicht-native Epoche verwendet direkten oder historischen Source-RK erneut ->
    successor_root_key_reuse / security_blocked.
73. normale Rotation ohne aktuellen URS und verifiziertes
    Source-RecoveryArtifact-Keypair -> blockiert; aktueller URS verloren =>
    zuerst recovery_rekey.
74. pre-announcement stale Rotation -> bereits erzeugter Successor wird
    orphaned; neuer Versuch nutzt neue Epoch-/Root-/Creation-/Artifact- und
    Control-IDs.
75. successor_creation_locator im Announcement != geschützter
    Manifest.creation_locator -> security_blocked.
76. Successor-Manifest/RecoveryArtifact kürzt, ersetzt oder erfindet
    recovery_credential_history gegenüber der final verifizierten v2-Source ->
    recovery_credential_history_mismatch / security_blocked.
77. staged RecoveryArtifact bereits publiziert, lokaler Abort bei weiterhin
    unverändertem Transition-Anchor -> unzulässig; exakte Transition bleibt
    completion-pflichtig.
78. Unknown Outcome mit fehlendem Envelope -> ohne erneutes canonical_full kein
    Retry; wird die vorbereitete Revision inzwischen stale, landet sie in
    stale_writer_pending statt in einem zweiten Append.
79. physisch vorhandene stale_writer_rejected-Row -> niemals allein wegen
    Prefix-Coverage als lokaler durable Commit markieren.
80. RecoveryArtifact-Publish mutating request wurde versucht und endet in
    Crash/unknown_outcome -> artifact_publish_attempted bleibt durable true;
    lokaler Abort ist verboten, bis Remote-Reconciliation bzw. ein echter
    Anchor-Overtake den Zustand entscheidet.
81. VerifiedRemoteState meldet eine Envelope-ID zugleich accepted und
    stale_writer_rejected oder meldet accepted/stale IDs außerhalb des
    verifizierten physischen Sets -> gemeinsamer Coordinator security_blocked
    vor Persistenz.
82. operation_generation ändert sich während der asynchronen
    unknown-outcome-retry-Authority-Prüfung -> kein zweiter Append; fail-closed.
83. post-activation Suffix enthält nur Fachrows/WriterGrants -> finalen Prefix
    vollständig verifizieren, End-Writer-Authority ins Backup binden, Cutover
    ggf. read_only fortsetzen.
84. post-activation Suffix akzeptiert RecoveryAuthorityTransition -> staged
    RecoveryArtifact ist historisch; lokaler Operation-State wird
    post_activation_superseded, kein stale activated Backup/kein Auto-Switch.
85. post-activation Suffix akzeptiert RotationAnnouncement auf dem Successor ->
    Successor bereits erneut sealed; alter Cutover post_activation_superseded,
    kein Auto-Switch.
86. Nach activated Backup/Lineage-Cache verändert sich der Successor vor dem
    lokalen Switch: letzter canonical_full muss RecoveryTransition/Seal erkennen
    und post_activation_superseded setzen; reine Fachrows/WriterGrants dürfen
    den Switch mit final neu abgeleitetem Writerstatus fortsetzen.
87. Auch der nach frischem Full Verify autorisierte Unknown-Outcome-Retry endet
    erneut in unknown_outcome und das Envelope fehlt weiter -> Readback erneut
    canonical_full verifizieren, Envelope pending lassen und aktuellen Versuch
    beenden; kein blinder dritter Append.
88. RecoveryArtifact-Create verliert Response und später erscheinen mehrere
    Kandidaten desselben Locators: nur owner-only/Grid-verifizierte,
    pre-bound leere oder byte-identisch erwartete operation-eigene Duplikate
    dürfen deterministisch konvergiert/orphaned werden. Pre-bound appProperties
    sind nur vollständig leer oder bereits exakt v6; vor Artifact-Write müssen
    die exakten drei v6-Properties readback-verifiziert sein. Widersprüchliche
    nicht-leere Artifact-Bytes/Properties bleiben ambiguous/security_blocked.
89. Jedes RecoveryArtifactV6 wird vor erster Remote-Mutation one-shot vollständig
    lokal persistiert/readback-verifiziert und per SHA-256 an den jeweiligen
    Operation-State gebunden. Create-/Write-Retries regenerieren niemals
    recovery_artifact_id, Salt, IV oder Ciphertext. recovery_rekey besitzt
    zusätzlich den D-002 artifact_publish_attempted-Fence.

## 22. Nicht-Ziele

Nicht Teil von v2:

- gleichzeitiges Schreiben zweier Geräte;
- automatische fachliche Merge-Konvergenz konkurrierender Writer;
- providerseitige Device-ACL bei demselben Google-Konto;
- Offline-Fachwrites im strikten Profil;
- automatische Übernahme stale lokaler Änderungen;
- Änderung der bestehenden v1-Semantik in-place.

## 23. Implementierungsreihenfolge

Die normative Feingranularität und die phasenweisen Golden-/Negative-Vector-Gates
stehen in §23/§24 von
`EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md`. Diese Architekturdatei
verwendet dieselbe Reihenfolge und darf sie nicht durch eine ältere gröbere
Planung übersteuern:

1. v2 Protokoll-/Schema-Definition exakt festschreiben. **Abgeschlossen; normative Quelle ist EDS_TRANSFERABLE_SINGLE_WRITER_V2_EXACT_PROTOCOL.md.**
2. reine v2 Typen/Validatoren/Krypto-Helper + die zu dieser Schicht gehörenden Golden Vectors.
3. RevisionV2 + WriterSignatureV2.
4. TransferableSingleWriterV2Verifier.
5. WriterGrantStateMachine.
6. EpochLocalSecurityStateV6 + Writer-Key-Store und fail-closed Writer-Gate.
7. RecoveryArtifactV6 / RecoveryTakeoverAuthorityV2.
8. SyncBackupV6.
9. v1->v2 Epoch-Migration.
10. read-only Join eines bestehenden Tagebuchs.
11. kooperativer Writer-Transfer.
12. forced takeover + stale-pending quarantine.
13. UI.
14. vollständige Unit-/Fault-/Browsermatrix bleibt über alle Schritte grün.
15. Live-Google-Konkurrenztest.
16. erst danach produktive Freigabe des Mehrgerätepfads.

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
- der gemeinsame `RemoteProfileVerifier.verify()`-/
  `TransportProfileCodec.verifyRemote()`-Pfad ist **canonical_full-only**.
  Der operation-gebundene v2-`rotation_resume`-Verifier liefert einen eigenen
  staged Resulttyp und darf niemals einen normalen `VerifiedRemoteState`
  erzeugen oder an CoordinatorStore/WriteAuthority weiterreichen;
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

Zwei zusätzliche Grenzen sind nach adversarial Review verbindlich:

- Nach einem Unknown Outcome reicht ein struktureller Read **nicht**. Fehlt das
  vorbereitete Envelope, muss vor jedem Retry erneut canonical full verifiziert
  werden; erst danach entscheidet die profilabhängige Authority für genau diese
  Envelope-Bytes `push` oder `quarantine_stale_writer`.
- Persistenz bekommt den vollständigen `VerifiedRemoteState` mit semantischen
  Envelope-Dispositionen. Physische Row-Anwesenheit/Anchor-Coverage allein darf
  niemals `durable` bedeuten, weil v2 eine physisch vorhandene
  `stale_writer_rejected`-Revision ausdrücklich zulässt.

Die Schreibfreigabe läuft deshalb über eine profilabhängige
Authority-Schnittstelle:

```text
WriteAuthority {
  canPrepareDomainWrite(verified)
  verifyBeforePush(envelope, verified, initial|unknown_outcome_retry)
    -> push | quarantine_stale_writer
  accessAfterReadback(verified)
}
```

v1 bekommt eine Adapterimplementierung mit exakt bisheriger Semantik. v2 prüft
Grant/Generation/Device-ID sowie Seal-/Pending-Rekey-State. `CoordinatorStore`
entscheidet Outbox-Durability anhand der verifizierten semantischen
Envelope-Sets, nicht anhand roher Rows.

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
RotationAnnouncementV2
SuccessorActivationConfirmationV2
EpochMigrationV2
MigrationIntegrityV2
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
PR #36 hat die ursprüngliche Profilentkopplung sauber hergestellt. Spätere
adversariale Reviews haben jedoch gezeigt, dass zwei **semantische** Contract-
Grenzen damals noch nicht sichtbar waren: Unknown-Outcome-Retry brauchte keinen
erneuten Full Verify, und lokale Durability konnte nur physische Row-Anwesenheit
sehen. Diese Erkenntnis ist kein Zurückdrehen von #36, sondern eine stärkere
Anforderung, die erst durch v2-stale-writer-Semantik entsteht. Der
Implementierungsstart bleibt blockiert, bis auch diese Nachhärtung grün ist:

1. aktuelle v1-Konstanten und Typen explizit als V1 benennen;
2. `RevisionV1` und `EpochLocalSecurityStateV5` als eingefrorene Typen
   herausziehen;
3. v1-Verifier hinter eine profilbezogene Verifier-Schnittstelle setzen;
4. Coordinator-Schreibfreigabe hinter eine profilneutrale
   `WriteAuthority`-Policy ziehen; die Policy besitzt getrennte Prepare-,
   Push-/Retry- und Readback-Gates und kann stale Writer explizit
   quarantinieren. Sie gehört in den Protokoll-/lokalen State-Layer, **nicht**
   in den Google-Provider;
5. `VerifiedRemoteState` an `profileId` binden, einen abgegrenzten
   `profileState` für spätere v2-Authority-Daten vorsehen und semantische
   accepted/stale-writer Envelope-Sets an die Persistenz weitergeben;
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
