"use client";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { identityOptionsSchema, type IdentityOptions, type Account } from "@animesoul/contracts";
import { accountRequest } from "../lib/account-client";
import { useSettingsAnchor } from "../lib/use-settings-anchor";

export function AccountIdentity({
  account,
  refresh,
  compact = false,
  onRecoveryChange,
  allowRecovery = true,
}: {
  account: Account | null;
  refresh: () => Promise<void>;
  compact?: boolean;
  onRecoveryChange?: (active: boolean) => void;
  allowRecovery?: boolean;
}) {
  const [options, setOptions] = useState<IdentityOptions | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [action, setAction] = useState<"verify" | "change" | "reset" | null>(null);
  const [token, setToken] = useState("");
  useEffect(() => {
    onRecoveryChange?.(recovery || action !== null);
  }, [recovery, action, onRecoveryChange]);
  useSettingsAnchor(options && account ? "identity-settings" : "");
  useEffect(() => {
    void accountRequest("/api/auth/options")
      .then((value) => setOptions(identityOptionsSchema.parse(value)))
      .catch(() => {});
    const url = new URL(window.location.href),
      hash = new URLSearchParams(url.hash.slice(1)),
      intent = hash.get("action");
    if (["verify", "change", "reset"].includes(intent ?? "")) {
      setAction(intent as "verify" | "change" | "reset");
      setToken(hash.get("token") ?? "");
      window.history.replaceState(null, "", url.pathname);
    }
    const status = url.searchParams.get("oauth");
    if (status) {
      setNotice(
        status === "done"
          ? "Вход через Google выполнен."
          : status === "error-409"
            ? "Аккаунт с этой почтой уже существует. Войдите в него и привяжите Google в настройках."
            : status === "cancelled"
              ? "Вход через Google отменён."
              : "Не удалось войти через Google. Попробуйте снова.",
      );
      window.history.replaceState(null, "", url.pathname);
    }
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  }
  async function google(password?: string) {
    await run(async () => {
      const value = await accountRequest(
        "/api/auth/google/start",
        { intent: account ? "link" : "login", ...(password ? { password } : {}) },
        account?.csrfToken,
      );
      const url = z.object({ url: z.url() }).parse(value).url;
      if (new URL(url).origin !== "https://accounts.google.com")
        throw new Error("Не удалось начать вход.");
      window.location.assign(url);
    });
  }
  function deliveryNotice() {
    return options?.localMail
      ? "Тестовое письмо сохранено локально и не отправлено по почте."
      : "Письмо отправлено. Откройте ссылку в нём.";
  }
  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      await accountRequest("/api/auth/password/request-reset", { email: data.get("email") });
      setNotice(
        "Если почта подтверждена и аккаунт существует, инструкция отправлена." +
          (options?.localMail ? " В тестовом режиме письмо сохранено локально." : ""),
      );
    });
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      const value = await accountRequest(
        action === "reset" ? "/api/auth/password/reset" : "/api/auth/email/confirm",
        {
          token: data.get("token"),
          ...(action === "reset" ? { password: data.get("password") } : {}),
        },
      );
      const result = z.object({ signInRequired: z.boolean() }).parse(value);
      setAction(null);
      setToken("");
      await refresh();
      setNotice(
        result.signInRequired ? "Изменения сохранены. Войдите снова." : "Почта подтверждена.",
      );
    });
  }
  if (!options && !action && !notice) return null;
  return (
    <section
      id="identity-settings"
      className={
        compact
          ? "account-auth-identity account-settings-anchor"
          : "account-card account-settings-anchor"
      }
    >
      {!compact && (
        <h2 className="account-settings-anchor">
          {account ? "Почта и Google" : "Вход и восстановление"}
        </h2>
      )}
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {action ? (
        <form className="account-form" onSubmit={confirm}>
          <h3>{action === "reset" ? "Новый пароль" : "Подтвердить почту"}</h3>
          <label>
            Код из письма
            <input
              name="token"
              defaultValue={token}
              minLength={43}
              maxLength={43}
              required
              autoComplete="off"
            />
          </label>
          {action === "reset" && (
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                minLength={6}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Подождите…" : "Подтвердить"}
          </button>
        </form>
      ) : (
        <>
          {account && (
            <p className="account-identity-email">
              <strong>{account.email}</strong>
              <span className={"account-status " + (account.emailVerified ? "is-on" : "is-warn")}>
                {account.emailVerified ? "Почта подтверждена" : "Почта не подтверждена"}
              </span>
            </p>
          )}
          {account && options?.email && !account.emailVerified && (
            <button
              className="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await accountRequest("/api/auth/email/verify", {}, account.csrfToken);
                  setNotice(deliveryNotice());
                })
              }
            >
              Подтвердить почту
            </button>
          )}
          {options?.google && !account && !recovery && (
            <button className="outline" disabled={busy} onClick={() => void google()}>
              Войти через Google
            </button>
          )}
          {account?.googleLinked && (
            <p className="account-status is-on">Google привязан — им можно входить</p>
          )}
          {options?.google && account?.hasPassword && !account.googleLinked && (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                void google(String(new FormData(event.currentTarget).get("password") ?? ""));
              }}
            >
              <label>
                Текущий пароль
                <input
                  name="password"
                  type="password"
                  minLength={6}
                  maxLength={128}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button className="outline" disabled={busy}>
                Привязать Google
              </button>
            </form>
          )}
          {options?.email && account?.hasPassword && (
            <form
              className="account-form identity-email-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void run(async () => {
                  await accountRequest(
                    "/api/auth/email/change",
                    { email: data.get("email"), password: data.get("password") },
                    account.csrfToken,
                  );
                  setNotice(deliveryNotice() + " Почта изменится после подтверждения.");
                });
              }}
            >
              <h3>Изменить почту</h3>
              <label>
                Новая почта
                <input name="email" type="email" maxLength={254} required autoComplete="email" />
              </label>
              <label>
                Текущий пароль
                <input
                  name="password"
                  type="password"
                  minLength={6}
                  maxLength={128}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button className="primary" disabled={busy}>
                Отправить подтверждение
              </button>
            </form>
          )}
          {options?.email && allowRecovery && (
            <>
              <button
                className="text-link identity-reset-button"
                disabled={busy}
                aria-expanded={recovery}
                aria-controls="account-recovery-form"
                onClick={() => setRecovery((value) => !value)}
              >
                {recovery
                  ? "Вернуться ко входу"
                  : account?.hasPassword === false
                    ? "Создать пароль через почту"
                    : "Забыли пароль?"}
              </button>
              {recovery && (
                <form id="account-recovery-form" className="account-form" onSubmit={reset}>
                  <p className="account-help">
                    Укажите подтверждённую почту аккаунта. Мы отправим ссылку для восстановления
                    пароля.
                  </p>
                  <label>
                    Подтверждённая почта
                    <input
                      name="email"
                      type="email"
                      defaultValue={account?.email ?? ""}
                      maxLength={254}
                      required
                      autoComplete="email"
                    />
                  </label>
                  <button className="outline" disabled={busy}>
                    {busy ? "Отправляем…" : "Отправить инструкцию"}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {compact && action && (
        <button
          type="button"
          className="text-link identity-reset-button"
          disabled={busy}
          onClick={() => {
            setAction(null);
            setToken("");
          }}
        >
          Вернуться ко входу
        </button>
      )}
    </section>
  );
}
