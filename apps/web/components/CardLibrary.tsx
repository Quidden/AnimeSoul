"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Account, Library } from "@animesoul/contracts";
import { accountRequest, loadAccount, loadLibrary } from "../lib/account-client";
type Value = {
  account: Account | null;
  library: Library | null;
  // False until the first session answer, so guest copy is not shown to a signed-in reader.
  ready: boolean;
  refresh: () => Promise<void>;
};
const Context = createContext<Value>({
  account: null,
  library: null,
  ready: false,
  refresh: async () => {},
});
export function CardLibraryProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null),
    [library, setLibrary] = useState<Library | null>(null),
    [ready, setReady] = useState(false);
  const revision = useRef(0);
  async function refresh() {
    const current = ++revision.current;
    try {
      const user = await loadAccount();
      // A failed library read does not invalidate a confirmed account session.
      const data = await loadLibrary().catch(() => null);
      if (current !== revision.current) return;
      setAccount(user);
      setLibrary(data);
      setReady(true);
    } catch {
      if (current !== revision.current) return;
      setAccount(null);
      setLibrary(null);
      setReady(true);
    }
  }
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => void refresh();
    const progress = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 200);
    };
    window.addEventListener("animesoul:account-changed", update);
    window.addEventListener("animesoul:library-updated", progress);
    return () => {
      revision.current++;
      clearTimeout(timer);
      window.removeEventListener("animesoul:account-changed", update);
      window.removeEventListener("animesoul:library-updated", progress);
    };
  }, []);
  return (
    <Context.Provider value={{ account, library, ready, refresh }}>{children}</Context.Provider>
  );
}
export function useCardLibrary() {
  return useContext(Context);
}
export function CardProgress({ animeId }: { animeId: string }) {
  const { library } = useCardLibrary();
  const progress = library?.progress.filter((p) => p.animeId === animeId);
  if (!progress?.length) return null;
  const completed = progress.filter((p) => p.completed).length;
  const current = progress.find((p) => !p.completed && p.position > 0 && p.duration > 0);
  const percent = current
    ? Math.min(100, Math.round((current.position / current.duration) * 100))
    : completed > 0
      ? 100
      : 0;
  return (
    <div className="card-watch-progress">
      <span>
        {current
          ? `${current.episode ? `Серия ${current.episode.number} · ` : ""}${percent}%`
          : `Просмотрено серий: ${completed}`}
      </span>
      <progress max={100} value={percent} aria-label="Прогресс просмотра" />
    </div>
  );
}
export function CardLibraryActions({ animeId, title }: { animeId: string; title: string }) {
  const { account, library, refresh } = useCardLibrary(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const item = library?.items.find((i) => i.animeId === animeId);
  async function save(path: string, body: unknown) {
    if (!account) {
      router.push("/account");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await accountRequest(path, body, account.csrfToken);
      await refresh();
      setNotice("Сохранено");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card-library-actions">
      <button
        type="button"
        aria-label={`${item?.favorite ? "Убрать из любимого" : "В любимое"}: ${title}`}
        aria-pressed={item?.favorite ?? false}
        disabled={busy}
        onClick={() => void save("/api/account/library", { animeId, favorite: !item?.favorite })}
      >
        {item?.favorite ? "♥" : "♡"}
      </button>
      <details className="card-folder-picker">
        <summary aria-label={`Добавить в папку: ${title}`}>＋</summary>
        <div className="card-folder-menu">
          {account ? (
            <>
              <b>Добавить в папку</b>
              {library?.folders.map((f) => (
                <button
                  type="button"
                  disabled={busy}
                  key={f.id}
                  onClick={() =>
                    void save("/api/account/folders/entry", { animeId, folderId: f.id })
                  }
                >
                  {f.name}
                </button>
              ))}
              <Link href="/library">Создать папку →</Link>
            </>
          ) : (
            <Link href="/account">Войти, чтобы сохранить</Link>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </details>
      {notice && (
        <span className="card-save-notice" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
