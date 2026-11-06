"use client";
import Link from "next/link";
import { useState } from "react";
import { useCardLibrary } from "./CardLibrary";
import { RatingSlider } from "./RatingSlider";
import { accountRequest } from "../lib/account-client";
export function AnimeLibraryActions({ animeId }: { animeId: string }) {
  const { account, library, ready, refresh } = useCardLibrary();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const item = library?.items.find((i) => i.animeId === animeId);
  async function save(path: string, body: unknown) {
    if (!account) return;
    setBusy(true);
    setNotice("");
    try {
      await accountRequest(path, body, account.csrfToken);
      await refresh();
      setNotice("Сохранено в библиотеке.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  if (!account)
    return (
      <p
        className="account-help anime-library"
        style={ready ? undefined : { visibility: "hidden" }}
      >
        <Link href="/account" className="outline">
          Войдите, чтобы сохранять любимое аниме и оценки →
        </Link>
      </p>
    );
  return (
    <div className="anime-library">
      <div className="library-item-controls">
        <button
          className="outline"
          disabled={busy}
          aria-pressed={item?.favorite ?? false}
          onClick={() =>
            void save("/api/account/library", { animeId, favorite: !item?.favorite }).catch(
              () => {},
            )
          }
        >
          {item?.favorite ? "♥ В любимом" : "♡ В любимое"}
        </button>
        <RatingSlider
          label="Оценить аниме"
          value={item?.score}
          disabled={busy}
          onSave={(score) => save("/api/account/library", { animeId, score })}
        />
        {!!library?.folders.length && (
          <label>
            Папка
            <select
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value)
                  void save("/api/account/folders/entry", {
                    folderId: e.target.value,
                    animeId,
                  }).catch(() => {});
              }}
            >
              <option value="">Выбрать…</option>
              {library.folders.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Link className="outline" href="/library">
          Моя библиотека →
        </Link>
      </div>
      {notice && (
        <p role="status" className="account-help">
          {notice}
        </p>
      )}
    </div>
  );
}
