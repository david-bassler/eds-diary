# EDS Diary

React- und TypeScript-Projekt auf Basis von Vite für ein EDS-Schmerztagebuch.

## Voraussetzungen

- Node.js 22 oder neuer
- npm 10 oder neuer

## Entwicklung

```bash
npm install
npm run dev
```

## PWA

Die Anwendung enthält ein Web-App-Manifest und einen Service Worker. Der Service
Worker wird nur im Production-Build registriert, damit die lokale Entwicklung
keine veralteten Assets aus einem Browser-Cache verwendet.

Zum lokalen Prüfen der installierbaren PWA:

```bash
npm run build
npm run preview
```

Manifest, Service Worker und App-Icons liegen unter `public/`.

## Lokale Speicherung und Google Sheets

Das Tagebuch arbeitet local-first:

1. Gesundheitsdaten werden zuerst in IndexedDB im Browser gespeichert.
2. Die Oberfläche ist dadurch unabhängig von einer Google-Verbindung nutzbar.
3. Änderungen markieren das betroffene Feature als noch zu synchronisieren.
4. Bei bestehender Google-Verbindung werden Änderungen gebündelt und seriell
   an Google Sheets übertragen.
5. Beim Verbinden wird ein vollständiger Abgleich ausgeführt. Datensätze werden
   über stabile IDs und `updatedAt`-Zeitstempel zusammengeführt.

Die zentrale Infrastruktur liegt unter:

```text
src/data/localDatabase.ts
src/data/googleSheets.ts
src/data/syncManager.ts
src/features/pain/painRepository.ts
src/features/pain/painSync.ts
```

Persönliche Tagebuchdaten werden nicht in `localStorage` gespeichert.
`localStorage` enthält ausschließlich die nicht-sensiblen Google-
Konfigurationswerte OAuth Client-ID und Spreadsheet-ID.

Der Google Access Token wird nicht persistiert und bleibt nur im Arbeitsspeicher.
Die App fordert den Scope

```text
https://www.googleapis.com/auth/drive.file
```

an. Google-API-Aufrufe laufen über eine gemeinsame serielle Queue. HTTP 429 und
vorübergehende 5xx-Fehler werden mit Backoff erneut versucht.

Das erste automatisch verwaltete Tabellenblatt heißt `Schmerzeintraege`.
Fehlende Tabellenblätter und Header werden beim Synchronisieren angelegt.

### Google einmalig einrichten

1. Google Sheets API in einem Google-Cloud-Projekt aktivieren.
2. OAuth-Zustimmungsbildschirm konfigurieren.
3. OAuth-Client vom Typ **Web application** anlegen.
4. Die URL der bereitgestellten PWA als Authorized JavaScript Origin eintragen.
5. Client-ID in der App unter **Datenspeicherung** speichern.
6. Mit Google verbinden.
7. Ein neues privates EDS-Sheet anlegen oder eine bestehende Spreadsheet-ID
   eintragen.

Es wird kein Client Secret in der PWA verwendet.

## Qualitätssicherung

```bash
npm run lint
npm run build
npm run test:e2e
```

Für den ersten Playwright-Lauf muss Chromium installiert werden:

```bash
npx playwright install chromium
```

## Storybook

```bash
npm run storybook
npm run build-storybook
```


## GitHub Pages

Die App wird bei jedem Push auf `main` automatisch über GitHub Actions gebaut
und als GitHub Pages Site veröffentlicht:

```text
https://david-bassler.github.io/eds-diary/
```

Der Workflow liegt unter:

```text
.github/workflows/deploy-pages.yml
```

Für den Pages-Build setzt der Workflow `VITE_BASE_PATH=/eds-diary/`. Lokale
Entwicklung und Playwright bleiben dadurch weiterhin unter `/` erreichbar.
Manifest, Icons und Service Worker verwenden den jeweiligen Vite-Base-Pfad und
funktionieren deshalb auch unter dem GitHub-Pages-Unterpfad.

Im Repository muss unter **Settings → Pages → Build and deployment → Source**
einmalig **GitHub Actions** ausgewählt sein.

Für Google OAuth ist als Authorized JavaScript Origin die Origin

```text
https://david-bassler.github.io
```

einzutragen; der Pfad `/eds-diary/` gehört nicht zur Origin.


## Schmerzerfassung

Der Bereich **Schmerzen** verwendet einen zweistufigen Flow:

1. Eine oder mehrere Körperregionen auf Vorder- oder Rückseite auswählen.
2. Schmerzart, mögliche Ursache, Notiz sowie Datum und Uhrzeit erfassen.

Datum und Uhrzeit werden beim Öffnen mit dem aktuellen lokalen Zeitpunkt
vorbelegt. Eigene Schmerzarten können als Chips hinzugefügt werden. Diese
benutzerdefinierten Optionen werden in IndexedDB gespeichert und bei aktivierter
Google-Synchronisierung über das Tabellenblatt `Schmerzarten` abgeglichen.

Ein Schmerzeintrag speichert mehrere Körperregionen gemeinsam mit den gewählten
Schmerzarten, der optionalen Ursache und Notiz sowie dem tatsächlichen
Erfassungszeitpunkt. Die Body-Map besitzt zusätzlich eine vollständige
Checkbox-Liste als barrierefreie Alternative zur grafischen Auswahl.
