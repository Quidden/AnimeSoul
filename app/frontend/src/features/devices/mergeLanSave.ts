import { isStorageDocument } from "../../lib/storage";
import type { StorageDocument } from "../../lib/types";
import { lanRequest } from "./api";

/** Object key order is irrelevant when checking whether a merge changed saves. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function mergeLanSave(document: StorageDocument, signal: AbortSignal) {
  const merged = await lanRequest<StorageDocument>("/merge", "POST", document, signal);
  return isStorageDocument(merged) && canonical(document.profiles) !== canonical(merged.profiles) ? merged : null;
}
