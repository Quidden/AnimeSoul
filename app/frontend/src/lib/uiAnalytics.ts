import { recordDebugEvent } from "./debugLog";

export type UiAction = "anime_open" | "watch_click" | "season_select" | "episode_select" | "dubbing_select" | "calendar_episode_open" | "retry_error";

export function trackUiAction(action: UiAction, details: Record<string, string | number> = {}): void {
  recordDebugEvent("info", "Действие в интерфейсе", action, action, details, {
    functionName: "trackUiAction",
    file: "src/lib/uiAnalytics.ts",
  });
  window.dispatchEvent(new CustomEvent("animesoul:ui-action", { detail: { action, details, at: Date.now() } }));
}
