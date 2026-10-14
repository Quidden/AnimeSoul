import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { validateProfileMedia } from "../apps/api/dist/account/profile-media.service.js";
import {
  profileMediaLimits,
  profileEditSchema,
  profileMediaEditSchema,
} from "../packages/contracts/dist/index.js";

const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { default: sharp } = await import(pathToFileURL(requireApi.resolve("sharp")));
async function image(format = "png") {
  return sharp({ create: { width: 24, height: 24, channels: 4, background: "#ad8ed1" } })
    .toFormat(format)
    .toBuffer();
}
async function animatedGif(frames = 2) {
  const pixels = new Uint8Array(8 * 8 * 4 * frames);
  for (let frame = 0; frame < frames; frame++) {
    for (let index = frame * 256; index < (frame + 1) * 256; index += 4) {
      pixels[index + (frame % 3)] = 255;
      pixels[index + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width: 8, height: 8 * frames, channels: 4, pageHeight: 8 } })
    .gif({ loop: 0, delay: Array.from({ length: frames }, () => 100) })
    .toBuffer();
}

test("media validation decodes static formats and all GIF frames, rejects malformed and oversized images", async () => {
  for (const format of ["png", "jpeg", "webp", "gif"])
    assert.equal(
      await validateProfileMedia(await image(format), "avatar"),
      format === "jpeg" ? "jpg" : format,
    );
  const gif = await animatedGif();
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
  assert.equal(await validateProfileMedia(gif, "banner"), "gif");
  await assert.rejects(
    validateProfileMedia(
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
      "avatar",
    ),
  );
  await assert.rejects(validateProfileMedia(Buffer.alloc(0), "avatar"));
  await assert.rejects(validateProfileMedia(Buffer.from("GIF89a invalid"), "banner"));
  await assert.rejects(validateProfileMedia((await image()).subarray(0, 40), "avatar"));
  await assert.rejects(
    validateProfileMedia(Buffer.alloc(profileMediaLimits.avatar + 1), "avatar"),
    (error) => error.getStatus() === 413,
  );
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  await assert.rejects(validateProfileMedia(wide, "banner"));
  await assert.rejects(validateProfileMedia(await animatedGif(301), "banner"));
});

test("media routes authenticate before accepting files and keep ordinary JSON limits", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test" }));
  const server = app.getHttpAdapter().getInstance();
  try {
    const payload = await image();
    for (const kind of ["avatar", "banner"]) {
      const noOrigin = await server.inject({
        method: "POST",
        url: "/api/account/profile/media/" + kind,
        headers: { "content-type": "application/octet-stream" },
        payload,
      });
      assert.equal(noOrigin.statusCode, 403, noOrigin.body);
      const noSession = await server.inject({
        method: "POST",
        url: "/api/account/profile/media/" + kind,
        headers: {
          "content-type": "application/octet-stream",
          origin: "http://localhost:8021",
          "x-animesoul-request": "1",
        },
        payload,
      });
      assert.equal(noSession.statusCode, 401, noSession.body);
    }
    const big = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { padding: "x".repeat(65536) },
    });
    assert.equal(big.statusCode, 413, big.body);
    const auth = app.get(AuthService);
    const writeSession = auth.writeSession;
    auth.writeSession = async () => ({ userId: "11111111-1111-4111-8111-111111111111" });
    try {
      for (const kind of ["avatar", "banner"]) {
        const over = await server.inject({
          method: "POST",
          url: "/api/account/profile/media/" + kind,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(profileMediaLimits[kind] + 1),
          },
          payload,
        });
        assert.equal(over.statusCode, 413, over.body);
      }
    } finally {
      auth.writeSession = writeSession;
    }
  } finally {
    await app.close();
  }
});

test(
  "profile media persists across API restarts, respects ownership and privacy, and cleans replaced files",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.match(url.pathname, /_test$/);
    const artifacts = path.resolve("artifacts");
    await mkdir(artifacts, { recursive: true });
    const storage = await mkdtemp(path.join(artifacts, "profile-media-test-"));
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url.href,
      PROFILE_MEDIA_DIR: storage,
    });
    const app = await createApplication(config);
    const db = app.get(AuthService).db;
    const server = app.getHttpAdapter().getInstance();
    const users = [];
    const tag = randomUUID().slice(0, 12);
    const get = (route, cookie = "") => server.inject({ url: route, headers: { cookie } });
    const post = (route, payload, account = {}, extra = {}) =>
      server.inject({
        method: "POST",
        url: route,
        headers: {
          origin: "http://localhost:8021",
          "x-animesoul-request": "1",
          "x-csrf-token": account.csrf ?? "",
          cookie: account.cookie ?? "",
          ...extra,
        },
        payload,
      });
    async function register(label) {
      const response = await post("/api/auth/register", {
        username: `${label}-${tag}`,
        email: `${label}-${tag}@example.invalid`,
        password: "Media testing пароль 2026",
      });
      assert.equal(response.statusCode, 201, response.body);
      const cookie = response.headers["set-cookie"].split(";")[0];
      const me = (await get("/api/auth/me", cookie)).json();
      users.push(me.id);
      return { id: me.id, username: me.username, cookie, csrf: me.csrfToken };
    }
    const file = (value) =>
      path.join(storage, ...value.replace("/api/profile-media/", "").split("/"));
    try {
      const owner = await register("media-owner");
      const other = await register("media-other");
      const png = await image();
      const gif = await animatedGif();
      const upload = (kind, bytes, account = owner, extra = {}) =>
        post("/api/account/profile/media/" + kind, bytes, account, {
          "content-type": "application/octet-stream",
          ...extra,
        });
      let response = await upload("avatar", png);
      assert.equal(response.statusCode, 201, response.body);
      const avatar = response.json().avatar;
      assert.match(avatar, new RegExp(`/api/profile-media/${owner.id}/avatar/.+\\.png$`));
      response = await upload("banner", gif);
      assert.equal(response.statusCode, 201, response.body);
      const banner = response.json().banner;
      assert.deepEqual(await readFile(file(banner)), gif);
      assert.equal(
        (await sharp(await readFile(file(banner)), { animated: true }).metadata()).pages,
        2,
      );
      assert.equal((await get("/api/auth/me", owner.cookie)).json().avatar, avatar);
      assert.equal((await get("/api/account/profile", owner.cookie)).json().banner, banner);
      assert.deepEqual((await get(banner, owner.cookie)).rawPayload, gif);
      assert.equal((await get(banner)).statusCode, 404);
      assert.equal((await get(avatar, other.cookie)).statusCode, 404);
      assert.equal((await get("/api/account/profile", other.cookie)).json().avatar, null);

      for (const headers of [{ "x-csrf-token": "invalid" }, { origin: "https://attacker.invalid" }])
        assert.equal((await upload("avatar", png, owner, headers)).statusCode, 403);
      assert.equal((await upload("avatar", png, {})).statusCode, 401);
      assert.equal(
        (await post("/api/account/profile/media", { kind: "avatar", value: avatar }, other))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await post(
            "/api/account/profile/media",
            { kind: "avatar", value: avatar, userId: owner.id },
            other,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        profileMediaEditSchema.safeParse({ kind: "avatar", value: banner }).success,
        false,
      );
      assert.equal(
        profileMediaEditSchema.safeParse({
          kind: "avatar",
          value: "https://attacker.invalid/track.gif",
        }).success,
        false,
      );
      assert.equal((await upload("avatar", Buffer.from("GIF89a invalid"))).statusCode, 400);
      assert.equal(
        (await upload("avatar", Buffer.alloc(profileMediaLimits.avatar + 1))).statusCode,
        413,
      );
      assert.equal((await get("/api/auth/me", owner.cookie)).json().avatar, avatar);

      const privateProfile = (await get("/api/account/profile", owner.cookie)).json();
      assert.equal(
        (
          await post(
            "/api/account/profile",
            { ...privateProfile, isPublic: true, profileAccess: "public" },
            owner,
          )
        ).statusCode,
        201,
      );
      const publicMedia = await get(banner);
      assert.equal(publicMedia.statusCode, 200, publicMedia.body);
      assert.equal(publicMedia.headers["content-type"], "image/gif");
      assert.equal(publicMedia.headers["cache-control"], "no-store");
      assert.deepEqual(publicMedia.rawPayload, gif);
      assert.equal((await get("/api/profiles/" + owner.username)).json().banner, banner);
      const restarted = await createApplication(config);
      try {
        const again = await restarted.getHttpAdapter().getInstance().inject({ url: banner });
        assert.deepEqual(again.rawPayload, gif);
      } finally {
        await restarted.close();
      }

      const profileOther = (await get("/api/account/profile", other.cookie)).json();
      assert.equal(profileEditSchema.safeParse({ ...profileOther, avatar }).success, true);
      assert.equal(
        (await post("/api/account/profile", { ...profileOther, avatar }, other)).statusCode,
        400,
      );
      assert.equal((await get("/api/auth/me", other.cookie)).json().avatar, null);

      const before = await readdir(path.join(storage, owner.id, "banner"));
      const transaction = db.$transaction;
      db.$transaction = async () => {
        throw new Error("Test transaction failure");
      };
      try {
        assert.equal((await upload("banner", gif)).statusCode, 500);
      } finally {
        db.$transaction = transaction;
      }
      assert.deepEqual(await readdir(path.join(storage, owner.id, "banner")), before);

      const replaced = await post(
        "/api/account/profile/media",
        { kind: "avatar", value: "/profile-presets/avatar-cat.svg" },
        owner,
      );
      assert.equal(replaced.statusCode, 201, replaced.body);
      await assert.rejects(readFile(file(avatar)), { code: "ENOENT" });
      assert.equal((await get(avatar, owner.cookie)).statusCode, 404);
      const giphy = await post(
        "/api/account/profile/media",
        { kind: "avatar", value: "giphy:Abc123" },
        owner,
      );
      assert.equal(giphy.statusCode, 201, giphy.body);
      assert.equal((await get("/api/auth/me", owner.cookie)).json().avatar, "giphy:Abc123");
      assert.equal((await get("/api/account/profile", other.cookie)).json().avatar, null);
      assert.equal(
        (
          await post(
            "/api/account/profile/media",
            { kind: "avatar", value: "giphy:../../evil" },
            owner,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await post(
            "/api/account/profile/media",
            { kind: "avatar", value: "giphy:Abc123", userId: other.id },
            owner,
          )
        ).statusCode,
        400,
      );
      assert.equal((await post("/api/account/profile", privateProfile, owner)).statusCode, 400);
      assert.equal(
        (await post("/api/account/profile/media", { kind: "banner", value: null }, owner))
          .statusCode,
        201,
      );
      await assert.rejects(readFile(file(banner)), { code: "ENOENT" });
      assert.equal((await get("/api/account/profile", owner.cookie)).json().banner, null);
    } finally {
      await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await app.close();
      assert.ok(storage.startsWith(artifacts + path.sep));
      await rm(storage, { recursive: true, force: true });
    }
  },
);
