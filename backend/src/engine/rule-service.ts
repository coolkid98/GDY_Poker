import type { PlayContext, ValidationResult } from "../types/game.js";

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

  validatePlay(playContext: PlayContext, cards: string[]): ValidationResult {
    if (cards.length === 0) {
      return {
        ok: false,
        reason: "EMPTY_PLAY"
      };
    }

    if (playContext.isTableEmpty) {
      return { ok: true };
    }

    return { ok: true };
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
}
