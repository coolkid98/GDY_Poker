import { Client, Room } from "colyseus";
import { buildDeck, shuffleCards } from "../engine/deck.js";
import { RuleService } from "../engine/rule-service.js";
import { GdyState, PlayerState } from "./schema/gdy-state.js";
import type { Card, PassMessage, PlayCardsMessage } from "../types/game.js";
import { RedisService } from "../services/redis-service.js";
import { AuthService } from "../services/auth-service.js";

interface JoinOptions {
  nickname?: string;
  authToken?: string;
  userId?: string;
  reconnectToken?: string;
}

interface ReadyMessage {
  ready: boolean;
}

interface RoomCreateOptions {
  maxPlayers?: number;
  redisService?: RedisService;
  authService?: AuthService;
}

interface ReconnectSessionSnapshot {
  token: string;
  sessionId: string;
  seat: number;
  nickname: string;
  connected: boolean;
  updatedAt: number;
}

const IN_GAME_LEAVE_GRACE_MS = 120_000;

export class GdyRoom extends Room<GdyState> {
  private readonly ruleService = new RuleService();
  private readonly playerHands = new Map<string, string[]>();
  private deck: Card[] = [];
  private readonly processedActionIds = new Set<string>();
  private readonly reconnectTokenByUserId = new Map<string, string>();
  private readonly leaveGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private redisService: RedisService | null = null;
  private authService: AuthService | null = null;

  onCreate(options: RoomCreateOptions): void {
    const state = new GdyState();
    state.roomId = this.roomId;
    this.setState(state);

    this.redisService = options.redisService ?? null;
    this.authService = options.authService ?? null;
    this.maxClients = options.maxPlayers ?? this.ruleService.maxPlayers;

    this.onMessage("ready", (client, message: ReadyMessage) => {
      this.handleReady(client, message);
    });

    this.onMessage("play_cards", (client, message: PlayCardsMessage) => {
      void this.handlePlayCards(client, message);
    });

    this.onMessage("pass", (client, message: PassMessage) => {
      void this.handlePass(client, message);
    });

    this.onMessage("trustee_on", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }
      player.trustee = true;
      this.persistRoomSnapshot();
    });

    this.onMessage("trustee_off", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }
      player.trustee = false;
      this.persistRoomSnapshot();
    });

    this.onMessage("request_reconnect_token", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }
      this.sendReconnectToken(client, player);
    });

    this.persistRoomSnapshot();
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const authUser = await this.authService?.authenticateToken(options.authToken);
    if (!authUser) {
      throw new Error("UNAUTHORIZED");
    }

    const normalizedUserId = authUser.userId;
    const incomingNickname = options.nickname?.trim() || authUser.nickname || authUser.username;

    const existing = this.findPlayerByUserId(normalizedUserId);
    if (existing) {
      this.bindPlayerSession(existing.sessionId, existing.player, client, incomingNickname);
      this.sendReconnectToken(client, existing.player);
      this.syncRoomStatus();
      this.persistRoomSnapshot();
      return;
    }

    if (this.state.status === "PLAYING" || this.state.status === "DEALING") {
      throw new Error("GAME_IN_PROGRESS");
    }

    const seat = this.nextSeat();
    if (seat < 0) {
      throw new Error("ROOM_FULL");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.userId = normalizedUserId;
    player.nickname = incomingNickname || `Player-${seat + 1}`;
    player.seat = seat;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    this.state.seatOrder.push(client.sessionId);
    this.playerHands.set(client.sessionId, []);
    this.sendReconnectToken(client, player);

    this.syncRoomStatus();
    this.persistRoomSnapshot();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    player.connected = false;
    const inGame = this.isGameInProgress();
    if (inGame) {
      this.handlePlayerDisconnectedDuringGame(player.seat);
    }

    await this.persistReconnectSession(player);
    this.persistRoomSnapshot();

    if (consented) {
      if (inGame) {
        this.scheduleLeaveGrace(player.userId, client.sessionId);
        this.syncRoomStatus();
        this.persistRoomSnapshot();
        return;
      }

      this.removePlayer(client.sessionId);
      this.syncRoomStatus();
      this.persistRoomSnapshot();
      return;
    }

    if (inGame) {
      this.scheduleLeaveGrace(player.userId, client.sessionId);
    }

    try {
      await this.allowReconnection(client, 30);
      const rejoined = this.state.players.get(client.sessionId);
      if (rejoined) {
        rejoined.connected = true;
        this.clearLeaveGrace(rejoined.userId);
        await this.persistReconnectSession(rejoined);
      } else {
        const byUserId = this.findPlayerByUserId(player.userId);
        if (byUserId?.player.connected) {
          this.clearLeaveGrace(byUserId.player.userId);
          await this.persistReconnectSession(byUserId.player);
        }
      }
    } catch {
      const stillBound = this.state.players.get(client.sessionId);
      if (stillBound && !stillBound.connected) {
        if (!inGame) {
          await this.clearReconnectSession(stillBound.userId);
          this.removePlayer(client.sessionId);
        }
      }
    }

    this.syncRoomStatus();
    this.persistRoomSnapshot();
  }

  onDispose(): void {
    for (const player of this.state.players.values()) {
      void this.clearReconnectSession(player.userId);
    }
    this.reconnectTokenByUserId.clear();
    for (const timerId of this.leaveGraceTimers.values()) {
      clearTimeout(timerId);
    }
    this.leaveGraceTimers.clear();
    void this.redisService?.clearRoomSnapshot(this.roomId);
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
      client.send("action_result", {
        ok: false,
        reason: "GAME_ALREADY_STARTED"
      });
      return;
    }

    player.ready = Boolean(message?.ready);
    this.syncRoomStatus();
    this.persistRoomSnapshot();

    if (this.canStartGame()) {
      this.startGame();
    }
  }

  private async handlePlayCards(client: Client, message: PlayCardsMessage): Promise<void> {
    const actionValidation = await this.validateActionBase(client, message.actionId);
    if (!actionValidation.ok) {
      client.send("action_result", actionValidation);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send("action_result", { ok: false, reason: "PLAYER_NOT_FOUND" });
      return;
    }

    if (player.seat !== this.state.turnSeat) {
      client.send("action_result", { ok: false, reason: "NOT_YOUR_TURN" });
      return;
    }

    const ownedCards = this.playerHands.get(client.sessionId) ?? [];
    const cards = message.cards ?? [];
    if (cards.length === 0) {
      client.send("action_result", { ok: false, reason: "EMPTY_PLAY" });
      return;
    }

    const hasEveryCard = cards.every((id) => ownedCards.includes(id));
    if (!hasEveryCard) {
      client.send("action_result", { ok: false, reason: "CARD_NOT_OWNED" });
      return;
    }

    const validation = this.ruleService.validatePlay(
      {
        cards,
        declaredType: message.declaredType,
        declaredKey: message.declaredKey,
        lastPlay:
          this.state.lastPlay.cards.length === 0
            ? null
            : {
                cards: [...this.state.lastPlay.cards],
                declaredType: this.state.lastPlay.declaredType,
                declaredKey: this.state.lastPlay.declaredKey
              }
      }
    );

    if (!validation.ok || !validation.play) {
      client.send("action_result", validation);
      return;
    }

    const nextHand = ownedCards.filter((cardId) => !cards.includes(cardId));
    this.playerHands.set(client.sessionId, nextHand);
    player.handCount = nextHand.length;
    client.send("hand_sync", { cards: nextHand });

    this.setLastPlay(player.seat, cards, validation.play.type, validation.play.key);
    this.state.passCount = 0;

    this.broadcast("played", {
      seat: player.seat,
      cardsCount: cards.length,
      cards: [...cards],
      declaredType: validation.play.type,
      declaredKey: validation.play.key
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
    this.persistRoomSnapshot();
  }

  private async handlePass(client: Client, message: PassMessage): Promise<void> {
    const actionValidation = await this.validateActionBase(client, message.actionId);
    if (!actionValidation.ok) {
      client.send("action_result", actionValidation);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send("action_result", { ok: false, reason: "PLAYER_NOT_FOUND" });
      return;
    }

    if (player.seat !== this.state.turnSeat) {
      client.send("action_result", { ok: false, reason: "NOT_YOUR_TURN" });
      return;
    }

    const validation = this.ruleService.validatePass({
      isTableEmpty: this.state.lastPlay.cards.length === 0,
      currentTurnSeat: this.state.turnSeat
    });
    if (!validation.ok) {
      client.send("action_result", validation);
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
      this.persistRoomSnapshot();
      return;
    }

    const nextSeat = this.nextActiveSeat(player.seat);
    if (nextSeat >= 0) {
      this.state.turnSeat = nextSeat;
    }

    this.syncRoomStatus();
    this.persistRoomSnapshot();
  }

  private async validateActionBase(client: Client, actionId: string | undefined): Promise<{ ok: boolean; reason?: string }> {
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

    if (!this.state.players.has(client.sessionId)) {
      return {
        ok: false,
        reason: "PLAYER_NOT_IN_ROOM"
      };
    }

    const actionReserved = await this.reserveActionId(actionId);
    if (!actionReserved) {
      return {
        ok: false,
        reason: "DUPLICATE_ACTION"
      };
    }

    return { ok: true };
  }

  private async reserveActionId(actionId: string): Promise<boolean> {
    if (this.processedActionIds.has(actionId)) {
      return false;
    }

    if (this.processedActionIds.size >= 5000) {
      this.processedActionIds.clear();
    }
    this.processedActionIds.add(actionId);

    if (!this.redisService?.isEnabled()) {
      return true;
    }

    try {
      const reserved = await this.redisService.reserveActionId(this.roomId, actionId, 900);
      if (!reserved) {
        this.processedActionIds.delete(actionId);
      }
      return reserved;
    } catch {
      return true;
    }
  }

  private findPlayerByUserId(userId: string): { sessionId: string; player: PlayerState } | null {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.userId === userId) {
        return { sessionId, player };
      }
    }
    return null;
  }

  private bindPlayerSession(oldSessionId: string, player: PlayerState, client: Client, nickname: string): void {
    this.clearLeaveGrace(player.userId);
    player.sessionId = client.sessionId;
    player.connected = true;
    player.nickname = nickname;

    if (oldSessionId !== client.sessionId) {
      this.state.players.delete(oldSessionId);
      this.state.players.set(client.sessionId, player);

      const seatOrderIndex = this.state.seatOrder.findIndex((id) => id === oldSessionId);
      if (seatOrderIndex >= 0) {
        this.state.seatOrder.splice(seatOrderIndex, 1, client.sessionId);
      }

      const hand = this.playerHands.get(oldSessionId) ?? [];
      this.playerHands.delete(oldSessionId);
      this.playerHands.set(client.sessionId, hand);
      player.handCount = hand.length;
      client.send("hand_sync", { cards: hand });

      const oldClient = this.clients.find((item) => item.sessionId === oldSessionId);
      oldClient?.leave(4002);
    } else {
      const hand = this.playerHands.get(client.sessionId) ?? [];
      player.handCount = hand.length;
      client.send("hand_sync", { cards: hand });
    }
  }

  private issueReconnectToken(userId: string): string {
    const token =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.reconnectTokenByUserId.set(userId, token);
    return token;
  }

  private sendReconnectToken(client: Client, player: PlayerState): void {
    const reconnectToken = this.issueReconnectToken(player.userId);
    client.send("reconnect_token", {
      roomId: this.roomId,
      userId: player.userId,
      reconnectToken,
      sessionId: client.sessionId
    });
    void this.persistReconnectSession(player);
  }

  private async persistReconnectSession(player: PlayerState): Promise<void> {
    if (!this.redisService?.isEnabled()) {
      return;
    }

    const token = this.reconnectTokenByUserId.get(player.userId);
    if (!token) {
      return;
    }

    const payload: ReconnectSessionSnapshot = {
      token,
      sessionId: player.sessionId,
      seat: player.seat,
      nickname: player.nickname,
      connected: player.connected,
      updatedAt: Date.now()
    };

    try {
      await this.redisService.setReconnectSession(this.roomId, player.userId, payload, 600);
    } catch {
      // Redis down should not block the room lifecycle.
    }
  }

  private async clearReconnectSession(userId: string): Promise<void> {
    if (!this.redisService?.isEnabled()) {
      return;
    }
    try {
      await this.redisService.clearReconnectSession(this.roomId, userId);
    } catch {
      // Best effort cleanup.
    }
  }

  private persistRoomSnapshot(): void {
    if (!this.redisService?.isEnabled()) {
      return;
    }

    const snapshot = {
      roomId: this.roomId,
      status: this.state.status,
      dealerSeat: this.state.dealerSeat,
      turnSeat: this.state.turnSeat,
      deckCount: this.state.deckCount,
      passCount: this.state.passCount,
      seatOrder: [...this.state.seatOrder],
      lastPlay: {
        seat: this.state.lastPlay.seat,
        cards: [...this.state.lastPlay.cards],
        declaredType: this.state.lastPlay.declaredType,
        declaredKey: this.state.lastPlay.declaredKey
      },
      players: [...this.state.players.entries()].map(([sessionId, player]) => ({
        sessionId,
        userId: player.userId,
        nickname: player.nickname,
        seat: player.seat,
        connected: player.connected,
        ready: player.ready,
        trustee: player.trustee,
        handCount: player.handCount,
        score: player.score
      })),
      playerHands: Object.fromEntries([...this.playerHands.entries()].map(([sessionId, cards]) => [sessionId, [...cards]])),
      deck: [...this.deck],
      updatedAt: Date.now()
    };

    void this.redisService.setRoomSnapshot(this.roomId, snapshot, 1800).catch(() => {
      // Snapshot persistence is best-effort and must not break game flow.
    });
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
      client.send("hand_dealt", {
        cards: this.playerHands.get(client.sessionId) ?? []
      });
    }

    this.broadcast("game_started", {
      dealerSeat: this.state.dealerSeat,
      turnSeat: this.state.turnSeat
    });
    this.syncRoomStatus();
    this.persistRoomSnapshot();
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
    this.persistRoomSnapshot();
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
      client.send("draw_card", { cardId: card.id });
    }
    this.state.deckCount = this.deck.length;

    this.broadcast("player_drew", {
      seat,
      cardsCount: 1,
      deckCount: this.state.deckCount,
      handCount: hand.length
    });

    this.persistRoomSnapshot();
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
    const connected = players.filter((p) => p.connected);
    const connectedPlaying = connected.filter((p) => p.handCount > 0);
    if (connectedPlaying.length > 0) {
      return connectedPlaying;
    }
    if (connected.length > 0) {
      return connected;
    }
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
    const removed = this.state.players.get(sessionId);
    this.state.players.delete(sessionId);
    this.playerHands.delete(sessionId);

    const index = this.state.seatOrder.findIndex((id) => id === sessionId);
    if (index >= 0) {
      this.state.seatOrder.splice(index, 1);
    }

    if (removed) {
      this.clearLeaveGrace(removed.userId);
      this.reconnectTokenByUserId.delete(removed.userId);
      void this.clearReconnectSession(removed.userId);
    }

    if (this.state.players.size === 0) {
      this.state.status = "WAITING";
      this.state.dealerSeat = -1;
      this.state.turnSeat = -1;
      this.clearTable();
      void this.redisService?.clearRoomSnapshot(this.roomId);
      this.processedActionIds.clear();
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

  private isGameInProgress(): boolean {
    return this.state.status === "PLAYING" || this.state.status === "DEALING";
  }

  private handlePlayerDisconnectedDuringGame(seat: number): void {
    if (this.state.turnSeat !== seat) {
      return;
    }

    const nextSeat = this.nextActiveSeat(seat);
    if (nextSeat >= 0 && nextSeat !== seat) {
      this.state.turnSeat = nextSeat;
    }
  }

  private scheduleLeaveGrace(userId: string, sessionId: string): void {
    this.clearLeaveGrace(userId);
    const timerId = setTimeout(() => {
      const existing = this.findPlayerByUserId(userId);
      if (!existing) {
        return;
      }
      if (existing.sessionId !== sessionId || existing.player.connected) {
        return;
      }
      this.removePlayer(existing.sessionId);
      this.syncRoomStatus();
      this.persistRoomSnapshot();
    }, IN_GAME_LEAVE_GRACE_MS);
    this.leaveGraceTimers.set(userId, timerId);
  }

  private clearLeaveGrace(userId: string): void {
    const timerId = this.leaveGraceTimers.get(userId);
    if (!timerId) {
      return;
    }
    clearTimeout(timerId);
    this.leaveGraceTimers.delete(userId);
  }
}
