"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "./platform/AdminShell";
import { accountSchema, type Account } from "@animesoul/contracts";
async function request(path: string, body?: unknown, csrf = "") {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-AnimeSoul-Request": "1",
      "X-CSRF-Token": csrf,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Слишком много попыток. Подождите 10 минут."
        : response.status === 503
          ? "Сервис временно недоступен."
          : "Проверьте почту, пароль, право доступа и новый код второго фактора.",
    );
  return (await response.json()) as unknown;
}
export function AdminAccess({ siteUrl }: { siteUrl: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void request("/api/admin/auth/me")
      .then((value) => setAccount(accountSchema.parse(value)))
      .catch(() => {});
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      await request("/api/admin/auth/login", {
        email: data.get("email"),
        password: data.get("password"),
        code: data.get("code"),
        remember: data.get("remember") === "on",
      });
      form.reset();
      setAccount(accountSchema.parse(await request("/api/admin/auth/me")));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка входа.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!account) return;
    setBusy(true);
    setNotice("");
    try {
      await request("/api/admin/auth/logout", {}, account.csrfToken);
      setAccount(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка выхода.");
    } finally {
      setBusy(false);
    }
  }
  if (account)
    return (
      <AdminShell account={account} siteUrl={siteUrl} logout={() => void logout()} busy={busy} />
    );
  return (
    <div className="login-page">
      <main className="login">
        <h1 className="login-heading">Административный доступ закрыт</h1>
        <p className="login-intro">
          Вход доступен владельцу, администраторам и аккаунтам, которым владелец выдал право
          управления резервом. Требуется включённый второй фактор.
        </p>
        <p className="notice">
          Код второго фактора — это 6 цифр из приложения-аутентификатора, а не письмо и не пароль.
          Если MFA ещё не настроен, сначала войдите на сайте и откройте раздел «Аккаунт →
          Безопасность», подтвердите пароль, добавьте показанный секрет в Aegis, Google
          Authenticator или другое TOTP-приложение и введите новый код. После этого вернитесь сюда.
          Если роль владельца ещё не назначена, её можно выдать локальной командой{" "}
          <code>
            pnpm account:operator owner &lt;почта или имя&gt; &quot;Причина назначения&quot;
          </code>
          .
        </p>
        <p>
          <a href={`${siteUrl}/account#security-settings`} target="_blank" rel="noreferrer">
            Открыть настройки MFA на сайте →
          </a>
        </p>
        <form onSubmit={login}>
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
          <label>
            Почта
            <input name="email" type="email" autoComplete="username" required maxLength={254} />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={6}
              maxLength={128}
              required
            />
          </label>
          <label>
            Код второго фактора или резервный код
            <input name="code" autoComplete="one-time-code" minLength={6} maxLength={64} required />
          </label>
          <label className="login-remember">
            <input name="remember" type="checkbox" disabled={busy} />
            <span>Не выходить 30 дней</span>
          </label>
          <button disabled={busy}>{busy ? "Проверяем…" : "Войти"}</button>
        </form>
      </main>
    </div>
  );
}
