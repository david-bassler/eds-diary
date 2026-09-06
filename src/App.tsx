import { useState } from 'react'
import {
  BottomNavigation,
  type AppSection,
} from './components/BottomNavigation/BottomNavigation'
import { TimeRangeColumn } from './components/TimeRangeColumn/TimeRangeColumn'
import type { TimeRange } from './components/TimeRangeColumn/TimeRangeColumn'
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
    description: 'Medikamente und ihre Einnahme werden hier verwaltet.',
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
  const [range, setRange] = useState<TimeRange>({
    start: '09:00',
    end: '10:30',
  })

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

            {activeSection === 'pain' ? (
              <TimeRangeColumn
                begin="06:00"
                end="18:00"
                resolution={15}
                value={range}
                onChange={setRange}
                label="Zeitfenster planen"
              />
            ) : null}

            {activeSection === 'medication' ? (
              <div className="app__placeholder">
                <p>
                  Die Medikamentenerfassung kommt als eigener Bereich auf diese
                  Grundnavigation.
                </p>
              </div>
            ) : null}

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
