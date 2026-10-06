export function siteConfiguration() {
  const url = new URL(process.env.SITE_URL ?? "http://localhost:8021");
  const indexable = process.env.PUBLIC_INDEXING === "true";
  if (
    indexable &&
    (url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      process.env.DEMO_CATALOG === "true")
  ) {
    throw new Error("Indexing requires a public HTTPS site and a real catalog.");
  }
  return { url, indexable };
}
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
