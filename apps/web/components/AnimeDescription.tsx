"use client";
import { useEffect, useRef, useState } from "react";

// The whole synopsis is in the page; a long one is clamped to a few lines until it is opened.
export function AnimeDescription({ text }: { text: string }) {
  const body = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const node = body.current;
    if (!node || expanded) return;
    const measure = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [expanded, text]);
  return (
    <div className="anime-description" id="anime-description">
      <p ref={body} className={expanded ? "expanded" : undefined}>
        {text || "Описание пока не добавлено."}
      </p>
      {(clamped || expanded) && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть" : "Читать полностью"}
        </button>
      )}
    </div>
  );
}
