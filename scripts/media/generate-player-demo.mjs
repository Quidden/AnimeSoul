import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("generate-player-demo.html", import.meta.url));
createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(html);
}).listen(18890, "127.0.0.1", () =>
  console.log("Player demo scene generator: http://127.0.0.1:18890"),
);
