import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PanelApp from './PanelApp.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import '@/index.css'
import './panel.css'

createRoot(document.getElementById('panel-root')).render(
  <StrictMode>
    <ErrorBoundary>
      <PanelApp />
    </ErrorBoundary>
  </StrictMode>,
)
