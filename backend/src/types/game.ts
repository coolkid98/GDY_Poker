export type GameStatus = "WAITING" | "READY" | "DEALING" | "PLAYING" | "SETTLING" | "CLOSED";

export type PatternType = "single" | "pair" | "straight" | "bomb";

export type CardSuit = "S" | "H" | "C" | "D" | "JOKER";

export type CardRank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "SJ"
  | "BJ";

export interface Card {
  id: string;
  suit: CardSuit;
  rank: CardRank;
  isWildcard: boolean;
}

export interface PlayCardsMessage {
  actionId: string;
  seq: number;
  cards: string[];
  declaredType?: PatternType;
  declaredKey?: string;
}

export interface PassMessage {
  actionId: string;
  seq: number;
}

export interface PlayContext {
  isTableEmpty: boolean;
  currentTurnSeat: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface LastPlaySnapshot {
  cards: string[];
  declaredType: string;
  declaredKey: string;
}

export interface PlayValidationInput {
  cards: string[];
  declaredType?: string;
  declaredKey?: string;
  lastPlay: LastPlaySnapshot | null;
}

export interface ParsedPlayResult {
  type: PatternType;
  key: string;
  length: number;
  bombSize?: 3 | 4;
  usedWildcards: number;
}

export interface PlayValidationResult extends ValidationResult {
  play?: ParsedPlayResult;
}
