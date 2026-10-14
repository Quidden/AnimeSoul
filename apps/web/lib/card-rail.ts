export function wholeCardRailLayout(
  available: number,
  preferred: number,
  gap: number,
  count: number,
) {
  const cardWidth = Math.max(1, Math.min(Math.floor(available), Math.floor(preferred)));
  const columns = Math.min(
    Math.max(1, count),
    Math.max(1, Math.floor((available + gap) / (cardWidth + gap))),
  );
  return { cardWidth, columns, width: columns * cardWidth + (columns - 1) * gap };
}
