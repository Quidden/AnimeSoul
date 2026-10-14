export function trailerEmbed(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const youtube = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"];
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : youtube.includes(url.hostname)
          ? (url.searchParams.get("v") ??
            url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})(?:\/|$)/)?.[1])
          : undefined;
    if (id && /^[\w-]{11}$/.test(id)) return "https://www.youtube-nocookie.com/embed/" + id;
  } catch {
    /* Unsupported metadata is omitted. */
  }
  return null;
}
