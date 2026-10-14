"use client";

export function RailControls({
  id,
  label,
  center,
  previous,
  next,
  onPrevious,
  onNext,
}: {
  id: string;
  label: string;
  center: number;
  previous: boolean;
  next: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="rail-controls" role="group" aria-label={`Прокрутка: ${label}`}>
      <button
        type="button"
        style={{ top: center }}
        aria-controls={id}
        aria-label={`${label}: листать влево`}
        disabled={!previous}
        onClick={onPrevious}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        style={{ top: center }}
        aria-controls={id}
        aria-label={`${label}: листать вправо`}
        disabled={!next}
        onClick={onNext}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
