# EDS Diary

Frisches React- und TypeScript-Projekt auf Basis von Vite.

## Voraussetzungen

- Node.js 22 oder neuer
- npm 10 oder neuer

## Entwicklung

```bash
npm install
npm run dev
```

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
