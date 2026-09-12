import { useEffect, useRef, useState } from 'react'
import {
  BottomNavigation,
  type AppSection,
} from './components/BottomNavigation/BottomNavigation'
import { ActivityNowIndicator } from './features/activity/ActivityNowIndicator'
import { ActivityPage } from './features/activity/ActivityPage'
import { MedicationPage } from './features/medication/MedicationPage'
import { PainPage } from './features/pain/PainPage'
import { PainStatusPrompt } from './features/pain/PainStatusPrompt'
import { QrShareButton } from './features/share/QrShareButton'
import { GoogleSyncSettings } from './features/settings/GoogleSyncSettings'
import { InstallAppSettings } from './features/settings/InstallAppSettings'
import {
  pathForSection,
  sectionFromPathname,
} from './routing/appHistory'
import './App.css'

const PAGE_COPY: Record<
  AppSection,
  { eyebrow: string; title: string; description: string }
> = {
  pain: {
    eyebrow: 'Schmerztagebuch',
    title: 'Schmerzen',
    description: '',
  },
  medication: {
    eyebrow: 'Schmerztagebuch',
    title: 'Medikamente',
    description: '',
  },
  activity: {
    eyebrow: 'Schmerztagebuch',
    title: 'Aktivitäten',
    description: '',
  },
  configuration: {
    eyebrow: 'App',
    title: 'Konfiguration',
    description: 'Datenspeicherung, Synchronisierung und weitere Einstellungen.',
  },
}

export function App() {
  const [activeSection, setActiveSection] = useState<AppSection>(() =>
    sectionFromPathname(window.location.pathname),
  )
  const activityHelpDialogRef = useRef<HTMLDialogElement>(null)
  const page = PAGE_COPY[activeSection]

  useEffect(() => {
    const canonicalPath = pathForSection(activeSection)
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(
        window.history.state,
        '',
        `${canonicalPath}${window.location.search}${window.location.hash}`,
      )
    }

    const handlePopState = () => {
      setActiveSection(sectionFromPathname(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(section: AppSection): void {
    const nextPath = pathForSection(section)

    if (window.location.pathname !== nextPath) {
      window.history.pushState({ section }, '', nextPath)
    }

    setActiveSection(section)
  }

  return (
    <>
      <main className="app">
        <div className="app__content">
          <section
            className="app__page"
            aria-labelledby={`page-title-${activeSection}`}
          >
            <header className="app__header">
              <div className="app__header-row">
                <div className="app__heading-copy">
                  <p className="app__eyebrow">{page.eyebrow}</p>
                  <h1 className="app__title" id={`page-title-${activeSection}`}>
                    {page.title}
                  </h1>
                </div>
                <div className="app__header-actions">
                  {activeSection === 'activity' ? (
                    <button
                      type="button"
                      className="app__help-button"
                      aria-label="Hilfe zu Aktivitäten"
                      title="Hilfe zu Aktivitäten"
                      onClick={() => activityHelpDialogRef.current?.showModal()}
                    >
                      ?
                    </button>
                  ) : null}
                  <QrShareButton />
                </div>
              </div>
              {page.description ? (
                <p className="app__description">{page.description}</p>
              ) : null}
            </header>

            {activeSection === 'pain' ? <PainPage /> : null}

            {activeSection === 'medication' ? <MedicationPage /> : null}

            {activeSection === 'activity' ? (
              <>
                <ActivityPage />
                <ActivityNowIndicator />
              </>
            ) : null}

            {activeSection === 'configuration' ? (
              <>
                <InstallAppSettings />
                <GoogleSyncSettings />
              </>
            ) : null}
          </section>
        </div>
      </main>

      <dialog
        ref={activityHelpDialogRef}
        className="app__help-dialog"
        aria-labelledby="activity-help-title"
      >
        <div className="app__help-card">
          <header className="app__help-header">
            <h2 id="activity-help-title">Aktivitäten – Hilfe</h2>
            <button
              type="button"
              className="app__help-close"
              aria-label="Hilfe schließen"
              onClick={() => activityHelpDialogRef.current?.close()}
            >
              Schließen
            </button>
          </header>
          <div className="app__help-content">
            <p>
              Auf dem Handy scrollt direktes Wischen. Halte kurz an der Startzeit,
              bis die Auswahl aktiviert ist, und ziehe dann zum Ende der Aktivität.
              Mit der Maus legst du einen Zeitraum durch vertikales Ziehen an.
            </p>
            <p>
              Die rechte Hälfte eines vorhandenen Zeitraums öffnet die Details.
              Überschneidungen werden nebeneinander dargestellt.
            </p>
            <p>
              Änderungen werden automatisch gespeichert. Mit Undo und Redo kannst
              du Änderungen zurücknehmen oder wiederherstellen.
            </p>
            <p>
              „Aktivität starten“ legt für heute eine laufende Aktivität ab jetzt
              an. Eine laufende Aktivität kannst du später mit „Jetzt beenden“
              abschließen.
            </p>
            <p>
              „Tag kopieren“ übernimmt ausgewählte Aktivitäten eines anderen Tages.
              Die gewählte Farbe gilt für alle Einträge mit demselben
              Aktivitätsnamen. Uhrzeiten werden als HH:MM eingegeben; 24:00 ist als
              Tagesende möglich.
            </p>
          </div>
        </div>
      </dialog>

      <PainStatusPrompt />

      <BottomNavigation
        activeSection={activeSection}
        onChange={navigate}
      />
    </>
  )
}
