-- ============================================================================
-- AEGIS MIGRATION 227 - DOCUMENT TEXT EXTRACTION
-- ============================================================================
-- Adds the ability to read PDF/Word content back out of an uploaded file
-- (previously pypdf/pdfplumber/python-docx were only used to GENERATE
-- documents AEGIS produces - nothing extracted text from a document a user
-- uploaded). Two tables get identical columns because they are genuinely
-- separate document stacks: core.file_attachments (the shared system most
-- modules link into via core.document_links) and finance.data_room_documents
-- (the Financial Data Room's own storage table).
--
-- extraction_status defaults to 'not_applicable' rather than 'pending' -
-- existing rows are not being retroactively queued for extraction by this
-- migration (no backfill job), so 'pending' would misrepresent what is
-- actually about to happen. The application sets 'pending' explicitly at
-- the moment it enqueues the extraction job for a new upload.
--
-- search_vector is a generated column (not a trigger) - it can never drift
-- out of sync with extracted_text, and these tables are write-once-then-
-- rarely-updated, so the "recomputed on every UPDATE" cost of a generated
-- column is a non-issue here.
-- ============================================================================

ALTER TABLE core.file_attachments
    ADD COLUMN IF NOT EXISTS extracted_text TEXT,
    ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable'
        CHECK (extraction_status IN ('not_applicable', 'pending', 'extracted', 'no_text_found', 'unsupported_format', 'failed')),
    ADD COLUMN IF NOT EXISTS extraction_error TEXT,
    ADD COLUMN IF NOT EXISTS text_extracted_at TIMESTAMPTZ;

ALTER TABLE core.file_attachments
    ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_file_attachments_search_vector
    ON core.file_attachments USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_file_attachments_extraction_pending
    ON core.file_attachments (organization_id)
    WHERE extraction_status = 'pending';


ALTER TABLE finance.data_room_documents
    ADD COLUMN IF NOT EXISTS extracted_text TEXT,
    ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable'
        CHECK (extraction_status IN ('not_applicable', 'pending', 'extracted', 'no_text_found', 'unsupported_format', 'failed')),
    ADD COLUMN IF NOT EXISTS extraction_error TEXT,
    ADD COLUMN IF NOT EXISTS text_extracted_at TIMESTAMPTZ;

ALTER TABLE finance.data_room_documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_data_room_documents_search_vector
    ON finance.data_room_documents USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_data_room_documents_extraction_pending
    ON finance.data_room_documents (organization_id)
    WHERE extraction_status = 'pending';
