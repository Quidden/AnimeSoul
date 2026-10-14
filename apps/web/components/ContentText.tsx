"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { contentSegments } from "../lib/content-links";

export function ContentText({ body, spoiler = false }: { body: string; spoiler?: boolean }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const text = (
    <p className="content-text">
      {contentSegments(body, origin).map((part, index) =>
        part.kind === "text" ? (
          part.text
        ) : (
          <Link
            key={index}
            href={part.href}
            prefetch={false}
            className={`content-reference content-reference-${part.linkKind}`}
          >
            {part.text}
          </Link>
        ),
      )}
    </p>
  );
  return spoiler ? (
    <details className="content-spoiler">
      <summary>Показать спойлер</summary>
      {text}
    </details>
  ) : (
    text
  );
}
