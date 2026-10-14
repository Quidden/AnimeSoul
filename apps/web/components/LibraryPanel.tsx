"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Library } from "@animesoul/contracts";
import { resumeEpisodeHref } from "@animesoul/contracts";
import { accountRequest, loadLibrary } from "../lib/account-client";
import { useAccountSession } from "./useAccountSession";
export function LibraryPanel() {
  const { account } = useAccountSession();
  const [library, setLibrary] = useState<Library | null>(null);
  const [folder, setFolder] = useState("all");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setLibrary(null);
    setNotice("");
    if (account)
      void loadLibrary()
        .then((value) => {
          if (active) setLibrary(value);
        })
        .catch((e) => {
          if (active)
            setNotice(e instanceof Error ? e.message : "Не удалось загрузить библиотеку.");
        });
    return () => {
      active = false;
    };
  }, [account]);
  async function mutate(path: string, body: unknown) {
    if (!account) return;
    setBusy(true);
    setNotice("");
    try {
      await accountRequest(path, body, account.csrfToken);
      setLibrary(await loadLibrary());
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }
  async function addFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await mutate("/api/account/folders", { name: new FormData(form).get("name") });
    form.reset();
  }
  const selected = library?.folders.find((f) => f.id === folder);
  const items =
    library?.items.filter((item) =>
      folder === "favorites"
        ? item.favorite
        : folder === "all"
          ? true
          : !!selected?.entries.some((e) => e.animeId === item.animeId),
    ) ?? [];
  return (
    <>
      <div className="account-heading">
        <span className="eyebrow">ЛИЧНОЕ</span>
        <h1>Моя библиотека</h1>
        <p>Любимое аниме, ваши папки, оценки и сохранённые серии.</p>
        <Link href="/account" className="text-link">
          Аккаунт и приватность →
        </Link>
      </div>
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {!account ? (
        <Link className="primary" href="/account">
          Войти в аккаунт
        </Link>
      ) : !library ? (
        <p role="status">Загружаем библиотеку…</p>
      ) : (
        <>
          <div className="library-toolbar">
            <label>
              Показать
              <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                <option value="all">Всё ({library.items.length})</option>
                <option value="favorites">Любимое</option>
                {library.folders.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name} ({f.entries.length})
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={addFolder}>
              <input
                name="name"
                aria-label="Название новой папки"
                placeholder="Новая папка"
                required
                maxLength={100}
              />
              <button className="outline" disabled={busy}>
                Создать
              </button>
            </form>
          </div>
          {selected && (
            <div className="account-actions">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("/api/account/folders", {
                    id: selected.id,
                    name: new FormData(e.currentTarget).get("name"),
                  });
                }}
              >
                <input
                  name="name"
                  key={selected.id}
                  defaultValue={selected.name}
                  maxLength={100}
                  required
                  aria-label="Переименовать папку"
                />
                <button className="outline" disabled={busy}>
                  Переименовать
                </button>
              </form>
              <button
                className="outline"
                disabled={busy}
                onClick={() => {
                  void mutate("/api/account/folders/delete", { id: selected.id }).then(() =>
                    setFolder("all"),
                  );
                }}
              >
                Удалить папку
              </button>
            </div>
          )}
          {items.length === 0 && (
            <p className="empty-state">
              Здесь пока пусто. Добавляйте аниме из каталога или перенесите прежний профиль.
            </p>
          )}
          <div className="library-list">
            {items.map((item) => {
              const episode = library.progress.find(
                (p) => p.animeId === item.animeId && p.episodeKey === item.lastEpisode,
              );
              return (
                <article className="library-item" key={item.animeId}>
                  <div className="library-poster">
                    {item.anime.poster && <img src={item.anime.poster} alt="" loading="lazy" />}
                  </div>
                  <div className="library-item-body">
                    <h2>
                      {item.anime.published ? (
                        <Link href={"/anime/" + item.anime.slug}>{item.anime.title}</Link>
                      ) : (
                        item.anime.title
                      )}
                    </h2>
                    {!item.anime.published && (
                      <p className="account-help">
                        Запись перенесена; страница появится после обновления каталога.
                      </p>
                    )}
                    {item.lastEpisode && (
                      <p className="account-help">
                        Последняя серия:{" "}
                        {episode?.episode ? (
                          <Link href={resumeEpisodeHref(item.anime.slug, episode.episode.id)}>
                            {episode.episode.number} · сезон {episode.episode.season}
                          </Link>
                        ) : (
                          item.lastEpisode
                        )}
                        {item.dubbing && ` · ${item.dubbing}`}
                        {episode &&
                          episode.duration > 0 &&
                          ` · ${Math.floor(episode.position / 60)} / ${Math.floor(episode.duration / 60)} мин`}
                        {episode?.completed && " · просмотрено"}
                      </p>
                    )}
                    <div className="library-item-controls">
                      <button
                        className="outline"
                        disabled={busy}
                        aria-pressed={item.favorite}
                        onClick={() =>
                          void mutate("/api/account/library", {
                            animeId: item.animeId,
                            favorite: !item.favorite,
                          })
                        }
                      >
                        {item.favorite ? "♥ В любимом" : "♡ В любимое"}
                      </button>
                      <label>
                        Оценка
                        <select
                          aria-label={"Оценка: " + item.anime.title}
                          value={item.score ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            void mutate("/api/account/library", {
                              animeId: item.animeId,
                              score: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">Без оценки</option>
                          {Array.from({ length: 10 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                              {i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Добавить в папку
                        <select
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value)
                              void mutate("/api/account/folders/entry", {
                                folderId: e.target.value,
                                animeId: item.animeId,
                              });
                          }}
                        >
                          <option value="">Выбрать…</option>
                          {library.folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selected && (
                        <button
                          className="outline"
                          disabled={busy}
                          onClick={() =>
                            void mutate("/api/account/folders/entry", {
                              folderId: selected.id,
                              animeId: item.animeId,
                              remove: true,
                            })
                          }
                        >
                          Убрать из папки
                        </button>
                      )}
                    </div>
                    {library.progress.some((p) => p.animeId === item.animeId) && (
                      <details className="library-progress">
                        <summary>Сохранённые серии</summary>
                        <ul>
                          {library.progress
                            .filter((p) => p.animeId === item.animeId)
                            .map((p) => (
                              <li key={p.episodeKey}>
                                <span>
                                  {p.episode && item.anime.published ? (
                                    <Link href={resumeEpisodeHref(item.anime.slug, p.episode.id)}>
                                      Серия {p.episode.number} · сезон {p.episode.season}
                                    </Link>
                                  ) : (
                                    `Серия ${p.episodeKey}`
                                  )}{" "}
                                  · {Math.floor(p.position / 60)} / {Math.floor(p.duration / 60)}{" "}
                                  мин
                                  {p.completed ? " · просмотрено" : ""}
                                </span>
                                <button
                                  className="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate("/api/account/progress", {
                                      animeId: item.animeId,
                                      episodeKey: p.episodeKey,
                                      position: p.position,
                                      duration: p.duration,
                                      completed: !p.completed,
                                      dubbing: item.dubbing,
                                      season: item.season,
                                    })
                                  }
                                >
                                  {p.completed ? "Снять отметку" : "Просмотрено"}
                                </button>
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                    {item.ratings.length > 0 && (
                      <details className="library-note">
                        <summary>Оценки сезонов и серий ({item.ratings.length})</summary>
                        <div className="library-item-controls">
                          {item.ratings.map((r) => (
                            <label key={r.scope + r.key}>
                              {r.scope === "season" ? "Сезон" : "Серия"} {r.key}
                              <select
                                value={r.score}
                                disabled={busy}
                                onChange={(e) =>
                                  void mutate("/api/account/ratings", {
                                    animeId: item.animeId,
                                    scope: r.scope,
                                    key: r.key,
                                    score: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                              >
                                <option value="">Без оценки</option>
                                {Array.from({ length: 10 }, (_, i) => (
                                  <option key={i + 1} value={i + 1}>
                                    {i + 1}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </details>
                    )}
                    {selected && (
                      <form
                        className="library-note"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void mutate("/api/account/folders/entry", {
                            folderId: selected.id,
                            animeId: item.animeId,
                            note: new FormData(e.currentTarget).get("note"),
                          });
                        }}
                      >
                        <input
                          key={selected.id + item.animeId}
                          name="note"
                          defaultValue={
                            selected.entries.find((e) => e.animeId === item.animeId)?.note ?? ""
                          }
                          maxLength={2000}
                          aria-label={"Заметка: " + item.anime.title}
                          placeholder="Личная заметка"
                        />
                        <button className="outline" disabled={busy}>
                          Сохранить заметку
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
