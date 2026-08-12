# AGENTS.md

This file contains the working agreement for humans and coding agents contributing
to EDS Diary. It applies to the entire repository.

## Project overview

EDS Diary is a React and TypeScript web application built with Vite. Storybook is
used for isolated component development, Playwright for browser-level tests,
ESLint for TypeScript and React rules, and Stylelint for CSS.

The product handles health-related information. Treat all diary and symptom data
as sensitive, even when working with fixtures or prototypes. Never commit real
personal or medical data, access tokens, secrets, or production exports.

## Prerequisites and common commands

Use a supported Node.js LTS release and the package manager declared by the
repository. This project currently uses npm.

```bash
npm install                 # Install dependencies
npm run dev                 # Start the Vite development server
npm run build               # Type-check and create a production build
npm run lint                # Run ESLint and Stylelint
npm run lint:js             # Run ESLint only
npm run lint:css            # Run Stylelint only
npm run storybook           # Start Storybook on port 6006
npm run build-storybook     # Build static Storybook
npm run test:e2e            # Run Playwright tests
```

Install the Playwright browser once after installing dependencies:

```bash
npx playwright install chromium
```

Do not claim that a command passed unless it was actually executed successfully.
When a command cannot run because of the environment, report the limitation and
still run every independent check that remains available.

## Repository structure

```text
.storybook/          Storybook configuration
src/                 Application source and component stories
tests/               Playwright end-to-end tests
eslint.config.js     ESLint flat configuration
playwright.config.ts Playwright projects and web server configuration
vite.config.ts       Vite configuration
```

Keep application code inside `src/`. As the application grows, prefer organizing
it by feature rather than by technical file type:

```text
src/
  app/               App shell, providers, routing, global setup
  components/        Reusable, product-agnostic UI components
  features/          Feature-specific UI, hooks, types, and services
  assets/            Static assets imported by the application
  test/              Shared test fixtures and helpers
```

Keep code close to where it is used. A component, its styles, story, and focused
tests should normally live in the same directory. Avoid adding barrel files unless
they establish a deliberate public API.

## React and TypeScript conventions

- Use function components and named exports for application code.
- Write new source files in TypeScript (`.ts`) or TSX (`.tsx`). Do not introduce
  JavaScript when TypeScript is practical.
- Keep TypeScript strict. Do not weaken compiler settings to accommodate a local
  implementation problem.
- Avoid `any`. Prefer a precise type, `unknown` with narrowing, or a generic.
- Model domain concepts explicitly and keep transport/API types separate from UI
  state when their shapes or lifecycles differ.
- Keep components focused on one responsibility. Extract behavior into a hook
  only when it is shared or makes the component meaningfully easier to understand.
- Derive values during rendering where possible. Do not mirror props or other
  state with an effect.
- Use effects only to synchronize with external systems, and clean them up.
- Prefer controlled form fields for product forms and validate at system
  boundaries.
- Never mutate props or React state. Use immutable updates.
- Use stable, semantic identifiers as list keys; never use an array index when
  items can be reordered, added, or removed.
- Avoid premature memoization. Add `memo`, `useMemo`, or `useCallback` only for a
  measured issue or a clear referential-stability requirement.
- Do not place business rules directly in presentation components. Keep them in
  small, testable domain functions or feature services.
- Do not put `try`/`catch` blocks around imports.

## Component API and Storybook

- Reusable components must have small, typed, composable APIs.
- Prefer semantic HTML over recreating native controls with generic elements.
- Add or update a colocated `*.stories.tsx` file whenever reusable UI behavior or
  appearance changes.
- Include stories for the default state and meaningful variants such as empty,
  loading, error, long-content, disabled, and narrow-viewport states when relevant.
- Use Storybook args rather than duplicating near-identical story render functions.
- Keep stories deterministic. Do not depend on production services or live user
  data; use explicit fixtures and mocked boundaries.
- Run `npm run build-storybook` for changes to Storybook configuration or shared
  components.

## Styling

- Keep global CSS limited to resets, design tokens, typography, and application
  foundations. Component-specific styles should stay close to the component.
- Reuse design tokens through CSS custom properties instead of repeating literal
  colors, spacing, radii, or shadows.
- Use class names compatible with the configured BEM-style Stylelint rule:
  `block`, `block__element`, and `block--modifier`.
- Build mobile-first and add media queries only where the content needs them.
- Prefer normal document flow, Grid, and Flexbox over fixed positioning and magic
  pixel offsets.
- Respect user preferences such as `prefers-reduced-motion` and ensure layouts
  remain usable with text zoom and long translated content.
- Do not use `!important` except to override an unavoidable third-party style;
  document the reason if it is necessary.

## Accessibility and inclusive health UX

Accessibility is a completion requirement, not a later enhancement.

- Target WCAG 2.2 AA for user-facing UI.
- All functionality must be operable with a keyboard and have a visible focus
  indicator.
- Every form control needs an associated accessible label. Error messages must be
  specific and programmatically associated with the relevant field.
- Preserve semantic heading order, landmarks, lists, buttons, and links.
- Do not rely on color alone to communicate pain type, severity, validation, or
  selection. Pair color with text, shape, pattern, iconography, or another cue.
- Maintain sufficient color contrast and touch targets of at least 44 by 44 CSS
  pixels where practical.
- Use live regions sparingly for important asynchronous status updates.
- Write neutral, supportive copy. Do not imply diagnosis or medical certainty,
  and distinguish tracking features from medical advice.
- Any body-map or graphical input must have an equivalent accessible interaction,
  such as a labeled body-region list or form controls.

Run the Storybook accessibility checks for component changes and cover critical
keyboard workflows in Playwright.

## Testing strategy

Use the smallest effective test level:

1. Pure unit tests for domain logic and data transformations.
2. Component stories and interaction tests for isolated UI states.
3. Playwright tests for a small number of critical user journeys and integration
   boundaries.

For every behavior change, add or update a test that would have caught the prior
behavior. Prefer queries by role, label, and visible name. Avoid brittle selectors,
implementation details, arbitrary sleeps, and pixel-perfect screenshot assertions
for dynamic content.

Playwright tests must be independent, deterministic, and safe to run in parallel.
Each test creates its own state and must not depend on test execution order. Use
synthetic data only, and clean up persisted state when a test creates it.

## Data, security, and privacy

- Collect and retain only the information required for a product feature.
- Do not log symptom entries, free-text diary content, authentication values, or
  other sensitive payloads to the browser console or analytics by default.
- Keep secrets in ignored environment files and provide safe placeholder names in
  documentation. Only variables explicitly intended for the browser may use
  Vite's `VITE_` prefix.
- Treat URL parameters, browser storage, API responses, imported files, and user
  text as untrusted input. Validate at boundaries and escape output appropriately.
- Do not use `dangerouslySetInnerHTML` without documented sanitization and a clear
  need.
- Avoid storing sensitive data in `localStorage`; document the threat model and
  retention behavior before introducing persistence.
- Review new dependencies for necessity, maintenance status, license, bundle cost,
  and security impact. Prefer platform capabilities and existing dependencies.

## Git and change discipline

- Keep changes focused on the requested outcome. Do not mix unrelated refactors
  into a feature or fix.
- Review `git diff` before committing and never discard unrelated user changes.
- Use concise, imperative commit messages that explain the outcome.
- Update documentation when commands, architecture, configuration, or contributor
  workflows change.
- Do not commit generated directories such as `node_modules`, `dist`,
  `storybook-static`, Playwright reports, test results, or local environment files.
- Do not bypass lint or test failures. Fix the underlying issue or clearly report
  a genuine environmental limitation.

## Definition of done

Before considering a change complete:

1. The implementation satisfies the requested behavior and handles empty, error,
   loading, and narrow-screen states where applicable.
2. TypeScript remains strict and the production build succeeds.
3. ESLint and Stylelint succeed.
4. Relevant stories and tests are added or updated.
5. Playwright passes for affected critical journeys.
6. Accessibility, keyboard behavior, responsive layout, privacy, and sensitive
   data handling have been reviewed.
7. Documentation reflects any changed setup or workflow.
8. The final diff contains no secrets, personal health data, generated output, or
   unrelated modifications.
