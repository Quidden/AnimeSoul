"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Account, PrivateProfile } from "@animesoul/contracts";
import { accountRequest, loadAccount, loadPrivateProfile } from "../lib/account-client";
import type { AccountSection } from "./AccountWorkspace";
import { ProfileMediaEditor } from "./ProfileMediaEditor";

export function AccountProfileSettings({
  account,
  onUpdate,
  section,
}: {
  account: Account;
  onUpdate: (account: Account) => void;
  section: AccountSection;
}) {
  const [profile, setProfile] = useState<PrivateProfile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ section: string; text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError("");
    void loadPrivateProfile()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Не удалось загрузить профиль.");
      });
    return () => {
      active = false;
    };
  }, [account.id, revision]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    target: "profile-settings" | "privacy-settings",
  ) {
    event.preventDefault();
    if (!profile || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    const privacy = target === "privacy-settings";
    const next = {
      username: privacy ? profile.username : data.get("username"),
      about: privacy ? profile.about : data.get("about"),
      presence: privacy ? profile.presence : data.get("presence"),
      isPublic: privacy ? data.get("profileAccess") === "public" : profile.isPublic,
      profileAccess: privacy ? data.get("profileAccess") : profile.profileAccess,
      friendRequests: privacy ? data.get("friendRequests") : profile.friendRequests,
      indexable: privacy ? data.has("indexable") : profile.indexable,
      visibility: privacy
        ? Object.fromEntries(
            Object.keys(profile.visibility).map((key) => [key, data.get("visibility-" + key)]),
          )
        : profile.visibility,
    };
    try {
      await accountRequest("/api/account/profile", next, account.csrfToken);
      setProfile(await loadPrivateProfile());
      onUpdate(await loadAccount());
      setNotice({
        section: target,
        text: privacy ? "Настройки приватности сохранены." : "Профиль сохранён.",
        error: false,
      });
    } catch (error) {
      setNotice({
        section: target,
        text: error instanceof Error ? error.message : "Не удалось сохранить настройки.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  const feedback = (target: string) =>
    notice?.section === target && (
      <p
        className={"account-notice" + (notice.error ? " account-notice-error" : "")}
        role={notice.error ? "alert" : "status"}
      >
        {notice.text}
      </p>
    );
  const loading =
    !profile &&
    (loadError ? (
      <div className="account-load-error" role="alert">
        <p>{loadError}</p>
        <button type="button" className="outline" onClick={() => setRevision((value) => value + 1)}>
          Повторить загрузку
        </button>
      </div>
    ) : (
      <p className="account-help" role="status">
        Загружаем настройки профиля…
      </p>
    ));
  return (
    <>
      <section
        id="profile-settings"
        hidden={section !== "profile-settings"}
        className="account-card account-settings-anchor account-section-view"
      >
        <h2>Профиль</h2>
        <p className="account-help">Имя, описание и статус, которые видны в твоём профиле.</p>
        {loading}
        {profile && (
          <form
            key={profile.username}
            className="account-form"
            onSubmit={(event) => void submit(event, "profile-settings")}
          >
            <fieldset disabled={busy} className="account-fields">
              <label>
                Имя профиля
                <input
                  name="username"
                  defaultValue={profile.username}
                  minLength={2}
                  maxLength={40}
                  required
                  autoComplete="nickname"
                />
              </label>
              <label>
                О себе
                <textarea
                  name="about"
                  defaultValue={profile.about}
                  maxLength={2000}
                  rows={5}
                  placeholder="Какие истории тебе нравятся?"
                />
              </label>
              <label>
                Статус
                <select name="presence" defaultValue={profile.presence}>
                  <option value="online">В сети</option>
                  <option value="offline">Не в сети</option>
                  <option value="dnd">Не беспокоить</option>
                  <option value="invisible">Невидимый</option>
                </select>
              </label>
            </fieldset>
            {feedback("profile-settings")}
            <div className="account-save-row">
              <button className="primary" disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить профиль"}
              </button>
              <Link className="text-link" href={"/users/" + encodeURIComponent(profile.username)}>
                Открыть мой профиль
              </Link>
            </div>
          </form>
        )}
      </section>
      <section
        id="media-settings"
        hidden={section !== "media-settings"}
        className="account-card account-settings-anchor account-section-view"
      >
        <h2>Аватар и обложка</h2>
        <p className="account-help">
          Выбери готовое оформление, найди GIF в GIPHY или загрузи своё изображение.
        </p>
        {loading}
        {profile && (
          <ProfileMediaEditor
            account={account}
            presence={profile.presence}
            value={profile}
            onChange={(media) => {
              setProfile((current) => (current ? { ...current, ...media } : current));
              onUpdate({ ...account, avatar: media.avatar });
            }}
          />
        )}
      </section>
      <section
        id="privacy-settings"
        hidden={section !== "privacy-settings"}
        className="account-card account-settings-anchor account-section-view"
      >
        <h2>Приватность</h2>
        <p className="account-help">Реши, кто может видеть профиль и общаться с тобой.</p>
        {loading}
        {profile && (
          <form
            className="account-form account-privacy-form"
            onSubmit={(event) => void submit(event, "privacy-settings")}
          >
            <fieldset disabled={busy} className="account-fields">
              <div className="account-form-grid">
                <label>
                  Кто видит профиль
                  <select
                    name="profileAccess"
                    defaultValue={
                      profile.profileAccess ?? (profile.isPublic ? "public" : "private")
                    }
                  >
                    <option value="public">Все</option>
                    <option value="friends">Друзья</option>
                    <option value="private">Только я</option>
                  </select>
                </label>
                <label>
                  Кто может отправлять заявки в друзья
                  <select name="friendRequests" defaultValue={profile.friendRequests ?? "everyone"}>
                    <option value="everyone">Все</option>
                    <option value="nobody">Никто</option>
                  </select>
                </label>
              </div>
              <label className="account-check">
                <input name="indexable" type="checkbox" defaultChecked={profile.indexable} />
                Разрешить индексацию публичного профиля
              </label>
              <fieldset className="account-visibility">
                <legend>Видимость разделов профиля</legend>
                <div className="account-form-grid">
                  {(
                    [
                      ["about", "О себе"],
                      ["favorites", "Любимое"],
                      ["folders", "Папки"],
                      ["ratings", "Оценки"],
                      ["statistics", "Статистика"],
                      ["friends", "Друзья"],
                      ["posts", "Посты"],
                      ["reviews", "Рецензии"],
                      ["comments", "История комментариев"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <select name={"visibility-" + key} defaultValue={profile.visibility[key]}>
                        <option value="public">Все</option>
                        <option value="friends">Друзья</option>
                        <option value="private">Только я</option>
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="account-help">
                Доступ к разделу ограничен видимостью всего профиля. Скрытая история комментариев не
                удаляет публичные комментарии под аниме.
              </p>
            </fieldset>
            {feedback("privacy-settings")}
            <div className="account-save-row">
              <button className="primary" disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить приватность"}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
