import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
const STORAGE_KEY = "adfix.auth.v1";
const AuthContext = createContext(undefined);
function readStoredAuth() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeStoredAuth(auth) {
    if (!auth) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}
export function AuthProvider({ children }) {
    const [storedAuth, setStoredAuth] = useState(() => readStoredAuth());
    const [isInitializing] = useState(false);
    const login = async (email, password) => {
        const result = await apiRequest("/auth/login", {
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
            await apiRequest("/auth/logout", {
                method: "POST",
                body: { refreshToken: storedAuth.refreshToken }
            }).catch(() => undefined);
        }
        setStoredAuth(null);
        writeStoredAuth(null);
    };
    const value = useMemo(() => ({
        isAuthenticated: Boolean(storedAuth?.accessToken),
        isInitializing,
        user: storedAuth?.user ?? null,
        accessToken: storedAuth?.accessToken ?? null,
        login,
        logout
    }), [isInitializing, storedAuth]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
}
