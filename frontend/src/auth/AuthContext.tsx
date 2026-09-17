import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { apiRequest, getStoredToken, setStoredToken } from "../api/client";

interface LoginResponse {
  success: boolean;
  accessToken: string;
  tokenType: string;
  user: {
    id: number;
    username: string;
    role: string;
  };
}

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const USER_STORAGE_KEY = "dms_user";

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() =>
    getStoredToken() ? readStoredUser() : null
  );

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiRequest<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      auth: false,
      body: { username, password }
    });

    setStoredToken(data.accessToken);

    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
    } catch {
      // ignorar — la sesión seguirá funcionando por esta pestaña
    }

    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);

    try {
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // no-op
    }

    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user && getStoredToken()),
      login,
      logout
    }),
    [user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }

  return ctx;
}
