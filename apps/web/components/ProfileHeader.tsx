"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PublicProfile } from "@animesoul/contracts";
import { Icon } from "./Icon";

function Avatar({ profile, large = false }: { profile: PublicProfile; large?: boolean }) {
  return (
    <span className={`profile-avatar${large ? " profile-avatar-large" : ""}`}>
      {profile.avatar ? (
        <img
          src={profile.avatar}
          alt={large ? `Аватар ${profile.username}` : ""}
          width={large ? 110 : 34}
          height={large ? 110 : 34}
        />
      ) : (
        <span>{profile.username.slice(0, 2).toUpperCase()}</span>
      )}
      <i className={`profile-presence-dot is-${profile.presence}`} />
    </span>
  );
}
export function ProfileHeader({ profile }: { profile: PublicProfile }) {
  const hero = useRef<HTMLElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [collapse, setCollapse] = useState(0);
  const identity = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPortalTarget(document.body);
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const headerHeight = window.innerWidth <= 720 ? 64 : 70;
        const top = identity.current?.getBoundingClientRect().top ?? 0;
        const progress = Math.max(0, Math.min(1, (headerHeight + 70 - top) / 70));
        setCollapse(progress);
        hero.current?.style.setProperty("--profile-collapse", String(progress));
        hero.current?.setAttribute("data-compact", progress > 0.5 ? "true" : "false");
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
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
      style={{ "--profile-collapse": 0 } as CSSProperties}
    >
      <div className="profile-cover" aria-hidden="true">
        {profile.banner ? (
          <img src={profile.banner} alt="" />
        ) : (
          <div className="profile-cover-art">
            <span className="profile-moon" />
            <span className="profile-mountain" />
            <span className="profile-mountain mountain-near" />
          </div>
        )}
        <div className="profile-cover-shade" />
      </div>
      <nav className="profile-breadcrumb" aria-label="Навигационная цепочка">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Профиль {profile.username}</span>
      </nav>
      <div className="profile-cover-space" />
      {portalTarget &&
        createPortal(
          <div
            className="profile-mini"
            aria-hidden="true"
            style={{ "--profile-collapse": collapse } as CSSProperties}
          >
            <Avatar profile={profile} />
            <strong>{profile.username}</strong>
            {profile.badge && <span className="profile-badge">{profile.badge}</span>}
          </div>,
          portalTarget,
        )}
      <div className="profile-identity" ref={identity}>
        <Avatar profile={profile} large />
        <div className="profile-identity-text">
          <div className="profile-name-line">
            <h1>{profile.username}</h1>
            {profile.badge && (
              <span className="profile-badge">
                <Icon name="check" />
                {profile.badge}
              </span>
            )}
          </div>
          <div className="profile-identity-meta">
            <span className="profile-presence-label">
              <i className={`profile-presence-dot is-${profile.presence}`} />
              {presence}
            </span>
            <span className="profile-meta-separator">·</span>
            <span className="profile-user-id">
              ID <span>{profile.id}</span>
            </span>
          </div>
        </div>
      </div>
      {profile.about !== undefined && (
        <div className="profile-about">
          <div className="profile-about-text">
            <p>{profile.about}</p>
          </div>
        </div>
      )}
    </section>
  );
}
