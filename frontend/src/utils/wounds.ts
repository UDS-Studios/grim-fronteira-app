type SceneWoundState = {
  wounds_gained?: number;
  wounds_applied?: number;
};

export function getWoundDisplay(persistentWounds: number | undefined, scenePlayer?: SceneWoundState) {
  // wounds_gained is remaining debt, decremented when committed to persistent wounds.
  // wounds_applied is history already included in that counter, not another wound.
  // A bust alone does not imply a wound (e.g. the Marshal-bust exemption).
  const wounds = (persistentWounds ?? 0) + (scenePlayer?.wounds_gained ?? 0);
  return { wounds, wounded: wounds > 0, dead: wounds >= 2 };
}
