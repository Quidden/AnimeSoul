"use client";
import { useRef, useState, type CSSProperties } from "react";
export function RatingSlider({
  label,
  value,
  onSave,
  disabled = false,
}: {
  label: string;
  value: number | null | undefined;
  onSave: (value: number | null) => Promise<void>;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value ?? 7),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const warmth = draft / 10;
  const color = [174 + 81 * warmth, 132 + 75 * warmth, 251 - 181 * warmth]
    .map(Math.round)
    .join(" ");
  async function save(next: number | null) {
    setBusy(true);
    setError("");
    try {
      await onSave(next);
      dialog.current?.close();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить оценку.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rating-slider-control">
      <button
        type="button"
        className={`rating-star${value != null ? " rated" : ""}`}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => {
          setDraft(value ?? 7);
          setError("");
          dialog.current?.showModal();
        }}
      >
        <span aria-hidden="true">{value != null ? "★" : "☆"}</span>
        {value != null && <b>{value}</b>}
      </button>
      <dialog
        ref={dialog}
        className="rating-slider-dialog"
        aria-label={label}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) event.currentTarget.close();
        }}
      >
        <div
          className="rating-slider-panel"
          style={
            {
              "--rating-color": color,
              "--rating-fill": `${draft * 10}%`,
              "--rating-glow": `${draft * 2}px`,
            } as CSSProperties
          }
        >
          <div className="rating-slider-heading">
            <strong>{label}</strong>
            <button
              type="button"
              aria-label="Закрыть оценку"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </div>
          <output className="rating-slider-value">
            {draft}
            <small> / 10</small>
          </output>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={draft}
            disabled={busy}
            aria-label={label}
            aria-valuetext={`${draft} из 10`}
            onChange={(event) => setDraft(Number(event.target.value))}
          />
          <div className="rating-slider-scale" aria-hidden="true">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
          <div className="rating-slider-actions">
            <button
              type="button"
              className="outline"
              disabled={busy || value == null}
              onClick={() => void save(null)}
            >
              Убрать оценку
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void save(draft)}
            >
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </dialog>
    </div>
  );
}
