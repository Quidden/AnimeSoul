"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type AnimeRelease, formatReleaseDate, releaseCountdown } from "../lib/anime-releases";

export function AnimeReleaseSchedule({
  releases,
  initialNow,
}: {
  releases: AnimeRelease[];
  initialNow: number;
}) {
  const [now, setNow] = useState(initialNow);
  const hasDate = releases.some((release) => release.date);

  useEffect(() => {
    if (!hasDate) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [hasDate, initialNow]);

  if (!releases.length) return null;
  return (
    <section className="anime-release-schedule" aria-labelledby="anime-release-heading">
      <h2 id="anime-release-heading">Ближайшие выходы</h2>
      <ul className="anime-release-list">
        {releases.map((release) => (
          <li className="anime-release" key={release.animeId}>
            <div className="anime-release-copy">
              <p className="anime-release-label">
                {release.label}
                {release.episode !== null && <span> · Серия {release.episode}</span>}
              </p>
              <h3>
                <Link href={`/anime/${release.slug}`}>{release.title}</Link>
              </h3>
              {release.date ? (
                <p className="anime-release-date">
                  <time dateTime={release.date.value}>{formatReleaseDate(release.date)}</time>
                  {release.date.precision === "day" && <span> · Время выхода не объявлено</span>}
                </p>
              ) : (
                <p className="anime-release-date">
                  {release.plannedLabel}. Точная дата выхода пока не объявлена.
                </p>
              )}
            </div>
            {release.date ? (
              <p className="anime-release-countdown" role="timer" aria-live="off">
                <span>До выхода</span>
                <strong>{releaseCountdown(release.date, now)}</strong>
              </p>
            ) : (
              <span className="anime-release-planned">Запланировано</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
