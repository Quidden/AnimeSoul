export function homeRailStops(offsets: number[], maxScroll: number) {
  const max = Math.max(0, maxScroll);
  return [...new Set([0, ...offsets.map((offset) => Math.min(max, Math.max(0, offset)))])];
}

export function nearestRailStop(stops: number[], position: number) {
  return stops.reduce(
    (nearest, stop, index) =>
      Math.abs(stop - position) < Math.abs((stops[nearest] ?? 0) - position) ? index : nearest,
    0,
  );
}

export function nextRailStop(stops: number[], position: number, direction: number) {
  const index = nearestRailStop(stops, position);
  return stops[Math.max(0, Math.min(stops.length - 1, index + Math.sign(direction)))] ?? 0;
}
