import type {
  CardRank,
  CardSuit,
  LastPlaySnapshot,
  ParsedPlayResult,
  PatternType,
  PlayContext,
  PlayValidationInput,
  PlayValidationResult,
  ValidationResult
} from "../types/game.js";

type MainRank = Exclude<CardRank, "SJ" | "BJ">;
type StraightRank = Exclude<MainRank, "2">;

interface ParsedCardId {
  id: string;
  deckNo: number;
  suit: CardSuit;
  rank: CardRank;
  wildcard: boolean;
}

const NORMAL_RANKS: MainRank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const STRAIGHT_RANKS: StraightRank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const PATTERN_TYPES: PatternType[] = ["single", "pair", "straight", "bomb"];

const normalRankIndex = new Map<MainRank, number>(NORMAL_RANKS.map((rank, index) => [rank, index]));
const straightRankIndex = new Map<StraightRank, number>(STRAIGHT_RANKS.map((rank, index) => [rank, index]));

const toMainRank = (input?: string): MainRank | null => {
  if (!input) {
    return null;
  }
  const normalized = input.trim().toUpperCase();
  if (normalized === "10") {
    return "10";
  }
  return (NORMAL_RANKS.find((rank) => rank === normalized) as MainRank | undefined) ?? null;
};

const toStraightRank = (input?: string): StraightRank | null => {
  const rank = toMainRank(input);
  if (!rank || rank === "2") {
    return null;
  }
  return rank;
};

const toPatternType = (input?: string): PatternType | null => {
  if (!input) {
    return null;
  }
  const normalized = input.trim().toLowerCase();
  return (PATTERN_TYPES.find((type) => type === normalized) as PatternType | undefined) ?? null;
};

export class RuleService {
  readonly maxPlayers = 10;
  readonly dealerInitialCards = 6;
  readonly playerInitialCards = 5;

  getInitialCardCount(seat: number, dealerSeat: number): number {
    return seat === dealerSeat ? this.dealerInitialCards : this.playerInitialCards;
  }

  validatePass(playContext: PlayContext): ValidationResult {
    if (playContext.isTableEmpty) {
      return {
        ok: false,
        reason: "TABLE_EMPTY_CANNOT_PASS"
      };
    }
    return { ok: true };
  }

  validatePlay(input: PlayValidationInput): PlayValidationResult {
    if (input.cards.length === 0) {
      return {
        ok: false,
        reason: "EMPTY_PLAY"
      };
    }

    const current = this.evaluatePlay(input.cards, input.declaredType, input.declaredKey);
    if (!current.ok || !current.play) {
      return current;
    }

    if (!input.lastPlay) {
      return current;
    }

    const previous = this.evaluateLastPlay(input.lastPlay);
    if (!previous.ok || !previous.play) {
      return {
        ok: false,
        reason: "LAST_PLAY_INVALID"
      };
    }

    if (!this.canBeat(current.play, previous.play)) {
      return {
        ok: false,
        reason: "CANNOT_BEAT_LAST_PLAY"
      };
    }

    return current;
  }

  settleWinner(remainCardsBySeat: Map<number, number>, winnerSeat: number): Map<number, number> {
    let winnerScore = 0;
    const scores = new Map<number, number>();

    for (const [seat, remain] of remainCardsBySeat.entries()) {
      if (seat === winnerSeat) {
        continue;
      }
      const loseScore = -remain;
      scores.set(seat, loseScore);
      winnerScore += remain;
    }

    scores.set(winnerSeat, winnerScore);
    return scores;
  }

  private evaluateLastPlay(lastPlay: LastPlaySnapshot): PlayValidationResult {
    return this.evaluatePlay(lastPlay.cards, lastPlay.declaredType, lastPlay.declaredKey, true);
  }

  private evaluatePlay(cards: string[], declaredType?: string, declaredKey?: string, fromLastPlay = false): PlayValidationResult {
    const parsedCards: ParsedCardId[] = [];
    for (const cardId of cards) {
      const parsed = this.parseCardId(cardId);
      if (!parsed) {
        return { ok: false, reason: "INVALID_CARD_ID" };
      }
      parsedCards.push(parsed);
    }

    const wildcardCards = parsedCards.filter((card) => card.wildcard);
    const nonWildcardCards = parsedCards.filter((card) => !card.wildcard);
    const hasWildcard = wildcardCards.length > 0;

    const type = toPatternType(declaredType);
    const key = toMainRank(declaredKey);
    const wildcards = wildcardCards.length;
    const counts = this.countRanks(nonWildcardCards.map((card) => card.rank as MainRank));

    if (hasWildcard && (!type || !key)) {
      return {
        ok: false,
        reason: "WILDCARD_DECLARE_REQUIRED"
      };
    }

    if (type) {
      const declared = this.validateDeclaredPattern(type, key, cards.length, counts, wildcards);
      if (!declared.ok) {
        return declared;
      }
      return {
        ok: true,
        play: declared.play
      };
    }

    if (hasWildcard && !fromLastPlay) {
      return {
        ok: false,
        reason: "WILDCARD_DECLARE_REQUIRED"
      };
    }

    return this.inferNaturalPattern(nonWildcardCards.map((card) => card.rank as MainRank));
  }

  private inferNaturalPattern(ranks: MainRank[]): PlayValidationResult {
    const len = ranks.length;
    if (len === 0) {
      return { ok: false, reason: "EMPTY_PLAY" };
    }

    if (len === 1) {
      return {
        ok: true,
        play: {
          type: "single",
          key: ranks[0],
          length: 1,
          usedWildcards: 0
        }
      };
    }

    if (this.isAllSame(ranks) && len === 2) {
      return {
        ok: true,
        play: {
          type: "pair",
          key: ranks[0],
          length: 2,
          usedWildcards: 0
        }
      };
    }

    if (this.isAllSame(ranks) && (len === 3 || len === 4)) {
      return {
        ok: true,
        play: {
          type: "bomb",
          key: ranks[0],
          length: len,
          bombSize: len as 3 | 4,
          usedWildcards: 0
        }
      };
    }

    const straight = this.detectStraight(ranks);
    if (straight) {
      return {
        ok: true,
        play: {
          type: "straight",
          key: straight.high,
          length: straight.length,
          usedWildcards: 0
        }
      };
    }

    return {
      ok: false,
      reason: "UNKNOWN_PATTERN"
    };
  }

  private validateDeclaredPattern(
    type: PatternType,
    key: MainRank | null,
    length: number,
    counts: Map<MainRank, number>,
    wildcardCount: number
  ): PlayValidationResult {
    if (!key) {
      return {
        ok: false,
        reason: "MISSING_DECLARED_KEY"
      };
    }

    if (type === "single") {
      if (length !== 1) {
        return { ok: false, reason: "INVALID_SINGLE_LENGTH" };
      }
      if (!this.canFormCount(counts, key, 1, wildcardCount)) {
        return { ok: false, reason: "INVALID_DECLARED_KEY" };
      }
      return {
        ok: true,
        play: {
          type: "single",
          key,
          length,
          usedWildcards: wildcardCount
        }
      };
    }

    if (type === "pair") {
      if (length !== 2) {
        return { ok: false, reason: "INVALID_PAIR_LENGTH" };
      }
      if (!this.canFormCount(counts, key, 2, wildcardCount)) {
        return { ok: false, reason: "INVALID_DECLARED_KEY" };
      }
      return {
        ok: true,
        play: {
          type: "pair",
          key,
          length,
          usedWildcards: wildcardCount
        }
      };
    }

    if (type === "bomb") {
      if (length !== 3 && length !== 4) {
        return { ok: false, reason: "INVALID_BOMB_LENGTH" };
      }
      if (!this.canFormCount(counts, key, length, wildcardCount)) {
        return { ok: false, reason: "INVALID_DECLARED_KEY" };
      }
      return {
        ok: true,
        play: {
          type: "bomb",
          key,
          length,
          bombSize: length as 3 | 4,
          usedWildcards: wildcardCount
        }
      };
    }

    if (type === "straight") {
      const straightKey = toStraightRank(key);
      if (!straightKey) {
        return { ok: false, reason: "STRAIGHT_KEY_INVALID" };
      }
      if (length < 3) {
        return { ok: false, reason: "STRAIGHT_TOO_SHORT" };
      }
      const straight = this.canFormStraight(straightKey, length, counts, wildcardCount);
      if (!straight) {
        return { ok: false, reason: "INVALID_STRAIGHT" };
      }
      return {
        ok: true,
        play: {
          type: "straight",
          key: straightKey,
          length,
          usedWildcards: wildcardCount
        }
      };
    }

    return { ok: false, reason: "UNKNOWN_PATTERN" };
  }

  private canBeat(current: ParsedPlayResult, previous: ParsedPlayResult): boolean {
    if (current.type === "bomb") {
      if (previous.type !== "bomb") {
        return true;
      }
      if (!current.bombSize || !previous.bombSize) {
        return false;
      }
      if (current.bombSize !== previous.bombSize) {
        return current.bombSize === 4 && previous.bombSize === 3;
      }
      return this.compareNormalRank(current.key, previous.key) > 0;
    }

    if (previous.type === "bomb") {
      return false;
    }

    if (current.type !== previous.type) {
      return false;
    }

    if (current.type === "straight") {
      if (current.length !== previous.length) {
        return false;
      }
      return this.compareStraightRank(current.key, previous.key) === 1;
    }

    const previousIndex = normalRankIndex.get(previous.key as MainRank);
    const currentIndex = normalRankIndex.get(current.key as MainRank);
    if (previousIndex === undefined || currentIndex === undefined) {
      return false;
    }

    if (current.key === "2" && previous.key !== "2") {
      return true;
    }
    return currentIndex === previousIndex + 1;
  }

  private compareNormalRank(a: string, b: string): number {
    const ia = normalRankIndex.get(a as MainRank);
    const ib = normalRankIndex.get(b as MainRank);
    if (ia === undefined || ib === undefined) {
      return 0;
    }
    return ia - ib;
  }

  private compareStraightRank(a: string, b: string): number {
    const ia = straightRankIndex.get(a as StraightRank);
    const ib = straightRankIndex.get(b as StraightRank);
    if (ia === undefined || ib === undefined) {
      return 0;
    }
    return ia - ib;
  }

  private canFormCount(
    counts: Map<MainRank, number>,
    target: MainRank,
    need: number,
    wildcards: number
  ): boolean {
    let fixedCount = 0;
    const consumedRanks: MainRank[] = [];
    for (const [rank, count] of counts.entries()) {
      if (rank === target) {
        fixedCount = count;
      } else if (count > 0) {
        consumedRanks.push(rank);
      }
    }

    if (consumedRanks.length > 0) {
      return false;
    }
    return fixedCount + wildcards >= need;
  }

  private canFormStraight(
    highest: StraightRank,
    length: number,
    counts: Map<MainRank, number>,
    wildcards: number
  ): boolean {
    const highIndex = straightRankIndex.get(highest);
    if (highIndex === undefined) {
      return false;
    }
    const lowIndex = highIndex - length + 1;
    if (lowIndex < 0) {
      return false;
    }

    const needed = STRAIGHT_RANKS.slice(lowIndex, highIndex + 1);

    for (const [rank, count] of counts.entries()) {
      if (count === 0) {
        continue;
      }
      if (rank === "2" || !needed.includes(rank as StraightRank)) {
        return false;
      }
      if (count > 1) {
        return false;
      }
    }

    const missingCount = needed.filter((rank) => (counts.get(rank as MainRank) ?? 0) === 0).length;
    return missingCount <= wildcards;
  }

  private detectStraight(ranks: MainRank[]): { high: StraightRank; length: number } | null {
    if (ranks.length < 3) {
      return null;
    }

    if (ranks.includes("2")) {
      return null;
    }

    const unique = new Set(ranks);
    if (unique.size !== ranks.length) {
      return null;
    }

    const sorted = [...ranks].sort(
      (a, b) => (straightRankIndex.get(a as StraightRank) ?? -999) - (straightRankIndex.get(b as StraightRank) ?? -999)
    ) as StraightRank[];

    for (let i = 1; i < sorted.length; i += 1) {
      const prev = straightRankIndex.get(sorted[i - 1]);
      const curr = straightRankIndex.get(sorted[i]);
      if (prev === undefined || curr === undefined || curr !== prev + 1) {
        return null;
      }
    }

    return {
      high: sorted[sorted.length - 1],
      length: sorted.length
    };
  }

  private isAllSame(ranks: MainRank[]): boolean {
    if (ranks.length === 0) {
      return false;
    }
    const first = ranks[0];
    return ranks.every((rank) => rank === first);
  }

  private countRanks(ranks: MainRank[]): Map<MainRank, number> {
    const counts = new Map<MainRank, number>();
    for (const rank of ranks) {
      counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }
    return counts;
  }

  private parseCardId(cardId: string): ParsedCardId | null {
    const parts = cardId.split("-");
    if (parts.length !== 3) {
      return null;
    }

    const deckNo = Number(parts[0]);
    const suit = parts[1] as CardSuit;
    const rank = parts[2] as CardRank;

    if (!Number.isInteger(deckNo) || deckNo <= 0) {
      return null;
    }

    const isJokerSuit = suit === "JOKER";
    const isJokerRank = rank === "SJ" || rank === "BJ";
    const wildcard = isJokerSuit || isJokerRank;

    if (wildcard) {
      if (!(isJokerSuit && isJokerRank)) {
        return null;
      }
      return {
        id: cardId,
        deckNo,
        suit,
        rank,
        wildcard
      };
    }

    const isMainSuit = suit === "S" || suit === "H" || suit === "C" || suit === "D";
    const isMainRank = NORMAL_RANKS.includes(rank as MainRank);
    if (!isMainSuit || !isMainRank) {
      return null;
    }

    return {
      id: cardId,
      deckNo,
      suit,
      rank,
      wildcard
    };
  }
}
