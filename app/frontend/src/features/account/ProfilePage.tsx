import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fetchAnimeDetails } from "../catalog/api";
import { animeRoute, navigateTo } from "../navigation/routes";
import { requestJson } from "../../lib/http";
import { useModalAccessibility } from "../../lib/modalAccessibility";
import type { Anime } from "../../lib/types";
import { useAccount } from "./context";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileIcon } from "./ProfileIcon";
import { useProfileMedia } from "./useProfileMedia";
import { PRESENCES, SECTION_LABELS, type Presence, type ProfileChanges, type ProfileSection, type UserProfile } from "./profile";
import "./profile.css";

function ProfileLink({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }) {
  return <a href={href} className={className} aria-label={label} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateTo(href); } }}>{children}</a>;
}
function Avatar({ profile, source, className = "" }: { profile: UserProfile; source: string; className?: string }) {
  const [failed, setFailed] = useState("");
  return <span className={`profile-avatar ${className}`}>
    {source && failed !== source ? <img src={source} alt={`Аватар ${profile.username}`} referrerPolicy="no-referrer" onError={() => setFailed(source)} /> : <span>{profile.username.slice(0, 1).toUpperCase()}</span>}
    <i className={`profile-presence-dot is-${profile.presence}`} aria-label={PRESENCES.find(item => item.value === profile.presence)?.label} />
  </span>;
}
function Badges({ profile }: { profile: UserProfile }) {
  return <>{profile.badges.map(badge => <span key={badge.id} className={`profile-badge is-${badge.kind}`} data-role={badge.id} data-frame={badge.kind}>{badge.kind === "premium" && <ProfileIcon name="star" />}{badge.kind === "admin" && <ProfileIcon name="check" />}{badge.name}</span>)}</>;
}
function Poster({ anime, title }: { anime?: Anime; title: string }) {
  const source = anime?.poster?.big || anime?.poster?.fullsize || "";
  const [failed, setFailed] = useState("");
  return source && failed !== source ? <img src={source} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(source)} /> : <span className="profile-poster-placeholder"><ProfileIcon name="image" /></span>;
}
function AnimeTile({ id, anime, title }: { id: number; anime?: Anime; title?: string }) {
  const label = anime?.title || title || `Аниме #${id}`;
  return <ProfileLink href={animeRoute(id)} className="profile-anime-tile"><span className="profile-poster"><Poster anime={anime} title={label} /></span><strong>{label}</strong><span>{[anime?.year, anime?.type?.name].filter(Boolean).join(" · ") || "Открыть аниме"}</span></ProfileLink>;
}
function SectionHeading({ section, count, owner, profile, busy, onChange }: { section: ProfileSection; count?: number; owner: boolean; profile: UserProfile; busy: boolean; onChange: (changes: ProfileChanges) => Promise<void> }) {
  const visible = profile.visibility?.[section] ?? true;
  return <div className="profile-section-heading"><h2>{SECTION_LABELS[section]}{count !== undefined && <span>{count}</span>}</h2>{owner && <button type="button" className={`profile-visibility ${visible ? "" : "is-private"}`} aria-label={`${visible ? "Скрыть" : "Показать другим"}: ${SECTION_LABELS[section]}`} aria-pressed={!visible} disabled={busy} onClick={() => void onChange({ visibility: { [section]: !visible } }).catch(() => undefined)}><ProfileIcon name={visible ? "eye" : "hidden"} /><span>{visible ? "Видно всем" : "Только вы"}</span></button>}</div>;
}
function CollectionDialog({ folder, known, onClose }: { folder: NonNullable<UserProfile["sections"]["collections"]>[number]; known: Record<number, Anime>; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalAccessibility(true, onClose, dialog);
  return createPortal(<div className="profile-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="profile-dialog profile-collection-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-folder-title" tabIndex={-1} ref={dialog}><div className="profile-dialog-heading"><div><span className="profile-kicker">ЛИЧНАЯ ПОДБОРКА</span><h2 id="profile-folder-title">{folder.name}</h2></div><button type="button" className="profile-icon-button" aria-label="Закрыть подборку" onClick={onClose}><ProfileIcon name="close" /></button></div>{folder.animeIds.length ? <div className="profile-anime-grid">{folder.animeIds.map(id => <AnimeTile key={id} id={id} anime={known[id]} />)}</div> : <p className="profile-empty">В этой подборке пока нет аниме.</p>}</div></div>, document.body);
}

export function ProfilePage({ userId }: { userId?: string }) {
  const { user, refresh } = useAccount();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [publicPreview, setPublicPreview] = useState<UserProfile | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [known, setKnown] = useState<Record<number, Anime>>({});
  const [metadataError, setMetadataError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [favoritesLimit, setFavoritesLimit] = useState(8);
  const [ratingsLimit, setRatingsLimit] = useState(5);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState("");
  const page = useRef<HTMLDivElement>(null);
  const identity = useRef<HTMLDivElement>(null);
  const presenceMenu = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const endpoint = userId ? `/api/profiles/${encodeURIComponent(userId)}` : "/api/profiles/me";
  useEffect(() => {
    mounted.current = true;
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!notice || notice.startsWith("Ссылка на профиль:")) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void requestJson<UserProfile>(endpoint, { cache: "no-store", signal: controller.signal })
      .then(setProfile).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Не удалось загрузить профиль"); });
    return () => controller.abort();
  }, [endpoint, reloadVersion]);
  const owner = Boolean(profile?.owner && !preview);
  const displayed = preview ? publicPreview : profile;
  const avatarMedia = useProfileMedia(displayed?.avatar ?? "");
  const bannerMedia = useProfileMedia(displayed?.banner ?? "");
  const ids = useMemo(() => [...new Set([
    ...(displayed?.sections.favorites?.slice(0, favoritesLimit) ?? []),
    ...(displayed?.sections.collections?.flatMap(folder => folder.id === selectedFolder ? folder.animeIds : folder.animeIds.slice(0, 3)) ?? []),
    ...(displayed?.sections.ratings?.slice(0, ratingsLimit).map(rating => rating.animeId) ?? []),
  ])], [displayed, favoritesLimit, ratingsLimit, selectedFolder]);
  useEffect(() => {
    let active = true;
    setMetadataError(false);
    void fetchAnimeDetails(ids).then(anime => { if (active) setKnown(Object.fromEntries(anime.map(item => [item.anime_id, item]))); })
      .catch(() => { if (active) setMetadataError(true); });
    return () => { active = false; };
  }, [ids, reloadVersion]);
  useEffect(() => {
    if (!profile) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!page.current || !identity.current) return;
      const headerBottom = page.current.querySelector(".profile-site-header")?.getBoundingClientRect().bottom ?? 76;
      const progress = Math.max(0, Math.min(1, (headerBottom - identity.current.getBoundingClientRect().top) / 110));
      page.current.style.setProperty("--profile-collapse", progress.toFixed(3));
      page.current.dataset.compact = String(progress > .75);
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("resize", scroll);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); };
  }, [profile]);
  useEffect(() => {
    if (!presenceOpen) return;
    const outside = (event: PointerEvent) => { if (!presenceMenu.current?.contains(event.target as Node)) setPresenceOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPresenceOpen(false); presenceMenu.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [presenceOpen]);
  const change = useCallback(async (changes: ProfileChanges) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes), errorMessage: "Не удалось сохранить. Проверьте поля и формат изображений." });
      const result = await requestJson<UserProfile>("/api/profiles/me", { cache: "no-store" });
      if (!mounted.current) return;
      setProfile(result); setNotice("Изменения сохранены");
      await refresh();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Не удалось сохранить");
      throw failure;
    } finally { if (mounted.current) setBusy(false); }
  }, [refresh]);
  async function togglePreview() {
    if (preview) { setPreview(false); return; }
    if (!profile) return;
    setBusy(true); setError("");
    try { setPublicPreview(await requestJson<UserProfile>(`/api/profiles/${encodeURIComponent(profile.id)}`, { cache: "no-store" })); setPreview(true); setPresenceOpen(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось открыть предпросмотр"); }
    finally { setBusy(false); }
  }
  async function copyLink() {
    if (!profile) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/users/${encodeURIComponent(profile.id)}`); setNotice("Ссылка на профиль скопирована"); }
    catch { setNotice(`Ссылка на профиль: ${window.location.origin}/users/${encodeURIComponent(profile.id)}`); }
  }
  const folder = displayed?.sections.collections?.find(item => item.id === selectedFolder);
  const presenceLabel = PRESENCES.find(item => item.value === displayed?.presence)?.label;
  return <div className="user-profile-page" ref={page}>
    <header className="profile-site-header">
      <div className="profile-site-header-inner">
        <ProfileLink href="/" className="profile-brand"><img src="/animesoul-icon.png" alt="" /><span>Anime<span>Soul</span></span></ProfileLink>
        <nav aria-label="Навигация сайта"><ProfileLink href="/catalog">Каталог</ProfileLink><ProfileLink href="/library">Библиотека</ProfileLink></nav>
        <div className="profile-mini" aria-hidden="true">{displayed && <><Avatar profile={displayed} source={avatarMedia.url} /><strong>{displayed.username}</strong><Badges profile={displayed} /></>}</div>
        <ProfileLink href={user ? "/account/settings" : "/account"} className="profile-header-action" label={user ? "Настройки аккаунта" : "Войти"}>
          {user ? <><ProfileIcon name="settings" /><span>Аккаунт</span></> : "Войти"}
        </ProfileLink>
      </div>
    </header>
    <main className="profile-main">
      <div className="profile-hero">
        {displayed && <div className="profile-cover" data-has-image={Boolean(bannerMedia.url && bannerError !== bannerMedia.url)}>
          {bannerMedia.url && bannerError !== bannerMedia.url ? <img src={bannerMedia.url} alt="Шапка профиля" referrerPolicy="no-referrer" onError={() => setBannerError(bannerMedia.url)} /> : <div className="profile-cover-art" aria-hidden="true"><span className="profile-moon" /><span className="profile-mountain mountain-far" /><span className="profile-mountain mountain-near" /><span className="profile-cover-grain" /></div>}
          <div className="profile-cover-shade" />
        </div>}
        <div className="profile-breadcrumb"><ProfileLink href="/">Главная</ProfileLink><span>/</span><span>{userId ? "Профиль пользователя" : "Мой профиль"}</span></div>
        {displayed && <>
          {preview && <div className="profile-preview-notice"><ProfileIcon name="eye" /><span>Так ваш профиль видят другие пользователи</span><button type="button" onClick={() => setPreview(false)}>Вернуться к профилю</button></div>}
          <div className="profile-cover-space">{owner && <button type="button" className="profile-cover-edit" aria-label="Изменить шапку" disabled={busy} onClick={() => setEditing(true)}><ProfileIcon name="image" /><span>Изменить шапку</span></button>}</div>
        </>}
      </div>
      {!displayed ? <div className="profile-loading" role="status">{error ? <><p className="profile-error" role="alert">{error}</p><button className="profile-secondary" onClick={() => setReloadVersion(value => value + 1)}>Повторить</button></> : <><div className="profile-loading-cover" /><p>Загружаем профиль…</p></>}</div> : <>
        <div className="profile-identity" ref={identity}>
          <Avatar profile={displayed} source={avatarMedia.url} className="profile-avatar-large" />
          <div className="profile-identity-text"><div className="profile-name-line"><h1>{displayed.username}</h1><Badges profile={displayed} /></div><div className="profile-identity-meta"><div className="profile-presence-picker" ref={presenceMenu}>
            {owner ? <><button type="button" className="profile-presence-trigger" aria-expanded={presenceOpen} aria-controls="profile-presence-options" disabled={busy} onClick={() => setPresenceOpen(!presenceOpen)}><i className={`profile-presence-dot is-${displayed.presence}`} />{presenceLabel}<span className="profile-chevron" aria-hidden="true">⌄</span></button>{presenceOpen && <div id="profile-presence-options" className="profile-presence-menu" role="group" aria-label="Выбрать статус">{PRESENCES.map(item => <button type="button" key={item.value} aria-pressed={displayed.presence === item.value} onClick={() => { setPresenceOpen(false); void change({ presence: item.value as Presence }).catch(() => undefined); }}><i className={`profile-presence-dot is-${item.value}`} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{displayed.presence === item.value && <ProfileIcon name="check" />}</button>)}</div>}</> : <span className="profile-presence-label"><i className={`profile-presence-dot is-${displayed.presence}`} />{presenceLabel}</span>}
          </div><span className="profile-meta-separator">·</span><span className="profile-user-id">ID <span>{displayed.id}</span></span></div></div>
          <div className="profile-identity-actions">{owner && <button type="button" className="profile-secondary" disabled={busy} onClick={() => setEditing(true)}><ProfileIcon name="edit" /><span>Редактировать</span></button>}<button type="button" className="profile-icon-button" aria-label="Скопировать ссылку на профиль" onClick={() => void copyLink()}><ProfileIcon name="link" /></button></div>
        </div>
        {displayed.about !== null && <section className="profile-about" aria-label="Обо мне"><div className="profile-about-text">{displayed.about ? <p>{displayed.about}</p> : owner ? <button type="button" className="profile-text" onClick={() => setEditing(true)}>Добавьте пару слов о себе <ProfileIcon name="edit" /></button> : null}</div>{owner && <SectionHeading section="about" owner={owner} profile={displayed} busy={busy} onChange={change} />}</section>}
        <div className="profile-subnav"><nav aria-label="Разделы профиля">{(["favorites", "collections", "ratings", "statistics"] as const).filter(key => displayed.sections[key] !== undefined).map(key => <a key={key} href={`#profile-${key}`}>{SECTION_LABELS[key]}</a>)}</nav>{profile?.owner && <button type="button" className="profile-preview-toggle" aria-pressed={preview} disabled={busy} onClick={() => void togglePreview()}><ProfileIcon name="eye" /><span>{preview ? "Мой профиль" : "Вид для других"}</span></button>}</div>
        <div className="profile-feedback" aria-live="polite">{error && <p className="profile-error" role="alert">{error}</p>}{notice && <p className="profile-notice" role="status">{notice}</p>}</div>
        {metadataError && <p className="profile-hint">Каталог временно недоступен. Данные профиля сохранены; <button type="button" className="profile-text" onClick={() => setReloadVersion(value => value + 1)}>загрузить обложки ещё раз</button>.</p>}
        {displayed.sections.favorites && <section className="profile-section" id="profile-favorites"><SectionHeading section="favorites" count={displayed.sections.favorites.length} owner={owner} profile={displayed} busy={busy} onChange={change} />{displayed.sections.favorites.length ? <><div className="profile-anime-grid">{displayed.sections.favorites.slice(0, favoritesLimit).map(id => <AnimeTile key={id} id={id} anime={known[id]} />)}</div>{displayed.sections.favorites.length > favoritesLimit && <button type="button" className="profile-more" onClick={() => setFavoritesLimit(value => value + 8)}>Показать ещё <ProfileIcon name="arrow" /></button>}</> : <div className="profile-empty"><p>{owner ? "Истории, к которым хочется возвращаться." : "Любимое аниме пока не добавлено."}</p>{owner && <ProfileLink href="/catalog">Найти любимое аниме <ProfileIcon name="arrow" /></ProfileLink>}</div>}</section>}
        {displayed.sections.collections && <section className="profile-section" id="profile-collections"><SectionHeading section="collections" count={displayed.sections.collections.length} owner={owner} profile={displayed} busy={busy} onChange={change} />{displayed.sections.collections.length ? <div className="profile-collections">{displayed.sections.collections.map(collection => <button type="button" key={collection.id} className="profile-collection" onClick={() => setSelectedFolder(collection.id)}><span className="profile-collection-art">{collection.animeIds.length ? collection.animeIds.slice(0, 3).map(id => <span key={id}><Poster anime={known[id]} title={known[id]?.title || `Аниме #${id}`} /></span>) : <ProfileIcon name="folder" />}</span><span className="profile-collection-info"><strong>{collection.name}</strong><span>{collection.animeIds.length} аниме</span></span><ProfileIcon name="arrow" /></button>)}</div> : <div className="profile-empty"><p>{owner ? "Соберите аниме по настроению, жанру или собственной идее." : "Подборок пока нет."}</p>{owner && <ProfileLink href="/library">Создать подборку <ProfileIcon name="arrow" /></ProfileLink>}</div>}{owner && !!displayed.sections.collections.length && <ProfileLink href="/library" className="profile-more">Управлять подборками <ProfileIcon name="arrow" /></ProfileLink>}</section>}
        <div className="profile-bottom-grid">
          {displayed.sections.ratings && <section className="profile-section" id="profile-ratings"><SectionHeading section="ratings" count={displayed.sections.ratings.length} owner={owner} profile={displayed} busy={busy} onChange={change} />{displayed.sections.ratings.length ? <><div className="profile-rating-list">{displayed.sections.ratings.slice(0, ratingsLimit).map((rating, index) => <ProfileLink key={rating.animeId} href={animeRoute(rating.animeId)} className="profile-rating-row"><span className="profile-rating-position">{String(index + 1).padStart(2, "0")}</span><span className="profile-rating-poster"><Poster anime={known[rating.animeId]} title={known[rating.animeId]?.title || rating.title} /></span><span className="profile-rating-info"><strong>{known[rating.animeId]?.title || rating.title || `Аниме #${rating.animeId}`}</strong><span>{[known[rating.animeId]?.year, known[rating.animeId]?.type?.name].filter(Boolean).join(" · ") || "Личная оценка"}</span></span><span className="profile-rating-score"><ProfileIcon name="star" />{rating.score.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</span></ProfileLink>)}</div>{displayed.sections.ratings.length > ratingsLimit && <button type="button" className="profile-more" onClick={() => setRatingsLimit(value => value + 5)}>Показать ещё <ProfileIcon name="arrow" /></button>}</> : <div className="profile-empty"><p>{owner ? "Ваш взгляд на каждую историю." : "Оценок пока нет."}</p>{owner && <ProfileLink href="/ratings">Перейти к оценкам <ProfileIcon name="arrow" /></ProfileLink>}</div>}</section>}
          {displayed.sections.statistics && <section className="profile-section" id="profile-statistics"><SectionHeading section="statistics" owner={owner} profile={displayed} busy={busy} onChange={change} /><p className="profile-stat-intro">Каждая серия — часть вашей истории.</p><div className="profile-stats"><div><strong>{displayed.sections.statistics.titles.toLocaleString("ru-RU")}</strong><span>завершённых аниме</span></div><div><strong>{displayed.sections.statistics.episodes.toLocaleString("ru-RU")}</strong><span>просмотренных эпизодов</span></div><div><strong>{Math.floor(displayed.sections.statistics.watchSeconds / 3600).toLocaleString("ru-RU")}<small>ч</small>{Math.floor(displayed.sections.statistics.watchSeconds % 3600 / 60)}<small>м</small></strong><span>время за просмотром</span></div></div>{owner && <ProfileLink href="/statistics" className="profile-more">Вся статистика <ProfileIcon name="arrow" /></ProfileLink>}</section>}
        </div>
        {!Object.keys(displayed.sections).length && <p className="profile-private-empty">Пользователь оставил свои подборки, оценки и статистику личными.</p>}
        <footer className="profile-footer"><span>В AnimeSoul с {new Date(displayed.joinedAt * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</span><span>У каждой истории есть свой зритель.</span></footer>
      </>}
    </main>
    {editing && profile && createPortal(<ProfileEditor profile={profile} onClose={() => setEditing(false)} onSave={change} />, document.body)}
    {folder && <CollectionDialog folder={folder} known={known} onClose={() => setSelectedFolder(null)} />}
  </div>;
}
