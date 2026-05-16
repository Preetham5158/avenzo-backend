import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { User } from "@avenzo/api-client";
import { ApiRequestError } from "@avenzo/api-client";
import { apiClient } from "@/lib/apiClient";
import { restoreToken, setToken } from "@/lib/tokenStore";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthActions {
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string, name?: string, phone?: string): Promise<void>;
  logout(): Promise<void>;
  updateProfile(name: string | null, phone: string | null): Promise<void>;
  clearError(): void;
}

const AuthContext = createContext<(AuthState & AuthActions) | null>(null);

export function useAuth(): AuthState & AuthActions {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await restoreToken();
        if (!token) return;
        // /api/v1/me returns User directly in the data envelope
        const me = await apiClient.auth.me();
        setUser(me);
      } catch {
        // Token is expired or invalid — clear it silently and go to login
        await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const res = await apiClient.auth.customerLogin(email, password).catch((err) => {
      const msg =
        err instanceof ApiRequestError && err.status === 401
          ? "Incorrect email or password."
          : err instanceof Error
          ? err.message
          : "Sign in failed. Please try again.";
      setError(msg);
      throw err;
    });
    await setToken(res.accessToken);
    setUser(res.user);
  }, []);

  const signup = useCallback(
    async (email: string, password: string, name?: string, phone?: string) => {
      setError(null);
      const res = await apiClient.auth
        .customerSignup({ email, password, name, phone })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
          throw err;
        });
      await setToken(res.accessToken);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const updateProfile = useCallback(
    async (name: string | null, phone: string | null) => {
      setError(null);
      const res = await apiClient.auth
        .updateCustomerProfile({ name, phone })
        .catch(async (err) => {
          if (err instanceof ApiRequestError && err.status === 401) {
            // Session expired — force re-login
            await setToken(null);
            setUser(null);
            setError("Your session has expired. Please sign in again.");
          } else {
            setError(err instanceof Error ? err.message : "Could not save changes.");
          }
          throw err;
        });
      // updateCustomerProfile returns { user: User }
      setUser(res.user);
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{ user, loading, error, login, signup, logout, updateProfile, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
}
