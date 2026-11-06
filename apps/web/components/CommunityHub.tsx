"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  contentTagsSchema,
  postListSchema,
  type ContentPost,
  type ContentQuery,
} from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { useAccountSession } from "./useAccountSession";
import { AdultContentPreference, CommentsPanel, PostCard, PostComposer } from "./ContentPanels";
import { communityFeedUrl, communityHref, type CommunityFilters } from "../lib/community-feed";
const rules = [
  ["Отмечайте спойлеры", "Метка «Спойлер» прячет текст под кнопкой."],
  ["Материалы 18+", "Видны только после подтверждения возраста — переключатель ниже."],
  ["Добавляйте хештеги", "По ним записи находят другие участники."],
] as const;

const sideTabs = [
  ["topics", "Темы"],
  ["hot", "Обсуждают"],
  ["rules", "Правила"],
] as const;

export function CommunityHub(filters: CommunityFilters) {
  const { section, tag, sort, q, kind, animeId } = filters;
  const { account, ready } = useAccountSession();
  const [items, setItems] = useState<ContentPost[]>([]),
    [next, setNext] = useState<ContentQuery | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [composing, setComposing] = useState(false),
    [sample, setSample] = useState<ContentPost[]>([]),
    [topics, setTopics] = useState<{ tag: string; count: number }[]>([]),
    [period, setPeriod] = useState<"day" | "week" | "month">("week"),
    [pinned, setPinned] = useState<ContentPost[]>([]),
    [topicsNotice, setTopicsNotice] = useState(""),
    [pinnedNotice, setPinnedNotice] = useState(""),
    [chosenTab, setSideTab] = useState<(typeof sideTabs)[number][0]>("topics");
  // The topic cloud does not apply to the comments feed, so that tab falls back to the next one.
  const sideTab = section === "comments" && chosenTab === "topics" ? "hot" : chosenTab;
  const refresh = () => setRevision((n) => n + 1);

  useEffect(() => {
    let active = true;
    setItems([]);
    setNext(null);
    setNotice("");
    setLoading(true);
    if (section === "comments") {
      setLoading(false);
      return;
    }
    void accountRequest(
      communityFeedUrl(
        { section, tag, sort, q, kind, animeId },
        null,
        tag || q || kind || animeId ? undefined : false,
      ),
    )
      .then((value) => {
        if (!active) return;
        const page = postListSchema.parse(value);
        setItems(page.items);
        setNext(page.next);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Не удалось загрузить.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, tag, sort, q, kind, animeId, revision, account?.id]);

  // This small selection is used only for the linked anime recommendations.
  useEffect(() => {
    let active = true;
    void accountRequest(communityFeedUrl({ section: "posts", sort: "discussed" }))
      .then((value) => {
        if (active) setSample(postListSchema.parse(value).items);
      })
      .catch(() => {
        if (active) setSample([]);
      });
    return () => {
      active = false;
    };
  }, [account?.id, revision]);

  useEffect(() => {
    let active = true;
    setTopics([]);
    setTopicsNotice("");
    void accountRequest("/api/account/content/tags?period=" + period)
      .then((value) => {
        if (!active) return;
        const items = contentTagsSchema.parse(value).items;
        setTopics(items);
        if (!items.length)
          setTopicsNotice(
            period === "month"
              ? "За месяц тегов пока нет."
              : "За этот период тегов не было — попробуйте «За месяц».",
          );
      })
      .catch(() => {
        if (active) setTopicsNotice("Не удалось загрузить темы.");
      });
    return () => {
      active = false;
    };
  }, [period, revision, account?.id]);

  useEffect(() => {
    let active = true;
    setPinned([]);
    setPinnedNotice("");
    void accountRequest("/api/account/content/posts?pinned=true")
      .then((value) => {
        if (active) setPinned(postListSchema.parse(value).items);
      })
      .catch(() => {
        if (active) setPinnedNotice("Не удалось загрузить закреплённые записи.");
      });
    return () => {
      active = false;
    };
  }, [revision, account?.id]);
  const discussed = useMemo(() => {
    const counts = new Map<string, { id: string; title: string; slug: string; count: number }>();
    for (const post of sample)
      if (post.anime) {
        const known = counts.get(post.anime.id);
        if (known) known.count++;
        else counts.set(post.anime.id, { ...post.anime, count: 1 });
      }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [sample]);

  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const page = postListSchema.parse(
        await accountRequest(
          communityFeedUrl(filters, next, tag || q || kind || animeId ? undefined : false),
        ),
      );
      setItems((old) => [...old, ...page.items]);
      setNext(page.next);
    } catch {
      setNotice("Не удалось загрузить следующую страницу.");
    } finally {
      setBusy(false);
    }
  }

  const topicLinks = (
    <ul className="community-tags">
      {topics.map(({ tag: name, count }) => (
        <li key={name}>
          <Link
            href={communityHref({
              ...filters,
              section: section === "comments" ? "posts" : section,
              tag: name === tag ? undefined : name,
            })}
            aria-current={name === tag ? "true" : undefined}
            prefetch={false}
          >
            #{name}
            <span>{count}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const periodControl = (
    <label className="community-period">
      Период
      <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
        <option value="day">За день</option>
        <option value="week">За неделю</option>
        <option value="month">За месяц</option>
      </select>
    </label>
  );

  return (
    <>
      <header className="community-hero">
        <div>
          <p className="eyebrow">ANIMESOUL</p>
          <h1>Сообщество</h1>
          <p>Рецензии, впечатления от серий и разговоры с теми, кто смотрит то же, что и вы.</p>
        </div>
        {ready &&
          (account ? (
            <button
              type="button"
              className="primary"
              aria-expanded={composing}
              onClick={() => setComposing(!composing)}
            >
              {composing ? "Закрыть редактор" : "Написать"}
            </button>
          ) : (
            <Link className="primary" href="/account">
              Войти, чтобы писать
            </Link>
          ))}
      </header>
      <div className="community-layout">
        <div className="community-main">
          <nav className="community-tabs" aria-label="Раздел сообщества">
            <Link
              href={communityHref({ ...filters, section: "posts" })}
              aria-current={section === "posts" ? "page" : undefined}
              prefetch={false}
            >
              Публикации
            </Link>
            <Link
              href={communityHref({ ...filters, section: "reviews", kind: undefined })}
              aria-current={section === "reviews" ? "page" : undefined}
              prefetch={false}
            >
              Рецензии
            </Link>
            <Link
              href={communityHref({ ...filters, section: "comments" })}
              aria-current={section === "comments" ? "page" : undefined}
              prefetch={false}
            >
              Обсуждения
            </Link>
          </nav>
          <form className="community-filters" action="/community">
            {section !== "posts" && <input type="hidden" name="tab" value={section} />}
            {tag && <input type="hidden" name="tag" value={tag} />}
            {animeId && <input type="hidden" name="animeId" value={animeId} />}
            <label>
              Поиск
              <input
                name="q"
                type="search"
                maxLength={200}
                defaultValue={q ?? ""}
                placeholder={
                  section === "comments" ? "По тексту комментария" : "По заголовку и тексту"
                }
              />
            </label>
            {section !== "comments" && (
              <label>
                Порядок
                <select name="sort" defaultValue={sort}>
                  <option value="new">Новые</option>
                  <option value="discussed">Обсуждаемые</option>
                  <option value="top">Топ</option>
                </select>
              </label>
            )}
            {section === "posts" && (
              <label>
                Формат
                <select name="kind" defaultValue={kind ?? ""}>
                  <option value="">Все публикации</option>
                  <option value="text">Текст</option>
                  <option value="episode">Впечатления от серии</option>
                </select>
              </label>
            )}
            <button className="outline" type="submit">
              Найти
            </button>
          </form>
          {section !== "comments" && (
            <div className="community-mobile-topics">
              {periodControl}
              {topicsNotice && <p role="status">{topicsNotice}</p>}
              {topics.length > 0 && <div className="community-tag-strip">{topicLinks}</div>}
            </div>
          )}
          {tag && (
            <div className="community-active-tag">
              <span>
                Тема: <strong>#{tag}</strong>
              </span>
              <Link href={communityHref({ ...filters, tag: undefined })} prefetch={false}>
                Показать всё ×
              </Link>
            </div>
          )}
          {animeId && (
            <div className="community-active-tag">
              <span>Записи выбранного аниме</span>
              <Link href={communityHref({ ...filters, animeId: undefined })} prefetch={false}>
                Все аниме ×
              </Link>
            </div>
          )}
          {composing && account && (
            <div className="community-composer">
              <PostComposer
                account={account}
                context={{}}
                saved={() => {
                  setComposing(false);
                  refresh();
                }}
              />
            </div>
          )}
          {pinnedNotice && <p role="status">{pinnedNotice}</p>}
          {pinned.length > 0 && !tag && !q && !kind && !animeId && (
            <section className="community-pinned" aria-label="Закреплённые записи">
              <h2>Закреплённое</h2>
              {pinned.map((post) => (
                <PostCard
                  key={post.id + ":" + post.updatedAt}
                  post={post}
                  account={account ?? null}
                  onChange={refresh}
                  thread
                />
              ))}
            </section>
          )}
          {section === "comments" && (
            <CommentsPanel
              target={animeId ? { animeId } : {}}
              title="Обсуждения"
              allDiscussions={!!animeId}
              query={q}
              globalFeed
            />
          )}
          {loading && (
            <div aria-hidden="true">
              <div className="community-skeleton" />
              <div className="community-skeleton" />
              <div className="community-skeleton" />
            </div>
          )}
          {notice && (
            <div className="profile-section-notice">
              <p role="alert">{notice}</p>
              <button type="button" className="outline" disabled={loading} onClick={refresh}>
                Повторить загрузку
              </button>
            </div>
          )}
          {items.map((post) => (
            <PostCard
              key={post.id + ":" + post.updatedAt}
              post={post}
              account={account ?? null}
              onChange={refresh}
              thread
            />
          ))}
          {section !== "comments" && !loading && !items.length && !notice && (
            <div className="community-empty">
              <strong>
                {tag
                  ? `По теме #${tag} пока ничего нет`
                  : section === "reviews"
                    ? "Рецензий пока нет"
                    : "Публикаций пока нет"}
              </strong>
              <p>Станьте первым — поделитесь мыслью, и разговор начнётся.</p>
              {tag && (
                <Link
                  className="outline"
                  href={communityHref({ ...filters, tag: undefined })}
                  prefetch={false}
                >
                  Показать всю ленту
                </Link>
              )}
            </div>
          )}
          {next && (
            <button
              type="button"
              className="outline community-more"
              disabled={busy}
              onClick={() => void more()}
            >
              {busy ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
        </div>
        <aside className="community-side" aria-label="О сообществе" data-tab={sideTab}>
          <div className="community-side-tabs" role="tablist" aria-orientation="vertical">
            {sideTabs
              .filter(([id]) => id !== "topics" || section !== "comments")
              .map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={"community-tab-" + id}
                  aria-selected={sideTab === id}
                  aria-controls={"community-panel-" + id}
                  data-tab={id}
                  onClick={() => setSideTab(id)}
                >
                  {label}
                </button>
              ))}
          </div>
          {section !== "comments" && (
            <div
              className="community-panel"
              role="tabpanel"
              id="community-panel-topics"
              aria-labelledby="community-tab-topics"
              data-panel="topics"
              hidden={sideTab !== "topics"}
            >
              {periodControl}
              {topicsNotice && <p role="status">{topicsNotice}</p>}
              {topicLinks}
            </div>
          )}
          <div
            className="community-panel"
            role="tabpanel"
            id="community-panel-hot"
            aria-labelledby="community-tab-hot"
            data-panel="hot"
            hidden={sideTab !== "hot"}
          >
            {discussed.length > 0 ? (
              <ul className="community-hot">
                {discussed.map((anime) => (
                  <li key={anime.id}>
                    <Link href={"/anime/" + anime.slug + "/community"} prefetch={false}>
                      <span>{anime.title}</span>
                      <small>{anime.count}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="community-panel-empty">Пока никто ничего не обсуждает.</p>
            )}
          </div>
          <div
            className="community-panel"
            role="tabpanel"
            id="community-panel-rules"
            aria-labelledby="community-tab-rules"
            data-panel="rules"
            hidden={sideTab !== "rules"}
          >
            <ul className="community-rules">
              {rules.map(([title, text]) => (
                <li key={title}>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <AdultContentPreference />
          </div>
        </aside>
      </div>
    </>
  );
}
