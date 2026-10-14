"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscriptionSchema, type Subscription } from "@animesoul/contracts";
export function useSubscription() {
  const [value, setValue] = useState<Subscription | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    try {
      const response = await fetch("/api/subscription", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error();
      const result = subscriptionSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        setValue(result);
        setError(false);
      }
    } catch {
      if (!controller.signal.aborted) {
        setValue(null);
        setError(true);
      }
    } finally {
      if (!controller.signal.aborted) setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => {
      setValue(null);
      setReady(false);
      void refresh();
    };
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(focus, 60000);
    window.addEventListener("animesoul:account-changed", changed);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active.current?.abort();
      clearInterval(timer);
      window.removeEventListener("animesoul:account-changed", changed);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!value?.nativeAccess || !value.expiresAt) return;
    const delay = new Date(value.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        setValue((current) =>
          current?.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()
            ? { ...current, nativeAccess: false }
            : current,
        );
        void refresh();
      },
      Math.max(0, Math.min(delay, 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [value, refresh]);
  return { value, ready, error, refresh };
}
