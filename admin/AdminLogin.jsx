import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'

/**
 * The platform operator's sign-in. There is no sign-up here: superadmins are
 * seeded with `npm run seed:admin`. Sessions are server-side HttpOnly cookies.
 */
export default function AdminLogin({ admin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await admin.login(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-field border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors hover:border-line-strong focus:border-accent-600 focus:bg-surface'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 font-sans">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-card bg-navy-900 text-white">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-xl font-bold text-ink">Platform console</h1>
          <p className="mt-1 text-sm text-muted">Sign in to oversee every shop.</p>
        </div>

        <div className="rounded-panel border border-line bg-surface p-5 shadow-panel">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Email</span>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" className={field} placeholder="admin@example.com"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Password</span>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required autoComplete="current-password" className={field} placeholder="Your password"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <button
              type="submit" disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-field bg-accent-600 px-4 py-2.5 font-semibold text-white shadow-lift hover:bg-accent-700 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Operator access only. Shop owners sign in at the counter panel instead.
        </p>
      </main>
    </div>
  )
}