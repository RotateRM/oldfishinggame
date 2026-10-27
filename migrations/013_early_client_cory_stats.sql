-- This installed early client shows Cory's own creation values as 1/0/100/20.
UPDATE characters SET strength = 1, luck = 0, focus_power = 100, focus_rate = 20, hitpoints = 100
WHERE appearance = 1 AND strength = 9 AND luck = 8 AND focus_power = 90 AND focus_rate = 64;
