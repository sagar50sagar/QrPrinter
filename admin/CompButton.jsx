import { useState } from 'react'
import { Gift, RotateCcw } from 'lucide-react'
import { ActionButton } from '../panel/components/PanelUi.jsx'

/**
 * Comp / un-comp a shop: a manual entitlement that bypasses billing. Granting
 * comp only gives access, so it needs no ceremony. Removing it can immediately
 * pause a shop that has no paid period, so it asks once with the consequence
 * stated — no type-to-confirm.
 */
export default function CompButton({ shopId, name, comped, onSet }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (value) => {
    setBusy(true)
    await onSet(shopId, value)
    setBusy(false)
    setConfirming(false)
  }

  if (comped) {
    if (confirming) {
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-danger">Remove comp? This shop returns to paid billing and may lose access.</span>
          <ActionButton tone="danger" disabled={busy} onClick={() => run(false)} label={`Confirm remove comp for ${name}`}>
            {busy ? 'Removing…' : 'Confirm'}
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => setConfirming(false)}>Cancel</ActionButton>
        </span>
      )
    }
    return (
      <ActionButton disabled={busy} onClick={() => setConfirming(true)} label={`Remove comp for ${name}`}>
        <span className="inline-flex items-center gap-1.5">
          <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
          Remove comp
        </span>
      </ActionButton>
    )
  }

  return (
    <ActionButton tone="primary" disabled={busy} onClick={() => run(true)} label={`Comp ${name}`}>
      <span className="inline-flex items-center gap-1.5">
        <Gift size={13} strokeWidth={2} aria-hidden="true" />
        {busy ? 'Comping…' : 'Comp'}
      </span>
    </ActionButton>
  )
}