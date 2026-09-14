import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { BuildVersionBadge } from './components/BuildVersionBadge'
import { ForegroundLinkedImageReceiver } from './components/ForegroundLinkedImageReceiver'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { initializeTheme } from './theme/theme'
import './styles/app.css'
import './styles/theme.css'
import './styles/edge-effects.css'
import './styles/linking.css'
import './styles/clipboard.css'
import './styles/connections.css'
import './styles/preserve.css'
import './styles/card-preserve.css'
import './styles/controls.css'
import './styles/preserved-panel.css'
import './styles/content-preview.css'
import './styles/build-version-badge.css'

initializeTheme()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ForegroundLinkedImageReceiver />
    <App />
    <BuildVersionBadge />
  </StrictMode>,
)
