import { useEffect } from "react";
import { emitAppEvent } from "../lib/events";
import { writeLocal } from "../lib/storage";
import type { SaveStatus } from "../lib/types";

const SAVE_STATUS_KEY = "animesoul:save-status";

/** Keeps the header and diagnostics in sync with the storage state. */
export function usePublishedSaveStatus(status: SaveStatus): void {
  useEffect(() => {
    writeLocal(SAVE_STATUS_KEY, status);
    emitAppEvent("save-status", status);
  }, [status]);
}
