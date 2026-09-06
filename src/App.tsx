import { useState } from 'react'
import { TimeRangeColumn } from './components/TimeRangeColumn/TimeRangeColumn'
import type { TimeRange } from './components/TimeRangeColumn/TimeRangeColumn'
import { GoogleSyncSettings } from './features/settings/GoogleSyncSettings'

export function App() {
  const [range, setRange] = useState<TimeRange>({
    start: '09:00',
    end: '10:30',
  })

  return (
    <main className="app">
      <div className="app__content">
        <TimeRangeColumn
          begin="06:00"
          end="18:00"
          resolution={15}
          value={range}
          onChange={setRange}
          label="Zeitfenster planen"
        />
        <GoogleSyncSettings />
      </div>
    </main>
  )
}
