import { Redis } from "ioredis";

export class RedisService {
  private client: Redis | null = null;
  private enabled = false;

  private roomStateKey(roomId: string): string {
    return `gdy:room:${roomId}:state`;
  }

  private roomReconnectKey(roomId: string, userId: string): string {
    return `gdy:room:${roomId}:reconnect:${userId}`;
  }

  private roomActionKey(roomId: string, actionId: string): string {
    return `gdy:room:${roomId}:action:${actionId}`;
  }

  private authUserByNameKey(username: string): string {
    return `gdy:auth:user:name:${username}`;
  }

  private authUserByIdKey(userId: string): string {
    return `gdy:auth:user:id:${userId}`;
  }

  async connect(redisUrl: string): Promise<void> {
    if (!redisUrl) {
      return;
    }

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3
    });

    await this.client.connect();
    this.enabled = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setRoomSnapshot(roomId: string, payload: unknown, ttlSeconds = 1800): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.set(this.roomStateKey(roomId), JSON.stringify(payload), "EX", ttlSeconds);
  }

  async getRoomSnapshot<T>(roomId: string): Promise<T | null> {
    if (!this.client) {
      return null;
    }

    const payload = await this.client.get(this.roomStateKey(roomId));
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  }

  async clearRoomSnapshot(roomId: string): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.del(this.roomStateKey(roomId));
  }

  async setReconnectSession(roomId: string, userId: string, payload: unknown, ttlSeconds = 600): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.set(this.roomReconnectKey(roomId, userId), JSON.stringify(payload), "EX", ttlSeconds);
  }

  async getReconnectSession<T>(roomId: string, userId: string): Promise<T | null> {
    if (!this.client) {
      return null;
    }

    const payload = await this.client.get(this.roomReconnectKey(roomId, userId));
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  }

  async clearReconnectSession(roomId: string, userId: string): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.del(this.roomReconnectKey(roomId, userId));
  }

  async reserveActionId(roomId: string, actionId: string, ttlSeconds = 900): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    const result = await this.client.set(this.roomActionKey(roomId, actionId), "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async createAuthUserByUsername(username: string, payload: unknown): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    const result = await this.client.set(this.authUserByNameKey(username), JSON.stringify(payload), "NX");
    return result === "OK";
  }

  async getAuthUserByUsername<T>(username: string): Promise<T | null> {
    if (!this.client) {
      return null;
    }

    const payload = await this.client.get(this.authUserByNameKey(username));
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  }

  async setAuthUserById(userId: string, payload: unknown): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.set(this.authUserByIdKey(userId), JSON.stringify(payload));
  }

  async getAuthUserById<T>(userId: string): Promise<T | null> {
    if (!this.client) {
      return null;
    }

    const payload = await this.client.get(this.authUserByIdKey(userId));
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.quit();
    this.client = null;
    this.enabled = false;
  }
}
