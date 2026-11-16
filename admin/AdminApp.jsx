import { LogOut, ShieldCheck } from 'lucide-react'
import ThemeToggle from '@/components/ui/ThemeToggle.jsx'
import useTheme from '@/lib/useTheme.js'
import { useAdmin } from './useAdmin.js'
import AdminLogin from './AdminLogin.jsx'
import Overview from './Overview.jsx'
import ShopDetail from './ShopDetail.jsx'

export default function AdminApp() {
  const [theme, toggleTheme] = useTheme()
  const admin = useAdmin()

  if (!admin.authChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-muted font-sans" role="status">
        Loading the platform console…
      </div>
    )
  }

  if (!admin.admin) return <AdminLogin admin={admin} />

  return (
    <div className="min-h-dvh bg-canvas font-sans">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-lift"
      >
        Skip to content
      </a>

      <header className="glass panel-no-print sticky top-0 z-50 border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-navy-900 text-white">
            <ShieldCheck size={18} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-base font-bold text-ink md:text-lg">Platform console</h1>
            <p className="truncate text-xs text-muted">{admin.admin.email}</p>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} className="size-10" />
          <button
            type="button" onClick={admin.logout} aria-label="Sign out" title="Sign out"
            className="flex size-10 items-center justify-center rounded-field border border-line bg-surface text-muted hover:bg-soft hover:text-ink"
          >
            <LogOut size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6">
        {admin.error ? (
          <p role="alert" className="mb-4 rounded-field bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {admin.error}
          </p>
        ) : null}
        {admin.detail ? <ShopDetail admin={admin} /> : <Overview admin={admin} />}
      </main>

      <footer className="panel-no-print mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted md:px-6">
        <p>
          Live across every shop on this QrPrinter server. Set the subscription price, and deactivate or
          activate a shop account — deactivating locks the shop admin out of the app and blocks customer
          uploads. All reversible; no shop data is deleted from here.
        </p>
      </footer>
    </div>
  )
}