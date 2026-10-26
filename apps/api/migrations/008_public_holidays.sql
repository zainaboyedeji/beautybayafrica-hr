-- Public holidays don't count as days of leave. HR adds the Islamic holidays
-- once the government announces them, and moves any that fall on a weekend.
CREATE TABLE public_holidays (
  day date PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO public_holidays (day, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-12', 'Democracy Day'),
  ('2026-10-01', 'Independence Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-06-12', 'Democracy Day'),
  ('2027-10-01', 'Independence Day'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Boxing Day');
