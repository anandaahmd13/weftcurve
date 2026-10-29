"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppState } from "@/domain/types";

interface AppContextValue {
  state: AppState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  mutate: <T>(path: string, body?: unknown) => Promise<T>;
  identityOpen: boolean;
  setIdentityOpen: (open: boolean) => void;
  notice: string | null;
  notify: (message: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const csrf = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acceptState = useCallback((next: AppState) => {
    csrf.current = next.csrf;
    setState(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch("/api/state", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load workspace data.");
      if (version === requestVersion.current) acceptState(result as AppState);
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Connection interrupted. Refresh before trying again.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [acceptState]);

  useEffect(() => {
    const initialFetch = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(initialFetch);
  }, [refresh]);

  const pending = Boolean(state && (state.worker.pending > 0 || state.claims.some((claim) => claim.status === "reserved" || claim.status === "submitted")));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { void refresh(); }, 2500);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  useEffect(() => () => { if (noticeTimeout.current) clearTimeout(noticeTimeout.current); }, []);

  const notify = useCallback((message: string) => {
    if (noticeTimeout.current) clearTimeout(noticeTimeout.current);
    setNotice(message);
    noticeTimeout.current = setTimeout(() => setNotice(null), 6500);
  }, []);

  const mutate = useCallback(async <T,>(path: string, body: unknown = {}): Promise<T> => {
    ++requestVersion.current;
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(csrf.current ? { "X-CSRF-Token": csrf.current } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      await refresh();
      throw new Error("Connection interrupted. The result is unknown; check the latest status before trying again.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await refresh();
      throw new Error(result?.error || "Request did not complete. Check the latest status before trying again.");
    }
    if (result && "network" in result && "projects" in result) acceptState(result as AppState);
    else if (result?.state) acceptState(result.state as AppState);
    return result as T;
  }, [acceptState, refresh]);

  return <AppContext.Provider value={{ state, loading, error, refresh, mutate, identityOpen, setIdentityOpen, notice, notify }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
