import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { GameStatus } from "../../types/game.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") userId = "";
  @type("string") nickname = "";
  @type("number") seat = -1;
  @type("boolean") connected = true;
  @type("boolean") ready = false;
  @type("boolean") trustee = false;
  @type("number") handCount = 0;
  @type("number") score = 0;
}

export class LastPlayState extends Schema {
  @type("number") seat = -1;
  @type(["string"]) cards = new ArraySchema<string>();
  @type("string") declaredType = "";
  @type("string") declaredKey = "";
}

export class GdyState extends Schema {
  @type("string") roomId = "";
  @type("string") status: GameStatus = "WAITING";
  @type("number") dealerSeat = -1;
  @type("number") turnSeat = -1;
  @type("number") deckCount = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(["string"]) seatOrder = new ArraySchema<string>();
  @type(LastPlayState) lastPlay = new LastPlayState();
  @type("number") passCount = 0;
}
