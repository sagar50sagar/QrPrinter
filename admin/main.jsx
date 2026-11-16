import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AdminApp from './AdminApp.jsx'
import ErrorBoundary from '../panel/components/ErrorBoundary.jsx'
import '@/index.css'
import '../panel/panel.css'

createRoot(document.getElementById('admin-root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AdminApp />
    </ErrorBoundary>
  </StrictMode>,
)