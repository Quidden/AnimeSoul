const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Local host aliases share only the configured scheme and port; public origins stay exact. */
export function isTrustedRequestOrigin(value: unknown, configuredUrl: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const expected = new URL(configuredUrl);
    if (!["http:", "https:"].includes(expected.protocol)) return false;
    if (value === expected.origin) return true;
    const actual = new URL(value);
    return (
      value === actual.origin &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port &&
      loopbackHosts.has(expected.hostname) &&
      loopbackHosts.has(actual.hostname)
    );
  } catch {
    return false;
  }
}
