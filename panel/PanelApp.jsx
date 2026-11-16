import { useCallback, useRef, useState } from 'react'
import { CircleAlert, CreditCard, LayoutDashboard, ListChecks, LogOut, SlidersHorizontal } from 'lucide-react'
import ThemeToggle from '@/components/ui/ThemeToggle.jsx'
import useTheme from '@/lib/useTheme.js'
import { usePanel } from './state/store.js'
import AuthView from './views/AuthView.jsx'
import DeactivatedView from './views/DeactivatedView.jsx'
import BillingView from './views/BillingView.jsx'
import DashboardView from './views/DashboardView.jsx'
import PrintingView from './views/PrintingView.jsx'
import SettingsView from './views/SettingsView.jsx'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', glyph: LayoutDashboard },
  { id: 'printing', label: 'Printing', glyph: ListChecks },
  { id: 'billing', label: 'Billing', glyph: CreditCard },
  { id: 'settings', label: 'Settings', glyph: SlidersHorizontal },
]

export default function PanelApp() {
  const [theme, toggleTheme] = useTheme()
  const panel = usePanel()
  const [tab, setTab] = useState('dashboard')
  const tabRefs = useRef([])

  const onTabKeyDown = useCallback((event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 }
    const step = keys[event.key]
    if (!step) return
    event.preventDefault()
    const index = tabs.findIndex((entry) => entry.id === tab)
    const next = (index + step + tabs.length) % tabs.length
    setTab(tabs[next].id)
    tabRefs.current[next]?.focus()
  }, [tab])

  const { settings } = panel

  if (!panel.authChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-muted font-sans" role="status">
        Loading the counter…
      </div>
    )
  }

  if (panel.deactivated) {
    return <DeactivatedView panel={panel} />
  }

  if (!panel.user) {
    return <AuthView panel={panel} />
  }

  const onlineDevices = panel.devices.filter((device) => device.online).length

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#panel-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-lift"
      >
        Skip to content
      </a>

      <header className="glass panel-no-print sticky top-0 z-50 border-b border-line">
        <div className="mx-auto w-full max-w-7xl px-3 py-2.5 md:px-6 md:py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-ink md:text-xl">{settings.cafeName}</h1>
              <p className="mt-0.5 truncate text-xs text-muted md:text-sm">{settings.welcomeMessage}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline ${
                  onlineDevices > 0 ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'
                }`}
                title={onlineDevices > 0 ? 'A local agent is connected' : 'No local agent is connected right now'}
              >
                {onlineDevices > 0 ? 'Agent connected' : 'Agent offline'}
              </span>
              <ThemeToggle theme={theme} onToggle={toggleTheme} className="size-10" />
              <button
                type="button"
                onClick={panel.logout}
                aria-label="Sign out"
                title="Sign out"
                className="flex size-10 items-center justify-center rounded-field border border-line bg-surface text-muted hover:bg-soft hover:text-ink"
              >
                <LogOut size={17} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          </div>

          <nav className="mt-2.5" aria-label="Panel sections">
            <div role="tablist" aria-label="Panel sections" className="flex gap-1.5 overflow-x-auto">
              {tabs.map((entry, index) => {
                const Glyph = entry.glyph
                const selected = tab === entry.id
                return (
                  <button
                    key={entry.id}
                    ref={(node) => {
                      tabRefs.current[index] = node
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${entry.id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${entry.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(entry.id)}
                    onKeyDown={onTabKeyDown}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-field border px-2.5 py-1.5 text-sm font-semibold transition-colors duration-150 md:gap-2 md:px-3 md:py-2 ${
                      selected
                        ? 'border-line bg-surface text-ink shadow-card'
                        : 'border-transparent text-muted hover:bg-soft hover:text-ink'
                    }`}
                  >
                    <Glyph size={16} strokeWidth={1.9} aria-hidden="true" />
                    {entry.label}
                  </button>
                )
              })}
            </div>
          </nav>
        </div>
      </header>

      {!panel.shop?.suspended && panel.billing?.state === 'grace' ? (
        <div role="alert" className="border-b border-warn/30 bg-warn-soft">
          <p className="mx-auto flex w-full max-w-7xl items-start gap-2 px-4 py-2.5 text-sm font-medium text-warn md:px-6">
            <CircleAlert size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Your subscription has expired — {panel.billing.days_left} grace day{panel.billing.days_left === 1 ? '' : 's'} left
              before printing pauses.{' '}
              <button type="button" onClick={() => setTab('billing')} className="font-semibold underline underline-offset-2">
                Renew in Billing
              </button>
            </span>
          </p>
        </div>
      ) : null}

      {!panel.shop?.suspended && panel.billing && !panel.billing.entitled ? (
        <div role="alert" className="border-b border-danger/30 bg-danger-soft">
          <p className="mx-auto flex w-full max-w-7xl items-start gap-2 px-4 py-2.5 text-sm font-medium text-danger md:px-6">
            <CircleAlert size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Printing is paused — an active subscription is required.{' '}
              <button type="button" onClick={() => setTab('billing')} className="font-semibold underline underline-offset-2">
                Open Billing
              </button>
            </span>
          </p>
        </div>
      ) : null}

      <main id="panel-main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6">
        {tab === 'dashboard' ? (
          <section role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard">
            <DashboardView panel={panel} />
          </section>
        ) : null}
        {tab === 'printing' ? (
          <section role="tabpanel" id="panel-printing" aria-labelledby="tab-printing">
            <PrintingView panel={panel} />
          </section>
        ) : null}
        {tab === 'billing' ? (
          <section role="tabpanel" id="panel-billing" aria-labelledby="tab-billing">
            <BillingView panel={panel} />
          </section>
        ) : null}
        {tab === 'settings' ? (
          <section role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <SettingsView panel={panel} />
          </section>
        ) : null}
      </main>

      <footer className="panel-no-print mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-muted md:px-6">
        {panel.error ? (
          <p role="alert" className="mb-2 rounded-field bg-danger-soft px-3 py-2 font-medium text-danger">
            {panel.error}
          </p>
        ) : null}
        <p>
          Jobs, printers and payments are live from the QrPrinter server. Print progress is reported by
          the local agent on the shop PC; a job only shows Success once the agent confirms it.
        </p>
      </footer>
    </div>
  )
}