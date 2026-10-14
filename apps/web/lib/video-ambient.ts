export function videoEdgeColors(pixels: ArrayLike<number>, width: number, height: number) {
  const sums = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if ((pixels[index + 3] ?? 0) < 128) continue;
      const edges = [y < height / 3, x >= (width * 2) / 3, y >= (height * 2) / 3, x < width / 3];
      edges.forEach((included, side) => {
        if (!included) return;
        const sum = sums[side]!;
        for (let channel = 0; channel < 3; channel++) sum[channel]! += pixels[index + channel] ?? 0;
        sum[3]!++;
      });
    }
  return sums.map((sum) =>
    sum.slice(0, 3).map((value) => Math.round(value / Math.max(1, sum[3]!))),
  );
}
