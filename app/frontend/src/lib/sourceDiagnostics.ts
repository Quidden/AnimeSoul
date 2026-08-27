export type VideoSourceIssue = {
  key: string;
  context: string;
  source: string;
  sourceLabel: string;
  unavailableData: string;
  reason: string;
};

type VideoSourceIssueInput = {
  animeId: number;
  title: string;
  seasonLabel: string;
  sources: Readonly<Record<string, string>>;
  loadedVideos: number;
  requestError?: string;
};

const SOURCE_COPY: Record<string, { label: string; data: string }> = {
  yummy: {
    label: "YummyAnime",
    data: "карточка и основной список серий/озвучек",
  },
  kodik: {
    label: "Kodik",
    data: "резервные серии, озвучки и ссылки плеера",
  },
};

/** Turn transport statuses into concise, user-facing per-title diagnostics. */
export function videoSourceIssues({
  animeId,
  title,
  seasonLabel,
  sources,
  loadedVideos,
  requestError,
}: VideoSourceIssueInput): VideoSourceIssue[] {
  const context = `${seasonLabel} · ${title}`;
  const issues = Object.entries(sources).flatMap(([source, rawStatus]) => {
    const status = String(rawStatus || "unknown").toLocaleLowerCase("ru-RU");
    if (status === "ok" || status === "unused") return [];
    const copy = SOURCE_COPY[source] ?? {
      label: source,
      data: "данные источника",
    };
    return [{
      key: `${animeId}:${source}`,
      context,
      source,
      sourceLabel: copy.label,
      unavailableData: copy.data,
      reason: sourceStatusReason(status),
    }];
  });

  if (issues.length) return issues;
  if (requestError) {
    return [{
      key: `${animeId}:request`,
      context,
      source: "request",
      sourceLabel: "Запрос серий",
      unavailableData: "весь список серий и озвучек",
      reason: requestError,
    }];
  }
  if (loadedVideos === 0) {
    return [{
      key: `${animeId}:empty`,
      context,
      source: "empty",
      sourceLabel: "Все ответившие источники",
      unavailableData: "серии и озвучки",
      reason: "источники ответили, но не вернули ни одной доступной серии",
    }];
  }
  return [];
}

function sourceStatusReason(status: string) {
  if (status === "unconfigured") return "ключ источника не настроен на этом устройстве";
  if (status === "timeout") return "источник не успел ответить";
  if (status === "error") return "источник вернул ошибку или временно недоступен";
  return `источник сообщил статус «${status}»`;
}
