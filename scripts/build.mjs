import { run } from "./run.mjs";
for (const args of [
  ["--filter", "@animesoul/database", "generate"],
  ["--filter", "@animesoul/contracts", "build"],
  ["--filter", "@animesoul/database", "build"],
  ["--filter", "@animesoul/api", "build"],
  ["--filter", "@animesoul/web", "build"],
  ["--filter", "@animesoul/admin", "build"],
])
  await run(args);
