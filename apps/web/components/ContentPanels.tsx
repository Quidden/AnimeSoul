"use client";
import Link from "next/link";
import { seasonLabel } from "../lib/season-label";
import dynamic from "next/dynamic";
import { useEffect, useState, type FormEvent } from "react";
import {
  commentListSchema,
  postListSchema,
  postSchema,
  type Account,
  type ContentPost,
  type ContentComment,
  type ContentQuery,
} from "@animesoul/contracts";
import { accountRequest, loadPrivateProfile } from "../lib/account-client";
import { useAccountSession } from "./useAccountSession";
import { ProfileImage } from "./ProfileImage";
import { ContentText } from "./ContentText";
import type { ContentEditorContext } from "./ContentReferencePicker";
import { contentEpisodeHref, contentTimeLabel, parseContentTime } from "../lib/content-links";
const ContentEditor = dynamic(
  () => import("./ContentEditor").then((module) => module.ContentEditor),
  {
    ssr: false,
    loading: () => (
      <div className="content-editor-loading" role="status">
        Загружаем редактор…
      </div>
    ),
  },
);
type Target = { animeId?: string; episodeId?: string; postId?: string; authorId?: string };
type Context = ContentEditorContext & { animeId?: string; title?: string };
function url(kind: string, query: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) q.set(key, value);
  return "/api/account/content/" + kind + "?" + q.toString();
}
// undefined while the session is loading, null for a guest: guest prompts must not flash for members.
function useAccount() {
  const { account, ready } = useAccountSession();
  return ready ? account : undefined;
}
function labels(form: FormData) {
  return ["spoiler", "18+", "nsfw"].filter((label) => form.get("label-" + label) === "on");
}
// "5 мин назад", "вчера", "12 окт": short enough for a feed card; the full date stays in the tooltip.
function ago(iso: string) {
  const date = new Date(iso),
    minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function LabelFields() {
  return (
    <fieldset className="content-labels">
      <legend>Метки</legend>
      {["spoiler", "18+", "nsfw"].map((label) => (
        <label key={label}>
          <input type="checkbox" name={"label-" + label} />
          {label === "spoiler" ? "Спойлер" : label.toUpperCase()}
        </label>
      ))}
    </fieldset>
  );
}
function Author({ author }: { author: { username: string; avatar: string | null } }) {
  return (
    <Link className="content-author" href={"/users/" + encodeURIComponent(author.username)}>
      <ProfileImage
        value={author.avatar}
        alt=""
        width={30}
        height={30}
        fallback={
          <span className="content-author-avatar" aria-hidden="true">
            {Array.from(author.username).slice(0, 2).join("").toUpperCase()}
          </span>
        }
      />
      <strong>{author.username}</strong>
    </Link>
  );
}
export function PostCard({
  post,
  account,
  onChange,
  thread = false,
}: {
  post: ContentPost;
  account: Account | null;
  onChange?: () => void;
  // Feed mode: long text folds and the discussion thread opens inside the card.
  thread?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [notice, setNotice] = useState(""),
    [expanded, setExpanded] = useState(false),
    [discussion, setDiscussion] = useState(false),
    [commentCount, setCommentCount] = useState(post.commentCount);
  useEffect(() => setCommentCount(post.commentCount), [post.commentCount]);
  const long = thread && post.body.length > 420;
  async function remove() {
    if (!account) return;
    try {
      await accountRequest("/api/account/content/posts/delete", { id: post.id }, account.csrfToken);
      onChange?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось удалить.");
    }
  }
  return (
    <article className={"content-card" + (thread ? " is-feed" : "")}>
      <div className="content-meta">
        <Author author={post.author} />
        {post.pinned && <span className="content-audience">Закреплено</span>}
        <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString("ru-RU")}>
          {ago(post.createdAt)}
        </time>
        {post.audience !== "public" && (
          <span className="content-audience">
            {post.audience === "friends" ? "Друзьям" : "Только мне"}
          </span>
        )}
      </div>
      <h3>
        <Link href={"/posts/" + post.id}>{post.title}</Link>
      </h3>
      {post.kind !== "text" && (
        <p className={"content-kind is-" + post.kind}>
          {post.kind === "review" ? "Рецензия" : "Обсуждение серии"}
          {post.score !== null && <b>★ {post.score}/10</b>}
        </p>
      )}
      {post.anime && (
        <Link
          className="content-context"
          href={
            post.episode
              ? contentEpisodeHref(post.anime.slug, post.episode.id, post.timestamp)
              : "/anime/" + post.anime.slug
          }
        >
          {post.anime.title}
          {post.episode &&
            ` · ${seasonLabel(post.episode.season).toLowerCase()}, серия ${post.episode.number}`}
          {post.timestamp !== null && ` · ${contentTimeLabel(post.timestamp)}`}
        </Link>
      )}
      {!!post.labels.length && (
        <div className="content-badges">
          {post.labels.map((l) => (
            <span key={l}>{l.toUpperCase()}</span>
          ))}
        </div>
      )}
      <div className={"content-body" + (long && !expanded ? " is-clamped" : "")}>
        <ContentText body={post.body} spoiler={post.labels.includes("spoiler")} />
      </div>
      {long && (
        <button type="button" className="content-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть" : "Читать полностью"}
        </button>
      )}
      <div className="content-tags">
        {post.tags.map((tag) => (
          <Link key={tag} href={"/community?tag=" + encodeURIComponent(tag)}>
            #{tag}
          </Link>
        ))}
      </div>
      <div className="content-actions">
        {thread ? (
          <>
            <button
              type="button"
              className="content-thread-toggle"
              aria-expanded={discussion}
              onClick={() => setDiscussion(!discussion)}
            >
              {discussion ? "Скрыть обсуждение" : "Обсудить"} · {commentCount}
            </button>
            <Link href={"/posts/" + post.id}>Открыть →</Link>
          </>
        ) : (
          <Link href={"/posts/" + post.id}>Обсудить · {commentCount} →</Link>
        )}
        {account?.id === post.author.id && (
          <>
            <button className="outline" onClick={() => setEditing(!editing)}>
              Редактировать
            </button>
            <button className="outline" onClick={() => void remove()}>
              Удалить
            </button>
          </>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {thread && discussion && (
        <div className="content-thread">
          <CommentsPanel
            target={{ postId: post.id }}
            compact
            onChange={() => {
              void accountRequest("/api/account/content/posts/" + post.id)
                .then((value) => setCommentCount(postSchema.parse(value).commentCount))
                .catch(() => {});
            }}
          />
        </div>
      )}
      {editing && account && (
        <PostComposer
          account={account}
          context={{
            ...(post.anime
              ? { animeId: post.anime.id, title: post.anime.title, anime: post.anime }
              : {}),
            ...(post.episode ? { episodeId: post.episode.id } : {}),
          }}
          draft={post}
          saved={() => {
            setEditing(false);
            onChange?.();
          }}
        />
      )}
    </article>
  );
}
export function PostComposer({
  account,
  context,
  draft,
  saved,
}: {
  account: Account;
  context: Context;
  draft?: ContentPost;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [editorReady, setEditorReady] = useState(false),
    [notice, setNotice] = useState(""),
    [kind, setKind] = useState(
      draft?.kind ?? (context.episodeId ? "episode" : context.animeId ? "review" : "text"),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const time = String(data.get("timestamp") ?? "").trim(),
        timestamp = time ? parseContentTime(time) : null;
      if (kind === "episode" && time && timestamp === null)
        throw new Error("Введите корректный таймкод, например 12:34 или 1:02:03.");
      await accountRequest(
        "/api/account/content/posts",
        {
          ...(draft ? { id: draft.id } : {}),
          kind,
          title: data.get("title"),
          body: data.get("body"),
          audience: data.get("audience"),
          tags: String(data.get("tags") ?? "")
            .split(/[\s,#]+/)
            .filter(Boolean),
          labels: labels(data),
          animeId: context.animeId ?? null,
          episodeId: kind === "episode" ? (context.episodeId ?? null) : null,
          timestamp: kind === "episode" ? timestamp : null,
          score: kind === "review" && data.get("score") ? Number(data.get("score")) : null,
        },
        account.csrfToken,
      );
      if (!draft) form.reset();
      saved();
      setNotice("Публикация сохранена.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось опубликовать.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="content-form" onSubmit={submit}>
      <h3>{draft ? "Изменить публикацию" : "Поделиться мыслями"}</h3>
      {context.title && <p>{context.title}</p>}
      {context.animeId && !context.episodeId && (
        <label>
          Вид публикации
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="review">Рецензия</option>
            <option value="text">Пост об аниме</option>
          </select>
        </label>
      )}
      <label>
        Заголовок
        <input name="title" required minLength={2} maxLength={160} defaultValue={draft?.title} />
      </label>
      <ContentEditor
        label="Текст"
        onReady={setEditorReady}
        defaultValue={draft?.body ?? ""}
        maxLength={10000}
        placeholder="Поделитесь мыслями. Названия аниме и имена персонажей можно превратить в ссылки."
        disabled={busy}
        context={context}
      />
      {kind === "episode" && (
        <label>
          Таймкод (например, 2:05)
          <input
            name="timestamp"
            defaultValue={
              draft?.timestamp === undefined || draft.timestamp === null
                ? ""
                : contentTimeLabel(draft.timestamp)
            }
            placeholder="2:05"
          />
        </label>
      )}
      {kind === "review" && (
        <label>
          Оценка
          <select name="score" defaultValue={draft?.score ?? ""}>
            <option value="">Без оценки</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}/10
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Хештеги
        <input
          name="tags"
          defaultValue={draft?.tags.join(" ")}
          placeholder="повседневность музыка обсуждение"
        />
      </label>
      <label>
        Кому видно
        <select name="audience" defaultValue={draft?.audience ?? "public"}>
          <option value="public">Всем</option>
          <option value="friends">Друзьям</option>
          <option value="private">Только мне</option>
        </select>
      </label>
      {draft ? (
        <fieldset className="content-labels">
          <legend>Метки</legend>
          {["spoiler", "18+", "nsfw"].map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                name={"label-" + l}
                defaultChecked={draft.labels.includes(l as "spoiler" | "18+" | "nsfw")}
              />
              {l}
            </label>
          ))}
        </fieldset>
      ) : (
        <LabelFields />
      )}
      <button className="primary" disabled={busy || !editorReady}>
        {busy ? "Сохраняем…" : draft ? "Сохранить публикацию" : "Опубликовать"}
      </button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
export function PostsPanel({
  authorId,
  section = "posts",
  context = {},
  tag,
}: {
  authorId?: string;
  section?: "posts" | "reviews";
  context?: Context;
  tag?: string;
}) {
  const account = useAccount(),
    [items, setItems] = useState<ContentPost[]>([]),
    [next, setNext] = useState<ContentQuery | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const animeId = context.animeId,
    episodeId = context.episodeId;
  async function fetchPage(cursor?: ContentQuery) {
    const result = postListSchema.parse(
      await accountRequest(
        url("posts", {
          authorId,
          section,
          animeId,
          episodeId,
          tag,
          before: cursor?.before,
          beforeId: cursor?.beforeId,
        }),
      ),
    );
    setItems((old) => (cursor ? [...old, ...result.items] : result.items));
    setNext(result.next);
  }
  useEffect(() => {
    let active = true;
    setItems([]);
    setNext(null);
    setNotice("");
    setLoading(true);
    void accountRequest(url("posts", { authorId, section, animeId, episodeId, tag }))
      .then((v) => {
        if (active) {
          const r = postListSchema.parse(v);
          setItems(r.items);
          setNext(r.next);
        }
      })
      .catch((e) => {
        if (active) setNotice(e instanceof Error ? e.message : "Не удалось загрузить.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authorId, section, animeId, episodeId, tag, revision, account?.id]);
  const refresh = () => setRevision((n) => n + 1);
  return (
    <section
      className="content-section"
      id={section === "reviews" ? "profile-reviews" : "profile-posts"}
    >
      <h2>
        {section === "reviews" ? "Рецензии" : "Публикации"}
        {tag && ` · #${tag}`}
      </h2>
      {account && (!authorId || authorId === account.id) && (
        <details className="content-compose">
          <summary>Написать публикацию</summary>
          <PostComposer account={account} context={context} saved={refresh} />
        </details>
      )}
      {account === null && !authorId && (
        <p>
          <Link href="/account">Войди</Link>, чтобы опубликовать пост.
        </p>
      )}
      {loading && <p role="status">Загружаем публикации…</p>}
      {notice && (
        <div className="profile-section-notice">
          <p role="alert">{notice}</p>
          <button type="button" className="outline" disabled={busy || loading} onClick={refresh}>
            Повторить загрузку
          </button>
        </div>
      )}
      {items.map((p) => (
        <PostCard
          key={p.id + ":" + p.updatedAt}
          post={p}
          account={account ?? null}
          onChange={refresh}
        />
      ))}
      {!loading && !items.length && !notice && (
        <p className="profile-empty">
          {section === "reviews" ? "Рецензий пока нет." : "Публикаций пока нет."}
        </p>
      )}
      {next && (
        <button
          className="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice("");
            void fetchPage(next)
              .catch(() => setNotice("Не удалось загрузить следующую страницу."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </section>
  );
}
export function CommentsPanel({
  target,
  title = "Обсуждение",
  allDiscussions = false,
  context = {},
  compact = false,
  globalFeed = false,
  query,
  onChange,
}: {
  target: Target;
  title?: string;
  allDiscussions?: boolean;
  context?: ContentEditorContext;
  // Inside a feed card the thread drops its own heading.
  compact?: boolean;
  globalFeed?: boolean;
  query?: string | undefined;
  onChange?: () => void;
}) {
  const account = useAccount(),
    [items, setItems] = useState<ContentComment[]>([]),
    [next, setNext] = useState<ContentQuery | null>(null),
    [reply, setReply] = useState<ContentComment | null>(null),
    [editorReady, setEditorReady] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const { animeId, episodeId, postId, authorId } = target;
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    let active = true;
    setItems([]);
    setNext(null);
    setNotice("");
    setLoading(true);
    void accountRequest(
      url("comments", {
        animeId,
        episodeId,
        postId,
        authorId,
        discussions: allDiscussions ? "all" : undefined,
        q: query,
      }),
    )
      .then((v) => {
        if (active) {
          const r = commentListSchema.parse(v);
          setItems(r.items);
          setNext(r.next);
        }
      })
      .catch((e) => {
        if (active) setNotice(e instanceof Error ? e.message : "Не удалось загрузить.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [animeId, episodeId, postId, authorId, revision, allDiscussions, query, account?.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    try {
      await accountRequest(
        "/api/account/content/comments",
        {
          body: data.get("body"),
          labels: labels(data),
          animeId: reply ? reply.animeId : (animeId ?? null),
          episodeId: reply ? reply.episodeId : (episodeId ?? null),
          postId: reply ? reply.postId : (postId ?? null),
          parentId: reply?.id ?? null,
        },
        account.csrfToken,
      );
      form.reset();
      setReply(null);
      refresh();
      onChange?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось отправить.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!account) return;
    try {
      await accountRequest("/api/account/content/comments/delete", { id }, account.csrfToken);
      refresh();
      onChange?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось удалить.");
    }
  }
  const rootIds = new Set(items.filter((c) => !c.parentId).map((c) => c.id));
  const orderedComments =
    authorId || globalFeed
      ? items
      : [
          ...items
            .filter((c) => !c.parentId)
            .flatMap((root) => [root, ...items.filter((c) => c.parentId === root.id)]),
          ...items.filter((c) => c.parentId && !rootIds.has(c.parentId)),
        ];
  return (
    <section
      className={"content-section content-comments-section" + (compact ? " is-compact" : "")}
      {...(compact ? {} : { id: "profile-comments" })}
    >
      <div className="content-comments-heading">
        <div>
          <p className="eyebrow">ОБСУЖДАЕМ ВМЕСТЕ</p>
          <h2>{title}</h2>
        </div>
        <span>
          {items.length}
          {next ? "+" : ""} комментариев
        </span>
      </div>
      {!authorId &&
        (!globalFeed || reply) &&
        (account ? (
          <form className="content-form content-comment-composer" onSubmit={submit}>
            <div className="content-composer-caption">
              <Author author={account} />
              <span>Поделитесь впечатлением</span>
            </div>
            {reply && (
              <p>
                Ответ {reply.author.username}{" "}
                <button type="button" className="outline" onClick={() => setReply(null)}>
                  Отменить ответ
                </button>
              </p>
            )}
            <ContentEditor
              label="Комментарий"
              onReady={setEditorReady}
              maxLength={4000}
              disabled={busy}
              context={context}
              placeholder="Что запомнилось? Введите имя персонажа или название аниме, чтобы добавить ссылку."
            />
            <LabelFields />
            <button className="primary" disabled={busy || !editorReady}>
              Отправить комментарий
            </button>
          </form>
        ) : (
          account === null && (
            <p>
              <Link href="/account">Войди</Link>, чтобы участвовать в обсуждении.
            </p>
          )
        ))}
      {loading && <p role="status">Загружаем комментарии…</p>}
      {notice && (
        <div className="profile-section-notice">
          <p role="alert">{notice}</p>
          <button type="button" className="outline" disabled={busy || loading} onClick={refresh}>
            Повторить загрузку
          </button>
        </div>
      )}
      {orderedComments.map((c) => (
        <article
          className={"content-card content-comment" + (c.parentId ? " content-reply" : "")}
          key={c.id}
          id={"comment-" + c.id}
        >
          <div className="content-meta">
            <Author author={c.author} />
            <time dateTime={c.createdAt}>
              {new Date(c.createdAt).toLocaleString("ru-RU", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            {c.parentId && (
              <span>
                Ответ {items.find((root) => root.id === c.parentId)?.author.username ?? "в ветке"}
              </span>
            )}
          </div>
          {c.deleted ? (
            <p className="profile-empty">Комментарий удалён автором.</p>
          ) : (
            <ContentText body={c.body} spoiler={c.labels.includes("spoiler")} />
          )}
          {!!c.labels.filter((label) => label !== "spoiler").length && (
            <div className="content-badges">
              {c.labels
                .filter((label) => label !== "spoiler")
                .map((label) => (
                  <span key={label}>{label.toUpperCase()}</span>
                ))}
            </div>
          )}
          <div className="content-actions">
            {authorId && <Link href={c.href + "#comment-" + c.id}>Открыть обсуждение →</Link>}
            {(allDiscussions || globalFeed) && (
              <Link href={c.href + "#comment-" + c.id}>
                {c.episodeId
                  ? "К обсуждению серии →"
                  : c.postId
                    ? "К публикации →"
                    : "К странице аниме →"}
              </Link>
            )}
            {account && !authorId && !c.deleted && !c.parentId && (
              <button className="outline" onClick={() => setReply(c)}>
                Ответить
              </button>
            )}
            {account?.id === c.author.id && !c.deleted && (
              <button className="outline" onClick={() => void remove(c.id)}>
                Удалить комментарий
              </button>
            )}
          </div>
        </article>
      ))}
      {!loading && !items.length && !notice && (
        <p className="profile-empty">
          {authorId ? "Комментариев пока нет." : "Обсуждение только начинается."}
        </p>
      )}
      {next && (
        <button
          className="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void accountRequest(
              url("comments", {
                animeId,
                episodeId,
                postId,
                authorId,
                discussions: allDiscussions ? "all" : undefined,
                q: query,
                before: next.before,
                beforeId: next.beforeId,
              }),
            )
              .then((v) => {
                const r = commentListSchema.parse(v);
                setItems((old) => [...old, ...r.items]);
                setNext(r.next);
              })
              .catch(() => setNotice("Не удалось загрузить комментарии."))
              .finally(() => setBusy(false));
          }}
        >
          Ещё комментарии
        </button>
      )}
    </section>
  );
}
export function PostDetail({ id }: { id: string }) {
  const account = useAccount(),
    [post, setPost] = useState<ContentPost | null>(null),
    [notice, setNotice] = useState(""),
    [rev, setRev] = useState(0);
  useEffect(() => {
    let active = true;
    void accountRequest("/api/account/content/posts/" + id)
      .then((v) => {
        if (active) {
          setPost(postSchema.parse(v));
          setNotice("");
        }
      })
      .catch(() => {
        if (active) {
          setPost(null);
          setNotice("Публикация недоступна или скрыта настройками контента.");
        }
      });
    return () => {
      active = false;
    };
  }, [id, rev]);
  return (
    <>
      {notice && <p role="status">{notice}</p>}
      {post && (
        <>
          <PostCard post={post} account={account ?? null} onChange={() => setRev((n) => n + 1)} />
          <CommentsPanel
            target={{ postId: post.id }}
            context={{
              ...(post.anime ? { anime: post.anime } : {}),
              ...(post.episode ? { episodeId: post.episode.id } : {}),
            }}
          />
        </>
      )}
    </>
  );
}
export function AdultContentPreference() {
  const account = useAccount(),
    [enabled, setEnabled] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (account)
      void loadPrivateProfile()
        .then((p) => setEnabled(p.preferences.adultContent === true))
        .catch(() => {});
  }, [account]);
  if (!account) return null;
  return (
    <div className="content-adult">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            const value = e.target.checked;
            void accountRequest(
              "/api/account/content/preferences",
              { enabled: value, confirmed18: value },
              account.csrfToken,
            )
              .then(() => {
                setEnabled(value);
                window.location.reload();
              })
              .catch(() => setNotice("Не удалось сохранить настройку."));
          }}
        />
        Мне есть 18 лет. Показывать материалы 18+ и NSFW.
      </label>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
