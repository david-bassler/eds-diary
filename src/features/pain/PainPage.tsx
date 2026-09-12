import { useState } from 'react'
import type { PainEntry } from './painEntry'
import { PainEntryFlow } from './PainEntryFlow'
import { PainEntryList } from './PainEntryList'
import './PainPage.css'

type PainPageMode = 'entry' | 'history'

function scrollToTop(): void {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  })
}

export function PainPage() {
  const [mode, setMode] = useState<PainPageMode>('entry')
  const [editingEntry, setEditingEntry] = useState<PainEntry | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  function showEntry(): void {
    setEditingEntry(null)
    setMode('entry')
  }

  function editEntry(entry: PainEntry): void {
    setEditingEntry(entry)
    setMode('entry')
    scrollToTop()
  }

  return (
    <section className="pain-page">
      <div className="pain-page__tabs" role="group" aria-label="Schmerzen">
        <button
          type="button"
          aria-pressed={mode === 'entry'}
          onClick={showEntry}
        >
          Eintragen
        </button>
        <button
          type="button"
          aria-pressed={mode === 'history'}
          onClick={() => {
            setEditingEntry(null)
            setMode('history')
          }}
        >
          Übersicht
        </button>
      </div>

      {mode === 'entry' ? (
        <>
          {editingEntry ? (
            <div className="pain-page__editing">
              <div>
                <strong>Schmerzeintrag bearbeiten</strong>
                <span>Die Änderungen ersetzen den bestehenden Eintrag.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingEntry(null)
                  setMode('history')
                }}
              >
                Abbrechen
              </button>
            </div>
          ) : null}

          <PainEntryFlow
            key={editingEntry?.id ?? 'new'}
            entry={editingEntry}
            onSaved={() => {
              setRefreshKey((current) => current + 1)
              if (editingEntry) {
                setEditingEntry(null)
                setMode('history')
                scrollToTop()
              }
            }}
          />
        </>
      ) : (
        <PainEntryList
          refreshKey={refreshKey}
          onEdit={editEntry}
          onChanged={() => setRefreshKey((current) => current + 1)}
        />
      )}
    </section>
  )
}
