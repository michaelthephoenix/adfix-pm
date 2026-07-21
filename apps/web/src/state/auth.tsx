import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest, setRefreshHandler, setUnauthorizedHandler } from "../lib/api";
import type { AuthTokens, User } from "../types";

type AuthContextValue = {
  isAuthenticated: boolean;
  isInitializing: boolean;
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  adoptSession: (session: AuthTokens) => void;
  logout: () => Promise<void>;
  updateLocalUser: (input: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ accessToken: string; user: User } | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const adoptSession = useCallback((result: AuthTokens) => {
    setSession({ accessToken: result.accessToken, user: result.user });
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const requestSession = () => apiRequest<AuthTokens>("/auth/refresh", {
          method: "POST",
          body: {},
          skipAuthRetry: true
        });
        let result: AuthTokens;
        try {
          result = await requestSession();
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== "REFRESH_ALREADY_ROTATED") throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 50));
          result = await requestSession();
        }
        if (active) adoptSession(result);
        return result.accessToken;
      } catch {
        if (active) setSession(null);
        return null;
      }
    };

    setRefreshHandler(refresh);
    setUnauthorizedHandler(() => setSession(null));
    void refresh().finally(() => active && setIsInitializing(false));

    return () => {
      active = false;
      setRefreshHandler(null);
      setUnauthorizedHandler(null);
    };
  }, [adoptSession]);

  const login = useCallback(async (email: string, password: string) => {
    adoptSession(await apiRequest<AuthTokens>("/auth/login", { method: "POST", body: { email, password } }));
  }, [adoptSession]);

  const logout = useCallback(async () => {
    await apiRequest<void>("/auth/logout", { method: "POST", body: {}, skipAuthRetry: true }).catch(() => undefined);
    setSession(null);
  }, []);

  const updateLocalUser = useCallback((input: Partial<User>) => {
    setSession((previous) => previous ? { ...previous, user: { ...previous.user, ...input } } : previous);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    isAuthenticated: Boolean(session?.accessToken),
    isInitializing,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? null,
    login,
    adoptSession,
    logout,
    updateLocalUser
  }), [adoptSession, isInitializing, login, logout, session, updateLocalUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
