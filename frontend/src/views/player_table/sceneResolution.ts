export type SceneOutcomeKey = "success" | "failure" | "wound";

export type SceneOutcome = {
  key: SceneOutcomeKey;
  label: string;
  color: string;
};

function getRank(cardId?: string | null): string {
  if (!cardId) return "";
  if (cardId === "RJ" || cardId === "BJ") return cardId;
  return cardId.slice(0, -1).toUpperCase();
}

export function getSceneCardValue(cardId?: string | null): number {
  const rank = getRank(cardId);
  if (!rank) return 0;
  if (rank === "RJ" || rank === "BJ" || rank === "J" || rank === "Q" || rank === "K") {
    return 10;
  }
  if (rank === "A") return 11;

  const parsed = Number.parseInt(rank, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSceneCardsValue(cardIds: string[]): number {
  return cardIds.reduce((sum, cardId) => sum + getSceneCardValue(cardId), 0);
}

function getBestBlackjackLikeTotal(cardIds: string[]): number {
  let total = cardIds.reduce((sum, cardId) => sum + getSceneCardValue(cardId), 0);
  let aces = cardIds.filter((cardId) => getRank(cardId) === "A").length;

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

export function getSceneHandTotal({
  figureCardId,
  playedCards,
  backendHandValue,
}: {
  figureCardId?: string | null;
  playedCards: string[];
  backendHandValue?: number | null;
}): number {
  if (typeof backendHandValue === "number") return backendHandValue;
  return getBestBlackjackLikeTotal(
    [figureCardId, ...playedCards].filter((cardId): cardId is string => !!cardId)
  );
}

export function getSceneOutcome(total: number | null, difficulty: number | null): SceneOutcome | null {
  if (total == null || difficulty == null) return null;
  if (total > 21) {
    return { key: "wound", label: "Wound!!", color: "#d11f1f" };
  }
  if (total >= difficulty) {
    return { key: "success", label: "Success!", color: "#2f8f3e" };
  }
  return { key: "failure", label: "Failure!", color: "#6f1d1b" };
}
