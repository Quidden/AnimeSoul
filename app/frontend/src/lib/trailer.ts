const YOUTUBE_HOST = /(^|\.)youtube(?:-nocookie)?\.com$/i;

/** Build a clean, decorative embed URL without YouTube playlist controls. */
export function homeTrailerEmbedUrl(rawUrl: string, startAt: number, origin?: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const isYoutube = YOUTUBE_HOST.test(url.hostname);
  if (isYoutube) {
    // `playlist` is commonly added to loop one video, but it also enables the
    // previous/next overlay that must not appear in the decorative home hero.
    url.searchParams.delete("playlist");
    url.searchParams.delete("loop");
    url.searchParams.set("enablejsapi", "1");
    if (origin) url.searchParams.set("origin", origin);
  }

  url.searchParams.set("autoplay", "1");
  url.searchParams.set("mute", "1");
  url.searchParams.set("controls", "0");
  url.searchParams.set("autohide", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("disablekb", "1");
  url.searchParams.set("fs", "0");
  url.searchParams.set("iv_load_policy", "3");
  url.searchParams.set("modestbranding", "1");
  url.searchParams.set("start", String(Math.max(0, Math.floor(startAt))));
  return url.toString();
}

export function isYouTubeTrailer(url: string) {
  try {
    return YOUTUBE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
