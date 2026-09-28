/** Disposable API data, separate from the user's synced profile. */
export function readDataCache(namespace: string, key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(namespace) ?? "{}")[key]?.value;
  } catch { return undefined; }
}

export function writeDataCache(namespace: string, key: string, value: unknown, limit = 200): void {
  try {
    let stored: Record<string, { updatedAt: number; value: unknown }> = {};
    try { stored = JSON.parse(localStorage.getItem(namespace) ?? "{}"); } catch { /* Replace corrupt cache. */ }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
    stored[key] = { updatedAt: Date.now(), value };
    const entries = Object.entries(stored).filter(([, entry]) => entry && Number.isFinite(entry.updatedAt))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, limit);
    localStorage.setItem(namespace, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* Full or disabled storage must not block API data. */ }
}
