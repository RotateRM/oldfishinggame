-- Location 5 is the character's equipped-slot set. Keep the wire-level active
-- flag aligned with placement so client-side fishing checks see equipped bait.
UPDATE inventory_items SET active = CASE WHEN location = 5 THEN 1 ELSE 0 END;
