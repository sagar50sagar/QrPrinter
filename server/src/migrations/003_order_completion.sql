-- Printed documents are removed after a short grace window (privacy + disk
-- hygiene), so accounting cannot live on the document row. The order keeps it:
-- how many documents it started with, how many printed, the sheets printed, and
-- when it finished. Daily print and revenue totals are derived from orders, so
-- they survive the deletion of the documents themselves.
ALTER TABLE orders
  ADD COLUMN document_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN printed_documents integer NOT NULL DEFAULT 0,
  ADD COLUMN printed_sheets    integer NOT NULL DEFAULT 0,
  ADD COLUMN completed_at      timestamptz;