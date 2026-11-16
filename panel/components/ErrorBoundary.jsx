import { Component } from 'react'

/**
 * A counter that goes blank is a counter that stops earning, so nothing on this
 * screen is allowed to take the whole page down. Storage can be corrupt, a
 * number can arrive as text, and the shop machine is the one place where "it
 * works on my machine" has no value.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    // The console is the only sink available until the panel reports anywhere.
    console.error('panel crashed', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-3 px-5">
        <h1 className="text-lg font-bold text-ink">The panel stopped unexpectedly</h1>
        <p className="text-sm text-body">
          Reloading usually fixes it. If it comes back, note the message below and pass it on — it
          says what the panel could not read.
        </p>
        <p className="panel-numeric rounded-field bg-soft px-3 py-2 font-mono text-xs text-soft-ink">
          {String(this.state.error.message ?? this.state.error)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-field border border-accent-600 bg-accent-600 px-3 py-2 text-sm font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            Reload the panel
          </button>
          <button
            type="button"
            className="rounded-field border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            onClick={() => {
              try {
                localStorage.removeItem('qp-panel-jobs')
                localStorage.removeItem('qp-panel-settings')
              } catch {
                /* nothing else to try */
              }
              window.location.reload()
            }}
          >
            Reload and clear the saved list
          </button>
        </div>
      </div>
    )
  }
}
