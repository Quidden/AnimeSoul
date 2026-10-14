"use client";
import Link from "next/link";
import { useState } from "react";
import { socialListSchema, type Person } from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { ProfileImage } from "./ProfileImage";
export function PersonLink({ person, detail }: { person: Person; detail?: string }) {
  return (
    <Link
      className="social-person"
      href={"/users/" + encodeURIComponent(person.username)}
      prefetch={false}
    >
      <span className="profile-avatar">
        <ProfileImage
          value={person.avatar}
          alt=""
          width={34}
          height={34}
          fallback={Array.from(person.username).slice(0, 2).join("").toUpperCase()}
        />
      </span>
      <span className="social-person-name">
        {person.username}
        {detail && <small>{detail}</small>}
      </span>
    </Link>
  );
}
export function ProfileFriends({
  username,
  initial,
  next: initialNext,
}: {
  username: string;
  initial: Person[];
  next: string | null;
}) {
  const [items, setItems] = useState(initial),
    [next, setNext] = useState(initialNext),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function more() {
    setBusy(true);
    setNotice("");
    try {
      const page = socialListSchema.parse(
        await accountRequest(
          "/api/account/profiles/" + encodeURIComponent(username) + "/friends?after=" + next,
        ),
      );
      setItems((previous) => [
        ...new Map([...previous, ...page.items].map((p) => [p.id, p])).values(),
      ]);
      setNext(page.next);
    } catch {
      setNotice("Войдите в аккаунт или обновите страницу, чтобы проверить доступ к списку.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-section" id="profile-friends">
      <div className="profile-section-heading">
        <h2>Друзья</h2>
      </div>
      <div className="social-people-grid">
        {items.map((person) => (
          <PersonLink key={person.id} person={person} />
        ))}
      </div>
      {!items.length && (
        <p className="profile-empty">В этом разделе пока нет доступных профилей.</p>
      )}
      {next && (
        <button className="outline" disabled={busy} onClick={() => void more()}>
          {busy ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
      {notice && (
        <p role="status" className="social-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
