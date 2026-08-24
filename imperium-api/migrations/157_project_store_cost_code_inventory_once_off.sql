-- Project stores, cost-code setup support, and once-off inventory metadata.

ALTER TABLE procurement.inventory_items
    ADD COLUMN IF NOT EXISTS is_once_off_purchase BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS repurchase_policy VARCHAR(24) NOT NULL DEFAULT 'reorder',
    ADD COLUMN IF NOT EXISTS procurement_notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_items_repurchase_policy_chk'
          AND conrelid = 'procurement.inventory_items'::regclass
    ) THEN
        ALTER TABLE procurement.inventory_items
            ADD CONSTRAINT inventory_items_repurchase_policy_chk
            CHECK (repurchase_policy IN ('reorder', 'once_off', 'do_not_reorder'));
    END IF;
END $$;

UPDATE procurement.inventory_items
SET repurchase_policy = 'once_off'
WHERE is_once_off_purchase = true
  AND repurchase_policy = 'reorder';

ALTER TABLE procurement.stores
    ADD COLUMN IF NOT EXISTS store_manager_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS engineer_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS foreman_id UUID REFERENCES core.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stores_project_active_idx
    ON procurement.stores (organization_id, project_id, status)
    WHERE is_deleted = false;
