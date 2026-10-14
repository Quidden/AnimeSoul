import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { createDatabase } from "../../packages/database/dist/src/index.js";
import { hashPassword, verifyPassword } from "../../apps/api/dist/auth/security.js";
import { demoTitles } from "./demo-titles.mjs";
const dataset = "animesoul-community-100-v1",
  directory = path.resolve("artifacts/demo-community"),
  manifestFile = path.join(directory, "accounts.private.json"),
  mode = process.argv[2] ?? "seed";
const url = new URL(process.env.DATABASE_URL);
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/animesoul"
)
  throw new Error("Demo accounts require the existing isolated local animesoul database.");
if (!["seed", "verify"].includes(mode)) throw new Error("Use pnpm demo:community [seed|verify].");
const db = createDatabase(url.href),
  now = new Date(),
  day = 86400000;
const ago = (days) => new Date(now.getTime() - days * day),
  pair = (a, b) => (a < b ? { lowId: a, highId: b } : { lowId: b, highId: a }),
  pairKey = (a, b) => [a, b].sort().join(":");
const tastes = [
  [
    "Фэнтези",
    "Тихие приключения",
    "Люблю истории о путешествиях и героях, которые меняются не сразу.",
    "спокойный темп и ощущение долгого пути",
    "фэнтези",
  ],
  [
    "Триллер",
    "Разобрать загадку",
    "После серии обычно записываю версии и проверяю, какие детали я пропустил.",
    "напряжение и последовательность решений персонажей",
    "детектив",
  ],
  [
    "Драма",
    "Эмоции в деталях",
    "Ценю истории, где чувства передают паузами, жестами и маленькими разговорами.",
    "тонкие эмоции и выразительные паузы",
    "драма",
  ],
  [
    "Комедия",
    "Вечер без спешки",
    "После работы выбираю лёгкое аниме. Хорошая шутка для меня важнее большого финального боя.",
    "естественный юмор и ритм диалогов",
    "комедия",
  ],
  [
    "Спорт",
    "Ещё один подход",
    "Смотрю спортивные истории ради команды и роста после неудач. Люблю обсуждать, как меняются отношения героев.",
    "командное взаимодействие и постепенный рост",
    "спорт",
  ],
  [
    "Романтика",
    "Любимые диалоги",
    "Мне нравятся романтические истории без спешки. Сначала замечаю, как герои разговаривают друг с другом.",
    "доверие между героями и живые диалоги",
    "романтика",
  ],
  [
    "Музыка",
    "Наушники и чай",
    "Часто возвращаюсь к любимым опенингам. В самой серии особенно слежу за звуком и настроением.",
    "музыкальные переходы и работу со звуком",
    "музыка",
  ],
  [
    "Фантастика",
    "Другие миры",
    "Собираю фантастику и истории о необычных мирах. Люблю обсуждать правила мира без спойлеров к финалу.",
    "внутреннюю логику мира и атмосферу",
    "фантастика",
  ],
  [
    "Приключения",
    "Большой список",
    "Обычно смотрю по две серии за вечер. Сохраняю интересные находки в отдельную папку, чтобы не потерять.",
    "чувство открытия и разнообразие приключений",
    "приключения",
  ],
  [
    "Повседневность",
    "Маленькие истории",
    "Предпочитаю спокойные истории о повседневной жизни. Люблю тёплую атмосферу и обычные разговоры.",
    "уютную атмосферу и внимание к мелочам",
    "повседневность",
  ],
];
const names = ["Sora", "Yuki", "Ren", "Aki", "Mika", "Haru", "Nami", "Kira", "Rin", "Yuna"];
const handles = [
  "NightTea",
  "PaperMoon",
  "BlueNotes",
  "SlowSunday",
  "TeamSpirit",
  "SoftRain",
  "VinylSky",
  "StarMap",
  "RoadLetter",
  "WarmWindow",
];
const habits = [
  "Смотрю вечером с чаем и не люблю спойлеры в названиях.",
  "На выходных выбираю один тайтл и стараюсь досмотреть сезон.",
  "Люблю обмениваться рекомендациями и сравнивать впечатления после серии.",
  "Сохраняю интересные серии в библиотеку и возвращаюсь к ним позже.",
  "Оценки ставлю после сезона, а не после первого впечатления.",
  "Часто смотрю с друзьями, но обсуждаю только то, что мы уже успели увидеть.",
  "Обращаю внимание на музыку, цвет и монтаж.",
  "Иногда делаю паузу в середине серии, чтобы записать мысль.",
  "Мой список на выходные постоянно растёт. Буду рад спокойным обсуждениям.",
  "Предпочитаю одну хорошую серию за вечер и разговор о ней без гонки за новинками.",
];
const voices = [
  "Не ожидал, что так захочется обсуждать маленькие детали.",
  "Пока впечатление хорошее, хотя отдельным моментам я бы дал больше времени.",
  "Хочется узнать, на что вы обратили внимание при первом просмотре.",
  "Не называю это идеальным произведением, но к нескольким сценам точно вернусь.",
  "Люблю, когда история оставляет пространство для собственного прочтения.",
  "Особенно приятно смотреть без спешки и потом сравнивать впечатления с друзьями.",
  "После просмотра хочется немного посидеть в тишине и разобрать впечатления.",
  "Для меня это хорошее напоминание, что атмосфера тоже может двигать историю.",
  "Сохранил в подборку, чтобы не потерять и посоветовать человеку с похожим вкусом.",
  "Интересно, изменится ли моё впечатление при повторном просмотре.",
];
const responses = [
  "Мне близок такой взгляд. Я тоже сначала обращаю внимание на атмосферу, а уже потом на крупные события.",
  "Согласен с частью мысли, но темп для меня оказался удачным: было время привыкнуть к героям.",
  "Спасибо за рекомендацию! Добавил в список на выходные; обсудим, когда досмотрю.",
  "Я заметил это только на повторном просмотре. Люблю, когда небольшая деталь меняет впечатление от сцены.",
  "У меня получилось иначе: больше запомнились диалоги. Но понимаю, почему тебе понравилась визуальная часть.",
  "Хорошо, что обсуждение без спойлеров к финалу. Пока догоняю и читаю только впечатления о первых сериях.",
  "Для меня музыка здесь действительно помогает настроению. Теперь хочу пересмотреть с хорошими наушниками.",
  "Не совсем согласен с оценкой, но аргументы понятны. Я бы добавил балл за атмосферу.",
  "Тоже сохранил этот момент. После серии было интересно подумать, почему он так запомнился.",
  "Давайте вернёмся к разговору после сезона. Любопытно сравнить первое впечатление с итоговым.",
];
function stable(v) {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, stable(v[k])]),
    );
  return v;
}
async function baseline(ids) {
  const out = {};
  for (const table of [
    "User",
    "UserProfile",
    "LegacyProfile",
    "LibraryItem",
    "LibraryRating",
    "LibraryFolder",
    "FolderEntry",
    "EpisodeProgress",
  ]) {
    const field = table === "User" ? "id" : "userId";
    const rows = await db.$queryRawUnsafe(
      `SELECT * FROM "${table}" WHERE "${field}"::text = ANY($1::text[])`,
      ids,
    );
    out[table] = {
      rows: rows.length,
      hash: createHash("sha256")
        .update(JSON.stringify(rows.map((r) => JSON.stringify(stable(r))).sort()))
        .digest("hex"),
    };
  }
  const anime = await db.anime.findMany({
    select: { id: true, slug: true },
    orderBy: { id: "asc" },
  });
  out.AnimeIdentity = {
    rows: anime.length,
    hash: createHash("sha256").update(JSON.stringify(anime)).digest("hex"),
  };
  return out;
}
async function backup() {
  const bin = process.env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin",
    file = path.join(directory, "before-demo-" + Date.now() + ".dump");
  async function run(name, args) {
    const p = spawn(path.join(bin, name + ".exe"), args, {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    p.stderr.on("data", (c) => {
      error += c;
    });
    const code = await new Promise((resolve, reject) => {
      p.once("error", reject);
      p.once("exit", resolve);
    });
    if (code !== 0) {
      writeFileSync(path.join(directory, "backup-error.private.log"), error);
      throw new Error("Demo backup failed; see private diagnostics.");
    }
  }
  await run("pg_dump", [
    "-h",
    url.hostname,
    "-p",
    url.port,
    "-U",
    decodeURIComponent(url.username),
    "-Fc",
    "-f",
    file,
    "animesoul",
  ]);
  if (statSync(file).size < 1000) throw new Error("Incomplete backup.");
  await run("pg_restore", ["--list", file]);
  return file;
}
function exportFiles(people) {
  const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const rows = [
    ["№", "Имя", "Логин (почта)", "Пароль", "Профиль", "Видимость", "Сценарий"],
    ...people.map((p) => [
      p.number,
      p.username,
      p.email,
      p.password,
      "http://localhost:8021/users/" + p.username,
      p.access,
      p.scenario,
    ]),
  ];
  writeFileSync(
    path.join(directory, "Логины-и-пароли.csv"),
    "\uFEFF" + rows.map((row) => row.map(quote).join(";")).join("\r\n") + "\r\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(directory, "Логины-и-пароли.txt"),
    "100 ВЫМЫШЛЕННЫХ ПОЛЬЗОВАТЕЛЕЙ ANIMESOUL\nВход: http://localhost:8021/account\nЛогин — почта, а не ник. У каждого свой пароль. Аккаунты созданы только в локальной БД.\n\n" +
      people
        .map(
          (p) =>
            `${String(p.number).padStart(3, "0")}. ${p.username}\nЛогин: ${p.email}\nПароль: ${p.password}\nПрофиль: http://localhost:8021/users/${p.username}\n${p.scenario}\n`,
        )
        .join("\n"),
    { mode: 0o600 },
  );
}
try {
  mkdirSync(directory, { recursive: true });
  if (existsSync(manifestFile)) {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")),
      people = manifest.people;
    if (manifest.dataset !== dataset || people.length !== 100)
      throw new Error("Unexpected demo manifest.");
    const accounts = await db.user.findMany({
      where: { id: { in: people.map((p) => p.id) } },
      include: { profile: true },
    });
    if (
      accounts.length !== 100 ||
      accounts.some(
        (a) =>
          a.profile?.preferences?.demoDataset !== dataset ||
          !people.some((p) => p.id === a.id && p.email === a.email),
      )
    )
      throw new Error(
        "Demo accounts changed or missing. Existing accounts will not be overwritten.",
      );
    exportFiles(people);
    if (mode === "verify") {
      for (let i = 0; i < people.length; i += 2)
        await Promise.all(
          people.slice(i, i + 2).map(async (p) => {
            const a = accounts.find((a) => a.id === p.id);
            if (!(await verifyPassword(p.password, a.passwordHash)))
              throw new Error("A demo password was changed: " + p.username);
          }),
        );
      console.info(
        "All 100 unique demo passwords verified with Argon2id; no account state overwritten.",
      );
    } else
      console.info(
        "The 100 demo accounts already exist; credentials exported without resetting activity.",
      );
  } else {
    if (mode === "verify") throw new Error("Create the demo dataset first.");
    if (
      await db.userProfile.count({
        where: { preferences: { path: ["demoDataset"], equals: dataset } },
      })
    )
      throw new Error(
        "Demo records exist without their private manifest; refusing duplicate generation.",
      );
    const catalog = await db.anime.findMany({
      where: { published: true, isDevelopment: false },
      select: {
        id: true,
        slug: true,
        title: true,
        genres: true,
        episodes: {
          select: { id: true, animeId: true, season: true, number: true, duration: true },
        },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
    const safe = catalog.filter((a) => !a.genres.some((g) => /хентай|эрот|эччи|hentai/i.test(g))),
      series = safe.find((a) => a.episodes.length >= 10);
    if (safe.length < 30 || !series)
      throw new Error(
        "Import a real published catalog and at least one complete episode list first.",
      );
    series.episodes.sort(
      (a, b) => Number(a.season) - Number(b.season) || Number(a.number) - Number(b.number),
    );
    const people = Array.from({ length: 100 }, (_, i) => {
      const group = Math.floor(i / 10),
        access = i < 72 ? "public" : i < 92 ? "friends" : "private";
      return {
        id: randomUUID(),
        number: i + 1,
        username: names[i % 10] + "_" + handles[group],
        email: `${names[i % 10].toLowerCase()}.${handles[group].toLowerCase()}@demo.animesoul.example.invalid`,
        password: "AS-" + randomBytes(12).toString("base64url"),
        access,
        group,
        scenario:
          i === 0
            ? "Общительный участник: более 50 друзей, входящие/отправленные заявки, подписчики и чёрный список."
            : i === 66 || i === 67
              ? "Отправленная заявка Sora_NightTea: можно отменить свою заявку."
              : i === 68 || i === 69
                ? "Заявка от Sora_NightTea: можно принять или отклонить."
                : i === 84
                  ? "Заблокирован Sora_NightTea: проверка чёрного списка и закрытого доступа."
                  : access === "friends"
                    ? "Профиль только для друзей; есть публичные и дружеские публикации."
                    : access === "private"
                      ? "Закрытый профиль; владелец видит свои разделы и библиотеку."
                      : `Любит ${tastes[group][4]}; библиотека, оценки, посты, рецензия и обсуждения.`,
      };
    });
    const friendMap = new Map(),
      blockMap = new Map(),
      requests = new Map(),
      followMap = new Map();
    const addFriend = (a, b) => {
      if (a !== b)
        friendMap.set(pairKey(a.id, b.id), {
          ...pair(a.id, b.id),
          createdAt: ago(12 + ((a.number + b.number) % 14)),
        });
    };
    for (let i = 0; i < 100; i++)
      for (let j = i + 1; j < 100; j++)
        if (
          (Math.floor(i / 10) === Math.floor(j / 10) && (i + j) % 3 !== 0) ||
          (i % 10 === j % 10 && (i + j) % 4 === 0)
        )
          addFriend(people[i], people[j]);
    for (let i = 1; i <= 63; i++) addFriend(people[0], people[i]);
    for (const [a, b] of [
      [0, 84],
      [4, 28],
      [12, 37],
      [21, 55],
      [31, 77],
      [43, 60],
      [53, 96],
      [64, 83],
      [71, 88],
      [78, 97],
    ]) {
      const blocker = people[a],
        target = people[b];
      blockMap.set(pairKey(blocker.id, target.id), {
        blockerId: blocker.id,
        targetId: target.id,
        createdAt: ago(2),
      });
      friendMap.delete(pairKey(blocker.id, target.id));
    }
    const addRequest = (a, b) => {
      const k = pairKey(a.id, b.id);
      if (
        a !== b &&
        !friendMap.has(k) &&
        !blockMap.has(k) &&
        b.access === "public" &&
        ((b.number - 1) % 17 !== 0 || b.number === 1)
      )
        requests.set(k, {
          ...pair(a.id, b.id),
          requestedBy: a.id,
          createdAt: ago(0.25 + (a.number % 5) / 10),
        });
    };
    for (let i = 0; i < 100; i++) addRequest(people[i], people[(i + 17) % 72]);
    for (const [a, b] of [
      [66, 0],
      [67, 0],
      [0, 68],
      [0, 69],
    ]) {
      friendMap.delete(pairKey(people[a].id, people[b].id));
      requests.delete(pairKey(people[a].id, people[b].id));
      addRequest(people[a], people[b]);
    }
    for (let i = 0; i < 100; i++)
      for (let step = 1; step <= 4 + (i % 7); step++) {
        const a = people[i],
          b = people[(i + step * 7) % 72];
        if (a !== b && !blockMap.has(pairKey(a.id, b.id)))
          followMap.set(a.id + ":" + b.id, {
            followerId: a.id,
            targetId: b.id,
            createdAt: ago(1 + step),
          });
      }
    const profiles = [],
      libraries = [],
      ratings = [],
      folders = [],
      entries = [],
      progress = [],
      posts = [],
      comments = [],
      users = [];
    for (let i = 0; i < 100; i++) {
      const p = people[i],
        taste = tastes[p.group],
        count = 9 + (i % 17),
        preferred = safe.filter((a) =>
          a.genres.some((g) => g.toLowerCase().includes(taste[0].toLowerCase())),
        ),
        pool = preferred.length >= count ? preferred : safe;
      const chosen = [
          series,
          ...Array.from({ length: count }, (_, j) => pool[(i * 11 + j * 17) % pool.length]),
        ].filter((a, j, all) => all.findIndex((b) => b.id === a.id) === j),
        favorites = demoTitles[p.group]
          .map((title) => safe.find((a) => a.title === title))
          .filter(Boolean),
        primary =
          favorites[i % favorites.length] ?? chosen.find((a) => a.id !== series.id) ?? series;
      if (!chosen.some((a) => a.id === primary.id)) chosen.splice(1, 0, primary);
      p.favoriteTitle = primary.title;
      profiles.push({
        userId: p.id,
        username: p.username,
        usernameKey: p.username.toLowerCase(),
        isPublic: p.access === "public",
        profileAccess: p.access,
        indexable: false,
        friendRequests: i % 17 === 0 && i !== 0 ? "nobody" : "everyone",
        avatar: [
          "/profile-presets/avatar-cat.svg",
          "/profile-presets/avatar-kitsune.svg",
          "/profile-presets/avatar-moon.svg",
          "/profile-presets/avatar-orbit.svg",
        ][i % 4],
        banner: [
          "/profile-presets/banner-dawn.svg",
          "/profile-presets/banner-night.svg",
          "/profile-presets/banner-sakura.svg",
          "/profile-presets/banner-stars.svg",
        ][p.group % 4],
        presence:
          i % 11 === 0 ? "invisible" : i % 7 === 0 ? "dnd" : i % 4 === 0 ? "online" : "offline",
        about: `${taste[2]} ${habits[i % 10]} Сейчас в моей подборке — «${primary.title}».`,
        visibility: {
          about: "public",
          favorites: i % 6 === 0 ? "friends" : "public",
          folders: i % 5 === 0 ? "friends" : "public",
          ratings: i % 8 === 0 ? "private" : "public",
          statistics: i % 4 === 0 ? "friends" : "public",
          friends: i % 9 === 0 && i !== 0 ? "private" : "public",
          posts: "public",
          reviews: i % 7 === 0 ? "friends" : "public",
          comments: i % 6 === 0 ? "friends" : "public",
        },
        content: {},
        preferences: { demoDataset: dataset, adultContent: false },
        updatedAt: ago(i % 3),
      });
      const last = 4 + (i % (series.episodes.length - 4)),
        lastEp = series.episodes[last - 1];
      for (let j = 0; j < chosen.length; j++) {
        const a = chosen[j],
          watched = j % 4 !== 3,
          score = watched ? 6 + ((i + j) % 5) : null;
        libraries.push({
          userId: p.id,
          animeId: a.id,
          favorite: j < 3,
          score,
          lastEpisode: a.id === series.id ? "episode:" + lastEp.id : "",
          season: 1,
          dubbing: a.id === series.id ? "AniLibria" : "",
          tracking: { status: a.id === series.id ? "watching" : watched ? "completed" : "planned" },
          updatedAt: ago((j + (i % 4)) / 6),
        });
        if (score !== null && a.id === series.id)
          ratings.push({ userId: p.id, animeId: a.id, scope: "season", key: "1", score });
      }
      for (let j = 0; j < 3; j++) {
        const id = randomUUID(),
          name = j === 0 ? "Сейчас смотрю" : j === 1 ? "На выходные" : taste[1];
        folders.push({ id, userId: p.id, name });
        const picks =
          j === 0 ? [series] : j === 1 ? chosen.filter((_, n) => n % 4 === 3) : chosen.slice(1, 5);
        for (const a of picks)
          entries.push({
            folderId: id,
            userId: p.id,
            animeId: a.id,
            note:
              j === 0
                ? "Продолжаю по вечерам, без спойлеров к следующим сериям."
                : j === 1
                  ? "Оставил на свободный вечер. После просмотра сравню впечатления с друзьями."
                  : `Хочу вернуться к «${a.title}» и внимательнее рассмотреть ${taste[3]}.`,
          });
      }
      for (let j = 0; j < last; j++) {
        const ep = series.episodes[j],
          duration = ep.duration ?? 1440,
          completed = j < last - 1,
          position = completed ? duration : Math.min(duration - 30, 125 + ((i * 47) % 800));
        progress.push({
          userId: p.id,
          animeId: series.id,
          episodeId: ep.id,
          episodeKey: "episode:" + ep.id,
          duration,
          position,
          completed,
          watchedSeconds: position,
          updatedAt: ago((last - 1 - j) / 3),
        });
        if (completed && j % 3 === 0)
          ratings.push({
            userId: p.id,
            animeId: series.id,
            scope: "episode",
            key: ep.season + ":" + ep.number,
            score: 7 + ((i + j) % 4),
          });
      }
      const n = 2 + (i % 3);
      for (let j = 0; j < n; j++)
        posts.push({
          id: randomUUID(),
          authorId: p.id,
          kind: "text",
          title: [
            "Что я ищу в аниме после длинного дня",
            "Моя небольшая подборка на выходные",
            "Почему я возвращаюсь к любимым историям",
            "Впечатления без спойлеров",
          ][j],
          body: `В последнее время выбираю ${taste[4]}. В «${primary.title}» мне хочется внимательнее рассмотреть ${taste[3]}. ${voices[(i + j) % 10]}\n\n${habits[(i + j + 2) % 10]} А какие истории вы советуете человеку с похожим вкусом?`,
          audience:
            j === 2 && i % 4 === 0 ? "friends" : j === 3 && i % 11 === 0 ? "private" : "public",
          tags: [taste[4], j % 2 ? "рекомендации" : "впечатления"],
          labels: [],
          animeId: j === 1 ? primary.id : null,
          createdAt: ago((90 + ((i * 137 + j * 29) % 3000)) / 1440),
          updatedAt: ago((90 + ((i * 137 + j * 29) % 3000)) / 1440),
        });
      posts.push({
        id: randomUUID(),
        authorId: p.id,
        kind: "review",
        title: `Мой взгляд на «${primary.title}»`,
        body: `Смотрел «${primary.title}» с интересом к тому, как здесь работают ${taste[3]}. Больше всего ценю цельное настроение: для меня важно, чтобы сцены поддерживали друг друга, а не просто выглядели эффектно по отдельности.\n\nЕсть моменты, к которым хочется вернуться и пересмотреть внимательнее. При этом мне не всегда одинаково близок выбранный темп — некоторым диалогам я бы дал больше пространства. ${voices[i % 10]}\n\nМоя оценка — это личное впечатление, а не попытка убедить всех смотреть одинаково. Если вам близка ${taste[4]}, попробуйте и расскажите, что запомнилось вам.`,
        audience: i % 9 === 0 ? "friends" : "public",
        tags: [taste[4], "рецензия"],
        labels: i === 16 ? ["18+"] : [],
        animeId: primary.id,
        score: 7 + (i % 4),
        createdAt: ago((75 + ((i * 173) % 2700)) / 1440),
        updatedAt: ago((75 + ((i * 173) % 2700)) / 1440),
      });
      const ep = series.episodes[Math.max(0, last - 2)],
        timestamp = Math.min(Math.floor((ep.duration ?? 1440) - 10), 65 + ((i * 31) % 600));
      posts.push({
        id: randomUUID(),
        authorId: p.id,
        kind: "episode",
        title: `«Фрирен», серия ${ep.number}: короткая заметка`,
        body: `Остановился на ${Math.floor(timestamp / 60)}:${String(timestamp % 60).padStart(2, "0")} и решил записать впечатление от ритма сцены. В этой серии мне интересно наблюдать за тем, как соединяются паузы, музыка и реакция героев.\n\n${voices[(i + 4) % 10]} Обсуждаю только эту серию; про следующие, пожалуйста, не рассказывайте.`,
        audience: i % 5 === 0 ? "friends" : "public",
        tags: ["фрирен", "таймкод"],
        labels: i % 4 === 0 ? ["spoiler"] : [],
        animeId: series.id,
        episodeId: ep.id,
        timestamp,
        createdAt: ago((100 + ((i * 191) % 2600)) / 1440),
        updatedAt: ago((100 + ((i * 191) % 2600)) / 1440),
      });
      for (let j = 0; j < 3; j++)
        comments.push({
          id: randomUUID(),
          authorId: p.id,
          animeId: chosen[j % chosen.length].id,
          body: `${responses[(i + j) % 10]} В «${chosen[j % chosen.length].title}» мне интереснее всего обсуждать ${taste[3]}.`,
          labels: [],
          createdAt: ago(2 + ((i + j) % 20) / 10),
          updatedAt: ago(2 + ((i + j) % 20) / 10),
        });
      for (let j = 0; j < 2; j++) {
        const episode = series.episodes[Math.max(0, last - 2 - j)];
        comments.push({
          id: randomUUID(),
          authorId: p.id,
          episodeId: episode.id,
          body: `Досмотрел серию ${episode.number} «Фрирен». ${responses[(i + j + 3) % 10]} Про следующие серии пока не читаю.`,
          labels: i % 8 === 0 ? ["spoiler"] : [],
          createdAt: ago(0.25 + ((i + j) % 15) / 20),
          updatedAt: ago(0.25 + ((i + j) % 15) / 20),
        });
      }
    }
    for (let i = 0; i < 100; i++) {
      const p = people[i],
        accessible = posts.filter(
          (post) =>
            post.authorId !== p.id &&
            !blockMap.has(pairKey(p.id, post.authorId)) &&
            !post.labels.includes("18+") &&
            (post.audience === "public" ||
              (post.audience === "friends" && friendMap.has(pairKey(p.id, post.authorId)))),
        );
      for (let j = 0; j < 4; j++) {
        const post = accessible[(i * 13 + j * 19) % accessible.length];
        comments.push({
          id: randomUUID(),
          authorId: p.id,
          postId: post.id,
          body: responses[(i + j) % 10],
          labels: [...post.labels],
          createdAt: new Date(
            Math.max(post.createdAt.getTime() + 60000, ago(((i + j) % 7) / 12).getTime()),
          ),
          updatedAt: now,
        });
      }
    }
    const roots = comments.filter((c) => c.postId && !c.parentId);
    for (let i = 0; i < 160; i++) {
      const root = roots[i],
        post = posts.find((p) => p.id === root.postId),
        p = people.find((p) => p.id === post.authorId);
      if (!blockMap.has(pairKey(p.id, root.authorId)))
        comments.push({
          id: randomUUID(),
          authorId: p.id,
          postId: post.id,
          parentId: root.id,
          body: [
            "Спасибо, что поделился впечатлением. Интересно сравнить, какие детали мы заметили по-разному.",
            "Понимаю твою мысль. Давай вернёмся к обсуждению после просмотра, без спойлеров для тех, кто ещё догоняет.",
            "Да, это хороший повод пересмотреть сцену. Попробую обратить внимание на то, о чём ты написал.",
          ][i % 3],
          labels: [...root.labels],
          createdAt: new Date(root.createdAt.getTime() + 60000),
          updatedAt: now,
        });
    }
    const originalIds = (await db.user.findMany({ select: { id: true } })).map((u) => u.id),
      before = await baseline(originalIds),
      backupFile = await backup();
    for (let i = 0; i < people.length; i += 2) {
      await Promise.all(
        people.slice(i, i + 2).map(async (p) => {
          users.push({
            id: p.id,
            email: p.email,
            passwordHash: await hashPassword(p.password),
            emailVerifiedAt: ago(50),
            createdAt: ago(90 + (p.number % 30)),
          });
        }),
      );
      if (i % 20 === 0) console.info("Prepared " + Math.min(i + 2, 100) + " / 100 demo accounts.");
    }
    writeFileSync(
      manifestFile,
      JSON.stringify(
        { dataset, status: "prepared", createdAt: now, people, originalIds, backup: backupFile },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await db.$transaction(
      async (tx) => {
        await tx.user.createMany({ data: users });
        await tx.userProfile.createMany({ data: profiles });
        await tx.libraryItem.createMany({ data: libraries });
        await tx.libraryRating.createMany({ data: ratings });
        await tx.libraryFolder.createMany({ data: folders });
        await tx.folderEntry.createMany({ data: entries });
        await tx.episodeProgress.createMany({ data: progress });
        await tx.friendship.createMany({ data: [...friendMap.values()] });
        await tx.friendRequest.createMany({ data: [...requests.values()] });
        await tx.follow.createMany({ data: [...followMap.values()] });
        await tx.userBlock.createMany({ data: [...blockMap.values()] });
        await tx.post.createMany({ data: posts });
        await tx.comment.createMany({ data: comments.filter((c) => !c.parentId) });
        await tx.comment.createMany({ data: comments.filter((c) => c.parentId) });
        await tx.auditEvent.create({
          data: {
            action: "demo.community-seeded",
            objectId: dataset,
            reason:
              "User-requested fictional local activity; 100 accounts. No real-user identities or privileges.",
          },
        });
      },
      { timeout: 60000 },
    );
    const after = await baseline(originalIds),
      unchanged = JSON.stringify(before) === JSON.stringify(after);
    const counts = {
      users: 100,
      libraryItems: libraries.length,
      ratings: ratings.length,
      folders: folders.length,
      progress: progress.length,
      friendships: friendMap.size,
      requests: requests.size,
      follows: followMap.size,
      blocks: blockMap.size,
      posts: posts.length,
      comments: comments.length,
    };
    writeFileSync(
      path.join(directory, "verification.json"),
      JSON.stringify({ checkedAt: now, unchanged, counts, before, after }, null, 2),
    );
    if (!unchanged)
      throw new Error("Original data no longer matches the baseline; inspect private report.");
    writeFileSync(
      manifestFile,
      JSON.stringify(
        {
          dataset,
          status: "ready",
          createdAt: now,
          people,
          originalIds,
          backup: backupFile,
          counts,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    exportFiles(people);
    console.info(
      JSON.stringify(
        {
          ready: true,
          counts,
          originalDataUnchanged: unchanged,
          files: [
            path.join(directory, "Логины-и-пароли.csv"),
            path.join(directory, "Логины-и-пароли.txt"),
          ],
        },
        null,
        2,
      ),
    );
  }
} finally {
  await db.$disconnect();
}
