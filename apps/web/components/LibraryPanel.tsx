"use client";
import Link from "next/link";
import { seasonLabel } from "../lib/season-label";
import { useEffect, useState, type FormEvent } from "react";
import type { Library } from "@animesoul/contracts";
import { resumeEpisodeHref } from "@animesoul/contracts";
import { accountRequest, loadLibrary } from "../lib/account-client";
import { useAccountSession } from "./useAccountSession";
import { Icon } from "./Icon";
export function LibraryPanel() {
  const { account, ready } = useAccountSession();
  const [library, setLibrary] = useState<Library | null>(null);
  const [folder, setFolder] = useState("all");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
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
    setAdding(false);
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
  const favorites = library?.items.filter((item) => item.favorite).length ?? 0;
  const rated = library?.items.filter((item) => item.score).length ?? 0;
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
      {!ready ? (
        // Until the session answers, a signed-in reader must not see the guest invitation.
        <p className="account-help" role="status">
          Загружаем библиотеку…
        </p>
      ) : !account ? (
        <>
          <Link className="primary" href="/account">
            Войти в аккаунт
          </Link>
          <ul className="library-guest-preview" aria-label="Что есть в библиотеке">
            <li>
              <strong>Смотрю сейчас</strong>
              <span>Серия и минута, на которой остановился, на любом устройстве.</span>
            </li>
            <li>
              <strong>Папки и избранное</strong>
              <span>Запланировано, любимое, брошено — свои списки под рукой.</span>
            </li>
            <li>
              <strong>Оценки</strong>
              <span>Ставь оценки и находи похожие тайтлы по вкусу.</span>
            </li>
          </ul>
          <Link className="text-link" href="/catalog">
            Пока просто посмотреть каталог →
          </Link>
        </>
      ) : !library ? (
        <p role="status">Загружаем библиотеку…</p>
      ) : (
        <>
          {library.items.length > 0 && (
            <ul className="library-summary" aria-label="Сводка библиотеки">
              <li>
                <strong>{library.items.length}</strong> в библиотеке
              </li>
              <li>
                <strong>{favorites}</strong> в любимом
              </li>
              <li>
                <strong>{rated}</strong> с оценкой
              </li>
            </ul>
          )}
          <div className="library-folders" role="group" aria-label="Папки">
            {[
              { id: "all", name: "Всё", count: library.items.length },
              { id: "favorites", name: "♥ Любимое", count: favorites },
              ...library.folders.map((f) => ({ id: f.id, name: f.name, count: f.entries.length })),
            ].map((tab) => (
              <button
                type="button"
                className="library-folder"
                key={tab.id}
                aria-pressed={folder === tab.id}
                onClick={() => setFolder(tab.id)}
              >
                {tab.name}
                <span>{tab.count}</span>
              </button>
            ))}
            {adding ? (
              <form className="library-folder-add" onSubmit={addFolder}>
                <input
                  name="name"
                  aria-label="Название новой папки"
                  placeholder="Название папки"
                  required
                  autoFocus
                  maxLength={100}
                />
                <button className="primary" disabled={busy}>
                  Создать
                </button>
                <button type="button" className="outline" onClick={() => setAdding(false)}>
                  Отмена
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="library-folder is-add"
                onClick={() => setAdding(true)}
              >
                + Папка
              </button>
            )}
          </div>
          {selected && (
            <details className="library-manage">
              <summary>Управление папкой «{selected.name}»</summary>
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
            </details>
          )}
          {items.length === 0 && (
            <div className="library-empty">
              <Icon name="folder" aria-hidden="true" />
              <strong>
                {folder === "all" ? "Библиотека пока пуста" : "Здесь пока ничего нет"}
              </strong>
              <p>
                {folder === "all"
                  ? "Добавляйте аниме кнопкой «+» на карточке в каталоге — прогресс и оценки соберутся здесь."
                  : "Добавьте тайтлы в эту папку кнопкой «Добавить в папку» на карточке из раздела «Всё»."}
              </p>
              {folder === "all" ? (
                <Link className="primary" href="/catalog">
                  Открыть каталог
                </Link>
              ) : (
                <button type="button" className="primary" onClick={() => setFolder("all")}>
                  Показать всё
                </button>
              )}
            </div>
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
                    <div className="library-item-head">
                      <h2>
                        {item.anime.published ? (
                          <Link href={"/anime/" + item.anime.slug}>{item.anime.title}</Link>
                        ) : (
                          item.anime.title
                        )}
                      </h2>
                      <button
                        type="button"
                        className="library-heart"
                        disabled={busy}
                        aria-pressed={item.favorite}
                        aria-label={
                          (item.favorite ? "Убрать из любимого: " : "В любимое: ") +
                          item.anime.title
                        }
                        onClick={() =>
                          void mutate("/api/account/library", {
                            animeId: item.animeId,
                            favorite: !item.favorite,
                          })
                        }
                      >
                        {item.favorite ? "♥" : "♡"}
                      </button>
                    </div>
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
                            {episode.episode.number} ·{" "}
                            {seasonLabel(episode.episode.season).toLowerCase()}
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
                    {episode && episode.duration > 0 && !episode.completed && (
                      <progress
                        className="library-item-progress"
                        max={episode.duration}
                        value={Math.min(episode.position, episode.duration)}
                        aria-label="Прогресс последней серии"
                      />
                    )}
                    <div className="library-item-controls">
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
                                      Серия {p.episode.number} ·{" "}
                                      {seasonLabel(p.episode.season).toLowerCase()}
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
