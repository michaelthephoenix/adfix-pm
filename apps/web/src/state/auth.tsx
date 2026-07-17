import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, setRefreshHandler, setUnauthorizedHandler } from "../lib/api";
import type { AuthTokens, User } from "../types";

type AuthContextValue = {
  isAuthenticated: boolean;
  isInitializing: boolean;
  user: User | null;
  accessToken: string | null;
  refreshToken: null;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; name: string; password: string }) => Promise<void>;
  adoptSession: (session: AuthTokens) => void;
  logout: () => Promise<void>;
  updateLocalUser: (input: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ accessToken: string; user: User } | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const adoptSession = (result: AuthTokens) => {
    setSession({ accessToken: result.accessToken, user: result.user });
  };

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await apiRequest<AuthTokens>("/auth/refresh", {
          method: "POST",
          body: {},
          skipAuthRetry: true
        });
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
  }, []);

  const login = async (email: string, password: string) => {
    adoptSession(await apiRequest<AuthTokens>("/auth/login", { method: "POST", body: { email, password } }));
  };

  const signup = async (input: { email: string; name: string; password: string }) => {
    adoptSession(await apiRequest<AuthTokens>("/auth/signup", { method: "POST", body: input }));
  };

  const logout = async () => {
    await apiRequest<void>("/auth/logout", { method: "POST", body: {}, skipAuthRetry: true }).catch(() => undefined);
    setSession(null);
  };

  const updateLocalUser = (input: Partial<User>) => {
    setSession((previous) => previous ? { ...previous, user: { ...previous.user, ...input } } : previous);
  };

  const value = useMemo<AuthContextValue>(() => ({
    isAuthenticated: Boolean(session?.accessToken),
    isInitializing,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? null,
    refreshToken: null,
    login,
    signup,
    adoptSession,
    logout,
    updateLocalUser
  }), [isInitializing, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
