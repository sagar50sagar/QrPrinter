-- Customer online payments (optional, alongside cash). Each shop connects its
-- own Razorpay account, so a customer's print payment settles straight to the
-- shop. The Key ID is public (the browser needs it for checkout); the Key Secret
-- and webhook secret are stored encrypted at rest (see lib/crypto.js).

ALTER TABLE shops
  ADD COLUMN rzp_key_id            text NOT NULL DEFAULT '',
  ADD COLUMN rzp_key_secret_enc    text NOT NULL DEFAULT '',
  ADD COLUMN rzp_webhook_secret_enc text NOT NULL DEFAULT '';

-- The Razorpay order created when a customer chooses to pay online, and the
-- captured payment id recorded by the webhook (audit + idempotency).
ALTER TABLE orders
  ADD COLUMN rzp_order_id   text,
  ADD COLUMN rzp_payment_id text;

CREATE UNIQUE INDEX orders_rzp_order_idx ON orders(rzp_order_id) WHERE rzp_order_id IS NOT NULL;

-- One row per verified payment webhook, exactly once. Mirrors billing_events:
-- the event id is the idempotency key, so a replayed delivery collapses.
CREATE TABLE payment_events (
  event_id       text PRIMARY KEY,
  event_type     text NOT NULL,
  shop_id        text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id       text REFERENCES orders(id) ON DELETE SET NULL,
  rzp_order_id   text,
  rzp_payment_id text,
  payload        jsonb NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);
CREATE INDEX payment_events_shop_idx ON payment_events(shop_id, received_at DESC);