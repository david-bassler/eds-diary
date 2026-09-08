import { useEffect, useState } from 'react'
import './InstallAppSettings.css'

interface InstallChoice {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

let installPrompt: BeforeInstallPromptEvent | null = null
const promptListeners = new Set<() => void>()

function notifyPromptListeners(): void {
  for (const listener of promptListeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as BeforeInstallPromptEvent
    notifyPromptListeners()
  })

  window.addEventListener('appinstalled', () => {
    installPrompt = null
    notifyPromptListeners()
  })
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true

  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean
  }
  return navigatorWithStandalone.standalone === true
}

function isIos(): boolean {
  const userAgent = navigator.userAgent
  const classicIos = /iPad|iPhone|iPod/i.test(userAgent)
  const desktopModeIpad =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1

  return classicIos || desktopModeIpad
}

export function InstallAppSettings() {
  const [promptAvailable, setPromptAvailable] = useState(
    () => installPrompt !== null,
  )
  const [installed, setInstalled] = useState(isStandalone)
  const [status, setStatus] = useState('')
  const ios = isIos()

  useEffect(() => {
    const updateState = () => {
      setPromptAvailable(installPrompt !== null)
      setInstalled(isStandalone())
    }

    promptListeners.add(updateState)
    window.addEventListener('appinstalled', updateState)

    return () => {
      promptListeners.delete(updateState)
      window.removeEventListener('appinstalled', updateState)
    }
  }, [])

  async function install(): Promise<void> {
    const prompt = installPrompt
    if (!prompt) return

    setStatus('')
    await prompt.prompt()
    const choice = await prompt.userChoice

    installPrompt = null
    setPromptAvailable(false)

    if (choice.outcome === 'accepted') {
      setStatus('Installation wurde gestartet.')
    } else {
      setStatus('Installation wurde nicht durchgeführt.')
    }
  }

  let description =
    'Installiere das EDS Tagebuch als eigene App auf diesem Gerät.'
  if (installed) {
    description = 'Das EDS Tagebuch läuft bereits als installierte App.'
  } else if (ios) {
    description =
      'Auf iPhone und iPad wird die App über das Teilen-Menü zum Home-Bildschirm hinzugefügt.'
  } else if (!promptAvailable) {
    description =
      'Falls kein Installationsknopf angeboten wird, kannst du die App über das Browsermenü installieren.'
  }

  return (
    <section
      className="install-app-settings"
      aria-labelledby="install-app-settings-title"
    >
      <div className="install-app-settings__copy">
        <h2 id="install-app-settings-title">App installieren</h2>
        <p>{description}</p>
      </div>

      {installed ? (
        <p className="install-app-settings__installed" role="status">
          Installiert
        </p>
      ) : ios ? (
        <ol className="install-app-settings__steps">
          <li>In Safari auf „Teilen“ tippen.</li>
          <li>„Zum Home-Bildschirm“ wählen.</li>
          <li>Mit „Hinzufügen“ bestätigen.</li>
        </ol>
      ) : promptAvailable ? (
        <button
          className="install-app-settings__button"
          type="button"
          onClick={() => void install()}
        >
          App installieren
        </button>
      ) : (
        <p className="install-app-settings__hint">
          Browsermenü öffnen und „App installieren“ oder „Zum Startbildschirm
          hinzufügen“ wählen.
        </p>
      )}

      <p className="install-app-settings__status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
