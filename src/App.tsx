import { useState } from 'react'
import {
  BottomNavigation,
  type AppSection,
} from './components/BottomNavigation/BottomNavigation'
import { MedicationPage } from './features/medication/MedicationPage'
import { PainEntryFlow } from './features/pain/PainEntryFlow'
import { GoogleSyncSettings } from './features/settings/GoogleSyncSettings'
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
  const [activeSection, setActiveSection] = useState<AppSection>('pain')
  const page = PAGE_COPY[activeSection]

  return (
    <>
      <main className="app">
        <div className="app__content">
          <section
            className="app__page"
            aria-labelledby={`page-title-${activeSection}`}
          >
            <header className="app__header">
              <p className="app__eyebrow">{page.eyebrow}</p>
              <h1 className="app__title" id={`page-title-${activeSection}`}>
                {page.title}
              </h1>
              <p className="app__description">{page.description}</p>
            </header>

            {activeSection === 'pain' ? <PainEntryFlow /> : null}

            {activeSection === 'medication' ? <MedicationPage /> : null}

            {activeSection === 'activity' ? (
              <div className="app__placeholder">
                <p>
                  Die Aktivitätserfassung kommt als eigener Bereich auf diese
                  Grundnavigation.
                </p>
              </div>
            ) : null}

            {activeSection === 'configuration' ? <GoogleSyncSettings /> : null}
          </section>
        </div>
      </main>

      <BottomNavigation
        activeSection={activeSection}
        onChange={setActiveSection}
      />
    </>
  )
}
