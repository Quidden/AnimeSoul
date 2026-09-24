import { useEffect, useRef } from "react";
import type { StorageDocument } from "../../lib/types";

/** Merge into live React state; the normal autosave path remains the only writer. */
export function useLanSaveSync(options: {
  ready: boolean;
  current: () => StorageDocument;
  apply: (document: StorageDocument) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const tick = async () => {
      const captured = latest.current;
      if (busy || !captured.ready) return;
      busy = true;
      try {
        const document = captured.current();
        const { mergeLanSave } = await import("./mergeLanSave");
        const merged = await mergeLanSave(document, controller.signal);
        // A progress edit, profile switch or Drive reload while awaiting the
        // merge invalidates it. Retry using fresh state on the next interval.
        if (controller.signal.aborted || captured !== latest.current || !merged) return;
        captured.apply(merged);
      } catch {
        // An unavailable peer must never block local saves or Google Drive.
      } finally { busy = false; }
    };
    const timer = window.setInterval(() => void tick(), 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
}
