"use client";
import { useEffect, useRef } from "react";
import type { PublicProfile } from "@animesoul/contracts";
export function ProfileHeader({ profile }: { profile: PublicProfile }) {
  const hero = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const progress = Math.max(0, Math.min(1, window.scrollY / 220));
        hero.current?.style.setProperty("--collapse", String(progress));
        hero.current?.setAttribute("data-compact", progress > 0.92 ? "true" : "false");
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, []);
  const presence =
    profile.presence === "online"
      ? "В сети"
      : profile.presence === "dnd"
        ? "Не беспокоить"
        : "Не в сети";
  return (
    <section
      className="profile-hero"
      ref={hero}
      data-compact="false"
      style={{ "--collapse": 0 } as React.CSSProperties}
    >
      <div
        className="profile-banner"
        style={profile.banner ? { backgroundImage: `url("${profile.banner}")` } : undefined}
      />
      <div className="compact-profile" aria-hidden="true">
        {profile.avatar && <img src={profile.avatar} alt="" width="26" height="26" />}
        <span>{profile.username}</span>
      </div>
      <div className="profile-heading content">
        <div className="avatar-wrap">
          {profile.avatar ? (
            <img
              className="avatar"
              src={profile.avatar}
              alt={`Аватар ${profile.username}`}
              width="112"
              height="112"
            />
          ) : (
            <span className="avatar avatar-fallback">
              {profile.username.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className={`presence-dot ${profile.presence}`} />
        </div>
        <div className="profile-identity">
          <div className="nickname">
            <h1>{profile.username}</h1>
            {profile.badge && <span className="badge">{profile.badge}</span>}
          </div>
          <p className="profile-subtitle">
            {presence}
            <span>·</span>
            <span className="user-id">ID {profile.id}</span>
          </p>
          {profile.about !== undefined && <p className="profile-about">{profile.about}</p>}
        </div>
      </div>
    </section>
  );
}
