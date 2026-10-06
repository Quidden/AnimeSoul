import { accountFetch, currentAccountId } from "./accountRuntime";
import type { DownloadEpisodeRequest, DownloadJobRequest } from "./downloads";
import type { KodikDirectSource } from "./kodikStream";

const BROWSER_BUFFER_LIMIT = 1024 * 1024 * 1024;
const MANIFEST_LIMIT = 2 * 1024 * 1024;
type Encryption = { url: string; iv?: string; sequence: number };
export type DownloadPart = { url: string; range?: string; encryption?: Encryption };
export type DownloadPlaylist = { variant?: string; parts: DownloadPart[]; extension: "mp4" | "ts" };
type WritableFile = { write: (data: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type DownloadDirectory = {
  getFileHandle: (name: string, options?: { create: boolean }) => Promise<{ createWritable: () => Promise<WritableFile> }>;
};

function mediaUrl(raw: string, base?: string) {
  const url = new URL(raw, base);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Источник скачивания должен использовать HTTPS.");
  return url.href;
}
function attributes(line: string) {
  return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)]
    .map(match => [match[1], match[2].replace(/^"|"$/g, "")]));
}

/** VOD HLS: master playlists, transport streams, fMP4, byte ranges and AES-128. */
export function parseDownloadPlaylist(text: string, base: string, quality: number): DownloadPlaylist {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("Источник вернул некорректный HLS-плейлист.");
  const variants: { url: string; height: number; audio?: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith("#EXT-X-STREAM-INF:")) {
      const info = attributes(lines[index]);
      const next = lines[index + 1];
      if (!next || next.startsWith("#")) throw new Error("Некорректный список качества HLS.");
      variants.push({ url: mediaUrl(next, base), height: Number(info.RESOLUTION?.split("x")[1]) || 0, audio: info.AUDIO });
    }
  }
  if (variants.length) {
    const selected = variants.find(variant => variant.height === quality)
      ?? variants.find(variant => !variant.height);
    if (!selected) throw new Error(`Источник не предоставил ${quality}p для скачивания.`);
    if (selected.audio && lines.some(line => {
      const info = attributes(line);
      return line.startsWith("#EXT-X-MEDIA:") && info.TYPE === "AUDIO" && info["GROUP-ID"] === selected.audio && info.URI;
    })) throw new Error("Источник предоставил звук отдельным файлом. Выберите другое качество или озвучку для скачивания.");
    return { variant: selected.url, parts: [], extension: "ts" };
  }
  if (lines.includes("#EXT-X-I-FRAMES-ONLY")) throw new Error("Источник предоставил только кадры предпросмотра вместо серии.");
  if (!lines.includes("#EXT-X-ENDLIST")) throw new Error("Дождитесь публикации полной серии перед скачиванием.");
  const parts: DownloadPart[] = [];
  let sequence = 0;
  let key: { url: string; iv?: string } | undefined;
  let rangeSpec: string | undefined;
  let previousRange: { url: string; end: number } | undefined;
  let extension: "mp4" | "ts" = "ts";
  const add = (url: string, spec?: string, initialization = false) => {
    let range: string | undefined;
    if (spec) {
      const match = /^(\d+)(?:@(\d+))?$/.exec(spec);
      if (!match) throw new Error("Некорректный диапазон HLS.");
      const length = Number(match[1]);
      const start = match[2] != null ? Number(match[2]) : previousRange?.url === url ? previousRange.end + 1 : NaN;
      const end = start + length - 1;
      if (!Number.isSafeInteger(end) || start < 0 || length < 1) throw new Error("Некорректный диапазон HLS.");
      range = `bytes=${start}-${end}`;
      previousRange = { url, end };
    } else previousRange = undefined;
    if (initialization && key && !key.iv) throw new Error("Для зашифрованного fMP4 требуется IV источника.");
    parts.push({ url, range, encryption: key ? { ...key, sequence } : undefined });
  };
  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      sequence = Number(line.split(":")[1]);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Некорректная последовательность HLS.");
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const info = attributes(line);
      if (info.METHOD === "NONE") key = undefined;
      else if (info.METHOD === "AES-128" && (!info.KEYFORMAT || info.KEYFORMAT === "identity") && info.URI) {
        if (info.IV && !/^0x[\da-f]{1,32}$/i.test(info.IV)) throw new Error("Некорректный IV источника.");
        key = { url: mediaUrl(info.URI, base), iv: info.IV };
      } else throw new Error("Этот формат шифрования не поддерживает скачивание.");
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const info = attributes(line);
      if (!info.URI) throw new Error("Источник не предоставил начало fMP4-файла.");
      extension = "mp4";
      add(mediaUrl(info.URI, base), info.BYTERANGE, true);
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) rangeSpec = line.slice(line.indexOf(":") + 1);
    else if (line.startsWith("#EXT-X-GAP")) throw new Error("Источник ещё не предоставил все части серии.");
    else if (!line.startsWith("#")) {
      add(mediaUrl(line, base), rangeSpec);
      rangeSpec = undefined;
      sequence++;
    }
  }
  if (!parts.length || parts.length > 20_000) throw new Error("Некорректное число частей серии.");
  return { parts, extension };
}

export function downloadIv(encryption: Encryption) {
  const hex = encryption.iv ? encryption.iv.slice(2).padStart(32, "0") : BigInt(encryption.sequence).toString(16).padStart(32, "0");
  return Uint8Array.from(hex.match(/../g)!, value => Number.parseInt(value, 16));
}

async function sourceResponse(url: string, signal: AbortSignal, range?: string) {
  const response = await fetch(mediaUrl(url), {
    signal, credentials: "omit", referrerPolicy: "no-referrer", headers: range ? { Range: range } : undefined,
  });
  if (!response.ok || (range && response.status !== 206)) throw new Error("Источник не отдал файл серии. Попробуйте ещё раз.");
  mediaUrl(response.url || url);
  if (/text\/html|application\/json/i.test(response.headers.get("Content-Type") ?? "")) throw new Error("Источник вернул ошибку вместо видео.");
  return response;
}
async function consume(response: Response, write: (chunk: Uint8Array) => Promise<void>, signal: AbortSignal) {
  if (!response.body) throw new Error("Источник вернул пустой ответ.");
  const reader = response.body.getReader();
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      await write(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function boundedBytes(response: Response, maximum: number, signal: AbortSignal) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  await consume(response, async chunk => {
    length += chunk.byteLength;
    if (length > maximum) throw new Error("Источник вернул слишком большой служебный файл.");
    chunks.push(chunk);
  }, signal);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
function filename(request: DownloadJobRequest, episode: DownloadEpisodeRequest, extension: string) {
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().slice(0, 90);
  return `${safe(request.title)} - S${episode.season}E${safe(episode.episode)} - ${safe(episode.dubbing)} - ${request.quality}p.${extension}`;
}

async function destination(directory: DownloadDirectory | null, name: string) {
  let file: WritableFile | undefined;
  if (directory) {
    const dot = name.lastIndexOf(".");
    for (let copy = 0; copy < 1000; copy++) {
      const candidate = copy ? `${name.slice(0, dot)} (${copy + 1})${name.slice(dot)}` : name;
      try { await directory.getFileHandle(candidate); }
      catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
        file = await (await directory.getFileHandle(candidate, { create: true })).createWritable();
        break;
      }
    }
    if (!file) throw new Error("Не удалось выбрать свободное имя файла.");
  }
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  return {
    async write(chunk: Uint8Array) {
      bytes += chunk.byteLength;
      if (file) await file.write(chunk);
      else {
        if (bytes > BROWSER_BUFFER_LIMIT) throw new Error("Для файла больше 1 ГБ используйте браузер с выбором папки скачивания, например Chrome или Edge.");
        chunks.push(new Uint8Array(chunk).buffer);
      }
      return bytes;
    },
    async finish() {
      if (!bytes) throw new Error("Источник вернул пустой файл серии.");
      if (file) await file.close();
      else {
        const url = URL.createObjectURL(new Blob(chunks, { type: name.endsWith(".ts") ? "video/mp2t" : "video/mp4" }));
        const link = document.createElement("a");
        link.href = url; link.download = name;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
    async abort() { if (file) await file.abort().catch(() => undefined); chunks.length = 0; },
  };
}

export async function downloadWebsiteEpisodes(request: DownloadJobRequest, signal: AbortSignal, notice: (value: string) => void) {
  const account = currentAccountId();
  if (!account) throw new Error("Войдите в аккаунт для скачивания.");
  // Invoke the picker while the download button's user activation is still active.
  const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<DownloadDirectory> }).showDirectoryPicker;
  const directory = picker ? await picker.call(window, { mode: "readwrite" }) : null;
  const assertAccount = () => { signal.throwIfAborted(); if (account !== currentAccountId()) throw new Error("Аккаунт изменился. Скачивание остановлено."); };
  let completed = 0;
  for (const episode of request.episodes) {
    assertAccount();
    notice(`Получаем серию ${episode.episode} · ${completed + 1} из ${request.episodes.length}…`);
    const response = await accountFetch("/api/kodik/download", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(episode), signal,
    });
    const result = await response.json() as { sources?: KodikDirectSource[]; detail?: string };
    if (!response.ok) throw new Error(result.detail || "Нет доступа к скачиванию.");
    assertAccount();
    const choices = (result.sources ?? []).filter(source => source.quality === request.quality);
    const source = choices.find(source => !/hls|mpegurl/i.test(source.type) && !/\.m3u8(?:\?|$)/i.test(source.src)) ?? choices[0];
    if (!source) throw new Error(`Серия ${episode.episode}: качество ${request.quality}p недоступно.`);
    let playlist: DownloadPlaylist | undefined;
    let direct: Response | undefined;
    if (/hls|mpegurl/i.test(source.type) || /\.m3u8(?:\?|$)/i.test(source.src)) {
      let url = mediaUrl(source.src);
      for (let depth = 0; depth < 4; depth++) {
        const manifest = await sourceResponse(url, signal);
        const text = new TextDecoder().decode(await boundedBytes(manifest, MANIFEST_LIMIT, signal));
        playlist = parseDownloadPlaylist(text, manifest.url || url, request.quality);
        if (!playlist.variant) break;
        url = playlist.variant;
      }
      if (!playlist || playlist.variant) throw new Error("Источник вернул слишком много вложенных плейлистов.");
    } else direct = await sourceResponse(source.src, signal);
    const output = await destination(directory, filename(request, episode, playlist?.extension ?? "mp4"));
    let lastNotice = 0;
    const write = async (chunk: Uint8Array) => {
      assertAccount();
      const bytes = await output.write(chunk);
      if (Date.now() - lastNotice >= 200) {
        notice(`Скачиваем серию ${episode.episode} · ${(bytes / 1024 / 1024).toFixed(1)} МБ · ${completed + 1} из ${request.episodes.length}`);
        lastNotice = Date.now();
      }
    };
    try {
      if (direct) await consume(direct, write, signal);
      else {
        const keys = new Map<string, CryptoKey>();
        for (const part of playlist!.parts) {
          assertAccount();
          const content = await sourceResponse(part.url, signal, part.range);
          if (part.encryption) {
            let key = keys.get(part.encryption.url);
            if (!key) {
              const raw = await boundedBytes(await sourceResponse(part.encryption.url, signal), 16, signal);
              if (raw.length !== 16) throw new Error("Источник вернул некорректный ключ HLS.");
              key = await crypto.subtle.importKey("raw", raw.buffer, "AES-CBC", false, ["decrypt"]);
              keys.set(part.encryption.url, key);
            }
            const encrypted = await boundedBytes(content, 64 * 1024 * 1024, signal);
            const decoded = await crypto.subtle.decrypt({ name: "AES-CBC", iv: downloadIv(part.encryption) }, key, encrypted.buffer);
            await write(new Uint8Array(decoded));
          } else await consume(content, write, signal);
        }
      }
      assertAccount();
      await output.finish(); completed++;
    } catch (error) { await output.abort(); throw error; }
  }
  return completed;
}
