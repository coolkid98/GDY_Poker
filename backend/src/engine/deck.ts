import type { Card, CardRank, CardSuit } from "../types/game.js";

const normalRanks: CardRank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const suits: CardSuit[] = ["S", "H", "C", "D"];

export const buildDeck = (decks = 2): Card[] => {
  const result: Card[] = [];

  for (let deckNo = 1; deckNo <= decks; deckNo += 1) {
    for (const suit of suits) {
      for (const rank of normalRanks) {
        result.push({
          id: `${deckNo}-${suit}-${rank}`,
          suit,
          rank,
          isWildcard: false
        });
      }
    }

    result.push({
      id: `${deckNo}-JOKER-SJ`,
      suit: "JOKER",
      rank: "SJ",
      isWildcard: true
    });
    result.push({
      id: `${deckNo}-JOKER-BJ`,
      suit: "JOKER",
      rank: "BJ",
      isWildcard: true
    });
  }

  return result;
};

export const shuffleCards = (cards: Card[]): Card[] => {
  const cloned = [...cards];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cloned[i];
    cloned[i] = cloned[j];
    cloned[j] = tmp;
  }
  return cloned;
};
