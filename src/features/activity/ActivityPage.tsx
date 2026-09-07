import { useState } from 'react'
import {
  TimeRangeColumn,
  type TimeRange,
} from '../../components/TimeRangeColumn/TimeRangeColumn'
import './ActivityPage.css'

const INITIAL_RANGE: TimeRange = {
  start: '09:00',
  end: '10:00',
}

export function ActivityPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(INITIAL_RANGE)

  return (
    <div className="activity-page">
      <section className="activity-page__intro" aria-labelledby="activity-time-title">
        <div>
          <h2 id="activity-time-title">Zeitraum der Aktivität</h2>
          <p>
            Wähle zunächst aus, wann die Aktivität stattgefunden hat. Den
            vorhandenen Zeitpicker passen wir anschließend weiter an.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={timeRange}
        onChange={setTimeRange}
        label="Aktivitätszeitraum"
      />
    </div>
  )
}
