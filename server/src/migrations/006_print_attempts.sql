-- How many times a document has been handed to an agent. requeueStale returns a
-- silent agent's job to the queue, but without a cap a print that succeeded and
-- lost its result would be offered again forever. The counter's Retry resets it.
ALTER TABLE documents
  ADD COLUMN print_attempts integer NOT NULL DEFAULT 0;