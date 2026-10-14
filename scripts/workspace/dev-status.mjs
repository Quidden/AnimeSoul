import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function portIsAvailable({ host, port }) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function matchesService(service, timeoutMs) {
  try {
    const host =
      service.host === "0.0.0.0" ? "127.0.0.1" : service.host === "::" ? "::1" : service.host;
    const address = host.includes(":") ? `[${host}]` : host;
    const response = await fetch(`http://${address}:${service.port}${service.route}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) return false;
    if (service.name === "API") {
      const health = await response.json();
      return health.status === "ok" && health.version === "0.4.0";
    }
    const title = (await response.text()).match(/<title>([^<]*)<\/title>/)?.[1];
    return title === service.title;
  } catch {
    return false;
  }
}

export async function inspectDevelopment({
  apiHost = process.env.API_HOST || "127.0.0.1",
  apiPort = Number(process.env.API_PORT || 8020),
  webPort = 8021,
  adminPort = 8022,
  timeoutMs = 15000,
} = {}) {
  const services = [
    { name: "API", host: apiHost, port: apiPort, route: "/api/health" },
    { name: "Web", host: "127.0.0.1", port: webPort, route: "/", title: "AnimeSoul — мир аниме" },
    { name: "Admin", host: "127.0.0.1", port: adminPort, route: "/", title: "AnimeSoul Admin" },
  ];
  const available = await Promise.all(services.map(portIsAvailable));
  const busy = services.filter((_, index) => !available[index]);
  if (!busy.length) return { state: "available", busy };
  if (busy.length === services.length) {
    const matches = await Promise.all(
      services.map((service) => matchesService(service, timeoutMs)),
    );
    if (matches.every(Boolean)) return { state: "running", busy };
  }
  return { state: "conflict", busy };
}

// Exit 10 lets the Windows launcher open the existing site without setup/build.
export async function checkDevelopment() {
  try {
    const status = await inspectDevelopment();
    if (status.state === "available") return 0;
    if (status.state === "running") {
      console.info("AnimeSoul is already running: http://localhost:8021");
      console.info("Administration: http://localhost:8022. No second server was started.");
      return 10;
    }
    console.error("AnimeSoul cannot start because these ports are occupied:");
    for (const service of status.busy)
      console.error(`  ${service.name}: ${service.host}:${service.port}`);
    console.error(
      "Check the application using these ports. Stop an earlier AnimeSoul launch with Ctrl+C in its terminal.",
    );
    return 1;
  } catch (error) {
    console.error(`AnimeSoul could not check its ports: ${error.code || "unknown error"}.`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await checkDevelopment();
