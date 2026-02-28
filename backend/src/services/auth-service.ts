import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { RedisService } from "./redis-service.js";

export interface AuthUserPublic {
  userId: string;
  username: string;
  nickname: string;
}

interface AuthUserRecord extends AuthUserPublic {
  passwordHash: string;
  createdAt: number;
}

interface TokenClaims {
  sub: string;
  username: string;
  nickname: string;
}

interface RegisterInput {
  username: string;
  password: string;
  nickname?: string;
}

interface LoginInput {
  username: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: AuthUserPublic;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly usersByUsername = new Map<string, AuthUserRecord>();
  private readonly usersById = new Map<string, AuthUserRecord>();

  constructor(
    private readonly redisService: RedisService,
    private readonly jwtSecret: string
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const username = this.normalizeUsername(input.username);
    const password = this.normalizePassword(input.password);
    const nickname = this.normalizeNickname(input.nickname, username);
    this.validateUsername(username);
    this.validatePassword(password);
    this.validateNickname(nickname);

    const existing = await this.getUserByUsername(username);
    if (existing) {
      throw new AuthError(409, "USERNAME_EXISTS", "用户名已存在");
    }

    const record: AuthUserRecord = {
      userId: randomUUID(),
      username,
      nickname,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: Date.now()
    };

    if (this.redisService.isEnabled()) {
      const created = await this.redisService.createAuthUserByUsername(username, record);
      if (!created) {
        throw new AuthError(409, "USERNAME_EXISTS", "用户名已存在");
      }
      await this.redisService.setAuthUserById(record.userId, record);
    } else {
      this.usersByUsername.set(username, record);
      this.usersById.set(record.userId, record);
    }

    return this.toAuthResult(record);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const username = this.normalizeUsername(input.username);
    const password = this.normalizePassword(input.password);
    this.validateUsername(username);
    this.validatePassword(password);

    const user = await this.getUserByUsername(username);
    if (!user) {
      throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    return this.toAuthResult(user);
  }

  async authenticateToken(token: string | undefined): Promise<AuthUserPublic | null> {
    if (!token) {
      return null;
    }

    let decoded: jwt.JwtPayload | string;
    try {
      decoded = jwt.verify(token, this.jwtSecret);
    } catch {
      return null;
    }

    if (typeof decoded === "string" || !decoded.sub) {
      return null;
    }

    const userId = String(decoded.sub);
    const user = await this.getUserById(userId);
    if (!user) {
      return null;
    }

    return {
      userId: user.userId,
      username: user.username,
      nickname: user.nickname
    };
  }

  private async getUserByUsername(username: string): Promise<AuthUserRecord | null> {
    if (this.redisService.isEnabled()) {
      const redisUser = await this.redisService.getAuthUserByUsername<AuthUserRecord>(username);
      if (redisUser) {
        this.usersByUsername.set(username, redisUser);
        this.usersById.set(redisUser.userId, redisUser);
        return redisUser;
      }
      return null;
    }
    return this.usersByUsername.get(username) ?? null;
  }

  private async getUserById(userId: string): Promise<AuthUserRecord | null> {
    if (this.redisService.isEnabled()) {
      const redisUser = await this.redisService.getAuthUserById<AuthUserRecord>(userId);
      if (redisUser) {
        this.usersByUsername.set(redisUser.username, redisUser);
        this.usersById.set(redisUser.userId, redisUser);
        return redisUser;
      }
      return null;
    }
    return this.usersById.get(userId) ?? null;
  }

  private toAuthResult(user: AuthUserRecord): AuthResult {
    const claims: TokenClaims = {
      sub: user.userId,
      username: user.username,
      nickname: user.nickname
    };

    const token = jwt.sign(claims, this.jwtSecret, {
      expiresIn: "30d"
    });

    return {
      token,
      user: {
        userId: user.userId,
        username: user.username,
        nickname: user.nickname
      }
    };
  }

  private normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizePassword(value: string): string {
    return value.trim();
  }

  private normalizeNickname(value: string | undefined, fallback: string): string {
    const nickname = value?.trim() ?? "";
    return nickname || fallback;
  }

  private validateUsername(username: string): void {
    if (!/^[a-z0-9_]{3,20}$/i.test(username)) {
      throw new AuthError(400, "INVALID_USERNAME", "用户名需为 3-20 位字母/数字/下划线");
    }
  }

  private validatePassword(password: string): void {
    if (password.length < 6 || password.length > 64) {
      throw new AuthError(400, "INVALID_PASSWORD", "密码长度需在 6-64 位");
    }
  }

  private validateNickname(nickname: string): void {
    if (!nickname || nickname.length > 20) {
      throw new AuthError(400, "INVALID_NICKNAME", "昵称不能为空且不超过 20 字");
    }
  }
}
