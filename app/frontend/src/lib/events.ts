import type { ApiStatus, PlayerPrefs, SaveStatus, ToolbarPosition } from "./types";

/**
 * Payloads for cross-feature browser events.
 *
 * Keep this map as the only source of event names. Components should not
 * exchange stringly-typed CustomEvent instances directly.
 */
export type AppEventMap = {
  "save-status": SaveStatus;
  "api-status": ApiStatus;
  "kodik-api-status": ApiStatus;
  "party-ping": {
    state: "idle" | "connected" | "error";
    ms?: number;
    roomId?: string;
  };
  "player-prefs": PlayerPrefs;
  toolbar: ToolbarPosition;
  "open-gdrive-choice": undefined;
};

export type AppEventName = keyof AppEventMap;

const browserEventName = (name: AppEventName) => `animesoul:${name}`;

export function emitAppEvent<Name extends AppEventName>(
  name: Name,
  ...args: AppEventMap[Name] extends undefined ? [] : [detail: AppEventMap[Name]]
): void {
  window.dispatchEvent(
    new CustomEvent(browserEventName(name), {
      detail: args[0],
    }),
  );
}

export function listenAppEvent<Name extends AppEventName>(
  name: Name,
  listener: (detail: AppEventMap[Name]) => void,
): () => void {
  const eventName = browserEventName(name);
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<AppEventMap[Name]>).detail);
  };

  window.addEventListener(eventName, handleEvent);
  return () => window.removeEventListener(eventName, handleEvent);
}
