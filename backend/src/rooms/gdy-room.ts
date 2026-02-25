import { Client, Room } from "colyseus";
import { buildDeck, shuffleCards } from "../engine/deck.js";
import { RuleService } from "../engine/rule-service.js";
import { GdyState, PlayerState } from "./schema/gdy-state.js";
import type { Card, PassMessage, PlayCardsMessage } from "../types/game.js";

interface JoinOptions {
  userId?: string;
  nickname?: string;
}

interface ReadyMessage {
  ready: boolean;
}

export class GdyRoom extends Room<GdyState> {
  private readonly ruleService = new RuleService();
  private readonly playerHands = new Map<string, string[]>();
  private deck: Card[] = [];
  private readonly processedActionIds = new Set<string>();

  onCreate(options: { maxPlayers?: number }): void {
    const state = new GdyState();
    state.roomId = this.roomId;
    this.setState(state);

    this.maxClients = options.maxPlayers ?? this.ruleService.maxPlayers;

    this.onMessage("ready", (client, message: ReadyMessage) => {
      this.handleReady(client, message);
    });

    this.onMessage("play_cards", (client, message: PlayCardsMessage) => {
      this.handlePlayCards(client, message);
    });

    this.onMessage("pass", (client, message: PassMessage) => {
      this.handlePass(client, message);
    });

    this.onMessage("trustee_on", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }
      player.trustee = true;
    });

    this.onMessage("trustee_off", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }
      player.trustee = false;
    });
  }

  onJoin(client: Client, options: JoinOptions): void {
    if (this.state.status === "PLAYING" || this.state.status === "DEALING") {
      throw new Error("GAME_IN_PROGRESS");
    }

    const seat = this.nextSeat();
    if (seat < 0) {
      throw new Error("ROOM_FULL");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.userId = options.userId ?? client.sessionId;
    player.nickname = options.nickname ?? `Player-${seat + 1}`;
    player.seat = seat;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    this.state.seatOrder.push(client.sessionId);
    this.playerHands.set(client.sessionId, []);

    this.syncRoomStatus();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    player.connected = false;

    if (consented) {
      this.removePlayer(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, 30);
      const rejoined = this.state.players.get(client.sessionId);
      if (rejoined) {
        rejoined.connected = true;
      }
    } catch {
      this.removePlayer(client.sessionId);
    }

    this.syncRoomStatus();
  }

  onDispose(): void {
    this.playerHands.clear();
    this.deck = [];
    this.processedActionIds.clear();
  }

  private handleReady(client: Client, message: ReadyMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    if (this.state.status === "PLAYING") {
      this.send(client, "action_result", {
        ok: false,
        reason: "GAME_ALREADY_STARTED"
      });
      return;
    }

    player.ready = Boolean(message?.ready);
    this.syncRoomStatus();

    if (this.canStartGame()) {
      this.startGame();
    }
  }

  private handlePlayCards(client: Client, message: PlayCardsMessage): void {
    const actionValidation = this.validateActionBase(client, message.actionId);
    if (!actionValidation.ok) {
      this.send(client, "action_result", actionValidation);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      this.send(client, "action_result", { ok: false, reason: "PLAYER_NOT_FOUND" });
      return;
    }

    if (player.seat !== this.state.turnSeat) {
      this.send(client, "action_result", { ok: false, reason: "NOT_YOUR_TURN" });
      return;
    }

    const ownedCards = this.playerHands.get(client.sessionId) ?? [];
    const cards = message.cards ?? [];
    if (cards.length === 0) {
      this.send(client, "action_result", { ok: false, reason: "EMPTY_PLAY" });
      return;
    }

    const hasEveryCard = cards.every((id) => ownedCards.includes(id));
    if (!hasEveryCard) {
      this.send(client, "action_result", { ok: false, reason: "CARD_NOT_OWNED" });
      return;
    }

    const validation = this.ruleService.validatePlay(
      {
        isTableEmpty: this.state.lastPlay.cards.length === 0,
        currentTurnSeat: this.state.turnSeat
      },
      cards
    );

    if (!validation.ok) {
      this.send(client, "action_result", validation);
      return;
    }

    const nextHand = ownedCards.filter((cardId) => !cards.includes(cardId));
    this.playerHands.set(client.sessionId, nextHand);
    player.handCount = nextHand.length;
    this.send(client, "hand_sync", { cards: nextHand });

    this.setLastPlay(player.seat, cards, message.declaredType ?? "", message.declaredKey ?? "");
    this.state.passCount = 0;

    this.broadcast("played", {
      seat: player.seat,
      cardsCount: cards.length,
      declaredType: message.declaredType ?? "",
      declaredKey: message.declaredKey ?? ""
    });

    if (player.handCount === 0) {
      this.finishGame(player.seat);
      return;
    }

    const nextSeat = this.nextActiveSeat(player.seat);
    if (nextSeat >= 0) {
      this.state.turnSeat = nextSeat;
    }

    this.syncRoomStatus();
  }

  private handlePass(client: Client, message: PassMessage): void {
    const actionValidation = this.validateActionBase(client, message.actionId);
    if (!actionValidation.ok) {
      this.send(client, "action_result", actionValidation);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      this.send(client, "action_result", { ok: false, reason: "PLAYER_NOT_FOUND" });
      return;
    }

    if (player.seat !== this.state.turnSeat) {
      this.send(client, "action_result", { ok: false, reason: "NOT_YOUR_TURN" });
      return;
    }

    const validation = this.ruleService.validatePass({
      isTableEmpty: this.state.lastPlay.cards.length === 0,
      currentTurnSeat: this.state.turnSeat
    });
    if (!validation.ok) {
      this.send(client, "action_result", validation);
      return;
    }

    this.state.passCount += 1;
    this.broadcast("passed", {
      seat: player.seat,
      passCount: this.state.passCount
    });

    const activeCount = this.activePlayers().length;
    if (activeCount > 1 && this.state.passCount >= activeCount - 1 && this.state.lastPlay.seat >= 0) {
      const lastSeat = this.state.lastPlay.seat;
      this.drawOneForSeat(lastSeat);
      this.state.turnSeat = lastSeat;
      this.clearTable();
      this.broadcast("round_reset", { turnSeat: lastSeat });
      this.syncRoomStatus();
      return;
    }

    const nextSeat = this.nextActiveSeat(player.seat);
    if (nextSeat >= 0) {
      this.state.turnSeat = nextSeat;
    }

    this.syncRoomStatus();
  }

  private validateActionBase(client: Client, actionId: string | undefined): { ok: boolean; reason?: string } {
    if (this.state.status !== "PLAYING") {
      return {
        ok: false,
        reason: "GAME_NOT_PLAYING"
      };
    }

    if (!actionId) {
      return {
        ok: false,
        reason: "MISSING_ACTION_ID"
      };
    }

    if (this.processedActionIds.has(actionId)) {
      return {
        ok: false,
        reason: "DUPLICATE_ACTION"
      };
    }

    if (!this.state.players.has(client.sessionId)) {
      return {
        ok: false,
        reason: "PLAYER_NOT_IN_ROOM"
      };
    }

    this.processedActionIds.add(actionId);
    if (this.processedActionIds.size > 5000) {
      this.processedActionIds.clear();
    }

    return { ok: true };
  }

  private canStartGame(): boolean {
    const players = [...this.state.players.values()];
    if (players.length < 2) {
      return false;
    }
    return players.every((p) => p.ready);
  }

  private startGame(): void {
    this.state.status = "DEALING";
    this.deck = shuffleCards(buildDeck(2));
    this.clearTable();

    if (this.state.dealerSeat < 0) {
      const seats = [...this.state.players.values()]
        .map((p) => p.seat)
        .sort((a, b) => a - b);
      this.state.dealerSeat = seats[Math.floor(Math.random() * seats.length)] ?? 0;
    }

    for (const player of this.state.players.values()) {
      const need = this.ruleService.getInitialCardCount(player.seat, this.state.dealerSeat);
      const hand: string[] = [];
      for (let i = 0; i < need; i += 1) {
        const card = this.deck.shift();
        if (!card) {
          break;
        }
        hand.push(card.id);
      }
      this.playerHands.set(player.sessionId, hand);
      player.handCount = hand.length;
      player.ready = false;
    }

    this.state.deckCount = this.deck.length;
    this.state.turnSeat = this.state.dealerSeat;
    this.state.status = "PLAYING";

    for (const client of this.clients) {
      this.send(client, "hand_dealt", {
        cards: this.playerHands.get(client.sessionId) ?? []
      });
    }

    this.broadcast("game_started", {
      dealerSeat: this.state.dealerSeat,
      turnSeat: this.state.turnSeat
    });
    this.syncRoomStatus();
  }

  private finishGame(winnerSeat: number): void {
    this.state.status = "SETTLING";

    const remainCards = new Map<number, number>();
    for (const player of this.state.players.values()) {
      remainCards.set(player.seat, player.handCount);
    }

    const scoreDelta = this.ruleService.settleWinner(remainCards, winnerSeat);
    for (const player of this.state.players.values()) {
      const delta = scoreDelta.get(player.seat) ?? 0;
      player.score += delta;
    }

    this.broadcast("settlement", {
      winnerSeat,
      scoreDelta: [...scoreDelta.entries()]
    });

    this.state.dealerSeat = winnerSeat;
    this.state.status = "READY";
    for (const player of this.state.players.values()) {
      player.ready = false;
      player.handCount = 0;
    }
    this.playerHands.clear();
    this.deck = [];
    this.clearTable();
    this.state.turnSeat = this.state.dealerSeat;
    this.syncRoomStatus();
  }

  private drawOneForSeat(seat: number): void {
    if (this.deck.length === 0) {
      return;
    }
    const sessionId = this.sessionIdBySeat(seat);
    if (!sessionId) {
      return;
    }
    const card = this.deck.shift();
    if (!card) {
      return;
    }

    const hand = this.playerHands.get(sessionId) ?? [];
    hand.push(card.id);
    this.playerHands.set(sessionId, hand);

    const player = this.state.players.get(sessionId);
    if (player) {
      player.handCount = hand.length;
    }

    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      this.send(client, "draw_card", { cardId: card.id });
    }
    this.state.deckCount = this.deck.length;
  }

  private clearTable(): void {
    this.setLastPlay(-1, [], "", "");
    this.state.passCount = 0;
  }

  private setLastPlay(seat: number, cards: string[], declaredType: string, declaredKey: string): void {
    this.state.lastPlay.seat = seat;
    this.state.lastPlay.cards.splice(0, this.state.lastPlay.cards.length);
    for (const cardId of cards) {
      this.state.lastPlay.cards.push(cardId);
    }
    this.state.lastPlay.declaredType = declaredType;
    this.state.lastPlay.declaredKey = declaredKey;
  }

  private activePlayers(): PlayerState[] {
    const players = [...this.state.players.values()];
    const playing = players.filter((p) => p.handCount > 0);
    return playing.length > 0 ? playing : players;
  }

  private nextSeat(): number {
    const occupied = new Set<number>();
    for (const player of this.state.players.values()) {
      occupied.add(player.seat);
    }

    for (let seat = 0; seat < this.maxClients; seat += 1) {
      if (!occupied.has(seat)) {
        return seat;
      }
    }
    return -1;
  }

  private nextActiveSeat(currentSeat: number): number {
    const seats = this.activePlayers()
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    if (seats.length === 0) {
      return -1;
    }

    for (const seat of seats) {
      if (seat > currentSeat) {
        return seat;
      }
    }
    return seats[0];
  }

  private sessionIdBySeat(seat: number): string | undefined {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.seat === seat) {
        return sessionId;
      }
    }
    return undefined;
  }

  private removePlayer(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.playerHands.delete(sessionId);

    const index = this.state.seatOrder.findIndex((id) => id === sessionId);
    if (index >= 0) {
      this.state.seatOrder.splice(index, 1);
    }

    if (this.state.players.size === 0) {
      this.state.status = "WAITING";
      this.state.dealerSeat = -1;
      this.state.turnSeat = -1;
      this.clearTable();
    }
  }

  private syncRoomStatus(): void {
    if (this.state.players.size === 0) {
      this.state.status = "WAITING";
      return;
    }

    if (this.state.status === "WAITING") {
      this.state.status = "READY";
    }
  }
}
