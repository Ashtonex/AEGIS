-- Real file upload/download for Documents. The 'documents' Supabase
-- Storage bucket itself was created via the Storage Admin API (private,
-- not public - unlike construction-drawings, since documents carry an
-- explicit internal/confidential classification and must not be readable
-- by anyone holding a permanent public URL). Reads happen exclusively
-- through short-lived signed URLs minted server-side by the backend's
-- service-role client after it checks documents.read + org match - there
-- is deliberately no SELECT policy here for `authenticated`, so a client
-- can't fetch an object directly even if it knows the storage path.
--
-- core.file_attachments and core.documents.file_attachment_id already
-- existed with exactly the right shape (storage_path, mime_type,
-- size_bytes) - this table was simply never wired into the application
-- before now.

DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload documents" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "Authenticated users can update their document uploads" ON storage.objects;
CREATE POLICY "Authenticated users can update their document uploads" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'documents')
    WITH CHECK (bucket_id = 'documents');
