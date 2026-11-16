import { ArrowLeft, CalendarClock, CircleAlert, ExternalLink, FileText, IndianRupee, Printer, ShoppingBag } from 'lucide-react'
import { BillingBadge, EmptyState, StatCard } from '../panel/components/PanelUi.jsx'
import { money } from '../panel/state/store.js'
import { OnlineBadge, StatusBadge } from './badges.jsx'
import SuspendButton from './SuspendButton.jsx'
import CompButton from './CompButton.jsx'

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** One shop in full: owner, totals, connected agents and recent orders. */
export default function ShopDetail({ admin }) {
  const { detail, closeShop, setSuspended, setComped } = admin
  const { shop, owner, devices, orders, counts, billing, billing_events } = detail

  return (
    <div className="space-y-5">
      <button
        type="button" onClick={closeShop}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
      >
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
        All shops
      </button>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink">{shop.name}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {owner?.email || 'no owner'} · joined {new Date(shop.created_at).toLocaleDateString('en-IN')}
            </p>
            <a
              href={shop.link} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:underline"
            >
              <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
              {shop.link}
            </a>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge shop={shop} />
            <SuspendButton shop={shop} onSet={setSuspended} />
          </div>
        </div>
        {shop.suspended ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-field bg-danger-soft px-2.5 py-2 text-xs font-medium text-danger">
            <CircleAlert size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            Deactivated {new Date(shop.suspended_at).toLocaleString('en-IN')}. The shop admin is locked out of the app and customer uploads are blocked until reactivated.
          </p>
        ) : null}
      </section>

      <section aria-label="Shop totals" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ShoppingBag} label="Orders" value={counts.orders} />
        <StatCard icon={FileText} label="Documents" value={counts.documents} />
        <StatCard icon={Printer} label="Printed" value={counts.printed} tone="success" />
        <StatCard icon={CircleAlert} label="Failed" value={counts.failed} tone={counts.failed > 0 ? 'warn' : 'neutral'} />
        <StatCard icon={IndianRupee} label="Collected" value={money(counts.collected)} tone="success" />
      </section>

      <section aria-labelledby="billing-heading" className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="billing-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Subscription</h2>
            <p className="mt-1 text-sm font-semibold text-ink">
              {billing?.plan?.name || 'QrPrinter Monthly'}
              {billing?.plan ? <span className="panel-numeric font-normal text-muted"> · {money(billing.plan.amount_paise / 100)}/{billing.plan.period === 'yearly' ? 'year' : 'month'}</span> : null}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <BillingBadge state={billing?.state} />
            <CompButton shopId={shop.id} name={shop.name} comped={billing?.comped} onSet={setComped} />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-muted">Razorpay status</dt>
            <dd className="truncate font-semibold text-ink">{billing?.subscription_status || 'none'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Days left</dt>
            <dd className="panel-numeric font-semibold text-ink">{billing?.days_left == null ? '∞' : billing.days_left}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Trial ends</dt>
            <dd className="panel-numeric font-semibold text-ink">{fmtDate(billing?.trial_ends_at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Paid through</dt>
            <dd className="panel-numeric font-semibold text-ink">{fmtDate(billing?.period_end)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Grace ends</dt>
            <dd className="panel-numeric font-semibold text-ink">{fmtDate(billing?.grace_ends_at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Entitled</dt>
            <dd className="font-semibold text-ink">{billing?.entitled ? 'Yes' : 'No'}</dd>
          </div>
        </dl>

        <div className="mt-4 space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted uppercase">
            <CalendarClock size={13} strokeWidth={2} aria-hidden="true" /> Billing events
          </h3>
          {!billing_events || billing_events.length === 0 ? (
            <p className="text-xs text-muted">No webhook events recorded for this shop yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-field border border-line">
              {billing_events.map((event) => (
                <li key={event.event_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="font-semibold text-ink">{event.event_type}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${
                    event.processed_at ? 'bg-success-soft text-success ring-success/25' : 'bg-warn-soft text-warn ring-warn/25'
                  }`}>
                    {event.processed_at ? 'processed' : 'pending'}
                  </span>
                  <span className="panel-numeric ml-auto text-muted">
                    {new Date(event.received_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="agents-heading" className="space-y-3">
        <h2 id="agents-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Connected agents</h2>
        {devices.length === 0 ? (
          <EmptyState title="No agents paired" note="This shop has not paired a local agent yet." />
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {devices.map((device) => (
              <li key={device.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{device.label || device.hostname || device.id}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{device.hostname} · agent {device.agent_version || '?'}</p>
                  </div>
                  <OnlineBadge online={device.online} />
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <div className="flex gap-1.5">
                    <dt className="text-muted">Spooler</dt>
                    <dd className="font-semibold text-ink">{device.spooler_running ? 'running' : 'stopped'}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted">Queue</dt>
                    <dd className="panel-numeric font-semibold text-ink">{device.queue_depth}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted">Last seen</dt>
                    <dd className="panel-numeric font-semibold text-ink">
                      {device.last_heartbeat_at
                        ? new Date(device.last_heartbeat_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                        : 'never'}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="orders-heading" className="space-y-3">
        <h2 id="orders-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Recent orders</h2>
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" note="Customer uploads will appear here." />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="panel-numeric text-sm font-semibold text-ink">{order.id}</span>
                <span className="text-sm text-body">{order.customer_name || '—'}</span>
                <span className="text-xs text-muted">{order.documents} doc{order.documents === 1 ? '' : 's'}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    order.status === 'paid' ? 'bg-success-soft text-success ring-success/25' : 'bg-warn-soft text-warn ring-warn/25'
                  }`}
                >
                  {order.status}
                </span>
                <span className="text-xs text-muted">{order.method}</span>
                <span className="panel-numeric ml-auto text-sm font-semibold text-ink">{money(order.amount)}</span>
                <span className="panel-numeric w-full text-xs text-muted sm:w-auto">
                  {new Date(order.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}