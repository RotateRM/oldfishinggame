-- Migration 013 used values observed on an incomplete early-client screen.
-- Restore the four original creation stats recovered from the complete client.
UPDATE characters SET strength = 9, luck = 8, focus_power = 90, focus_rate = 64, hitpoints = 100
WHERE appearance = 1 AND strength = 1 AND luck = 0 AND focus_power = 100 AND focus_rate = 20;

-- The installed client contains both habitat and aquarium models for fish 114.
INSERT OR IGNORE INTO fish_definitions (fish_id, model_code) VALUES (11400, 'F011400_A');

-- Fish 100 is the one verified by the client and live protocol in Pangaea.
INSERT OR IGNORE INTO map_fish (map_id, fish_id, fishing_point, minimum_level, weight)
VALUES (0, 100, NULL, 1, 1);
