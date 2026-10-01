import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initializeDataLayer } from './data/initializeDataLayer'
import { installAppPrivacyShield } from './data/appPrivacyShield'
import { registerServiceWorker } from './registerServiceWorker'
import { restoreGitHubPagesRoute } from './routing/appHistory'
import './styles.css'

installAppPrivacyShield()
restoreGitHubPagesRoute()
initializeDataLayer()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
