-- SQLite permits duplicate NULL values in the composite map_fish key.
DELETE FROM map_fish
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM map_fish
  GROUP BY map_id, fish_id, COALESCE(fishing_point, -1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_map_fish_unique_point
ON map_fish(map_id, fish_id, COALESCE(fishing_point, -1));

-- Fish 114 has a habitat model but no matching aquarium model in this client.
-- Keep it catalogued, but do not select it until the missing model is recovered.
UPDATE fish_definitions SET model_code = 'F011400_H', enabled = 0 WHERE fish_id = 11400;
