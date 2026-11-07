import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "../api/auth.js";
import { setUnauthorizedHandler } from "../api/client.js";

const AuthContext = createContext(null);
export const ME_KEY = ["me"];

/**
 * Holds the signed-in user (from GET /auth/me; 401 simply means "nobody"). When any other
 * request later gets a 401 the session has ended: the user is cleared, cached data is
 * dropped and `sessionExpired` lets the login page explain why.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);
  // true after a deliberate sign-out, so the next sign-in does not jump back to the old page
  const [signedOut, setSignedOut] = useState(false);
  const hadUser = useRef(false);

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.getMe();
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const user = me.data ?? null;
  hadUser.current = Boolean(user);

  const clearSession = useCallback(() => {
    queryClient.setQueryData(ME_KEY, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (hadUser.current) setSessionExpired(true);
      clearSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = useCallback(
    async (email, password) => {
      const next = await authApi.login(email, password);
      setSessionExpired(false);
      setSignedOut(false);
      queryClient.setQueryData(ME_KEY, next);
      return next;
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSessionExpired(false);
      setSignedOut(true);
      clearSession();
    }
  }, [clearSession]);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ME_KEY }), [queryClient]);

  const value = useMemo(
    () => ({ user, loading: me.isPending, error: me.error, login, logout, refresh, sessionExpired, signedOut }),
    [user, me.isPending, me.error, login, logout, refresh, sessionExpired, signedOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export const ADMIN_ROLES = ["admin", "faculty"];
export const isStaff = (user) => ADMIN_ROLES.includes(user?.role);
