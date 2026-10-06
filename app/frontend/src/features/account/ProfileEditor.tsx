import { useEffect, useRef, useState, type FormEvent } from "react";
import { useModalAccessibility } from "../../lib/modalAccessibility";
import { requestJson } from "../../lib/http";
import { GiphyPicker } from "./GiphyPicker";
import { ProfileIcon } from "./ProfileIcon";
import { type ProfileMediaOptions, type ProfilePreset } from "./profileMedia";
import { useProfileMedia } from "./useProfileMedia";
import { SECTION_LABELS, type ProfileChanges, type ProfileSection, type UserProfile } from "./profile";

function MediaField({ label, value, onChange, banner = false, options, onSearch }: { label: string; value: string; onChange: (value: string) => void; banner?: boolean; options: ProfileMediaOptions | null; onSearch: () => void }) {
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"presets" | "custom">("presets");
  const media = useProfileMedia(value);
  const allowed = Boolean(options?.canCustomize);
  const presets = options?.presets.filter(preset => preset.kind === (banner ? "banner" : "avatar")) ?? [];
  async function upload(file?: File) {
    if (!file || !allowed) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 1024 * 1024) {
      setError("Выберите PNG, JPEG, GIF или WebP размером до 1 МБ."); return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      onChange(data);
    } catch { setError("Не удалось прочитать изображение."); }
  }
  return <div className="profile-media-field">
    <span className="profile-field-label">{label}</span>
    <div className={`profile-media-preview ${banner ? "is-banner" : ""}`}>{media.url ? <img src={media.url} alt={`Предпросмотр: ${label.toLowerCase()}`} referrerPolicy="no-referrer" onError={() => setError("Изображение недоступно. Выберите другой вариант.")} /> : <ProfileIcon name="image" />}</div>
    <div className="profile-media-tabs"><button type="button" aria-pressed={tab === "presets"} onClick={() => setTab("presets")}>Готовые</button><button type="button" aria-pressed={tab === "custom"} onClick={() => setTab("custom")}>Свои / поиск <span>Premium</span></button></div>
    {tab === "presets" ? <div className={`profile-preset-grid ${banner ? "is-banner" : ""}`}>{presets.map((preset: ProfilePreset) => <button type="button" key={preset.id} className="profile-preset" aria-label={`${label}: ${preset.name}${preset.animated ? ", анимация" : ""}`} aria-pressed={value === preset.url} onClick={() => { onChange(preset.url); setError(""); }}><img src={preset.url} alt="" /><span>{preset.name}</span>{preset.animated && <small>Анимация</small>}</button>)}</div> : allowed ? <>
      <div className="profile-media-actions"><label className="profile-upload">Загрузить файл<input type="file" aria-label={`${label}: загрузить файл`} accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label><button type="button" className="profile-text" onClick={onSearch}>Найти GIF <ProfileIcon name="arrow" /></button></div>
      <input type="url" aria-label={`${label}: прямая ссылка`} placeholder={value.startsWith("data:") ? "Файл загружен · можно заменить ссылкой" : value.startsWith("giphy:") ? "GIF выбран · можно заменить ссылкой" : "Или прямая https:// ссылка"} value={value.startsWith("https:") ? value : ""} maxLength={500} onChange={event => { onChange(event.target.value); setError(""); }} />
    </> : <p className="profile-media-lock">Свои изображения и поиск GIF доступны с премиумом. Все готовые варианты, включая анимации, доступны вам.</p>}
    <button type="button" className="profile-text profile-media-remove" onClick={() => { onChange(""); setError(""); }}>Убрать</button>
    {(error || media.error) && <p className="profile-error" role="alert">{error || media.error}</p>}
  </div>;
}

export function ProfileEditor({ profile, onClose, onSave }: { profile: UserProfile; onClose: () => void; onSave: (changes: ProfileChanges) => Promise<void> }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState(profile.username);
  const [about, setAbout] = useState(profile.about ?? "");
  const [avatar, setAvatar] = useState(profile.avatar);
  const [banner, setBanner] = useState(profile.banner);
  const [visibility, setVisibility] = useState(profile.visibility!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mediaOptions, setMediaOptions] = useState<ProfileMediaOptions | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [mediaVersion, setMediaVersion] = useState(0);
  const [gifTarget, setGifTarget] = useState<"avatar" | "banner" | null>(null);
  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
    if (gifTarget) dialog.current?.querySelector<HTMLInputElement>('input[aria-label="Поиск GIF"]')?.focus();
  }, [gifTarget]);
  useEffect(() => {
    let active = true;
    setMediaError("");
    void requestJson<ProfileMediaOptions>("/api/profiles/media-options", { cache: "no-store" }).then(options => { if (active) setMediaOptions(options); })
      .catch(() => { if (active) setMediaError("Не удалось загрузить библиотеку изображений."); });
    return () => { active = false; };
  }, [mediaVersion]);
  useModalAccessibility(true, () => { if (!busy) onClose(); }, dialog);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      // Submit only edited fields so another device's unrelated settings survive.
      const changes: ProfileChanges = {};
      if (username !== profile.username) changes.username = username;
      if (about !== (profile.about ?? "")) changes.about = about;
      if (avatar !== profile.avatar) changes.avatar = avatar;
      if (banner !== profile.banner) changes.banner = banner;
      const editedVisibility = Object.fromEntries((Object.keys(visibility) as ProfileSection[])
        .filter(key => visibility[key] !== profile.visibility?.[key]).map(key => [key, visibility[key]]));
      if (Object.keys(editedVisibility).length) changes.visibility = editedVisibility;
      if (Object.keys(changes).length) await onSave(changes);
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить профиль"); }
    finally { setBusy(false); }
  }
  return <div className="profile-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="profile-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" tabIndex={-1}>
      <div className="profile-dialog-heading"><div><span className="profile-kicker">ВАШЕ ПРОСТРАНСТВО</span><h2 id="profile-edit-title">Редактировать профиль</h2></div><button type="button" className="profile-icon-button" disabled={busy} onClick={onClose} aria-label="Закрыть"><ProfileIcon name="close" /></button></div>
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy} className="profile-editor-fields" data-gif-open={Boolean(gifTarget && mediaOptions?.canCustomize)}>
          <label className="profile-field">Ник<input required value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" /><small>3–32 латинских символа, цифры или подчёркивания.</small></label>
          <label className="profile-field">Обо мне<textarea value={about} onChange={event => setAbout(event.target.value)} maxLength={600} rows={3} placeholder="Любимые истории, настроение, пара слов о себе…" /><small>{about.length} / 600</small></label>
          <div className="profile-media-grid"><MediaField label="Аватарка" value={avatar} onChange={setAvatar} options={mediaOptions} onSearch={() => setGifTarget("avatar")} /><MediaField label="Шапка" value={banner} onChange={setBanner} options={mediaOptions} onSearch={() => setGifTarget("banner")} banner /></div>
          {mediaError ? <p className="profile-error" role="alert">{mediaError} <button type="button" className="profile-text" onClick={() => setMediaVersion(value => value + 1)}>Повторить</button></p> : !mediaOptions ? <p className="profile-hint" role="status">Загружаем готовые варианты…</p> : <p className="profile-hint">Готовые аватарки и шапки, включая анимации, доступны всем.{mediaOptions.canCustomize && " С премиумом можно загружать свои PNG, JPEG, GIF и WebP до 1 МБ или выбирать GIF через поиск."}</p>}
          {gifTarget && mediaOptions?.canCustomize && <GiphyPicker target={gifTarget} onClose={() => setGifTarget(null)} onSelect={value => { (gifTarget === "avatar" ? setAvatar : setBanner)(value); setGifTarget(null); }} />}
          <div className="profile-privacy-editor"><h3>Что видно другим</h3><p className="profile-hint">Скрытые разделы видите только вы. Подборки, избранное, рейтинг и статистика изначально закрыты.</p>{(Object.keys(SECTION_LABELS) as ProfileSection[]).map(key => <label key={key}><span>{SECTION_LABELS[key]}</span><input type="checkbox" checked={visibility[key]} onChange={event => setVisibility({ ...visibility, [key]: event.target.checked })} /><span className="profile-switch" aria-hidden="true" /></label>)}</div>
        </fieldset>
        {error && <p className="profile-error" role="alert">{error}</p>}
        {!gifTarget && <div className="profile-dialog-footer"><button type="button" className="profile-secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="profile-primary" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить изменения"}</button></div>}
      </form>
    </div>
  </div>;
}
