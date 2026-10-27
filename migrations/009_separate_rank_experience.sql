-- FishingChamp tracks character-level EXP and rank/grade EXP separately.
ALTER TABLE characters ADD COLUMN rank_experience INTEGER NOT NULL DEFAULT 0;
