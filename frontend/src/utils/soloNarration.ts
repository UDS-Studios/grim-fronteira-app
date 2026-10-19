import type { SoloState } from "../api/types.ts";

export function soloNarrationId(gameId: string, solo: SoloState): string {
  // Starting the test changes intro -> playing, but is the same story passage.
  const sceneNumber = solo.scene_number + (solo.step === "intro" ? 1 : 0);
  return JSON.stringify([gameId, solo.node, sceneNumber, solo.attempt, solo.outcome, solo.text]);
}
