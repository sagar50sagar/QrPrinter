import { ShieldAlert } from 'lucide-react'

/**
 * Shown when the platform has deactivated this shop account. The server rejects
 * every panel call with account_deactivated, so the counter is genuinely locked
 * — this screen just explains why and offers a way back to sign in.
 */
export default function DeactivatedView({ panel }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 font-sans">
      <main className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-card bg-danger-soft text-danger">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-xl font-bold text-ink">Account deactivated</h1>
        <p className="mt-2 text-sm text-muted">
          The platform has deactivated this account, so the counter is locked. Contact support to
          reactivate it.
        </p>
        <button
          type="button"
          onClick={panel.acknowledgeDeactivation}
          className="mt-5 w-full rounded-field border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-soft"
        >
          Back to sign in
        </button>
      </main>
    </div>
  )
}