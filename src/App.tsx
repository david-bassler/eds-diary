export function App() {
  return (
    <main className="app">
      <section className="welcome" aria-labelledby="welcome-title">
        <span className="welcome__eyebrow">EDS Diary</span>
        <h1 id="welcome-title">Dein neues React-Projekt ist bereit.</h1>
        <p>
          Vite, TypeScript, Storybook, Playwright, ESLint und Stylelint sind
          eingerichtet. Ab hier kann die Anwendung sauber neu entstehen.
        </p>
        <a href="http://localhost:6006" className="welcome__link">
          Komponenten in Storybook ansehen
        </a>
      </section>
    </main>
  )
}
