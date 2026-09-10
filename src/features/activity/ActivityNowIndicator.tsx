import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './ActivityNowIndicator.css'

const MINUTES_PER_DAY = 24 * 60
const REFRESH_INTERVAL_MS = 30_000

function localDate(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function ActivityNowIndicator() {
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const [dateInput, setDateInput] = useState<HTMLInputElement | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nextSurface = document.querySelector<HTMLElement>(
        '.activity-page .timerange__surface',
      )
      const nextDateInput = document.querySelector<HTMLInputElement>(
        '.activity-page__date input[type="date"]',
      )

      setSurface(nextSurface)
      setDateInput(nextDateInput)
      setSelectedDate(nextDateInput?.value ?? '')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!dateInput) return

    const updateSelectedDate = () => setSelectedDate(dateInput.value)
    dateInput.addEventListener('change', updateSelectedDate)
    dateInput.addEventListener('input', updateSelectedDate)

    return () => {
      dateInput.removeEventListener('change', updateSelectedDate)
      dateInput.removeEventListener('input', updateSelectedDate)
    }
  }, [dateInput])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  if (!surface || selectedDate !== localDate(now)) return null

  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const top = (minutes / MINUTES_PER_DAY) * 100
  const time = localTime(now)

  return createPortal(
    <div
      className="activity-now-indicator"
      style={{ top: `${top}%` }}
      role="status"
      aria-label={`Jetzt ${time}`}
      data-testid="activity-now-indicator"
    >
      <span className="activity-now-indicator__label" aria-hidden="true">
        JETZT
      </span>
    </div>,
    surface,
  )
}
