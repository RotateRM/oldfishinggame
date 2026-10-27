INSERT OR IGNORE INTO maps (id, code, name, minimum_level, enabled) VALUES
  (1, 'sanctuary', 'The Sanctuary', 1, 1),
  (2, 'piscis', 'Piscis', 1, 1),
  (3, 'dragon_island', 'Dragon Island', 30, 1),
  (4, 'paradise', 'Paradise Island', 1, 1),
  (5, 'unknown_world', 'Unknown World', 1, 1),
  (6, 'aquafarm', 'Aquafarm', 50, 1),
  (7, 'whirling', 'The Whirling', 30, 1),
  (8, 'bamboo_forest', 'Bamboo Forest', 100, 1),
  (9, 'blue_dragon', 'Blue Dragon', 1, 1),
  (10, 'zuma_isles', 'The Zuma Isles', 30, 1);

INSERT OR IGNORE INTO channels (id, map_id, channel_number, name, maximum_players)
SELECT 100 + id, id, 1, name || ' 1', 100 FROM maps WHERE id BETWEEN 1 AND 10;
