-- Each notice has a type, which sets its colour and icon, and HR can pin one
-- or more to the top of the noticeboard.
ALTER TABLE announcements
  ADD COLUMN category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'important', 'event', 'celebration')),
  ADD COLUMN pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz;
