"use client";
import { useEffect, useState } from "react";
import { frameSearchQuotaSchema, type FrameSearchQuota } from "@animesoul/contracts";
const eventName = "animesoul:frame-quota";
let value: FrameSearchQuota | null = null;
let request: Promise<void> | null = null;
let fetchedAt = 0;
let revision = 0;
export function updateFrameQuota(next: FrameSearchQuota) {
  value = next;
  revision++;
  fetchedAt = Date.now();
  window.dispatchEvent(new Event(eventName));
}
export async function refreshFrameQuota(force = false) {
  if (request) return request;
  if (!force && Date.now() - fetchedAt < 30000) return;
  const current = revision;
  request = (async () => {
    try {
      const response = await fetch("/api/search/frame/quota", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Unavailable.");
      const next = frameSearchQuotaSchema.parse(await response.json());
      if (revision === current) updateFrameQuota(next);
    } catch {
      if (revision === current) {
        value = null;
        fetchedAt = Date.now();
        window.dispatchEvent(new Event(eventName));
      }
    }
  })();
  try {
    await request;
  } finally {
    request = null;
  }
}
export function FrameSearchQuota() {
  const [quota, setQuota] = useState<FrameSearchQuota | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const update = () => {
      setQuota(value);
      setLoaded(fetchedAt > 0);
    };
    update();
    window.addEventListener(eventName, update);
    void refreshFrameQuota();
    const timer = setInterval(() => void refreshFrameQuota(), 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(eventName, update);
    };
  }, []);
  return (
    <div className="frame-quota" data-empty={quota?.remaining === 0} role="status">
      <div>
        <span>Лимит сервера</span>
        <strong>
          {quota
            ? `${quota.remaining} из ${quota.total} поисков осталось`
            : loaded
              ? "Остаток временно недоступен"
              : "Проверяем лимит…"}
        </strong>
      </div>
      {quota && (
        <>
          <progress
            max={quota.total}
            value={quota.remaining}
            aria-label="Оставшаяся квота поиска"
          />
          <span className="frame-help">Общий для всех посетителей · за последние 24 часа</span>
        </>
      )}
      {!quota && loaded && (
        <button type="button" className="text-link" onClick={() => void refreshFrameQuota(true)}>
          Обновить лимит
        </button>
      )}
    </div>
  );
}
