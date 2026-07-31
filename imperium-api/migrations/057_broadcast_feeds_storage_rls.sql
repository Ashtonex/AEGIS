-- ============================================================================
-- Broadcast feeds storage bucket + RLS policy
-- ============================================================================
-- Discovered via live testing: the "broadcast-feeds" Supabase Storage bucket
-- referenced by the Website Content tab's image broadcast upload feature had
-- never been created, and once created (via the Storage Admin API) had no
-- RLS policy on storage.objects permitting uploads. The frontend always
-- uploads using the signed-in user's own JWT (never a service-role key), so
-- with no policy grant every upload was rejected with "new row violates
-- row-level security policy" regardless of the user's app-level permissions.
-- The bucket itself is created as public (via the Storage Admin API, not
-- SQL) so getPublicUrl() links work without needing a read policy here.

CREATE POLICY "Authenticated users can upload broadcast feed images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'broadcast-feeds');

CREATE POLICY "Authenticated users can update their broadcast feed images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'broadcast-feeds')
WITH CHECK (bucket_id = 'broadcast-feeds');

CREATE POLICY "Authenticated users can read broadcast feed images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'broadcast-feeds');
