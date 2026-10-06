/** Non-React runtime shared by account requests and the existing save client. */
let website = false;
let accountId: string | null = null;
let saveRevision: number | undefined;
let saveConflict = false;

export function setAccountRuntime(enabled: boolean, id: string | null) {
  if (id !== accountId) {
    saveRevision = undefined;
    saveConflict = false;
  }
  website = enabled;
  accountId = id;
}

export function isWebsiteRuntime() { return website; }
export function currentAccountId() { return accountId; }
export function scopedStorageKey(key: string) {
  return website ? `animesoul:account:${accountId ?? "guest"}:${key}` : key;
}
export function observeSaveRevision(value: unknown) {
  if (typeof value === "number") {
    saveRevision = value;
    saveConflict = false;
  }
}
export function accountSaveRevision() { return saveRevision; }
export function hasSaveConflict() { return saveConflict; }
export function markSaveConflict() { saveConflict = true; }

export function csrfToken() {
  if (typeof document === "undefined") return "";
  const entries = document.cookie.split("; ");
  const entry = entries.find(value => value.startsWith("__Host-animesoul_csrf="))
    ?? entries.find(value => value.startsWith("animesoul_csrf="));
  return entry ? decodeURIComponent(entry.slice(entry.indexOf("=") + 1)) : "";
}

export function accountFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (website && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken());
    if (accountId) headers.set("X-Account-Id", accountId);
  }
  return fetch(input, { ...init, headers, credentials: init.credentials ?? "same-origin" });
}
