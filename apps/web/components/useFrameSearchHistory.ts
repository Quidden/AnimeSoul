"use client";
import { useEffect, useState } from "react";
import type { FrameSearchResult } from "@animesoul/contracts";
import {
  appendFrameHistory,
  frameHistoryKey,
  parseFrameHistory,
  type FrameHistoryEntry,
} from "../lib/frame-search-history";
const eventName = "animesoul:frame-history";
let memory: FrameHistoryEntry[] | null = null;
function read() {
  if (memory !== null) return memory;
  try {
    memory = parseFrameHistory(localStorage.getItem(frameHistoryKey));
  } catch {
    memory = [];
  }
  return memory;
}
export function rememberFrameSearch(result: FrameSearchResult) {
  memory = appendFrameHistory(read(), result, Date.now(), crypto.randomUUID());
  try {
    localStorage.setItem(frameHistoryKey, JSON.stringify(memory));
  } catch {
    /* Keep this session usable when storage is unavailable. */
  }
  window.dispatchEvent(new Event(eventName));
}
export function clearFrameSearchHistory() {
  memory = [];
  try {
    localStorage.removeItem(frameHistoryKey);
  } catch {
    /* The in-memory history is still cleared. */
  }
  window.dispatchEvent(new Event(eventName));
}
export function useFrameSearchHistory() {
  const [history, setHistory] = useState<FrameHistoryEntry[]>([]);
  useEffect(() => {
    setHistory(read());
    const update = () => setHistory(read());
    const external = (event: StorageEvent) => {
      if (event.key === frameHistoryKey || event.key === null) {
        memory = null;
        update();
      }
    };
    window.addEventListener(eventName, update);
    window.addEventListener("storage", external);
    return () => {
      window.removeEventListener(eventName, update);
      window.removeEventListener("storage", external);
    };
  }, []);
  return history;
}
