import { createContext, useContext, useMemo, useState } from "react";
import { apiRequest, setUnauthorizedHandler } from "../lib/api";
import { useEffect } from "react";
import type { AuthTokens, User } from "../types";

type AuthContextValue = {
  isAuthenticated: boolean;
  isInitializing: boolean;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateLocalUser: (input: Partial<User>) => void;
};

const STORAGE_KEY = "adfix.auth.v1";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

function readStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: StoredAuth | null) {
  if (!auth) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [storedAuth, setStoredAuth] = useState<StoredAuth | null>(() => readStoredAuth());
  const [isInitializing] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setStoredAuth(null);
      writeStoredAuth(null);
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = async (email: string, password: string) => {
    const result = await apiRequest<AuthTokens>("/auth/login", {
      method: "POST",
      body: { email, password }
    });

    const next = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user
    };
    setStoredAuth(next);
    writeStoredAuth(next);
  };

  const logout = async () => {
    if (storedAuth?.refreshToken) {
      await apiRequest<void>("/auth/logout", {
        method: "POST",
        body: { refreshToken: storedAuth.refreshToken }
      }).catch(() => undefined);
    }

    setStoredAuth(null);
    writeStoredAuth(null);
  };

  const updateLocalUser = (input: Partial<User>) => {
    setStoredAuth((previous) => {
      if (!previous) return previous;
      const next = {
        ...previous,
        user: {
          ...previous.user,
          ...input
        }
      };
      writeStoredAuth(next);
      return next;
    });
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(storedAuth?.accessToken),
      isInitializing,
      user: storedAuth?.user ?? null,
      accessToken: storedAuth?.accessToken ?? null,
      refreshToken: storedAuth?.refreshToken ?? null,
      login,
      logout,
      updateLocalUser
    }),
    [isInitializing, storedAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
