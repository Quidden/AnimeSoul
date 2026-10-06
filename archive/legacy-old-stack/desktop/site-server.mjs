import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function nodeRequestToWeb(request, port) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const init = {
    method: request.method,
    headers: request.headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(response, target) {
  target.statusCode = response.status;
  for (const [name, value] of response.headers) target.setHeader(name, value);
  if (!response.body) return target.end();
  Readable.fromWeb(response.body).pipe(target);
}

export async function startSiteServer({ root, port = 32101, testMode = false }) {
  const clientRoot = path.resolve(root, "dist", "client");
  const workerPath = path.resolve(root, "dist", "server", "index.js");
  const { default: worker } = await import(`${pathToFileURL(workerPath).href}?desktop=${Date.now()}`);

  const assets = {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname.replace(/^\/+/, "");
      const filePath = path.resolve(clientRoot, relative);
      if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${path.sep}`)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const info = await stat(filePath);
        if (!info.isFile()) return new Response("Not found", { status: 404 });
        return new Response(Readable.toWeb(createReadStream(filePath)), {
          headers: {
            "content-length": String(info.size),
            "content-type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };

  const server = createServer(async (request, response) => {
    try {
      const webRequest = nodeRequestToWeb(request, port);
      const requestUrl = new URL(webRequest.url);
      if (testMode && requestUrl.pathname === "/__desktop_player_test") {
        const source = requestUrl.searchParams.get("src") ?? "";
        if (!source.startsWith("https://")) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Invalid player URL");
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><body style="margin:0;background:#000"><iframe src="${source.replaceAll('"', "&quot;")}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe></body></html>`);
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        const asset = await assets.fetch(webRequest);
        if (asset.status !== 404) {
          await sendWebResponse(asset, response);
          return;
        }
      }
      const result = await worker.fetch(webRequest, { ASSETS: assets }, {
        waitUntil() {},
        passThroughOnException() {},
      });
      await sendWebResponse(result, response);
    } catch (error) {
      console.error("[AnimeSoul desktop server]", error);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("AnimeSoul could not load");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
