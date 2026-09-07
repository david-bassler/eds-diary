import { useState } from 'react'
import {
  TimeRangeColumn,
  type TimeRange,
} from '../../components/TimeRangeColumn/TimeRangeColumn'
import './ActivityPage.css'

export function ActivityPage() {
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([])

  return (
    <div className="activity-page">
      <section className="activity-page__intro" aria-labelledby="activity-time-title">
        <div>
          <h2 id="activity-time-title">Zeiträume der Aktivität</h2>
          <p>
            Wähle einen oder mehrere Zeiträume aus, in denen die Aktivität
            stattgefunden hat.
          </p>
        </div>
      </section>

      <TimeRangeColumn
        begin="00:00"
        end="24:00"
        resolution={15}
        value={timeRanges}
        onChange={setTimeRanges}
        label="Aktivitätszeiträume"
      />
    </div>
  )
}
