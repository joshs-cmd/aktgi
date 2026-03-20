CREATE TABLE IF NOT EXISTS onestop_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  internal_code text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(query)
);

ALTER TABLE onestop_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read on onestop_aliases"
  ON onestop_aliases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow service role insert on onestop_aliases"
  ON onestop_aliases FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Allow service role update on onestop_aliases"
  ON onestop_aliases FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Allow service role delete on onestop_aliases"
  ON onestop_aliases FOR DELETE
  TO service_role
  USING (true);

INSERT INTO onestop_aliases (query, internal_code, notes) VALUES
  ('GILDAN5000',  'GD210',     'Gildan 5000'),
  ('G5000',       'GD210',     'Gildan 5000 prefixed'),
  ('5000',        'GD210',     'Gildan 5000 bare'),
  ('GILDAN18500', 'GD280',     'Gildan 18500'),
  ('G18500',      'GD280',     'Gildan 18500 prefixed'),
  ('GILDAN64000', 'GD640',     'Gildan 64000'),
  ('G64000',      'GD640',     'Gildan 64000 prefixed'),
  ('GILDAN2000',  'GD200',     'Gildan 2000'),
  ('G2000',       'GD200',     'Gildan 2000 prefixed'),
  ('BC3001',      'CV207',     'Bella+Canvas 3001'),
  ('3001',        'CV207',     'Bella+Canvas 3001 bare'),
  ('BELLA3001',   'CV207',     'Bella+Canvas 3001 brand prefix'),
  ('BC3001CVC',   'CV207CVC',  'Bella+Canvas 3001 CVC'),
  ('BC3001Y',     'CV207Y',    'Bella+Canvas 3001 Youth'),
  ('BC3005',      'CV265',     'Bella+Canvas 3005'),
  ('BC3413',      'CV208',     'Bella+Canvas 3413'),
  ('BC3415',      'CV2015',    'Bella+Canvas 3415'),
  ('BC3501',      'CV201',     'Bella+Canvas 3501'),
  ('BC3719',      'CV291',     'Bella+Canvas 3719'),
  ('BC6400',      'CV206',     'Bella+Canvas 6400'),
  ('BC6405',      'CV404',     'Bella+Canvas 6405'),
  ('PC54',        'PC54',      'Port & Company PC54'),
  ('PC61',        'PC61',      'Port & Company PC61'),
  ('PC78H',       'PC78H',     'Port & Company PC78H'),
  ('PC90H',       'PC90H',     'Port & Company PC90H'),
  ('NL3600',      'NL3600',    'Next Level 3600'),
  ('NL6210',      'NL6210',    'Next Level 6210'),
  ('NL3633',      'NL250',     'Next Level 3633 tank'),
  ('3633',        'NL250',     'Next Level 3633 bare'),
  ('HANES5280',   'HN5280',    'Hanes 5280'),
  ('5280',        'HN5280',    'Hanes 5280 bare'),
  ('HANES5250',   'HN5250',    'Hanes 5250'),
  ('HANES5170',   'HN5170',    'Hanes 5170')
ON CONFLICT (query) DO UPDATE SET
  internal_code = EXCLUDED.internal_code,
  notes = EXCLUDED.notes;