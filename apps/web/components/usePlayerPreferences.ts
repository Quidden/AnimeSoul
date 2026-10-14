"use client";
import { useEffect, useRef, useState } from "react";
import {
  dubbingKey,
  playerStateSchema,
  readPlayerPreferences,
  type Account,
  type PlayerPreferences,
} from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";

export function usePlayerPreferences(
  animeId: string | undefined,
  account: Account | null,
  authReady: boolean,
) {
  const [preferences, setPreferences] = useState(() => readPlayerPreferences({}));
  const [manual, setManual] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const identity = `${account?.id ?? "guest"}:${animeId ?? "settings"}`;
  const [notice, setNotice] = useState("");
  const queue = useRef(Promise.resolve());
  const values = useRef({ preferences, manual });
  values.current = { preferences, manual };
  useEffect(() => {
    let live = true;
    setReady(false);
    setManual(null);
    setNotice("");
    if (!authReady) return;
    if (!account) {
      try {
        setPreferences(
          readPlayerPreferences(JSON.parse(localStorage.getItem("animesoul:guest-player") ?? "{}")),
        );
        setManual(animeId ? localStorage.getItem("animesoul:guest-dubbing:" + animeId) : null);
      } catch {
        /* Optional device preferences. */
      }
      setLoadedFor(identity);
      setReady(true);
      return;
    }
    void accountRequest("/api/account/player" + (animeId ? "?animeId=" + animeId : ""))
      .then(playerStateSchema.parse)
      .then((state) => {
        if (live) {
          setPreferences(state.preferences);
          setManual(state.dubbing);
        }
      })
      .catch(() => {
        if (live)
          setNotice("Настройки плеера пока недоступны. Повторите после обновления страницы.");
      })
      .finally(() => {
        if (live) {
          setLoadedFor(identity);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [animeId, account?.id, authReady]);
  function persist(path: string, body: unknown) {
    if (!account) return;
    const owner = account;
    queue.current = queue.current.then(async () => {
      try {
        await accountRequest("/api/account/player/" + path, body, owner.csrfToken, false);
        setNotice("");
      } catch {
        setNotice("Не удалось сохранить настройку. Повторите действие.");
      }
    });
  }
  function edit(update: Partial<Pick<PlayerPreferences, "resume" | "autoplay">>) {
    const next = { ...values.current.preferences, ...update };
    values.current.preferences = next;
    setPreferences(next);
    if (account) persist("preferences", update);
    else
      try {
        localStorage.setItem("animesoul:guest-player", JSON.stringify(next));
      } catch {
        /* Optional. */
      }
  }
  function favorite(dubbing: string, enabled: boolean) {
    const names = values.current.preferences.favoriteDubbings.filter(
      (name) => dubbingKey(name) !== dubbingKey(dubbing),
    );
    if (enabled && names.length >= 50) {
      setNotice("Можно выбрать до 50 любимых озвучек.");
      return;
    }
    if (enabled) names.push(dubbing);
    const next = { ...values.current.preferences, favoriteDubbings: names };
    values.current.preferences = next;
    setPreferences(next);
    if (account) persist("favorite", { dubbing, favorite: enabled });
    else
      try {
        localStorage.setItem("animesoul:guest-player", JSON.stringify(next));
      } catch {
        /* Optional. */
      }
  }
  function choose(dubbing: string | null) {
    values.current.manual = dubbing;
    setManual(dubbing);
    if (!animeId) return;
    if (account) persist("dubbing", { animeId, dubbing });
    else
      try {
        if (dubbing) localStorage.setItem("animesoul:guest-dubbing:" + animeId, dubbing);
        else localStorage.removeItem("animesoul:guest-dubbing:" + animeId);
      } catch {
        /* Optional. */
      }
  }
  return {
    preferences,
    manual,
    ready: ready && loadedFor === identity,
    notice,
    edit,
    favorite,
    choose,
  };
}
