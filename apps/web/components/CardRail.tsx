"use client";

import { Children, useId, useRef, type ReactNode } from "react";
import { RailControls } from "./RailControls";
import { useSteppedRail } from "./useSteppedRail";

export function CardRail({
  children,
  label,
  imageSelector,
}: {
  children: ReactNode;
  label: string;
  imageSelector: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const navigation = useSteppedRail(track, imageSelector, Children.count(children), true);
  return (
    <div className="card-rail rail-shell">
      <div
        id={id}
        ref={track}
        className="card-rail-track"
        role="group"
        aria-label={`${label}: горизонтальная лента`}
        tabIndex={navigation.enabled ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            navigation.move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {children}
      </div>
      {navigation.enabled && (
        <RailControls
          id={id}
          label={label}
          center={navigation.center}
          previous={navigation.previous}
          next={navigation.next}
          onPrevious={() => navigation.move(-1)}
          onNext={() => navigation.move(1)}
        />
      )}
    </div>
  );
}
