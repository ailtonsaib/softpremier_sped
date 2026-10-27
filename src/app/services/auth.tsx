import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { getDeviceId, getDeviceName } from "./licensing";
import type { BingoPlanId } from "./licensing";

const FUNCTION_URL =
  `https://${projectId}.supabase.co/functions/v1/make-server-f2d7d378`;
const API_URL = `${FUNCTION_URL}/bingo`;
const AUTH_URL = `https://${projectId}.supabase.co/auth/v1`;
const SESSION_KEY = "bingo:session";
export const PLATFORM_OWNER_EMAIL = "ailtonsaib@gmail.com";

export type AccountLicense = {
  id: string;
  customerName: string;
  customerEmail: string;
  kind: "trial" | "paid";
  status: "active" | "blocked";
  expiresAt: string | null;
  maxCards: number | null;
  cardsUsed: number;
  maxDevices: number;
  plan?: BingoPlanId;
  price?: number;
};

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
};

type Account = {
  user: { id: string; email?: string };
  profile?: { companyName?: string; contactName?: string };
  license: AccountLicense;
};

type AuthContextValue = {
  account: Account | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    companyName: string;
    contactName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  refreshAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readSession(): Session | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function getStoredAccessToken() {
  return readSession()?.access_token || null;
}

function authError(payload: { msg?: string; error_description?: string } = {}) {
  return payload.msg || payload.error_description || "Não foi possível concluir a operação.";
}

export function getPasswordRecoveryToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("type") === "recovery" ? params.get("access_token") : null;
}

export async function requestPasswordRecovery(email: string) {
  const redirectTo = new URL(window.location.pathname, window.location.origin).toString();
  const response = await fetch(
    `${AUTH_URL}/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: {
        apikey: publicAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(payload));
}

export async function completePasswordRecovery(password: string, accessToken: string) {
  const response = await fetch(`${AUTH_URL}/user`, {
    method: "PUT",
    headers: {
      apikey: publicAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(payload));
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function saveSession(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function deviceHeaders() {
  const [deviceId, deviceName] = await Promise.all([
    getDeviceId(),
    getDeviceName(),
  ]);
  return {
    "X-Device-Id": deviceId,
    "X-Device-Name": encodeURIComponent(deviceName),
  };
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  authenticated = false,
  baseUrl = API_URL,
): Promise<T> {
  let session = readSession();
  const headers = {
    "Content-Type": "application/json",
    ...(await deviceHeaders()),
    ...init.headers,
  } as Record<string, string>;
  if (authenticated && session) {
    headers.Authorization = `Bearer ${session.access_token}`;
  } else {
    headers.Authorization = `Bearer ${publicAnonKey}`;
  }
  let response = await fetch(`${baseUrl}${path}`, { ...init, headers });

  if (authenticated && response.status === 401 && session?.refresh_token) {
    const refreshed = await fetch(
      `https://${projectId}.supabase.co/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: publicAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      },
    );
    if (refreshed.ok) {
      session = await refreshed.json();
      saveSession(session);
      headers.Authorization = `Bearer ${session!.access_token}`;
      response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    }
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshAccount = useCallback(async () => {
    const next = await call<Account>("/auth/me", {}, true);
    setAccount(next);
  }, []);

  useEffect(() => {
    if (!readSession()) {
      setLoading(false);
      return;
    }
    refreshAccount()
      .catch((reason) => {
        saveSession(null);
        setError(reason instanceof Error ? reason.message : "Sessão inválida.");
      })
      .finally(() => setLoading(false));
  }, [refreshAccount]);

  useEffect(() => {
    const listener = () => void refreshAccount();
    window.addEventListener("bingo-license-updated", listener);
    return () => window.removeEventListener("bingo-license-updated", listener);
  }, [refreshAccount]);

  const authenticate = async (path: string, body: unknown) => {
    setError("");
    const device = await deviceHeaders();
    const result = await call<{ session?: Session; user: Account["user"]; license: AccountLicense }>(
      path,
      {
        method: "POST",
        body: JSON.stringify({
          ...(body as object),
          deviceId: device["X-Device-Id"],
          deviceName: decodeURIComponent(device["X-Device-Name"]),
        }),
      },
    );
    if (!result.session) throw new Error("Conta criada. Faça login para continuar.");
    saveSession(result.session);
    await refreshAccount();
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      loading,
      error,
      login: (email, password) => authenticate("/auth/login", { email, password }),
      signup: (data) => authenticate("/auth/signup", data),
      logout: () => {
        saveSession(null);
        setAccount(null);
        setError("");
      },
      refreshAccount,
    }),
    [account, error, loading, refreshAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider.");
  return context;
}

export async function authRequest<T>(path: string, init?: RequestInit) {
  return call<T>(path, init, true);
}

export async function platformRequest<T>(path: string, init?: RequestInit) {
  return call<T>(path, init, true, FUNCTION_URL);
}

export async function hasOwnerAccess() {
  if (!readSession()) return false;
  try {
    const account = await call<Account>("/auth/me", {}, true);
    return account.user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL;
  } catch {
    return false;
  }
}

export async function reserveCards(eventId: string, quantity: number) {
  if (await hasOwnerAccess()) {
    return { cardsUsed: 0, cardsRemaining: null };
  }
  const result = await authRequest<{ cardsUsed: number; cardsRemaining: number | null }>(
    "/usage/cards/reserve",
    {
      method: "POST",
      body: JSON.stringify({
        eventId,
        quantity,
        generationId: crypto.randomUUID(),
      }),
    },
  );
  window.dispatchEvent(new Event("bingo-license-updated"));
  return result;
}
