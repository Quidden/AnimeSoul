import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { AdministrationContentService } from "../apps/api/dist/admin/content.service.js";
import { AnalyticsService } from "../apps/api/dist/admin/analytics.service.js";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";
import { randomUUID } from "node:crypto";

test("two catalog windows from one IP can prefetch 120 cards alongside experience and identity reads", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  app.get(AdministrationContentService).experience = async () => ({
    announcements: [],
    campaigns: [],
  });
  app.get(AnalyticsService).collect = async () => ({ accepted: true });
  const server = app.getHttpAdapter().getInstance();
  let reads = 0;
  async function request(url, options = {}, expected = 200) {
    const response = await server.inject({ url, remoteAddress: "127.0.0.97", ...options });
    assert.equal(response.statusCode, expected, `${url}: ${response.body}`);
    reads++;
  }
  try {
    await Promise.all(
      [0, 1].map(async (window) => {
        for (let index = 0; index < 60; index++) {
          const anime = developmentAnime[(index + window) % developmentAnime.length];
          await Promise.all([
            request(`/api/anime/${anime.slug}`),
            request(`/api/anime/${anime.slug}/franchise`),
          ]);
          if (index % 5 === 0) {
            await Promise.all([
              request("/api/catalog?page=" + (index / 5 + 1)),
              request("/api/experience?animeId=" + anime.id),
              request("/api/auth/me", {}, 401),
              request("/api/auth/developer-access", {}, 401),
              request(
                "/api/experience/event",
                {
                  method: "POST",
                  payload: {
                    id: randomUUID(),
                    visitorId: randomUUID(),
                    visitId: randomUUID(),
                    kind: "page_view",
                    path: "/catalog",
                  },
                },
                201,
              ),
            ]);
          }
        }
      }),
    );
    assert.equal(reads, 360);
  } finally {
    await app.close();
  }
});
