import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { requestJson } from "../../lib/http";
import { navigateTo } from "../navigation/routes";
import { useAccount } from "./context";
import { useProfileMedia } from "./useProfileMedia";

function Field({ label, name, type = "text", autoComplete, minLength, maxLength = 254, optional = false }: {
  label: string; name: string; type?: string; autoComplete?: string; minLength?: number; maxLength?: number; optional?: boolean;
}) {
  return <label className="account-field"><span>{label}</span><input name={name} type={type} autoComplete={autoComplete} minLength={minLength} maxLength={maxLength} required={!optional} /></label>;
}

function AccountForm({ children, submit, onSubmit }: { children: ReactNode; submit: string; onSubmit: (data: FormData) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError(""); setNotice("");
    try {
      await onSubmit(new FormData(form));
      setNotice("Готово. Если требуется подтверждение, проверьте почту.");
      form.reset();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось выполнить действие"); }
    finally { setBusy(false); }
  }
  return <form className="account-form" onSubmit={event => void handle(event)}>
    {children}<button type="submit" disabled={busy} className="account-primary">{busy ? "Подождите…" : submit}</button>
    {error && <p role="alert" className="account-error">{error}</p>}
    {notice && <p role="status" className="account-notice">{notice}</p>}
  </form>;
}

export function AccountPage() {
  const { user, config, refresh, logout } = useAccount();
  const avatarMedia = useProfileMedia(user?.avatar ?? "");
  const [tab, setTab] = useState<"login" | "register" | "reset">("login");
  const [message, setMessage] = useState("");
  // Capture a link once, then remove it from the address bar before requests.
  const [confirmation, setConfirmation] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("verify") ?? fragment.get("reset");
    return token ? { token, reset: fragment.has("reset") } : null;
  });
  useEffect(() => {
    if (confirmation) window.history.replaceState({}, "", window.location.pathname);
  }, [confirmation]);
  const googleError = new URLSearchParams(window.location.search).has("auth_error");
  const canAdmin = user?.permissions.some(permission => permission.startsWith("admin."));
  async function send(path: string, data: FormData | Record<string, string> = {}) {
    const payload = data instanceof FormData ? Object.fromEntries(data.entries()) : data;
    const result = await requestJson<{ verificationSent?: boolean; message?: string }>(`/api/auth/${path}`, {
      method: path === "profile" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    await refresh();
    if (result.verificationSent === false) setMessage("Аккаунт создан, но письмо не доставлено. Повторите отправку подтверждения.");
    else if (result.message) setMessage(result.message);
  }
  async function action(run: () => Promise<unknown>) {
    try { await run(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка запроса"); }
  }

  return <main className="account-page">
    <div className="account-page-nav"><a href="/" onClick={event => { event.preventDefault(); navigateTo("/"); }}>AnimeSoul</a>
      {user && <nav><button type="button" onClick={() => navigateTo("/account")}>← Профиль</button><button type="button" onClick={() => navigateTo("/library")}>Библиотека</button>{canAdmin && <button type="button" onClick={() => navigateTo("/admin")}>Админ-панель</button>}</nav>}
    </div>
    {googleError && <p className="account-error" role="alert">Не удалось войти через Google. Если аккаунт с этой почтой уже существует, войдите по паролю и привяжите Google в профиле.</p>}
    {message && <p className="account-notice" role="status">{message}</p>}
    {confirmation ? <section className="account-card"><h1>{confirmation.reset ? "Новый пароль" : "Подтверждение почты"}</h1>
      <AccountForm submit={confirmation.reset ? "Сохранить пароль" : "Подтвердить почту"} onSubmit={async data => {
        await send("confirm", { token: confirmation.token, ...(confirmation.reset ? { password: String(data.get("password")) } : {}) });
        setConfirmation(null); setMessage("Данные подтверждены. Войдите в аккаунт, если сессия завершена.");
      }}>{confirmation.reset && <Field label="Новый пароль · не менее 12 символов" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} />}</AccountForm>
    </section> : !user ? <section className="account-card account-auth-card">
      <p className="account-eyebrow">ВАША БИБЛИОТЕКА НА ЛЮБОМ УСТРОЙСТВЕ</p><h1>{tab === "register" ? "Создать аккаунт" : tab === "reset" ? "Восстановить доступ" : "Добро пожаловать"}</h1>
      <p className="account-muted">Избранное, история и прогресс просмотра сохраняются в вашем аккаунте.</p>
      <div className="account-tabs"><button type="button" aria-pressed={tab === "login"} onClick={() => setTab("login")}>Вход</button><button type="button" aria-pressed={tab === "register"} onClick={() => setTab("register")}>Регистрация</button></div>
      {config.google && tab !== "reset" && <a className="account-google" href="/api/auth/google/start"><span aria-hidden="true">G</span>Продолжить с Google</a>}
      {tab === "register" && !config.email ? <p className="account-muted">Регистрация по email будет доступна после настройки почтовой отправки.</p> : <AccountForm key={tab} submit={tab === "register" ? "Создать аккаунт" : tab === "reset" ? "Отправить ссылку" : "Войти"} onSubmit={data => send(tab, data)}>
        {tab === "register" && <Field label="Логин" name="username" autoComplete="username" minLength={3} maxLength={32} />}
        <Field label={tab === "login" ? "Логин или email" : "Email"} name={tab === "login" ? "login" : "email"} type={tab === "login" ? "text" : "email"} autoComplete={tab === "login" ? "username" : "email"} />
        {tab !== "reset" && <Field label={tab === "register" ? "Пароль · не менее 12 символов" : "Пароль"} name="password" type="password" autoComplete={tab === "register" ? "new-password" : "current-password"} minLength={tab === "register" ? 12 : 1} maxLength={128} />}
      </AccountForm>}
      {config.email && <button type="button" className="account-text-button" onClick={() => setTab("reset")}>Забыли пароль?</button>}
    </section> : <>
      <section className="account-profile-heading"><div className="account-profile-avatar">{avatarMedia.url ? <img src={avatarMedia.url} alt="" referrerPolicy="no-referrer" /> : user.username.slice(0, 1).toUpperCase()}</div>
        <div><p className="account-eyebrow">ЛИЧНЫЙ ПРОФИЛЬ</p><h1>{user.username}</h1><p>{user.email} · {user.emailVerified ? "Почта подтверждена" : "Подтвердите почту"}</p><div className="account-role-badges">{user.roles.map(role => <span key={role.id}>{role.name}</span>)}</div></div>
        <button type="button" className="account-logout" onClick={() => void action(logout)}>Выйти</button>
      </section>
      {!user.emailVerified && config.email && <div className="account-notice">Подтвердите email для доступа к выданным разрешениям. <button type="button" onClick={() => void action(() => send("verification"))}>Отправить письмо ещё раз</button></div>}
      <div className="account-grid">
        <section className="account-card"><h2>Логин</h2><p className="account-muted">Отображается в шапке сайта. Латинские буквы, цифры и подчёркивания.</p>
          <AccountForm submit="Изменить логин" onSubmit={data => send("profile", data)}><Field label="Новый логин" name="username" autoComplete="username" minLength={3} maxLength={32} /></AccountForm>
        </section>
        <section className="account-card"><h2>{user.hasPassword ? "Изменить пароль" : "Добавить пароль"}</h2><p className="account-muted">После изменения все прежние сессии будут завершены.{!user.hasPassword && " Для сохранения войдите через Google менее пяти минут назад."}</p>
          <AccountForm submit="Сохранить пароль" onSubmit={data => send("password", data)}>{user.hasPassword && <Field label="Текущий пароль" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} />}<Field label="Новый пароль · не менее 12 символов" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} /></AccountForm>
        </section>
        <section className="account-card"><h2>Почта</h2><p className="account-muted">Новый адрес начнёт действовать после подтверждения по ссылке. Затем потребуется войти заново.</p>
          {config.email ? <AccountForm submit="Отправить подтверждение" onSubmit={data => send("email", data)}><Field label="Новый email" name="email" type="email" autoComplete="email" />{user.hasPassword && <Field label="Текущий пароль" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} />}</AccountForm> : <p>Почтовая отправка ещё не настроена.</p>}
        </section>
        <section className="account-card"><h2>Google и доступы</h2><p>{user.googleLinked ? "Google подключён. Смена email в профиле сохранит эту связь." : "Подключите Google, чтобы входить без пароля."}</p>
          {config.google && !user.googleLinked && <button type="button" className="account-google" onClick={() => void action(async () => {
            const result = await requestJson<{ url: string }>("/api/auth/google/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            window.location.assign(result.url);
          })}>Привязать Google</button>}
          <p className="account-muted">Плеер AnimeSoul: {user.emailVerified && user.permissions.includes("player.use") ? "доступ разрешён" : "доступ выдаёт администратор"}.</p>
          <p className="account-muted">Скачивание: {user.emailVerified && user.permissions.includes("downloads.use") ? "доступ разрешён" : "доступ выдаёт администратор"}.</p>
          {canAdmin && <button type="button" className="account-primary" onClick={() => navigateTo("/admin")}>Управление пользователями и ролями →</button>}
        </section>
      </div>
    </>}
  </main>;
}
