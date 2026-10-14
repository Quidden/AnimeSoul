"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  searchPreviewDelay,
  searchPreviewMoved,
  type PreviewPoint,
  type SearchOption,
  type SearchPreviewSnapshot,
} from "../lib/search-preview";

type Candidate = { option: SearchOption; element: HTMLElement; origin: PreviewPoint | null };

export function useSearchPreview(dialog: RefObject<HTMLDialogElement | null>, resetKey: string) {
  const [snapshot, setSnapshot] = useState<SearchPreviewSnapshot | null>(null);
  const candidate = useRef<Candidate | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    candidate.current = null;
    setSnapshot(null);
  }, []);

  const schedule = useCallback(
    (next: Candidate) => {
      dismiss();
      candidate.current = next;
      timer.current = setTimeout(() => {
        timer.current = null;
        const surface = dialog.current;
        if (candidate.current !== next || !next.element.isConnected || !surface?.open) return;
        if (next.origin && !next.element.matches(":hover")) return;
        const row = next.element.getBoundingClientRect();
        const bounds = surface.getBoundingClientRect();
        // Keyboard selection can scroll a row into view; never preview a hidden row.
        if (row.bottom <= bounds.top || row.top >= bounds.bottom) return;
        setSnapshot({
          option: next.option,
          anchor: {
            left: row.left - bounds.left - surface.clientLeft,
            top: row.top - bounds.top - surface.clientTop,
            width: row.width,
            height: row.height,
          },
          container: { width: surface.clientWidth, height: surface.clientHeight },
        });
      }, searchPreviewDelay);
    },
    [dialog, dismiss],
  );

  const move = useCallback(
    (point: PreviewPoint, next?: Pick<Candidate, "option" | "element">) => {
      const current = candidate.current;
      if (next && (!current || current.option.id !== next.option.id))
        schedule({ ...next, origin: point });
      else if (current && (!current.origin || searchPreviewMoved(current.origin, point)))
        schedule({ ...current, origin: point });
    },
    [schedule],
  );

  useEffect(() => {
    dismiss();
    const element = dialog.current;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaX && !event.deltaY) return;
      // A floating preview sits outside the scroll area. Pass its wheel gesture
      // through to the results so the first tick both closes it and scrolls.
      if (event.target instanceof Element && event.target.closest(".search-preview")) {
        const results = element?.querySelector<HTMLElement>(".global-search-scroll");
        if (results) {
          event.preventDefault();
          const unit =
            event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? results.clientHeight : 1;
          results.scrollBy({ top: event.deltaY * unit, left: event.deltaX * unit });
        }
      }
      dismiss();
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", dismiss);
    return () => {
      element?.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", dismiss);
      if (timer.current) clearTimeout(timer.current);
      candidate.current = null;
    };
  }, [dialog, resetKey, dismiss]);

  return { snapshot, schedule, move, dismiss };
}
