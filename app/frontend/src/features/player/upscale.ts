export type UpscaleTarget = 0 | 1080 | 1440 | 2160;
export type UpscaleProfile = "light" | "advanced";
export const UPSCALE_MODES = [2160, 1440, 1080] as const;
export const upscaleLabel = (height: number) => height === 2160 ? "4K" : height === 1440 ? "2K" : "Full HD";

export function outputSize(width: number, height: number, target: number) {
  if (!(width > 0 && height > 0 && target > 0)) return [0, 0] as const;
  // Fit the target rectangle, but never downsample a higher-resolution source.
  const scale = Math.max(1, Math.min(target * 16 / 9 / width, target / height));
  return [Math.round(width * scale), Math.round(height * scale)] as const;
}

export function replacementPosition(time: number, duration: number) {
  const outside = Number.isFinite(duration) && time >= duration;
  return { time: Math.max(0, Math.min(Math.max(0, time - 5), Number.isFinite(duration) ? Math.max(0, duration - 1) : Infinity)), outside };
}
