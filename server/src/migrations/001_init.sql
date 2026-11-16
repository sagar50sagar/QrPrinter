-- QrPrinter product schema.
-- Money is stored as integer paise (1 rupee = 100 paise) so totals never drift
-- through floating point. The API converts to rupees at the edge.

CREATE TABLE shops (
  id              text PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  is_open         boolean NOT NULL DEFAULT true,
  welcome_message text NOT NULL DEFAULT '',
  currency        text NOT NULL DEFAULT 'INR',
  price_bw_paise    integer NOT NULL DEFAULT 200,
  price_color_paise integer NOT NULL DEFAULT 1000,
  -- Printer endpoints chosen in Settings; null means "not assigned yet".
  printer_bw      text,
  printer_color   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  shop_id       text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_shop_idx ON users(shop_id);

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- One agent installation. The raw token is returned once at pairing; only its
-- SHA-256 is stored, so a database leak does not hand out printing credentials.
CREATE TABLE devices (
  id               text PRIMARY KEY,
  shop_id          text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE,
  label            text NOT NULL DEFAULT '',
  hostname         text NOT NULL DEFAULT '',
  machine_key      text NOT NULL DEFAULT '',
  agent_version    text NOT NULL DEFAULT '',
  spooler_running  boolean NOT NULL DEFAULT false,
  printers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  queue_depth      integer NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_shop_idx ON devices(shop_id);

CREATE TABLE pairing_codes (
  id             text PRIMARY KEY,
  shop_id        text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  used_by_device text REFERENCES devices(id) ON DELETE SET NULL
);
CREATE INDEX pairing_codes_code_idx ON pairing_codes(code);

-- One order per upload batch: payment and customer identity live here.
CREATE SEQUENCE order_seq START 1000;
CREATE TABLE orders (
  id             text PRIMARY KEY,
  shop_id        text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_name  text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  note           text NOT NULL DEFAULT '',
  method         text NOT NULL DEFAULT 'cash',   -- cash | online
  status         text NOT NULL DEFAULT 'unpaid', -- unpaid | paid
  amount_paise   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE INDEX orders_shop_idx ON orders(shop_id, created_at DESC);

-- One document per file: its own print status, routing and result.
CREATE TABLE documents (
  id             text PRIMARY KEY,
  order_id       text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id        text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  file_name      text NOT NULL,
  stored_path    text NOT NULL,
  fetch_key      text NOT NULL,
  content_type   text NOT NULL DEFAULT 'application/pdf',
  bytes          bigint NOT NULL DEFAULT 0,
  sha256         text NOT NULL,
  pages          integer NOT NULL DEFAULT 1,
  copies         integer NOT NULL DEFAULT 1,
  mode           text NOT NULL DEFAULT 'bw',     -- bw | color
  duplex         boolean NOT NULL DEFAULT false,
  paper          text NOT NULL DEFAULT 'A4',
  page_range     text,
  print_status   text NOT NULL DEFAULT 'pending',
  -- pending → queued → printing → printed|failed|rejected|uncertain
  print_stage    text NOT NULL DEFAULT '',
  print_detail   text NOT NULL DEFAULT '',
  copies_printed integer,
  printer_name   text,
  device_id      text REFERENCES devices(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  finished_at    timestamptz
);
CREATE INDEX documents_order_idx ON documents(order_id);
CREATE INDEX documents_queue_idx ON documents(shop_id, print_status);