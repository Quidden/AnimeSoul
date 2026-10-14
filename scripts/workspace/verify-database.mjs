import { spawn } from "node:child_process";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createDatabase } from "../../packages/database/dist/src/index.js";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../../apps/api/dist/auth/security.js";

const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "54329")
  throw new Error("Verification requires the isolated local cluster.");
const bin = process.env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
async function run(executable, args, overrides = {}, cwd = process.cwd()) {
  const child = spawn(executable, args, {
    env: { ...env, ...overrides },
    stdio: "inherit",
    windowsHide: true,
    cwd,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error("Database verification command failed.");
}
const pg = (name) => path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const args = ["-h", "127.0.0.1", "-p", "54329", "-U", decodeURIComponent(url.username)];
const testUrl = new URL(url);
testUrl.pathname = "/animesoul_test";
const prisma = path.resolve("packages/database/node_modules/prisma/build/index.js");
await run(
  process.execPath,
  [prisma, "migrate", "deploy", "--config", "prisma.config.ts"],
  { DATABASE_URL: testUrl.href },
  path.resolve("packages/database"),
);
await run(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "tests/database.test.mjs",
    "tests/accounts.test.mjs",
    "tests/catalog-sync.test.mjs",
    "tests/catalog-discovery.test.mjs",
    "tests/global-search.test.mjs",
    "tests/kodik-primary.test.mjs",
    "tests/reserve-access.test.mjs",
    "tests/identity.test.mjs",
    "tests/playback-progress.test.mjs",
    "tests/social.test.mjs",
    "tests/content.test.mjs",
  ],
  {
    TEST_DATABASE_URL: testUrl.href,
    DATABASE_URL: testUrl.href,
  },
);
const source = createDatabase(testUrl.href);
const markerId = randomUUID();
const accountMarkerId = randomUUID();
const friendMarkerId = randomUUID();
const episodeMarkerId = randomUUID();
await source.anime.create({
  data: {
    id: markerId,
    slug: "restore-" + markerId,
    title: "Restore verification",
    originalTitle: "Restore verification",
    aliases: ["Unicode: Фрирен"],
    description: "Backup marker",
    year: 2026,
    genres: [],
    status: "released",
    published: false,
    episodes: {
      create: {
        id: episodeMarkerId,
        season: "1",
        number: "1",
        providers: {
          create: { provider: "kodik", externalId: "restore-source" },
        },
      },
    },
  },
});
await source.user.create({
  data: {
    id: accountMarkerId,
    email: "restore-" + accountMarkerId + "@example.invalid",
    passwordHash: await hashPassword("Restore marker пароль 2026"),
    disabledAt: new Date(),
    profile: {
      create: {
        username: "restore-" + accountMarkerId,
        usernameKey: "restore-" + accountMarkerId,
        about: "Приватный профиль",
        visibility: {
          about: false,
          favorites: false,
          folders: false,
          ratings: false,
          statistics: false,
        },
        content: {},
        preferences: { theme: "dark" },
      },
    },
    library: {
      create: {
        animeId: markerId,
        favorite: true,
        score: 8,
        ratings: { create: { scope: "episode", key: "1", score: 9 } },
      },
    },
    episodeProgress: {
      create: {
        animeId: markerId,
        episodeId: episodeMarkerId,
        episodeKey: "episode:" + episodeMarkerId,
        position: 42,
        duration: 120,
        completed: false,
      },
    },
  },
});
mkdirSync("artifacts/database-backups", { recursive: true });
await source.user.create({
  data: {
    id: friendMarkerId,
    disabledAt: new Date(),
    profile: {
      create: {
        username: "friend-" + friendMarkerId,
        usernameKey: "friend-" + friendMarkerId,
        profileAccess: "friends",
        visibility: {
          about: "friends",
          favorites: "private",
          folders: "private",
          ratings: "private",
          statistics: "private",
          friends: "friends",
        },
        content: {},
      },
    },
  },
});
const [lowId, highId] = [accountMarkerId, friendMarkerId].sort();
await source.friendship.create({ data: { lowId, highId } });
await source.follow.create({ data: { followerId: accountMarkerId, targetId: friendMarkerId } });
const postMarkerId = randomUUID(),
  commentMarkerId = randomUUID();
await source.post.create({
  data: {
    id: postMarkerId,
    authorId: accountMarkerId,
    title: "Заметка для восстановления",
    body: "Приватная мысль о серии",
    kind: "episode",
    animeId: markerId,
    episodeId: episodeMarkerId,
    timestamp: 42,
    audience: "friends",
    tags: ["фрирен"],
    labels: ["spoiler"],
  },
});
await source.comment.create({
  data: {
    id: commentMarkerId,
    authorId: friendMarkerId,
    postId: postMarkerId,
    body: "Ответ для проверки восстановления",
    labels: ["spoiler"],
  },
});
const backup = path.resolve("artifacts/database-backups/foundation.dump");
await run(pg("pg_dump"), [...args, "-d", "animesoul_test", "-Fc", "-f", backup]);
// This database is owned by this verification, contains no user data, and is replaced on reruns.
await run(pg("dropdb"), [...args, "--if-exists", "animesoul_restore_test"]);
await run(pg("createdb"), [...args, "animesoul_restore_test"]);
await run(pg("pg_restore"), [...args, "-d", "animesoul_restore_test", "--exit-on-error", backup]);
const restoreUrl = new URL(url);
restoreUrl.pathname = "/animesoul_restore_test";
const database = createDatabase(restoreUrl.href);
try {
  await database.$queryRaw`SELECT 1`;
  await database.anime.count();
  await database.user.count();
  await database.providerSetting.count();
  await database.friendRequest.count();
  await database.userBlock.count();
  const restoredPost = await database.post.findUnique({ where: { id: postMarkerId } }),
    restoredComment = await database.comment.findUnique({ where: { id: commentMarkerId } });
  if (
    restoredPost?.timestamp !== 42 ||
    restoredPost.audience !== "friends" ||
    restoredComment?.postId !== postMarkerId ||
    restoredComment.body !== "Ответ для проверки восстановления"
  )
    throw new Error("Restored content did not match.");
  if (
    !(await database.friendship.findUnique({ where: { lowId_highId: { lowId, highId } } })) ||
    !(await database.follow.findUnique({
      where: { followerId_targetId: { followerId: accountMarkerId, targetId: friendMarkerId } },
    })) ||
    (await database.userProfile.findUnique({ where: { userId: friendMarkerId } }))
      ?.profileAccess !== "friends"
  )
    throw new Error("Restored social relationships did not match.");
  const marker = await database.anime.findUnique({ where: { id: markerId } });
  if (marker?.title !== "Restore verification" || marker.aliases[0] !== "Unicode: Фрирен")
    throw new Error("Restored data did not match the backup.");
  const account = await database.user.findUnique({
    where: { id: accountMarkerId },
    include: { profile: true, library: { include: { ratings: true } }, episodeProgress: true },
  });
  if (
    account?.profile?.about !== "Приватный профиль" ||
    account.profile.isPublic ||
    account.library[0]?.score !== 8 ||
    account.library[0]?.ratings[0]?.score !== 9 ||
    account.episodeProgress[0]?.position !== 42 ||
    account.episodeProgress[0]?.episodeId !== episodeMarkerId ||
    !(await database.episodeProvider.findFirst({
      where: { episodeId: episodeMarkerId, provider: "kodik", externalId: "restore-source" },
    }))
  )
    throw new Error("Restored account and library did not match.");
  console.info(
    "Isolated PostgreSQL migration, HTTP integration, account/library backup and restore passed.",
  );
} finally {
  await database.$disconnect();
  await source.user.delete({ where: { id: accountMarkerId } });
  await source.user.delete({ where: { id: friendMarkerId } });
  await source.episode.delete({ where: { id: episodeMarkerId } });
  await source.anime.delete({ where: { id: markerId } });
  await source.$disconnect();
}
