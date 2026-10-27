UPDATE item_definitions SET name = 'Basic Rod', maximum_durability = 50, equipment_slot = 8 WHERE item_id = 524801;
UPDATE inventory_items SET duration = 50 WHERE item_id = 524801 AND duration > 50;

INSERT INTO item_definitions (item_id, category, equipment_slot, maximum_durability, stack_limit) VALUES
  (589828, 'equipment', 9, 100, 1),
  (655363, 'equipment', 10, 0, 99),
  (720897, 'equipment', 11, 100, 1),
  (720906, 'equipment', 11, 100, 1),
  (786433, 'equipment', 12, 100, 1),
  (786438, 'equipment', 12, 100, 1),
  (851970, 'equipment', 13, 100, 1),
  (851979, 'equipment', 13, 100, 1),
  (851980, 'equipment', 13, 100, 1)
ON CONFLICT(item_id) DO UPDATE SET category = excluded.category, equipment_slot = excluded.equipment_slot, maximum_durability = excluded.maximum_durability, stack_limit = excluded.stack_limit;

