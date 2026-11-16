import { useState } from 'react'
import { Loader2, Store } from 'lucide-react'

/**
 * The shop account gate. Signing up creates the shop and its permanent link;
 * signing in returns to the counter. Sessions are server-side HttpOnly cookies,
 * so nothing here stores a credential in the browser.
 */
export default function AuthView({ panel }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cafeName, setCafeName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await panel.login(email, password)
      else await panel.signup({ email, password, cafeName })
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
            <Store className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-xl font-bold text-ink">Cyber cafe panel</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === 'login' ? 'Sign in to your counter.' : 'Create your shop and its customer link.'}
          </p>
        </div>

        <div className="rounded-panel border border-line bg-surface p-5 shadow-panel">
          <div role="tablist" aria-label="Sign in or create a shop" className="mb-4 flex gap-1.5">
            {[['login', 'Sign in'], ['signup', 'Create shop']].map(([value, label]) => (
              <button
                key={value} type="button" role="tab" aria-selected={mode === value}
                onClick={() => { setMode(value); setError('') }}
                className={`flex-1 rounded-field border px-3 py-2 text-sm font-semibold ${
                  mode === value ? 'border-line bg-canvas text-ink shadow-card' : 'border-transparent text-muted hover:bg-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Cyber cafe name</span>
                <input
                  type="text" value={cafeName} onChange={(e) => setCafeName(e.target.value)}
                  maxLength={80} required autoComplete="organization" className={field}
                  placeholder="e.g. Sharma Digital Seva"
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Email</span>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" className={field} placeholder="you@example.com"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Password</span>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={field} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
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
              {mode === 'login' ? 'Sign in' : 'Create shop'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          {mode === 'login'
            ? 'New here? Create a shop to get a customer upload link and QR code.'
            : 'Already have a shop? Sign in instead.'}
        </p>
      </main>
    </div>
  )
}