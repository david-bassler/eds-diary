import { pathForSection } from '../../routing/appHistory'
import './BottomNavigation.css'

export type AppSection =
  | 'pain'
  | 'medication'
  | 'activity'
  | 'configuration'

export interface BottomNavigationProps {
  activeSection: AppSection
  onChange: (section: AppSection) => void
}

interface NavigationItem {
  id: AppSection
  label: string
  icon: 'pain' | 'medication' | 'activity' | 'configuration'
}

const ITEMS: readonly NavigationItem[] = [
  { id: 'pain', label: 'Schmerzen', icon: 'pain' },
  { id: 'medication', label: 'Medikamente', icon: 'medication' },
  { id: 'activity', label: 'Aktivitäten', icon: 'activity' },
  { id: 'configuration', label: 'Konfiguration', icon: 'configuration' },
]

function NavigationIcon({ icon }: { icon: NavigationItem['icon'] }) {
  if (icon === 'pain') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18M5.8 7.1l12.4 9.8M18.2 7.1 5.8 16.9" />
      </svg>
    )
  }

  if (icon === 'medication') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8.4 15.6 7.2-7.2a3.4 3.4 0 0 1 4.8 4.8l-7.2 7.2a3.4 3.4 0 0 1-4.8-4.8ZM11 13l4 4M4 7h7M7.5 3.5v7" />
      </svg>
    )
  }

  if (icon === 'activity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h4l2.2-5 4.1 10 2.2-5H21" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.2A3.8 3.8 0 1 0 12 15.8 3.8 3.8 0 0 0 12 8.2Z" />
      <path d="m19.4 13.5 1.2 1-.9 2.1-1.6-.1a7.8 7.8 0 0 1-1.6 1.6l.1 1.6-2.1.9-1-1.2a7.8 7.8 0 0 1-2.2 0l-1 1.2-2.1-.9.1-1.6a7.8 7.8 0 0 1-1.6-1.6l-1.6.1-.9-2.1 1.2-1a7.8 7.8 0 0 1 0-2.2l-1.2-1 .9-2.1 1.6.1a7.8 7.8 0 0 1 1.6-1.6l-.1-1.6 2.1-.9 1 1.2a7.8 7.8 0 0 1 2.2 0l1-1.2 2.1.9-.1 1.6a7.8 7.8 0 0 1 1.6 1.6l1.6-.1.9 2.1-1.2 1a7.8 7.8 0 0 1 0 2.2Z" />
    </svg>
  )
}

export function BottomNavigation({
  activeSection,
  onChange,
}: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="Hauptnavigation">
      <div className="bottom-navigation__inner">
        {ITEMS.map((item) => {
          const active = item.id === activeSection

          return (
            <a
              key={item.id}
              className="bottom-navigation__item"
              href={pathForSection(item.id)}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return
                }

                event.preventDefault()
                onChange(item.id)
              }}
            >
              <span className="bottom-navigation__icon">
                <NavigationIcon icon={item.icon} />
              </span>
              <span className="bottom-navigation__label">{item.label}</span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}
