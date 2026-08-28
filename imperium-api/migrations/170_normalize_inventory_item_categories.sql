-- Collapse duplicate free-text inventory item categories without changing items,
-- stock balances, movements, or supplier links.
UPDATE procurement.inventory_items
SET category = CASE
    WHEN normalized_category IN ('aggregate', 'aggregates') THEN 'Aggregates'
    WHEN normalized_category IN ('board', 'boards', 'timber', 'timber boards', 'timber & boards') THEN 'Timber & Boards'
    WHEN normalized_category IN ('brick', 'bricks', 'block', 'blocks') THEN 'Bricks & Blocks'
    WHEN normalized_category IN ('cement', 'cement concrete', 'cement & concrete', 'concrete') THEN 'Cement & Concrete'
    WHEN normalized_category = 'electrical' THEN 'Electrical'
    WHEN normalized_category IN ('fastener', 'fasteners', 'fixings') THEN 'Fasteners & Fixings'
    WHEN normalized_category IN ('fuel', 'lubricants') THEN 'Fuel & Lubricants'
    WHEN normalized_category IN ('paint', 'paint chemicals', 'paint & chemicals') THEN 'Paint & Chemicals'
    WHEN normalized_category IN ('ppe', 'ppe safety', 'ppe & safety') THEN 'PPE & Safety'
    WHEN normalized_category = 'plumbing' THEN 'Plumbing'
    WHEN normalized_category IN ('roof', 'roofing') THEN 'Roofing'
    WHEN normalized_category IN ('steel', 'steel metalwork', 'steel & metalwork') THEN 'Steel & Metalwork'
    WHEN normalized_category IN ('structural material', 'structural materials') THEN 'Structural Materials'
    WHEN normalized_category IN ('tile', 'tiles', 'tiles finishes', 'tiles & finishes') THEN 'Tiles & Finishes'
    WHEN normalized_category IN ('tool', 'tools', 'tools equipment', 'tools & equipment') THEN 'Tools & Equipment'
    ELSE initcap(clean_category)
END
FROM (
    SELECT
        id,
        regexp_replace(btrim(category), '\s+', ' ', 'g') AS clean_category,
        lower(regexp_replace(replace(btrim(category), '/', ' '), '\s+', ' ', 'g')) AS normalized_category
    FROM procurement.inventory_items
    WHERE category IS NOT NULL AND btrim(category) <> ''
) cleaned
WHERE procurement.inventory_items.id = cleaned.id
  AND procurement.inventory_items.category IS DISTINCT FROM CASE
      WHEN normalized_category IN ('aggregate', 'aggregates') THEN 'Aggregates'
      WHEN normalized_category IN ('board', 'boards', 'timber', 'timber boards', 'timber & boards') THEN 'Timber & Boards'
      WHEN normalized_category IN ('brick', 'bricks', 'block', 'blocks') THEN 'Bricks & Blocks'
      WHEN normalized_category IN ('cement', 'cement concrete', 'cement & concrete', 'concrete') THEN 'Cement & Concrete'
      WHEN normalized_category = 'electrical' THEN 'Electrical'
      WHEN normalized_category IN ('fastener', 'fasteners', 'fixings') THEN 'Fasteners & Fixings'
      WHEN normalized_category IN ('fuel', 'lubricants') THEN 'Fuel & Lubricants'
      WHEN normalized_category IN ('paint', 'paint chemicals', 'paint & chemicals') THEN 'Paint & Chemicals'
      WHEN normalized_category IN ('ppe', 'ppe safety', 'ppe & safety') THEN 'PPE & Safety'
      WHEN normalized_category = 'plumbing' THEN 'Plumbing'
      WHEN normalized_category IN ('roof', 'roofing') THEN 'Roofing'
      WHEN normalized_category IN ('steel', 'steel metalwork', 'steel & metalwork') THEN 'Steel & Metalwork'
      WHEN normalized_category IN ('structural material', 'structural materials') THEN 'Structural Materials'
      WHEN normalized_category IN ('tile', 'tiles', 'tiles finishes', 'tiles & finishes') THEN 'Tiles & Finishes'
      WHEN normalized_category IN ('tool', 'tools', 'tools equipment', 'tools & equipment') THEN 'Tools & Equipment'
      ELSE initcap(clean_category)
  END;
