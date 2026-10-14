import { createDatabase, catalogFields } from "./index.js";
import { developmentAnime } from "./fixtures.js";
if (process.env.NODE_ENV === "production" || process.env.DEMO_CATALOG !== "true") {
  throw new Error("Development seed requires DEMO_CATALOG=true outside production.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Development seed requires a local database.");
const database = createDatabase(process.env.DATABASE_URL);
try {
  for (const anime of developmentAnime) {
    const { indexable } = anime;
    const data = catalogFields(anime);
    if (indexable) throw new Error("Development fixtures must stay non-indexable.");
    await database.anime.upsert({
      where: { id: anime.id },
      create: { ...data, published: true, isDevelopment: true },
      update: {},
    });
  }
  console.info("Development catalog seeded. No administrative account created.");
} finally {
  await database.$disconnect();
}
