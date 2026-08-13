import { useEffect } from "react";
import { emitAppEvent } from "../lib/events";
import { writeLocal } from "../lib/storage";
import type { ApiStatus } from "../lib/types";

const API_STATUS_KEY = "animesoul:api-status";
const SETTLE_DELAY_MS = 1_200;

/**
 * Publishes one aggregated activity state for all YummyAnime requests.
 *
 * The API indicator stays in the updating state until every tracked request
 * is settled. Silent health checks are intentionally excluded.
 */
export function useApiActivity(): void {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let pendingRequests = 0;
    let requestFailed = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const report = (status: ApiStatus) => {
      writeLocal(API_STATUS_KEY, status);
      emitAppEvent("api-status", status);
    };

    const scheduleSettledStatus = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (pendingRequests > 0) return;
        report({
          state: requestFailed ? "error" : "updated",
          at: Date.now(),
        });
        requestFailed = false;
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

      clearTimeout(settleTimer);
      pendingRequests += 1;
      report({ state: "updating" });

      try {
        const response = await originalFetch(input, init);
        if (!response.ok) requestFailed = true;
        return response;
      } catch (error) {
        requestFailed = true;
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
