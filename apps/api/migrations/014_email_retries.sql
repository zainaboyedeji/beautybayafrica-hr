-- Failed emails are tried again a few times, further apart each time.
ALTER TABLE email_outbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 1,
  -- When the next try is due; NULL once it's sent, given up on, or replaced
  -- by a newer copy.
  ADD COLUMN next_attempt_at timestamptz;

CREATE INDEX email_outbox_retry_idx ON email_outbox (next_attempt_at)
  WHERE next_attempt_at IS NOT NULL;
