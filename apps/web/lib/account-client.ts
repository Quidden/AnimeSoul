"use client";
import {
  accountSchema,
  librarySchema,
  privateProfileSchema,
  loginFailureSchema,
  loginFailureMessages,
} from "@animesoul/contracts";

export class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function accountRequest(path: string, body?: unknown, csrf = "", notify = true) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-AnimeSoul-Request": "1",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 600;
    const messages: Record<number, string> = {
      400: "Проверьте заполнение полей. Код привязки мог истечь.",
      401: "Войдите в аккаунт или проверьте почту, пароль и код.",
      403: "Запрос отклонён. Обновите страницу и повторите.",
      404: "Запись не найдена.",
      409: "Почта или имя уже заняты, либо настройка уже изменена.",
      429: `Слишком много запросов. Повторите через ${wait} сек.`,
      503: "Сервис аккаунтов временно недоступен.",
    };
    let message = messages[response.status] ?? "Не удалось сохранить. Повторите позже.";
    if (path === "/api/auth/login") {
      if (response.status === 401) {
        const failure = loginFailureSchema.safeParse(await response.json().catch(() => null));
        message = failure.success
          ? loginFailureMessages[failure.data.code]
          : "Не удалось войти. Проверьте почту и пароль.";
      } else if (response.status === 400)
        message = "Проверьте почту и пароль. Пароль должен содержать от 6 до 128 символов.";
    }
    throw new AccountRequestError(message, response.status);
  }
  const result: unknown = await response.json();
  if (body !== undefined && notify) window.dispatchEvent(new Event("animesoul:account-changed"));
  return result;
}
export async function loadAccount() {
  return accountSchema.parse(await accountRequest("/api/auth/me"));
}
export async function loadLibrary() {
  return librarySchema.parse(await accountRequest("/api/account/library"));
}
export async function loadPrivateProfile() {
  return privateProfileSchema.parse(await accountRequest("/api/account/profile"));
}
