import { CreditCard, ExternalLink, IndianRupee, Printer, ShoppingBag, Store, Wifi } from 'lucide-react'
import { ActionButton, BillingBadge, EmptyState, StatCard } from '../panel/components/PanelUi.jsx'
import { money } from '../panel/state/store.js'
import { StatusBadge } from './badges.jsx'
import SuspendButton from './SuspendButton.jsx'
import CompButton from './CompButton.jsx'
import PlanPriceCard from './PlanPriceCard.jsx'

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="panel-numeric truncate font-semibold text-ink">{value}</dd>
    </div>
  )
}

/** Platform totals and every shop, with suspend/reactivate and a way in. */
export default function Overview({ admin }) {
  const { overview, opening, openShop, setSuspended, setComped, setPlanPrice } = admin

  if (!overview) {
    return <div role="status" className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center text-sm text-muted">Loading shops…</div>
  }

  const { totals, shops } = overview

  return (
    <div className="space-y-5">
      <section aria-label="Platform totals" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Store} label="Shops" value={totals.shops} hint={`${totals.open} open · ${totals.suspended} deactivated`} />
        <StatCard icon={ShoppingBag} label="Orders" value={totals.orders} />
        <StatCard icon={Printer} label="Prints today" value={totals.prints_today} />
        <StatCard icon={IndianRupee} label="Collected" value={money(totals.collected)} tone="success" />
        <StatCard icon={Wifi} label="Agents online" value={totals.agents_online} tone={totals.agents_online > 0 ? 'success' : 'warn'} />
      </section>

      <section aria-label="Subscription totals" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={IndianRupee} label="MRR" value={money(totals.mrr)} hint={`${totals.paying} paying × plan`} tone="success" />
        <StatCard icon={CreditCard} label="Paying" value={totals.paying} tone="success" />
        <StatCard icon={CreditCard} label="Trialing" value={totals.trialing} />
        <StatCard icon={CreditCard} label="Comped" value={totals.comped} />
        <StatCard icon={CreditCard} label="Lapsed" value={totals.lapsed} tone={totals.lapsed > 0 ? 'warn' : 'neutral'} />
      </section>

      <section aria-label="Subscription plan">
        <PlanPriceCard plan={overview.plan} onSave={setPlanPrice} />
      </section>

      <section aria-labelledby="shops-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 id="shops-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Shops</h2>
          <p className="panel-numeric mr-auto text-sm text-body">{shops.length}</p>
        </div>

        {shops.length === 0 ? (
          <EmptyState
            title="No shops yet"
            note="Shops appear here as soon as someone creates one from the landing page."
          />
        ) : (
          <ul className="grid gap-2.5 lg:grid-cols-2">
            {shops.map((shop) => (
              <li key={shop.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{shop.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{shop.owner_email || 'no owner email'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge shop={shop} />
                    <BillingBadge state={shop.billing?.state} />
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  <Stat label="Orders" value={shop.orders} />
                  <Stat label="Prints today" value={shop.prints_today} />
                  <Stat label="Collected" value={money(shop.collected)} />
                  <Stat label="Agents" value={`${shop.agents_online}/${shop.devices}`} />
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton onClick={() => openShop(shop.id)} disabled={opening} label={`View ${shop.name}`}>
                    View
                  </ActionButton>
                  <a
                    href={shop.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-soft"
                  >
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                    Customer page
                  </a>
                  <CompButton shopId={shop.id} name={shop.name} comped={shop.billing?.comped} onSet={setComped} />
                  <span className="ml-auto">
                    <SuspendButton shop={shop} onSet={setSuspended} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}