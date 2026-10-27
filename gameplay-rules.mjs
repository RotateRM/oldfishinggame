export function baseStatsForAppearance(appearance) {
  return ({
    1: { strength: 9, luck: 8, focusPower: 90, focusRate: 64 },
    2: { strength: 8, luck: 11, focusPower: 80, focusRate: 67 },
    3: { strength: 10, luck: 12, focusPower: 100, focusRate: 70 },
    4: { strength: 8, luck: 11, focusPower: 80, focusRate: 67 },
  })[appearance] ?? { strength: 1, luck: 0, focusPower: 100, focusRate: 20 };
}

export function fightProfileFor(character) {
  return {
    fishStrength: 1,
    playerStrength: character.strength ?? 1,
    luck: character.luck ?? 0,
    focusPower: character.focusPower ?? 100,
    focusRate: character.focusRate ?? 20,
    hitPoints: character.hitPoints ?? 100,
  };
}
