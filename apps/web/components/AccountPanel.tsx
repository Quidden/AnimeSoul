"use client";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { type Account } from "@animesoul/contracts";
import { useAccountSession } from "./useAccountSession";
import { AccountIdentity } from "./AccountIdentity";
import { AccountAppearance } from "./AccountAppearance";
import { AccountPlayerSettings } from "./AccountPlayerSettings";
import { AccountWorkspace } from "./AccountWorkspace";
import { AccountProfileSettings } from "./AccountProfileSettings";
import { Icon } from "./Icon";
import { accountRequest, loadAccount } from "../lib/account-client";
import { useSettingsAnchor } from "../lib/use-settings-anchor";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие.";
export function AccountPanel() {
  const { account, setAccount, ready } = useAccountSession();
  const [mode, setMode] = useState<"login" | "register" | "claim">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [identityActive, setIdentityActive] = useState(false);
  useSettingsAnchor(
    ready && !account
      ? "profile-settings media-settings privacy-settings security-settings identity-settings player-settings appearance-settings"
      : "",
    "account-sign-in",
  );
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("mode") === "register") setMode("register");
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await accountRequest("/api/auth/" + mode, {
        email: data.get("email"),
        password: data.get("password"),
        ...(mode === "register" ? { username: data.get("username") } : {}),
        ...(mode === "claim" ? { code: data.get("code") } : {}),
      });
      form.reset();
      setAccount(await loadAccount());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout(all = false) {
    setBusy(true);
    setError("");
    try {
      await accountRequest(
        all ? "/api/auth/logout-all" : "/api/auth/logout",
        {},
        account?.csrfToken,
      );
      setAccount(null);
      setMode("login");
      setShowPassword(false);
      setIdentityActive(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!ready || !account) {
    const modeIndex = { login: 0, register: 1, claim: 2 }[mode];
    const copy = {
      login: ["С возвращением", "Войдите, чтобы открыть свою библиотеку."],
      register: ["Создать аккаунт", "Ваша коллекция начинается здесь."],
      claim: ["Перенести профиль", "Верните библиотеку из прежней версии."],
    }[mode];
    return (
      <div className="account-auth-layout">
        <div className="account-welcome">
          <span className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span>
          <h1>Ваш аккаунт</h1>
          <p className="account-welcome-copy">
            Любимые истории, ваши оценки и просмотр. Всё в одном месте.
          </p>
          <ul className="account-benefits">
            <li>
              <span className="account-benefit-icon">
                <Icon name="folder" />
              </span>
              <div>
                <strong>Своя библиотека</strong>
                <span>Сохраняйте любимое и планируйте просмотр.</span>
              </div>
            </li>
            <li>
              <span className="account-benefit-icon">
                <Icon name="check" />
              </span>
              <div>
                <strong>Продолжайте с того же места</strong>
                <span>Прогресс и оценки доступны на всех устройствах.</span>
              </div>
            </li>
            <li>
              <span className="account-benefit-icon">
                <Icon name="user" />
              </span>
              <div>
                <strong>Профиль под вашим контролем</strong>
                <span>Вы решаете, кто видит вашу коллекцию.</span>
              </div>
            </li>
          </ul>
          <Link href="/catalog" className="account-catalog-link">
            Пока просто посмотреть каталог <span aria-hidden="true">→</span>
          </Link>
        </div>
        <section
          id="account-sign-in"
          className="account-auth-card account-settings-anchor"
          aria-labelledby="account-auth-title"
          aria-busy={!ready || busy}
        >
          {!ready ? (
            <div className="account-auth-loading" role="status">
              <span className="account-spinner" aria-hidden="true" />
              <p id="account-auth-title">Проверяем вход…</p>
            </div>
          ) : (
            <>
              <div
                className="account-tabs"
                role="group"
                aria-label="Способ входа"
                hidden={identityActive}
                style={{ "--auth-tab": modeIndex } as CSSProperties}
              >
                {(
                  [
                    ["login", "Вход"],
                    ["register", "Регистрация"],
                    ["claim", "Перенос"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    aria-label={value === "claim" ? "Перенос профиля" : label}
                    aria-controls="account-auth-form"
                    disabled={busy}
                    onClick={() => {
                      setMode(value);
                      setError("");
                      setShowPassword(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="account-auth-heading"
                key={`heading-${identityActive ? "identity" : mode}`}
              >
                <h2 id="account-auth-title">{identityActive ? "Доступ к аккаунту" : copy[0]}</h2>
                {!identityActive && <p>{copy[1]}</p>}
              </div>
              <form
                id="account-auth-form"
                key={`form-${mode}`}
                onSubmit={submit}
                className="account-form account-auth-form"
                hidden={identityActive}
                aria-describedby={error ? "account-auth-error" : undefined}
              >
                <fieldset disabled={busy} className="account-auth-fields">
                  {mode === "register" && (
                    <label>
                      Имя профиля
                      <input
                        name="username"
                        autoComplete="nickname"
                        minLength={2}
                        maxLength={40}
                        placeholder="Как вас называть?"
                        required
                      />
                    </label>
                  )}
                  {mode === "claim" && (
                    <label>
                      Код привязки
                      <input
                        name="code"
                        autoComplete="off"
                        minLength={32}
                        maxLength={128}
                        placeholder="Одноразовый код переноса"
                        required
                        aria-describedby="account-claim-help"
                      />
                      <span id="account-claim-help" className="account-field-help">
                        Код выдаёт владелец прежней локальной копии.
                      </span>
                    </label>
                  )}
                  <label>
                    Почта
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      placeholder="you@example.com"
                      required
                    />
                  </label>
                  <label>
                    Пароль
                    <span className="account-password-field">
                      <input
                        name="password"
                        aria-label="Пароль"
                        type={showPassword ? "text" : "password"}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        minLength={6}
                        maxLength={128}
                        placeholder={mode === "login" ? "Ваш пароль" : "Не менее 6 символов"}
                        aria-describedby={mode !== "login" ? "account-password-help" : undefined}
                        required
                      />
                      <button
                        type="button"
                        className="account-password-toggle"
                        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? "Скрыть" : "Показать"}
                      </button>
                    </span>
                  </label>
                  {mode !== "login" && (
                    <p id="account-password-help" className="account-field-help">
                      Не менее 6 символов. Ваш профиль будет приватным.
                    </p>
                  )}
                </fieldset>
                {error && (
                  <p
                    id="account-auth-error"
                    role="alert"
                    className="account-notice account-notice-error"
                  >
                    {error}
                  </p>
                )}
                <button className="primary account-submit" disabled={busy}>
                  {busy && <span className="account-spinner" aria-hidden="true" />}
                  {busy
                    ? "Подождите…"
                    : mode === "login"
                      ? "Войти"
                      : mode === "register"
                        ? "Создать аккаунт"
                        : "Привязать профиль"}
                  {!busy && (
                    <span className="account-submit-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                </button>
              </form>
              <AccountIdentity
                compact
                account={null}
                allowRecovery={mode === "login"}
                onRecoveryChange={setIdentityActive}
                refresh={async () => setAccount(await loadAccount().catch(() => null))}
              />
            </>
          )}
        </section>
      </div>
    );
  }
  return (
    <AccountWorkspace account={account}>
      {(section) => (
        <>
          <AccountProfileSettings account={account} onUpdate={setAccount} section={section} />
          <div hidden={section !== "player-settings"} className="account-section-view">
            <AccountPlayerSettings account={account} />
          </div>
          <div hidden={section !== "security-settings"} className="account-section-view">
            {account.hasPassword ? (
              <AccountSecurity
                account={account}
                onUpdate={setAccount}
                onPasswordChanged={() => setAccount(null)}
              />
            ) : (
              <section id="security-settings" className="account-card account-settings-anchor">
                <h2>Безопасность</h2>
                <p className="account-help">
                  Пароль ещё не установлен. Управлять способами входа можно в разделе «Почта и
                  Google».
                </p>
                <a href="#identity-settings" className="outline">
                  Способы входа
                </a>
              </section>
            )}
            <section className="account-card account-sessions">
              <h2>Управление сессиями</h2>
              <p className="account-help">
                Выйди из текущего аккаунта или заверши вход на всех устройствах.
              </p>
              {error && (
                <p role="alert" className="account-notice account-notice-error">
                  {error}
                </p>
              )}
              <div className="account-actions">
                <button className="outline" disabled={busy} onClick={() => void logout()}>
                  Выйти
                </button>
                <button className="outline" disabled={busy} onClick={() => void logout(true)}>
                  Выйти на всех устройствах
                </button>
              </div>
            </section>
          </div>
          <div hidden={section !== "identity-settings"} className="account-section-view">
            <AccountIdentity
              account={account}
              refresh={async () => {
                setAccount(await loadAccount().catch(() => null));
              }}
            />
          </div>
          <div hidden={section !== "appearance-settings"} className="account-section-view">
            <AccountAppearance />
          </div>
        </>
      )}
    </AccountWorkspace>
  );
}
function AccountSecurity({
  account,
  onUpdate,
  onPasswordChanged,
}: {
  account: Account;
  onUpdate: (account: Account) => void;
  onPasswordChanged: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  useSettingsAnchor("security-settings");
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      await accountRequest(
        "/api/auth/password",
        { current: data.get("current"), next: data.get("next") },
        account.csrfToken,
      );
      onPasswordChanged();
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function mfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      if (!secret) {
        const result = z
          .object({ secret: z.string() })
          .parse(
            await accountRequest(
              "/api/auth/mfa/begin",
              { password: data.get("password") },
              account.csrfToken,
            ),
          );
        setSecret(result.secret);
        form.reset();
      } else {
        const result = z
          .object({ recoveryCodes: z.array(z.string()) })
          .parse(
            await accountRequest(
              "/api/auth/mfa/confirm",
              { code: data.get("code") },
              account.csrfToken,
            ),
          );
        setSecret("");
        setRecovery(result.recoveryCodes);
        onUpdate(await loadAccount());
        setNotice("Второй фактор включён. Сохраните резервные коды в безопасном месте.");
      }
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="security-settings" className="account-card account-settings-anchor">
      <h2>Безопасность</h2>
      {notice && (
        <p role="status" className="account-notice">
          {notice}
        </p>
      )}
      <form className="account-form" onSubmit={changePassword}>
        <h3>Изменить пароль</h3>
        <label>
          Текущий пароль
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            minLength={6}
            maxLength={128}
            required
          />
        </label>
        <label>
          Новый пароль
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={6}
            maxLength={128}
            required
          />
        </label>
        <p className="account-help">
          После смены пароля потребуется войти заново на всех устройствах.
        </p>
        <button className="outline" disabled={busy}>
          Изменить пароль
        </button>
      </form>
      <h3>Второй фактор для административного доступа</h3>
      <p className="account-help">
        Для входа в админку нужны назначенная роль, пароль и код приложения аутентификации.
      </p>
      {account.mfaEnabled ? (
        <p>Второй фактор включён.</p>
      ) : (
        <form className="account-form" onSubmit={mfa}>
          {secret ? (
            <>
              <p className="account-help">
                Добавьте этот секрет в приложение аутентификации: TOTP, 6 цифр, 30 секунд.
              </p>
              <code className="account-secret">{secret}</code>
              <label>
                Код из приложения
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
            </>
          ) : (
            <label>
              Подтвердите пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={6}
                maxLength={128}
                required
              />
            </label>
          )}
          <button className="outline" disabled={busy}>
            {secret ? "Подтвердить код" : "Настроить второй фактор"}
          </button>
        </form>
      )}
      {recovery.length > 0 && (
        <>
          <h3>Одноразовые резервные коды</h3>
          <textarea
            className="account-secret"
            rows={8}
            value={recovery.join("\n")}
            readOnly
            aria-label="Резервные коды"
          />
          <p className="account-help">
            Коды показываются только сейчас. Каждый можно использовать один раз.
          </p>
          <button className="outline" onClick={() => setRecovery([])}>
            Сохранил коды
          </button>
        </>
      )}
    </section>
  );
}
