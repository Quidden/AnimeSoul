import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  accountFetch, currentAccountId, observeSaveRevision, scopedStorageKey, setAccountRuntime,
} from "../src/lib/accountRuntime";
import { readLocal, saveStorageDocument, writeLocal } from "../src/lib/storage";
import { downloadIv, downloadWebsiteEpisodes, parseDownloadPlaylist } from "../src/lib/websiteDownloads";
import type { DownloadJobRequest } from "../src/lib/downloads";
import type { StorageDocument } from "../src/lib/types";

const nativeFetch = globalThis.fetch;
const descriptors = Object.fromEntries(["document", "window", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const sample: StorageDocument = {
  schemaVersion: 3, updatedAt: "2026-10-05T00:00:00Z", activeProfile: "default",
  profiles: [{ id: "default", name: "Основной", snapshot: {} as StorageDocument["profiles"][number]["snapshot"] }],
};

afterEach(() => {
  globalThis.fetch = nativeFetch;
  setAccountRuntime(false, null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function setup(id: string) {
  setAccountRuntime(true, id);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "__Host-animesoul_csrf=bound-csrf; unrelated=ignored" } });
}
function success(revision: number) { return Response.json({ saved: true, serverRevision: revision }); }
function tick() { return new Promise<void>(resolve => setImmediate(resolve)); }

test("website cache keys isolate accounts while local keys remain compatible", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  setup("alice"); writeLocal("progress", { episode: 4 });
  setup("bob"); assert.deepEqual(readLocal("progress", {}), {}); writeLocal("progress", { episode: 1 });
  setup("alice"); assert.deepEqual(readLocal("progress", {}), { episode: 4 });
  setAccountRuntime(false, null); assert.equal(scopedStorageKey("progress"), "progress");
  assert.deepEqual(readLocal("progress", {}), {});
});

test("website mutations send the bound account and CSRF without losing JSON headers", async () => {
  setup("alice");
  globalThis.fetch = async (_input, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("X-Account-Id"), "alice");
    assert.equal(headers.get("X-CSRF-Token"), "bound-csrf");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(options?.credentials, "same-origin");
    return success(1);
  };
  await accountFetch("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
});

test("overlapping account saves use sequential committed revisions", async () => {
  setup("alice"); observeSaveRevision(0);
  const revisions: unknown[] = [];
  let release: (value: Response) => void = () => undefined;
  globalThis.fetch = async (_input, options) => {
    revisions.push(JSON.parse(String(options?.body)).serverRevision);
    if (revisions.length === 1) return new Promise<Response>(resolve => { release = resolve; });
    return success(2);
  };
  const first = saveStorageDocument(sample);
  const second = saveStorageDocument(sample);
  await tick(); assert.deepEqual(revisions, [0]);
  release(success(1));
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  assert.deepEqual(revisions, [0, 1]);
});

test("a save conflict blocks retries until a fresh server read", async () => {
  setup("alice"); observeSaveRevision(0);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 409 }); };
  assert.equal((await saveStorageDocument(sample)).status, 409);
  assert.equal((await saveStorageDocument(sample)).status, 409);
  assert.equal(calls, 1);
  observeSaveRevision(7);
  globalThis.fetch = async (_input, options) => {
    assert.equal(JSON.parse(String(options?.body)).serverRevision, 7);
    return success(8);
  };
  assert.equal((await saveStorageDocument(sample)).status, 200);
});

test("queued old-account saves cannot be submitted after switching accounts", async () => {
  setup("alice"); observeSaveRevision(0);
  let calls = 0;
  let release: (value: Response) => void = () => undefined;
  globalThis.fetch = async () => { calls++; return new Promise<Response>(resolve => { release = resolve; }); };
  const first = saveStorageDocument(sample);
  const stale = saveStorageDocument(sample);
  await tick(); setup("bob"); observeSaveRevision(9); release(success(1));
  await first; assert.equal((await stale).status, 409); assert.equal(calls, 1);
  assert.equal(currentAccountId(), "bob");
  globalThis.fetch = async (_input, options) => { assert.equal(JSON.parse(String(options?.body)).serverRevision, 9); return success(10); };
  await saveStorageDocument(sample);
});

test("UI cancellation after submission does not lose the committed revision", async () => {
  setup("alice"); observeSaveRevision(0);
  const controller = new AbortController();
  let release: (value: Response) => void = () => undefined;
  globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
  const submitted = saveStorageDocument(sample, controller.signal);
  await tick(); controller.abort(); release(success(1)); await submitted;
  globalThis.fetch = async (_input, options) => { assert.equal(JSON.parse(String(options?.body)).serverRevision, 1); return success(2); };
  assert.equal((await saveStorageDocument(sample)).status, 200);
});


test("guests keep a separate browser cache and never call the account save API", async () => {
  setAccountRuntime(true, null);
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("guest must not write account saves"); };
  const response = await saveStorageDocument(sample);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).browserOnly, true);
  assert.equal(requests, 0);
  assert.equal(scopedStorageKey("favorites"), "animesoul:account:guest:favorites");
  setup("alice");
  assert.notEqual(scopedStorageKey("favorites"), "animesoul:account:guest:favorites");
});

test("HLS download selects the requested master rendition and rejects a missing quality", () => {
  const manifest = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n360/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1280x720\n720/index.m3u8\n";
  assert.equal(parseDownloadPlaylist(manifest, "https://cdn.example/master.m3u8", 720).variant, "https://cdn.example/720/index.m3u8");
  assert.throws(() => parseDownloadPlaylist(manifest, "https://cdn.example/master.m3u8", 480), /480p/);
});

test("fMP4 byte ranges preserve initialization and implicit offsets", () => {
  const manifest = '#EXTM3U\n#EXT-X-MAP:URI="movie.mp4",BYTERANGE="10@0"\n#EXT-X-BYTERANGE:20@10\nmovie.mp4\n#EXT-X-BYTERANGE:30\nmovie.mp4\n#EXT-X-ENDLIST';
  const result = parseDownloadPlaylist(manifest, "https://cdn.example/list.m3u8", 720);
  assert.equal(result.extension, "mp4");
  assert.deepEqual(result.parts.map(part => part.range), ["bytes=0-9", "bytes=10-29", "bytes=30-59"]);
  assert.throws(() => parseDownloadPlaylist('#EXTM3U\n#EXT-X-BYTERANGE:10\nmovie.mp4\n#EXT-X-ENDLIST', "https://cdn.example/list.m3u8", 720), /диапазон/);
});

test("HLS uses sequence or explicit AES IV and rejects live or unsupported encrypted playlists", () => {
  const result = parseDownloadPlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:257\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n1.ts\n#EXT-X-KEY:METHOD=NONE\n2.ts\n#EXT-X-ENDLIST', "https://cdn.example/list.m3u8", 720);
  assert.deepEqual([...downloadIv(result.parts[0].encryption!)].slice(-2), [1, 1]);
  assert.equal(result.parts[1].encryption, undefined);
  assert.equal(downloadIv({ url: "https://cdn.example/key", iv: "0xFF", sequence: 0 }).at(-1), 255);
  assert.throws(() => parseDownloadPlaylist("#EXTM3U\n1.ts", "https://cdn.example/list.m3u8", 720), /полной серии/);
  assert.throws(() => parseDownloadPlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,AUDIO="audio"\nvideo.m3u8', "https://cdn.example/master.m3u8", 720), /звук отдельным/);
  assert.throws(() => parseDownloadPlaylist("#EXTM3U\n#EXT-X-I-FRAMES-ONLY\n1.ts\n#EXT-X-ENDLIST", "https://cdn.example/list.m3u8", 720), /предпросмотра/);
  assert.throws(() => parseDownloadPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n1.ts\n#EXT-X-ENDLIST', "https://cdn.example/list.m3u8", 720), /шифрования/);
  assert.throws(() => parseDownloadPlaylist("#EXTM3U\nhttp://cdn.example/1.ts\n#EXT-X-ENDLIST", "https://cdn.example/list.m3u8", 720), /HTTPS/);
});

const downloadRequest: DownloadJobRequest = {
  animeId: 1, title: "Title", quality: 720,
  episodes: [{ videoId: 1, season: 1, episode: "1", dubbing: "Voice", iframeUrl: "https://kodik.info/seria/1" }],
};
function downloadFolder() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  let created = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { showDirectoryPicker: async () => ({
    getFileHandle: async (_name: string, options?: { create: boolean }) => {
      if (!options?.create) throw new DOMException("missing", "NotFoundError");
      created++;
      return { createWritable: async () => ({ write: async (chunk: Uint8Array) => { chunks.push(new Uint8Array(chunk)); }, close: async () => { closed = true; }, abort: async () => { aborted = true; } }) };
    },
  }) } });
  return { chunks, get closed() { return closed; }, get aborted() { return aborted; }, get created() { return created; } };
}

test("website download decrypts AES-128 HLS to a video file and uses the protected API", async () => {
  setup("alice");
  const folder = downloadFolder();
  const rawKey = new Uint8Array(16).fill(7);
  const plain = new Uint8Array([0x47, 1, 2, 3, 4, 5]);
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-CBC", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, plain);
  const requested: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input); requested.push(url);
    if (url === "/api/kodik/download") {
      assert.equal(new Headers(options?.headers).get("X-Account-Id"), "alice");
      return Response.json({ sources: [{ quality: 720, src: "https://cdn.example/list.m3u8", type: "hls" }] });
    }
    assert.equal(options?.credentials, "omit");
    if (url.endsWith("list.m3u8")) return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n1.ts\n#EXT-X-ENDLIST');
    if (url.endsWith("/key")) return new Response(rawKey);
    return new Response(encrypted);
  };
  assert.equal(await downloadWebsiteEpisodes(downloadRequest, new AbortController().signal, () => undefined), 1);
  assert.deepEqual(Buffer.concat(folder.chunks), Buffer.from(plain));
  assert.equal(folder.closed, true); assert.equal(folder.aborted, false);
  assert.equal(requested[0], "/api/kodik/download");
});

test("denied download permissions never fetch media or create a file", async () => {
  setup("alice"); const folder = downloadFolder(); let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ detail: "Нет разрешения" }, { status: 403 }); };
  await assert.rejects(downloadWebsiteEpisodes(downloadRequest, new AbortController().signal, () => undefined), /Нет разрешения/);
  assert.equal(requests, 1); assert.equal(folder.created, 0);
});

test("switching accounts mid-download aborts the file instead of committing it", async () => {
  setup("alice"); const folder = downloadFolder();
  globalThis.fetch = async input => {
    if (String(input) === "/api/kodik/download") return Response.json({ sources: [{ quality: 720, src: "https://cdn.example/movie.mp4", type: "video" }] });
    setAccountRuntime(true, "bob");
    return new Response(new Uint8Array([1, 2, 3]));
  };
  await assert.rejects(downloadWebsiteEpisodes(downloadRequest, new AbortController().signal, () => undefined), /Аккаунт изменился/);
  assert.equal(folder.aborted, true); assert.equal(folder.closed, false); assert.equal(folder.chunks.length, 0);
});
