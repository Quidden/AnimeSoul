"use client";

import { Children, useId, useRef, type ReactNode } from "react";
import { RailControls } from "./RailControls";
import { useSteppedRail } from "./useSteppedRail";

export function HomeRail({
  children,
  label,
  variant,
}: {
  children: ReactNode;
  label: string;
  variant: "watching" | "popular";
}) {
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const navigation = useSteppedRail(
    track,
    variant === "watching" ? ".home-watch-image" : ".poster",
    Children.count(children),
  );

  return (
    <div className={`home-rail home-rail-${variant} rail-shell`}>
      <div
        id={id}
        ref={track}
        className={`home-rail-track home-${variant}-rail`}
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
