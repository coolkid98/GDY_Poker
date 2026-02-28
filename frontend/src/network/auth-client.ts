export interface AuthUser {
  userId: string;
  username: string;
  nickname: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

interface AuthApiResponse {
  token: string;
  user: AuthUser;
}

const AUTH_STORAGE_KEY = "gdy:auth-session";

const isLoopbackHost = (host: string): boolean => {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
};

const getWsEndpoint = (): string => {
  const configured = import.meta.env.VITE_COLYSEUS_ENDPOINT as string | undefined;
  if (!configured) {
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${window.location.hostname}:2567`;
    }
    return "ws://127.0.0.1:2567";
  }

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const parsed = new URL(configured);
    const browserHost = window.location.hostname;
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
      parsed.hostname = browserHost;
      if (!parsed.port) {
        parsed.port = "2567";
      }
      return parsed.toString().replace(/\/$/, "");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return configured;
  }
};

const resolveApiEndpoint = (): string => {
  const configured = import.meta.env.VITE_API_ENDPOINT as string | undefined;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const wsEndpoint = getWsEndpoint();
  try {
    const parsed = new URL(wsEndpoint);
    const httpProtocol = parsed.protocol === "wss:" ? "https:" : "http:";
    return `${httpProtocol}//${parsed.host}`;
  } catch {
    return "http://127.0.0.1:2567";
  }
};

const apiEndpoint = resolveApiEndpoint();

const parseAuthError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
};

const postAuth = async (path: string, body: Record<string, unknown>): Promise<AuthSession> => {
  const response = await fetch(`${apiEndpoint}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await parseAuthError(response));
  }

  const payload = (await response.json()) as AuthApiResponse;
  const session: AuthSession = {
    token: String(payload.token ?? ""),
    user: {
      userId: String(payload.user?.userId ?? ""),
      username: String(payload.user?.username ?? ""),
      nickname: String(payload.user?.nickname ?? "")
    }
  };

  if (!session.token || !session.user.userId) {
    throw new Error("登录返回数据异常");
  }

  setAuthSession(session);
  return session;
};

export const registerAccount = async (input: {
  username: string;
  password: string;
  nickname: string;
}): Promise<AuthSession> => {
  return postAuth("/auth/register", input);
};

export const loginAccount = async (input: {
  username: string;
  password: string;
}): Promise<AuthSession> => {
  return postAuth("/auth/login", input);
};

export const getAuthSession = (): AuthSession | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.userId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const setAuthSession = (session: AuthSession): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
};

export const clearAuthSession = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const getApiEndpoint = (): string => apiEndpoint;
