-- A refund or a lost dispute must stop a paid order from printing, and must
-- never erase the fact that it was paid. orders keeps the current state;
-- payment_log keeps every transition, append-only, with whoever caused it.
ALTER TABLE orders
  ADD COLUMN reversed_at    timestamptz,
  ADD COLUMN reverse_reason text NOT NULL DEFAULT '';

CREATE TABLE payment_log (
  id             bigserial PRIMARY KEY,
  shop_id        text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id       text REFERENCES orders(id) ON DELETE SET NULL,
  event          text NOT NULL,              -- paid | unpaid | reversed | restored | rejected
  method         text NOT NULL DEFAULT '',   -- cash | online
  amount_paise   integer NOT NULL DEFAULT 0,
  actor          text NOT NULL DEFAULT '',   -- webhook | counter:<user id>
  detail         text NOT NULL DEFAULT '',
  rzp_payment_id text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_log_shop_idx ON payment_log(shop_id, created_at DESC);
CREATE INDEX payment_log_order_idx ON payment_log(order_id);