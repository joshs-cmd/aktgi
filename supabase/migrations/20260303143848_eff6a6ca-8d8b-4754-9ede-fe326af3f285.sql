
-- Create the distributor-archives storage bucket (private, admin-only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'distributor-archives',
  'distributor-archives',
  false,
  524288000, -- 500MB limit per file
  ARRAY['application/json', 'text/csv', 'text/plain', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Only allow service role to insert (edge functions use service role key)
CREATE POLICY "Service role can upload archives"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'distributor-archives');

-- Only allow authenticated reads (admin portal will use service role via edge fn)
CREATE POLICY "Service role can read archives"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'distributor-archives');

-- Allow service role to delete old files
CREATE POLICY "Service role can delete archives"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'distributor-archives');
