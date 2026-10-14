import { spawn, spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repository = process.argv[2] ?? "quiddens/animesoul-dev";
const tag = process.argv[3] ?? "dev";
if (
  !/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository) ||
  !/^[\w][\w.-]{0,127}$/.test(tag)
)
  throw new Error(
    "Usage: node scripts/docker/publish-dev-image.mjs username/repository tag [--prepare-only]",
  );
const [namespace, name] = repository.split("/");
const config = JSON.parse(
  await readFile(
    path.join(process.env.DOCKER_CONFIG ?? path.join(os.homedir(), ".docker"), "config.json"),
    "utf8",
  ),
);
const store = config.credHelpers?.["https://index.docker.io/v1/"] ?? config.credsStore;
if (!store)
  throw new Error(
    "Log in with Docker Desktop or docker login first; a credential helper is required.",
  );
const helper =
  process.env.DOCKER_CREDENTIAL_HELPER ??
  (process.platform === "win32" && store === "desktop"
    ? path.join(
        process.env.LOCALAPPDATA,
        "Programs",
        "DockerDesktop",
        "resources",
        "bin",
        "docker-credential-desktop.exe",
      )
    : `docker-credential-${store}`);
function credential(address) {
  const result = spawnSync(helper, ["get"], {
    input: address + "\n",
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}
const hubPath = `/v2/namespaces/${namespace}/repositories/${name}`;
async function request(route, token, options = {}) {
  return fetch("https://hub.docker.com" + route, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
}
let token;
const access = credential("https://index.docker.io/v1/access-token");
if (access?.Secret) {
  const probe = await request(hubPath, access.Secret);
  if ([200, 404].includes(probe.status)) token = access.Secret;
}
if (!token) {
  const saved = credential("https://index.docker.io/v1/");
  if (!saved?.Secret)
    throw new Error("Docker Hub credentials are unavailable. Log in to Docker Desktop first.");
  const response = await request("/v2/auth/token", null, {
    method: "POST",
    body: JSON.stringify({ identifier: saved.Username, secret: saved.Secret }),
  });
  if (!response.ok)
    throw new Error(
      `Docker Hub authentication failed (${response.status}); refresh Docker Desktop login or use a PAT with docker login.`,
    );
  token = (await response.json()).access_token;
}
if (!token) throw new Error("Docker Hub did not return an access token.");
let response = await request(hubPath, token);
if (response.status === 404) {
  response = await request(`/v2/namespaces/${namespace}/repositories`, token, {
    method: "POST",
    body: JSON.stringify({
      namespace,
      name,
      registry: "docker.io",
      is_private: true,
      description: "Private AnimeSoul test environment with full catalog and one owner account",
      full_description:
        "Self-contained development image: web, administration, API, worker and PostgreSQL. The full catalog is restored on first boot; a single owner account and MFA credentials are generated in the persistent volume. No original user accounts or provider keys are included. See the project docs/operations/DEV_IMAGE.md for build, launch and credential commands.",
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      `Private repository creation failed (${response.status}): ${String(result.message ?? result.detail ?? "Check repository permissions and your private repository quota.")}`,
    );
  }
  console.info(`Created private repository: ${repository}`);
  response = await request(hubPath, token);
}
if (!response.ok)
  throw new Error(
    `Cannot verify repository visibility (${response.status}). No image will be pushed.`,
  );
const repo = await response.json();
if (repo.is_private !== true)
  throw new Error("Repository is public. Refusing to push the development image.");
console.info(`Verified private repository: ${repository}`);
if (!process.argv.includes("--prepare-only")) {
  const image = `${repository}:${tag}`;
  const child = spawn("docker", ["push", image], { windowsHide: true, stdio: "inherit" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`docker push failed (${code})`)),
    );
  });
  const verifiedResponse = await request(hubPath, token);
  if (!verifiedResponse.ok || (await verifiedResponse.json()).is_private !== true)
    throw new Error("Could not confirm private visibility after publication.");
  const tagResponse = await request(`${hubPath}/tags/${tag}`, token);
  if (!tagResponse.ok) throw new Error(`Cannot verify the published tag (${tagResponse.status}).`);
  const published = await tagResponse.json();
  const anonymousAuth = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!anonymousAuth.ok) throw new Error("Could not check anonymous pull access.");
  const anonymousToken = (await anonymousAuth.json()).token;
  const anonymousPull = await fetch(
    `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`,
    {
      method: "HEAD",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${anonymousToken}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
    },
  );
  if (![401, 403].includes(anonymousPull.status))
    throw new Error(`Anonymous pull denial was not confirmed (${anonymousPull.status}).`);
  const report = {
    image,
    private: true,
    anonymousPullDenied: true,
    verifiedAt: new Date().toISOString(),
    digest: published.digest,
    images: published.images?.map(({ architecture, os: operatingSystem, digest }) => ({
      architecture,
      os: operatingSystem,
      digest,
    })),
  };
  await mkdir("artifacts/dev-image", { recursive: true });
  await writeFile(
    `artifacts/dev-image/published-${tag}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.info(JSON.stringify(report, null, 2));
}
