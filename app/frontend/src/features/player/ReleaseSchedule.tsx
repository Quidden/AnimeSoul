import type { Anime, ScheduleEntry, SeasonGroup } from "../../lib/types";
import { formatCalendarDate } from "../../lib/anime";

export interface ReleaseScheduleRow {
  group: SeasonGroup;
  entry: Anime;
  item: ScheduleEntry;
}

interface ReleaseScheduleProps {
  rows: ReleaseScheduleRow[];
}

/** Compact schedule for announced franchise episodes. */
export function ReleaseSchedule({ rows }: ReleaseScheduleProps) {
  if (!rows.length) return null;

  return <section className="release-schedule">
    <div>
      <span className="eyebrow">ГРАФИК ВЫХОДА</span>
      <h2>Следующие серии</h2>
    </div>
    {rows.map(({ group, entry, item }) => {
      const aired = item.episodes?.aired ?? 0;
      const total = item.episodes?.count ?? 0;
      const nextDate = item.episodes?.next_date;
      return <article key={entry.anime_id}>
        <span>
          <b>{group.label}</b>
          <small>
            {aired} из {total || "—"} серий вышло · следующая — серия {aired + 1}
            {total ? ` из ${total}` : ""}
          </small>
        </span>
        {nextDate && <time>{formatCalendarDate(nextDate)}</time>}
      </article>;
    })}
  </section>;
}
