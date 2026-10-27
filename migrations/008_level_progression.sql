-- Provisional cumulative EXP curve. The original client thresholds have not yet
-- been recovered, so keeping them as rows lets us replace the values safely.
CREATE TABLE IF NOT EXISTS level_thresholds (
  level INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 100),
  required_experience INTEGER NOT NULL UNIQUE CHECK (required_experience >= 0)
);

WITH RECURSIVE levels(level) AS (
  SELECT 1
  UNION ALL
  SELECT level + 1 FROM levels WHERE level < 100
)
INSERT OR IGNORE INTO level_thresholds (level, required_experience)
SELECT level, 400 * level * (level - 1) FROM levels;

-- EXP is authoritative. These triggers also cover edits made directly through
-- HeidiSQL or another SQLite editor.
CREATE TRIGGER IF NOT EXISTS characters_level_from_experience_insert
AFTER INSERT ON characters
BEGIN
  UPDATE characters
  SET level = COALESCE((
    SELECT MAX(level) FROM level_thresholds
    WHERE required_experience <= MAX(0, NEW.experience)
  ), 1)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS characters_level_from_experience_update
AFTER UPDATE OF experience ON characters
BEGIN
  UPDATE characters
  SET level = COALESCE((
    SELECT MAX(level) FROM level_thresholds
    WHERE required_experience <= MAX(0, NEW.experience)
  ), 1)
  WHERE id = NEW.id;
END;

-- Normalize existing characters immediately when this migration is applied.
UPDATE characters
SET level = COALESCE((
  SELECT MAX(level) FROM level_thresholds
  WHERE required_experience <= MAX(0, characters.experience)
), 1);
