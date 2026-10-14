export const posterPaletteKey = "animesoul:poster-palette:3";
export type PosterPalette = { poster: string; colors: [number, number, number][] };
export function parsePosterPalette(value: unknown): PosterPalette | null {
  if (!value || typeof value !== "object") return null;
  const { poster, colors } = value as Partial<PosterPalette>;
  if (
    typeof poster !== "string" ||
    !poster ||
    poster.length > 2048 ||
    !Array.isArray(colors) ||
    colors.length !== 3 ||
    !colors.every(
      (color) =>
        Array.isArray(color) &&
        color.length === 3 &&
        color.every((n) => Number.isInteger(n) && n >= 0 && n <= 255),
    )
  )
    return null;
  return { poster, colors };
}

// Quantize small samples, exclude near-white/black background and favor saturated
// clusters. Select separated colors so one large color does not occupy every glow.
export function extractPosterColors(pixels: ArrayLike<number>): [number, number, number][] {
  const buckets = new Map<string, { sum: number[]; count: number; weight: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const rgb = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!],
      high = Math.max(...rgb),
      low = Math.min(...rgb);
    if (high < 35 || low > 225) continue;
    const key = rgb.map((n) => Math.floor(n / 32)).join(":");
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0], count: 0, weight: 0 };
    rgb.forEach((n, index) => (bucket.sum[index]! += n));
    bucket.count++;
    bucket.weight += 0.25 + (high - low) / 255;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((b) => b.sum.map((n) => Math.round(n / b.count)) as [number, number, number]);
  const selected: [number, number, number][] = [];
  const chromatic = ranked.filter((rgb) => Math.max(...rgb) - Math.min(...rgb) >= 32);
  const bright = chromatic.filter(
    (rgb) => Math.max(...rgb) >= 110 && Math.max(...rgb) - Math.min(...rgb) >= 45,
  );
  const candidates = bright.length ? bright : chromatic.length ? chromatic : ranked;
  if (candidates[0]) selected.push(candidates[0]);
  // A second red shade can be far apart in RGB, yet look like the same glow.
  // Favor distinct chromatic directions, with frequency as a tie breaker.
  while (selected.length < 3) {
    let best: [number, number, number] | undefined,
      bestScore = 0;
    for (const [rank, rgb] of candidates.entries()) {
      const distance = Math.min(
        ...selected.map((color) => {
          const normalize = (c: number[]) => c.map((n) => n - Math.min(...c));
          const a = normalize(rgb),
            b = normalize(color);
          return a.reduce((sum, n, i) => sum + (n - b[i]!) ** 2, 0);
        }),
      );
      const score = distance / (1 + rank * 0.035);
      if (distance > 4900 && score > bestScore) {
        best = rgb;
        bestScore = score;
      }
    }
    if (!best) break;
    selected.push(best);
  }
  if (!selected.length) selected.push([110, 115, 135]);
  while (selected.length < 3) selected.push(selected[0]!);
  return selected;
}

export const posterPaletteBootstrap = `(()=>{try{const p=JSON.parse(localStorage.getItem(${JSON.stringify(posterPaletteKey)})||"null");if(p&&typeof p.poster==="string"&&p.poster.length<=2048&&Array.isArray(p.colors)&&p.colors.length===3&&p.colors.every(c=>Array.isArray(c)&&c.length===3&&c.every(n=>Number.isInteger(n)&&n>=0&&n<=255))){p.colors.forEach((c,i)=>document.documentElement.style.setProperty("--poster-color-"+i,c.join(" ")));document.documentElement.setAttribute("data-poster-ambient","")}}catch{}})();`;
