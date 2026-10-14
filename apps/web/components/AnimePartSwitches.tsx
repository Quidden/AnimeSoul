"use client";
import type { CSSProperties } from "react";
export type PartFilter = {
  key: string;
  label: string;
  color: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};
export function AnimePartSwitches({
  filters,
  label = "Показывать части франшизы",
}: {
  filters: PartFilter[];
  label?: string;
}) {
  return (
    <div className="anime-part-switches" aria-label={label}>
      {filters.map((filter) => (
        <label key={filter.key} style={{ "--part-color": filter.color } as CSSProperties}>
          <input
            type="checkbox"
            role="switch"
            checked={filter.checked}
            onChange={(event) => filter.onChange(event.target.checked)}
          />
          <span className="anime-switch-slider" aria-hidden="true" />
          <span>{filter.label}</span>
        </label>
      ))}
    </div>
  );
}
