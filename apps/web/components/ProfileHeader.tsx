"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PublicProfile } from "@animesoul/contracts";
import { Icon } from "./Icon";
import { ProfileControls } from "./ProfileControls";
import { ProfileImage } from "./ProfileImage";
import { accountSettingsHref } from "../lib/account-settings";

function Avatar({
  profile,
  large = false,
  editable = false,
}: {
  profile: PublicProfile;
  large?: boolean;
  editable?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const content = (
    <>
      {profile.avatar && profile.avatar !== failed ? (
        <ProfileImage
          value={profile.avatar}
          fallback={<span>{Array.from(profile.username).slice(0, 2).join("").toUpperCase()}</span>}
          alt={large ? `Аватар ${profile.username}` : ""}
          width={large ? 110 : 34}
          height={large ? 110 : 34}
          onError={() => setFailed(profile.avatar)}
        />
      ) : (
        <span>{Array.from(profile.username).slice(0, 2).join("").toUpperCase()}</span>
      )}
      <i className={`profile-presence-dot is-${profile.presence}`} />
    </>
  );
  const className = `profile-avatar${large ? " profile-avatar-large" : ""}`;
  return editable ? (
    <Link
      className={className + " profile-avatar-settings-link"}
      href={accountSettingsHref("media-settings")}
      aria-label="Настроить аватар и обложку"
      title="Аватар и обложка"
    >
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}
export function ProfileHeader({ profile }: { profile: PublicProfile }) {
  const [isOwner, setIsOwner] = useState(false);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const hero = useRef<HTMLElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [collapse, setCollapse] = useState(0);
  const identity = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>(".profile-brand"));
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
        {profile.banner && profile.banner !== failedCover ? (
          <ProfileImage
            value={profile.banner}
            cover
            alt=""
            fallback={
              <div className="profile-cover-art">
                <span className="profile-moon" />
                <span className="profile-mountain" />
                <span className="profile-mountain mountain-near" />
              </div>
            }
            onError={() => setFailedCover(profile.banner)}
          />
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
        <Avatar profile={profile} large editable={isOwner} />
        <div className="profile-identity-text">
          <div className="profile-name-line">
            <div className="profile-name-edit-group">
              <h1>{profile.username}</h1>
              {isOwner && (
                <Link
                  className="profile-name-edit"
                  href={accountSettingsHref("profile-settings")}
                  aria-label="Настроить имя и описание профиля"
                  title="Настройки профиля"
                >
                  <Icon name="settings" width={16} height={16} />
                </Link>
              )}
            </div>
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
      {!!profile.about?.trim() && (
        <div className="profile-about">
          <div className="profile-about-text">
            <p>{profile.about}</p>
          </div>
        </div>
      )}
      <ProfileControls profile={profile} onOwnerChange={setIsOwner} />
    </section>
  );
}
