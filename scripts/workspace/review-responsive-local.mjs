import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const document = await readFile(
  new URL("../../artifacts/admin-modernization/responsive-review.html", import.meta.url),
);
const server = createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(document);
});
server.listen(18823, "127.0.0.1", () =>
  console.log("Responsive CSS snapshot: http://localhost:18823"),
);
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
