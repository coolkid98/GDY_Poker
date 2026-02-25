import { Redis } from "ioredis";

export class RedisService {
  private client: Redis | null = null;
  private enabled = false;

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

  async setRoomSnapshot(roomId: string, payload: unknown): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.set(`gdy:room:${roomId}:state`, JSON.stringify(payload), "EX", 300);
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
