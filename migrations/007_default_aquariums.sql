INSERT OR IGNORE INTO aquariums (character_id, name)
SELECT id, name || '''s Aquarium' FROM characters;
