import { useEffect } from "react";
import { emitAppEvent } from "../lib/events";
import { writeLocal } from "../lib/storage";
import type { ApiStatus } from "../lib/types";

const YUMMY_STATUS_KEY = "animesoul:api-status";
const KODIK_STATUS_KEY = "animesoul:kodik-api-status";
const SETTLE_DELAY_MS = 1_200;

function hybridMode(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    const mode = parsed.searchParams.get("mode") ?? "catalog";
    return mode === "catalog" || mode === "details" || mode === "videos";
  } catch {
    return true;
  }
}

/** Publish independent activity states for the two mutually-reserved APIs. */
export function useApiActivity(): void {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let pendingRequests = 0;
    let yummyFailed = false;
    let kodikFailed = false;
    let kodikParticipated = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const reportYummy = (status: ApiStatus) => {
      writeLocal(YUMMY_STATUS_KEY, status);
      emitAppEvent("api-status", status);
    };
    const reportKodik = (status: ApiStatus) => {
      writeLocal(KODIK_STATUS_KEY, status);
      emitAppEvent("kodik-api-status", status);
    };

    const scheduleSettledStatus = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (pendingRequests > 0) return;
        const at = Date.now();
        reportYummy({ state: yummyFailed ? "error" : "updated", at });
        if (kodikParticipated) {
          reportKodik({ state: kodikFailed ? "error" : "updated", at });
        }
        yummyFailed = false;
        kodikFailed = false;
        kodikParticipated = false;
      }, SETTLE_DELAY_MS);
    };

    const trackedFetch: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const shouldTrack = url.includes("/api/yummy") && !url.includes("silent=1");
      if (!shouldTrack) return originalFetch(input, init);

      const usesKodikReserve = hybridMode(url);
      clearTimeout(settleTimer);
      pendingRequests += 1;
      reportYummy({ state: "updating" });
      if (usesKodikReserve) {
        kodikParticipated = true;
        reportKodik({ state: "updating" });
      }

      try {
        const response = await originalFetch(input, init);
        const yummySource = response.headers.get("X-AnimeSoul-Yummy-Status");
        const kodikSource = response.headers.get("X-AnimeSoul-Kodik-Status");
        if (!response.ok || yummySource === "error") yummyFailed = true;
        if (usesKodikReserve && (!response.ok || kodikSource === "error" || kodikSource === "unconfigured")) {
          kodikFailed = true;
        }
        return response;
      } catch (error) {
        yummyFailed = true;
        if (usesKodikReserve) kodikFailed = true;
        throw error;
      } finally {
        pendingRequests -= 1;
        if (pendingRequests === 0) scheduleSettledStatus();
      }
    };

    window.fetch = trackedFetch;
    return () => {
      clearTimeout(settleTimer);
      if (window.fetch === trackedFetch) window.fetch = originalFetch;
    };
  }, []);
}
