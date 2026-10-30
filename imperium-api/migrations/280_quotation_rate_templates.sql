-- ============================================================================
-- Migration 280: reusable rate build-up templates for the estimating workspace
-- ============================================================================
-- Additive only. finance.construction_assemblies keeps its legacy recipe
-- columns (material_recipe / labour_gang / plant_needs) and every existing
-- reader of them keeps working.
--
-- A build-up saved from the workspace stores its resources in their native
-- shape (resources jsonb: type, name, qty per unit, unit, unit cost, source,
-- source date). The legacy columns are filled too for the resource types that
-- map onto them, so the old assembly calculator still prices the template.
--
-- Templates are versioned by row: saving a code that already exists inserts
-- a new row (template_version + 1) and retires the old one (is_deleted =
-- true, superseded_by = new id). Applying a template COPIES its resources
-- into the quotation line with the template id and version recorded, so a
-- later template change never alters a historical quotation.

ALTER TABLE finance.construction_assemblies
    ADD COLUMN IF NOT EXISTS resources           jsonb,
    ADD COLUMN IF NOT EXISTS template_version    integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS currency            varchar(10),
    ADD COLUMN IF NOT EXISTS source_quotation_id uuid,
    ADD COLUMN IF NOT EXISTS source_line_id      text,
    ADD COLUMN IF NOT EXISTS superseded_by       uuid,
    ADD COLUMN IF NOT EXISTS created_by          uuid,
    ADD COLUMN IF NOT EXISTS notes               text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'construction_assemblies_superseded_by_fkey'
          AND conrelid = 'finance.construction_assemblies'::regclass
    ) THEN
        ALTER TABLE finance.construction_assemblies
            ADD CONSTRAINT construction_assemblies_superseded_by_fkey
            FOREIGN KEY (superseded_by) REFERENCES finance.construction_assemblies(id);
    END IF;
END $$;
