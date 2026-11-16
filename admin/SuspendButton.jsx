import { useState } from 'react'
import { Ban, RotateCcw } from 'lucide-react'
import { ActionButton } from '../panel/components/PanelUi.jsx'

/**
 * Deactivate / activate a shop account (the suspended_at flag). Deactivating
 * locks the shop admin out of the whole app and blocks customer uploads, so it
 * asks once with the consequence stated — no type-to-confirm. Activating
 * restores access and needs no ceremony. Reversible; never deletes data.
 */
export default function SuspendButton({ shop, onSet }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (suspended) => {
    setBusy(true)
    await onSet(shop.id, suspended)
    setBusy(false)
    setConfirming(false)
  }

  if (shop.suspended) {
    return (
      <ActionButton tone="primary" disabled={busy} onClick={() => run(false)} label={`Activate ${shop.name}`}>
        <span className="inline-flex items-center gap-1.5">
          <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
          {busy ? 'Activating…' : 'Activate'}
        </span>
      </ActionButton>
    )
  }

  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-danger">Deactivate? The shop admin is locked out and customers can’t upload.</span>
        <ActionButton tone="danger" disabled={busy} onClick={() => run(true)} label={`Confirm deactivate ${shop.name}`}>
          {busy ? 'Deactivating…' : 'Confirm'}
        </ActionButton>
        <ActionButton disabled={busy} onClick={() => setConfirming(false)}>Cancel</ActionButton>
      </span>
    )
  }

  return (
    <ActionButton tone="danger" disabled={busy} onClick={() => setConfirming(true)} label={`Deactivate ${shop.name}`}>
      <span className="inline-flex items-center gap-1.5">
        <Ban size={13} strokeWidth={2} aria-hidden="true" />
        Deactivate
      </span>
    </ActionButton>
  )
}