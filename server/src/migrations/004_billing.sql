-- Shop subscription billing (flow B: shop pays the platform).
-- Money is integer paise, like everywhere else. Entitlement is computed from
-- time windows (trial / paid period / grace) so it is robust to webhook ordering
-- and replays; the stored status is for display and audit only.

CREATE TABLE plans (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  amount_paise integer NOT NULL,
  currency     text NOT NULL DEFAULT 'INR',
  period       text NOT NULL DEFAULT 'monthly',
  interval     integer NOT NULL DEFAULT 1,
  -- Created lazily in Razorpay the first time a shop subscribes; null until then.
  rzp_plan_id  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name, amount_paise, currency, period, interval)
VALUES ('plan_monthly', 'QrPrinter Monthly', 29900, 'INR', 'monthly', 1)
ON CONFLICT (id) DO NOTHING;

-- Billing state lives on shops, beside is_open / suspended_at, so the existing
-- session and customer loaders pick it up with no extra join.
ALTER TABLE shops ADD COLUMN trial_ends_at           timestamptz;
ALTER TABLE shops ADD COLUMN comped                  boolean NOT NULL DEFAULT false;
ALTER TABLE shops ADD COLUMN plan_id                 text REFERENCES plans(id);
ALTER TABLE shops ADD COLUMN rzp_subscription_id     text;
ALTER TABLE shops ADD COLUMN subscription_status     text NOT NULL DEFAULT 'none';
ALTER TABLE shops ADD COLUMN subscription_period_end timestamptz;
ALTER TABLE shops ADD COLUMN billing_updated_at      timestamptz;

-- Grandfather every shop that already exists with a fresh trial, so launching
-- billing never instantly locks out a live cafe. New signups get their trial in
-- the signup route.
UPDATE shops SET trial_ends_at = now() + interval '14 days' WHERE trial_ends_at IS NULL;

-- One row per webhook event. The primary key is the idempotency guard: a replayed
-- or retried delivery inserts nothing and is skipped, so a charge is applied once.
CREATE TABLE billing_events (
  event_id            text PRIMARY KEY,
  event_type          text NOT NULL,
  shop_id             text,
  rzp_subscription_id text,
  payload             jsonb NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz
);
CREATE INDEX billing_events_shop_idx ON billing_events(shop_id, received_at DESC);