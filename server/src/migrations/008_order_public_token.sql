-- Order ids are sequential (J-1000, J-1001, ...) because the counter reads them
-- aloud. The customer status and pay endpoints are unauthenticated, so accepting
-- that id let anyone walk the sequence and read other people's names, files and
-- amounts. Those two endpoints now take this opaque token instead; the id stays
-- the human-facing reference and every foreign key keeps pointing at it.
ALTER TABLE orders ADD COLUMN public_token text;

-- gen_random_uuid() is built in from Postgres 13, so no extension is needed.
UPDATE orders
   SET public_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)
 WHERE public_token IS NULL;

ALTER TABLE orders ALTER COLUMN public_token SET NOT NULL;
CREATE UNIQUE INDEX orders_public_token_idx ON orders(public_token);