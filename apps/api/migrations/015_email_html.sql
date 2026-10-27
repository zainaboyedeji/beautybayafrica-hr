-- The designed (HTML) version of each email, so a retry sends it too.
ALTER TABLE email_outbox ADD COLUMN html text;
