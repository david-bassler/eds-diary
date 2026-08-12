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

The dependency declarations intentionally use npm's `latest` distribution tag so
a fresh install resolves the newest published toolchain. Commit the generated
`package-lock.json` after the first successful install to make that resolved set
reproducible for local development and CI.

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
