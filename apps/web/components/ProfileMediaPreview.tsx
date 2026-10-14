"use client";

import type { ProfileMedia } from "@animesoul/contracts";
import { ProfileImage } from "./ProfileImage";

export function ProfileMediaPreview({
  username,
  media,
  presence,
  pending,
}: {
  username: string;
  media: ProfileMedia;
  presence: "online" | "offline" | "dnd" | "invisible";
  pending: boolean;
}) {
  const status =
    presence === "online" ? "В сети" : presence === "dnd" ? "Не беспокоить" : "Не в сети";
  return (
    <section className="profile-media-mini-preview" aria-label="Предпросмотр профиля">
      <div className="profile-media-mini-cover">
        <ProfileImage value={media.banner} cover alt="Обложка в предпросмотре" />
        <span className="profile-media-mini-shade" />
      </div>
      <div className="profile-media-mini-identity">
        <span className="profile-media-mini-avatar">
          <ProfileImage
            value={media.avatar}
            alt="Аватар в предпросмотре"
            fallback={Array.from(username).slice(0, 2).join("").toUpperCase()}
          />
          <i className={"profile-presence-dot is-" + presence} />
        </span>
        <div>
          <strong>{username}</strong>
          <span>{status}</span>
        </div>
        <small>{pending ? "Предпросмотр выбора" : "Текущее оформление"}</small>
      </div>
    </section>
  );
}
