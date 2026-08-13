const SCORES = Array.from({ length: 10 }, (_, index) => 10 - index);

export function ScorePicker({
  value,
  onChange,
  label = "Ваша оценка",
  compact = false,
  className = "",
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <label
      className={`score-picker ${compact ? "compact " : ""}${className}`.trim()}
      onClick={event => event.stopPropagation()}
    >
      {!compact && <span>{label}</span>}
      <select
        value={value ?? ""}
        aria-label={label}
        title={label}
        onClick={event => event.stopPropagation()}
        onChange={event => onChange(event.target.value ? Number(event.target.value) : undefined)}
      >
        <option value="">★ —</option>
        {SCORES.map(score => <option value={score} key={score}>★ {score}</option>)}
      </select>
    </label>
  );
}
