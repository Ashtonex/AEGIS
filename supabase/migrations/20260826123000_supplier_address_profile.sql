-- Supplier address is required by HR vendor verification, so staff-created
-- procurement suppliers need to store it on the supplier profile too.

ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS address TEXT;
