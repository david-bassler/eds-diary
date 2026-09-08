import { useEffect, useState } from 'react'
import {
  BottomNavigation,
  type AppSection,
} from './components/BottomNavigation/BottomNavigation'
import { ActivityPage } from './features/activity/ActivityPage'
import { MedicationPage } from './features/medication/MedicationPage'
import { PainEntryFlow } from './features/pain/PainEntryFlow'
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
    description: 'Schmerzepisoden erfassen und ihren Verlauf dokumentieren.',
  },
  medication: {
    eyebrow: 'Schmerztagebuch',
    title: 'Medikamente',
    description: 'Eingenommene Medikamente mit Dosis und Zeitpunkt dokumentieren.',
  },
  activity: {
    eyebrow: 'Schmerztagebuch',
    title: 'Aktivitäten',
    description: 'Aktivitäten und Belastungen werden hier dokumentiert.',
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
                <QrShareButton />
              </div>
              <p className="app__description">{page.description}</p>
            </header>

            {activeSection === 'pain' ? <PainEntryFlow /> : null}

            {activeSection === 'medication' ? <MedicationPage /> : null}

            {activeSection === 'activity' ? <ActivityPage /> : null}

            {activeSection === 'configuration' ? (
              <>
                <InstallAppSettings />
                <GoogleSyncSettings />
              </>
            ) : null}
          </section>
        </div>
      </main>

      <PainStatusPrompt />

      <BottomNavigation
        activeSection={activeSection}
        onChange={navigate}
      />
    </>
  )
}
