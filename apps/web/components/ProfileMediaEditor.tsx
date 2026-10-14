"use client";
import { useCallback, useEffect, useId, useState } from "react";
import {
  avatarPresets,
  bannerPresets,
  profileMediaAccept,
  profileMediaLimits,
  profileMediaResultSchema,
  type Account,
  type ProfileMedia,
  type ProfileMediaKind,
} from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { profileMediaFileError, uploadProfileMedia } from "../lib/profile-media-client";
import { ProfileImage } from "./ProfileImage";
import { ProfileGiphyPicker } from "./ProfileGiphyPicker";
import { ProfileMediaPreview } from "./ProfileMediaPreview";

function MediaField({
  kind,
  value,
  username,
  busy,
  save,
  chooseGiphy,
  onPreview,
}: {
  kind: ProfileMediaKind;
  value: string | null;
  username: string;
  busy: boolean;
  save: (kind: ProfileMediaKind, value: string | null | File) => Promise<boolean>;
  chooseGiphy: (kind: ProfileMediaKind) => void;
  onPreview: (kind: ProfileMediaKind, value: string | null) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const label = kind === "avatar" ? "Аватар" : "Обложка";
  const presets = kind === "avatar" ? avatarPresets : bannerPresets;
  useEffect(() => {
    if (!file) {
      setPreview(null);
      onPreview(kind, null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    onPreview(kind, url);
    return () => {
      URL.revokeObjectURL(url);
      onPreview(kind, null);
    };
  }, [file, kind, onPreview]);
  const src = preview ?? value;
  return (
    <fieldset className="profile-media-field" disabled={busy}>
      <legend>{label}</legend>
      <div className={`profile-media-sample is-${kind}`}>
        {src && src !== failedImage ? (
          <ProfileImage
            value={src}
            cover={kind === "banner"}
            fallback={
              <span>
                {kind === "avatar"
                  ? Array.from(username).slice(0, 2).join("").toUpperCase()
                  : "Обложка по умолчанию"}
              </span>
            }
            alt={`${file ? "Предпросмотр" : "Текущий"} — ${label.toLowerCase()}`}
            onError={() => {
              setFailedImage(src);
              if (file) setError("Браузер не смог открыть изображение. Выберите другой файл.");
            }}
          />
        ) : (
          <span>
            {kind === "avatar"
              ? Array.from(username).slice(0, 2).join("").toUpperCase()
              : "Обложка по умолчанию"}
          </span>
        )}
      </div>
      <label htmlFor={`${id}-preset`}>Готовое оформление</label>
      <select
        id={`${id}-preset`}
        value={presets.some((preset) => preset.path === value) ? value! : value ? "custom" : ""}
        onChange={(event) => {
          setFile(null);
          setError("");
          void save(kind, event.target.value || null);
        }}
      >
        <option value="">{kind === "avatar" ? "Инициалы" : "По умолчанию"}</option>
        {value && !presets.some((preset) => preset.path === value) && (
          <option value="custom" disabled>
            Своё изображение
          </option>
        )}
        {presets.map((preset) => (
          <option key={preset.path} value={preset.path}>
            {preset.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="outline"
        onClick={() => {
          setFile(null);
          setError("");
          chooseGiphy(kind);
        }}
      >
        Выбрать {kind === "avatar" ? "аватар" : "обложку"} из GIPHY
      </button>
      <label htmlFor={`${id}-file`}>Загрузить изображение</label>
      <input
        id={`${id}-file`}
        type="file"
        accept={profileMediaAccept}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          const invalid = profileMediaFileError(next, kind);
          setError(invalid ?? "");
          setFile(invalid ? null : next);
        }}
      />
      <p id={`${id}-help`} className="profile-media-help">
        JPEG, PNG, WebP или GIF · до {profileMediaLimits[kind] / 1024 / 1024} МБ.
        <br />
        {kind === "avatar"
          ? "Лучше квадратное изображение."
          : "Лучше широкое изображение: 3:1."}{" "}
        GIF сохраняет анимацию.
      </p>
      {file && (
        <div className="profile-media-file">
          <span>{file.name}</span>
          <button
            type="button"
            className="primary"
            disabled={busy || !!error}
            onClick={() => {
              void save(kind, file).then((saved) => {
                if (saved) setFile(null);
              });
            }}
          >
            {busy ? "Загружаем…" : `Сохранить ${label.toLowerCase()}`}
          </button>
          <button
            type="button"
            className="outline"
            onClick={() => {
              setFile(null);
              setError("");
            }}
          >
            Отменить выбор
          </button>
        </div>
      )}
      {value && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setFile(null);
            setError("");
            void save(kind, null);
          }}
        >
          {kind === "avatar" ? "Убрать аватар" : "Убрать обложку"}
        </button>
      )}
      {error && (
        <p className="profile-media-notice" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
export function ProfileMediaEditor({
  account,
  value,
  onChange,
  presence = "offline",
}: {
  account: Account;
  value: ProfileMedia;
  onChange: (value: ProfileMedia) => void;
  presence?: "online" | "offline" | "dnd" | "invisible";
}) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [giphyKind, setGiphyKind] = useState<ProfileMediaKind | null>(null);
  const [draft, setDraft] = useState<Partial<ProfileMedia>>({});
  const preview = useCallback((kind: ProfileMediaKind, next: string | null) => {
    setDraft((current) => {
      if (next === null) {
        if (current[kind] === undefined) return current;
        const result = { ...current };
        delete result[kind];
        return result;
      }
      return current[kind] === next ? current : { ...current, [kind]: next };
    });
  }, []);
  function chooseGiphy(kind: ProfileMediaKind) {
    if (giphyKind && giphyKind !== kind) preview(giphyKind, null);
    setGiphyKind(kind);
  }
  async function save(kind: ProfileMediaKind, next: string | null | File) {
    setBusy(true);
    setUploading(next instanceof File);
    setNotice("");
    setError(false);
    try {
      const result =
        next instanceof File
          ? await uploadProfileMedia(next, kind, account.csrfToken)
          : profileMediaResultSchema.parse(
              await accountRequest(
                "/api/account/profile/media",
                { kind, value: next },
                account.csrfToken,
              ),
            );
      onChange(result);
      preview(kind, null);
      setNotice(
        kind === "avatar"
          ? next === null
            ? "Аватар сброшен."
            : "Аватар сохранён."
          : next === null
            ? "Обложка сброшена."
            : "Обложка сохранена.",
      );
      return true;
    } catch (e) {
      setError(true);
      setNotice(
        e instanceof Error ? e.message : "Не удалось сохранить изображение. Повторите загрузку.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-media-editor" aria-busy={busy}>
      <ProfileMediaPreview
        username={account.username}
        media={{ avatar: draft.avatar ?? value.avatar, banner: draft.banner ?? value.banner }}
        presence={presence}
        pending={!!(draft.avatar || draft.banner)}
      />
      <p className="profile-media-help">
        Выбранные изображения видны в миниатюре до сохранения. Аватар и обложка сохраняются
        отдельно.
      </p>
      <div className="profile-media-fields">
        <MediaField
          kind="avatar"
          value={value.avatar}
          username={account.username}
          busy={busy}
          save={save}
          chooseGiphy={chooseGiphy}
          onPreview={preview}
        />
        <MediaField
          kind="banner"
          value={value.banner}
          username={account.username}
          busy={busy}
          save={save}
          chooseGiphy={chooseGiphy}
          onPreview={preview}
        />
      </div>
      {giphyKind && (
        <ProfileGiphyPicker
          key={giphyKind}
          kind={giphyKind}
          busy={busy}
          save={save}
          preview={(value) => preview(giphyKind, value)}
          close={() => {
            preview(giphyKind, null);
            setGiphyKind(null);
          }}
        />
      )}
      <p className="profile-media-help">
        Максимум 4096 × 4096, до 300 кадров и 40 млн пикселей во всех кадрах.
      </p>
      {busy && (
        <p role="status" className="profile-media-notice">
          {uploading ? "Загружаем и проверяем изображение…" : "Сохраняем оформление…"}
        </p>
      )}
      {notice && (
        <p role={error ? "alert" : "status"} className="profile-media-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
