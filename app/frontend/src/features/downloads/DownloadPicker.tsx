import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DownloadJob } from "../../lib/downloads";
import { useModalAccessibility } from "../../lib/modalAccessibility";

export type DownloadCandidate = {
  key: string;
  season: number;
  seasonLabel: string;
  episode: string;
  downloaded: boolean;
  queued: boolean;
  missingDubbing: boolean;
};

type DownloadPickerProps = {
  open: boolean;
  title: string;
  candidates: DownloadCandidate[];
  dubbings: string[];
  dubbing: string;
  quality: number;
  qualities: number[];
  initialKey?: string;
  jobs: DownloadJob[];
  busy: boolean;
  notice: string;
  onClose: () => void;
  onDubbingChange: (value: string) => void;
  onQualityChange: (value: number) => void;
  onSubmit: (keys: string[]) => Promise<boolean>;
  onCancelJob: (jobId: string) => void;
};

type Filter = "available" | "all" | "downloaded";

function compareEpisodes(left: string, right: string) {
  return left.localeCompare(right, "ru", { numeric: true });
}

function jobLabel(job: DownloadJob) {
  if (job.status === "downloading") return job.current || "Скачивается";
  if (job.status === "paused") return "Пауза до разрешённой сети";
  return `В очереди${job.queuePosition ? ` · №${job.queuePosition}` : ""}`;
}

export function DownloadPicker({
  open,
  title,
  candidates,
  dubbings,
  dubbing,
  quality,
  qualities,
  initialKey,
  jobs,
  busy,
  notice,
  onClose,
  onDubbingChange,
  onQualityChange,
  onSubmit,
  onCancelJob,
}: DownloadPickerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("available");
  const [ranges, setRanges] = useState<Record<number, { from: string; to: string }>>({});

  useModalAccessibility(open, onClose, dialogRef);

  const seasons = useMemo(() => {
    const grouped = new Map<number, DownloadCandidate[]>();
    for (const candidate of candidates) {
      grouped.set(candidate.season, [...(grouped.get(candidate.season) ?? []), candidate]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([season, items]) => ({
        season,
        label: items[0]?.seasonLabel ?? `Сезон ${season}`,
        items: items.sort((left, right) => compareEpisodes(left.episode, right.episode)),
      }));
  }, [candidates]);

  useEffect(() => {
    if (!open) return;
    const available = new Set(candidates.filter(item => !item.downloaded && !item.queued).map(item => item.key));
    setSelected(current => {
      const retained = new Set([...current].filter(key => available.has(key)));
      if (!retained.size && initialKey && available.has(initialKey)) retained.add(initialKey);
      return retained;
    });
    setRanges(Object.fromEntries(seasons.map(({ season, items }) => [
      season,
      { from: items[0]?.episode ?? "", to: items.at(-1)?.episode ?? "" },
    ])));
  }, [open, dubbing, quality, candidates, initialKey, seasons]);

  if (!open || typeof document === "undefined") return null;

  const selectable = candidates.filter(item => !item.downloaded && !item.queued);
  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const setSeason = (season: number, enabled: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const item of candidates.filter(candidate => candidate.season === season && !candidate.downloaded && !candidate.queued)) {
      if (enabled) next.add(item.key);
      else next.delete(item.key);
    }
    return next;
  });
  const selectRange = (season: number) => {
    const items = seasons.find(item => item.season === season)?.items ?? [];
    const range = ranges[season];
    const fromIndex = items.findIndex(item => item.episode === range?.from);
    const toIndex = items.findIndex(item => item.episode === range?.to);
    if (fromIndex < 0 || toIndex < 0) return;
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    setSelected(current => {
      const next = new Set(current);
      for (const item of items.slice(start, end + 1)) {
        if (!item.downloaded && !item.queued) next.add(item.key);
      }
      return next;
    });
  };
  const submit = async () => {
    if (!selected.size || busy) return;
    const added = await onSubmit([...selected]);
    if (added) setSelected(new Set());
  };

  return createPortal(
    <div className="download-picker-layer" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="download-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-picker-title"
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="download-picker-header">
          <div>
            <span>Офлайн-загрузка</span>
            <h2 id="download-picker-title">Выберите серии</h2>
            <p>{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть выбор серий">×</button>
        </header>

        <div className="download-picker-controls">
          <label>
            Озвучка
            <select value={dubbing} onChange={event => onDubbingChange(event.target.value)}>
              {dubbings.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Качество
            <select value={quality} onChange={event => onQualityChange(Number(event.target.value))}>
              {qualities.map(value => <option key={value} value={value}>{value}p</option>)}
            </select>
            <small>Точное наличие проверяется для каждой выбранной серии</small>
          </label>
          <label>
            Показать
            <select value={filter} onChange={event => setFilter(event.target.value as Filter)}>
              <option value="available">Не скачанные</option>
              <option value="all">Все серии</option>
              <option value="downloaded">Скачанные / в очереди</option>
            </select>
          </label>
        </div>

        <div className="download-picker-bulk-actions">
          <button type="button" onClick={() => setSelected(new Set(selectable.map(item => item.key)))}>Выбрать все нескачанные</button>
          <button type="button" onClick={() => setSelected(new Set())}>Снять выбор</button>
          <span>{selectable.length} не скачано</span>
        </div>

        <div className="download-picker-seasons">
          {seasons.map(({ season, label, items }) => {
            const available = items.filter(item => !item.downloaded && !item.queued);
            const visible = items.filter(item => (
              filter === "all"
              || (filter === "available" && !item.downloaded && !item.queued)
              || (filter === "downloaded" && (item.downloaded || item.queued))
            ));
            const selectedInSeason = available.filter(item => selected.has(item.key)).length;
            const range = ranges[season] ?? { from: items[0]?.episode ?? "", to: items.at(-1)?.episode ?? "" };
            return (
              <article className="download-picker-season" key={season}>
                <div className="download-picker-season-heading">
                  <label>
                    <input
                      type="checkbox"
                      checked={available.length > 0 && selectedInSeason === available.length}
                      ref={input => { if (input) input.indeterminate = selectedInSeason > 0 && selectedInSeason < available.length; }}
                      disabled={!available.length}
                      onChange={event => setSeason(season, event.target.checked)}
                    />
                    <span className="download-picker-season-copy">
                      <strong>{label}</strong>
                      <span>{selectedInSeason} из {available.length}</span>
                    </span>
                  </label>
                  <button type="button" disabled={!selectedInSeason} onClick={() => setSeason(season, false)}>Снять</button>
                </div>
                {items.length > 1 && (
                  <div className="download-picker-range">
                    <span>Диапазон</span>
                    <select
                      aria-label={`Первая серия раздела «${label}»`}
                      value={range.from}
                      onChange={event => setRanges(current => ({ ...current, [season]: { ...range, from: event.target.value } }))}
                    >
                      {items.map(item => <option key={item.key} value={item.episode}>с {item.episode}</option>)}
                    </select>
                    <select
                      aria-label={`Последняя серия раздела «${label}»`}
                      value={range.to}
                      onChange={event => setRanges(current => ({ ...current, [season]: { ...range, to: event.target.value } }))}
                    >
                      {items.map(item => <option key={item.key} value={item.episode}>по {item.episode}</option>)}
                    </select>
                    <button type="button" onClick={() => selectRange(season)}>Выбрать</button>
                  </div>
                )}
                <div className="download-picker-episodes">
                  {visible.map(item => (
                    <label
                      className={`${selected.has(item.key) ? "is-selected" : ""}${item.downloaded ? " is-downloaded" : ""}${item.queued ? " is-queued" : ""}${item.missingDubbing ? " is-missing-dubbing" : ""}`}
                      key={item.key}
                      title={item.downloaded
                        ? "Уже скачано"
                        : item.queued
                          ? "Уже в очереди"
                          : item.missingDubbing
                            ? `В серии ${item.episode} нет озвучки «${dubbing}»`
                            : `Серия ${item.episode}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        disabled={item.downloaded || item.queued}
                        onChange={() => toggle(item.key)}
                      />
                      <span>{item.episode}</span>
                      {(item.downloaded || item.queued || item.missingDubbing) && (
                        <small>{item.downloaded ? "✓" : item.queued ? "…" : "нет озвучки"}</small>
                      )}
                    </label>
                  ))}
                  {!visible.length && <p>Нет серий для выбранного фильтра.</p>}
                </div>
              </article>
            );
          })}
          {!seasons.length && <p className="download-picker-empty">Для этой озвучки пока нет серий Kodik.</p>}
        </div>

        {jobs.length > 0 && (
          <section className="download-picker-queue" aria-label="Очередь этого аниме">
            <h3>Уже в очереди · {jobs.length}</h3>
            {jobs.map(job => (
              <div key={job.id}>
                <span><b>{jobLabel(job)}</b><small>{job.completed}/{job.total} · {job.quality}p</small></span>
                <button type="button" onClick={() => onCancelJob(job.id)}>Отменить</button>
              </div>
            ))}
          </section>
        )}

        <footer className="download-picker-footer">
          <div>
            <strong>{selected.size} сер.</strong>
            <span className={notice ? "has-notice" : undefined} role="status" aria-live="polite">
              {notice || "Можно сразу добавить ещё один сезон — он встанет следующим в очередь."}
            </span>
          </div>
          <button type="button" disabled={!selected.size || busy} onClick={() => void submit()}>
            {busy ? "Проверяем…" : `Добавить в очередь${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
