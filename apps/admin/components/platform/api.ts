"use client";
import { useEffect, useState } from "react";
export async function api<T>(
  path: string,
  body?: unknown,
  csrf = "",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path.startsWith("/api/") ? path : "/api/admin/platform/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-AnimeSoul-Request": "1",
      "X-CSRF-Token": csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join(" · ")
        : (data.message ?? `Ошибка ${response.status}`),
    );
  return data as T;
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<T>(path, undefined, "", controller.signal)
      .then((value) => {
        setData(value);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, setData, error, loading, reload: () => setRevision((v) => v + 1) };
}
export function query(values: Record<string, string | number | undefined>) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
export function localDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState(fallback),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.length <= 65536) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(fallback)) {
          if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string"))
            setValue(parsed.slice(0, 100) as T);
        } else if (fallback && typeof fallback === "object") {
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            setValue(
              Object.fromEntries(
                Object.entries(fallback).map(([name, defaultValue]) => [
                  name,
                  typeof (parsed as Record<string, unknown>)[name] === typeof defaultValue
                    ? (parsed as Record<string, unknown>)[name]
                    : defaultValue,
                ]),
              ) as T,
            );
        } else if (typeof parsed === typeof fallback) setValue(parsed as T);
      }
    } catch {
      /* Storage or telemetry failure must not block the interface. */
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Storage or telemetry failure must not block the interface. */
      }
  }, [key, value, ready]);
  return [value, setValue] as const;
}
