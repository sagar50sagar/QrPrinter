import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CustomerApp from './CustomerApp.jsx'
import ErrorBoundary from '../panel/components/ErrorBoundary.jsx'
import '@/index.css'

createRoot(document.getElementById('customer-root')).render(
  <StrictMode>
    <ErrorBoundary>
      <CustomerApp />
    </ErrorBoundary>
  </StrictMode>,
)