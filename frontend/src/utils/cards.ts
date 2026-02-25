const suitMap: Record<string, string> = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
  JOKER: "🃏"
};

const suitOrder: Record<string, number> = {
  S: 1,
  H: 2,
  C: 3,
  D: 4,
  JOKER: 5
};

const rankOrder: Record<string, number> = {
  "3": 1,
  "4": 2,
  "5": 3,
  "6": 4,
  "7": 5,
  "8": 6,
  "9": 7,
  "10": 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
  "2": 13,
  SJ: 14,
  BJ: 15
};

const redSuits = new Set(["H", "D"]);

interface ParsedCard {
  deckNo: number;
  suit: string;
  rank: string;
}

const parseCardId = (cardId: string): ParsedCard | null => {
  const parts = cardId.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const deckNo = Number(parts[0]);
  if (!Number.isFinite(deckNo)) {
    return null;
  }
  return {
    deckNo,
    suit: parts[1],
    rank: parts[2]
  };
};

export const toCardLabel = (cardId: string): string => {
  const parsed = parseCardId(cardId);
  if (!parsed) {
    return cardId;
  }
  if (parsed.suit === "JOKER") {
    return parsed.rank === "BJ" ? "大王" : "小王";
  }
  const suit = suitMap[parsed.suit] ?? parsed.suit;
  return `${suit}${parsed.rank}`;
};

export const cardThemeClass = (cardId: string): string => {
  const parsed = parseCardId(cardId);
  if (!parsed) {
    return "card-black";
  }
  if (parsed.suit === "JOKER") {
    return "card-joker";
  }
  return redSuits.has(parsed.suit) ? "card-red" : "card-black";
};

export const sortCardIds = (cards: string[]): string[] => {
  return [...cards].sort((a, b) => {
    const pa = parseCardId(a);
    const pb = parseCardId(b);
    if (!pa || !pb) {
      return a.localeCompare(b);
    }
    const rankDiff = (rankOrder[pa.rank] ?? 999) - (rankOrder[pb.rank] ?? 999);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const suitDiff = (suitOrder[pa.suit] ?? 999) - (suitOrder[pb.suit] ?? 999);
    if (suitDiff !== 0) {
      return suitDiff;
    }
    return pa.deckNo - pb.deckNo;
  });
};

export const hasWildcard = (cards: string[]): boolean => {
  return cards.some((id) => id.includes("-JOKER-"));
};
