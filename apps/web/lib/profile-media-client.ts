"use client";
import {
  profileMediaLimits,
  profileMediaResultSchema,
  profileMediaTypes,
  type ProfileMediaKind,
} from "@animesoul/contracts";

export function profileMediaFileError(file: File, kind: ProfileMediaKind) {
  if (!file.size) return "Выберите непустой файл.";
  if (file.size > profileMediaLimits[kind])
    return `Максимальный размер — ${profileMediaLimits[kind] / 1024 / 1024} МБ.`;
  if (
    !/\.(?:jpe?g|png|webp|gif)$/i.test(file.name) ||
    (file.type && !profileMediaTypes.some((type) => type === file.type))
  )
    return "Выберите JPEG, PNG, WebP или GIF.";
  return null;
}
export async function uploadProfileMedia(file: File, kind: ProfileMediaKind, csrf: string) {
  const invalid = profileMediaFileError(file, kind);
  if (invalid) throw new Error(invalid);
  const response = await fetch("/api/account/profile/media/" + kind, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/octet-stream",
      "X-AnimeSoul-Request": "1",
      "X-CSRF-Token": csrf,
    },
    body: file,
  });
  if (!response.ok) {
    const fallback: Record<number, string> = {
      401: "Сессия завершилась. Войдите в аккаунт снова.",
      403: "Запрос отклонён. Обновите страницу и повторите.",
      413: `Максимальный размер — ${profileMediaLimits[kind] / 1024 / 1024} МБ.`,
      429: "Слишком много загрузок. Подождите минуту и повторите.",
    };
    const result = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(
      fallback[response.status] ??
        (typeof result?.message === "string"
          ? result.message
          : "Не удалось загрузить изображение. Повторите позже."),
    );
  }
  const media = profileMediaResultSchema.parse(await response.json());
  window.dispatchEvent(new Event("animesoul:account-changed"));
  return media;
}
