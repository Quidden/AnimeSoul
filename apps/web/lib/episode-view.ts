export function episodeViewing(
  duration: number | null | undefined,
  progress?: { position: number; duration: number; completed: boolean },
) {
  const length =
    progress && Number.isFinite(progress.duration) && progress.duration > 0
      ? progress.duration
      : duration;
  const position =
    progress && Number.isFinite(progress.position) ? Math.max(0, progress.position) : 0;
  const completed = progress?.completed === true;
  const percent = completed
    ? 100
    : length && length > 0
      ? Math.min(100, (position / length) * 100)
      : 0;
  return {
    completed,
    percent,
    started: position > 0 && !completed,
    remaining: length && length > 0 ? (completed ? 0 : Math.max(0, length - position)) : null,
  };
}
export function minutesLabel(seconds: number) {
  return `${Math.max(1, Math.ceil(seconds / 60))} мин`;
}
