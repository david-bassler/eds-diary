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
