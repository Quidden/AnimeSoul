import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "../../lib/http";
import { navigateTo } from "../navigation/routes";
import { useAccount, type AccountUser } from "./context";

type Role = { id: string; name: string; protected: boolean; permissions: string[] };
type RolePayload = { roles: Role[]; permissions: Record<string, string> };
type AuditEvent = { id: string; action: string; actor_id: string; target_id: string; created_at: number };
const auditLabels: Record<string, string> = {
  "role.create": "Создана роль", "role.update": "Изменена роль", "user.roles": "Изменены роли пользователя",
  "owner.bootstrap": "Назначен владелец", "profile.username": "Изменён логин",
  "credential.password": "Изменён пароль", "credential.reset": "Сброшен пароль",
  "credential.verify": "Подтверждена почта", "credential.email": "Изменена почта",
};

export function AdminPage() {
  const { user, refresh } = useAccount();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const canUsers = Boolean(user?.emailVerified && user.permissions.includes("admin.users"));
  const canRoles = Boolean(user?.emailVerified && user.permissions.includes("admin.roles"));

  async function loadUsers(q = query, page = offset) {
    const result = await requestJson<{ users: AccountUser[]; hasMore: boolean }>(`/api/admin/users?q=${encodeURIComponent(q)}&offset=${page}`);
    setUsers(result.users); setMore(result.hasMore);
  }
  async function loadRoles() {
    const result = await requestJson<RolePayload>("/api/admin/roles");
    setRoles(result.roles); setPermissions(result.permissions);
  }
  async function loadAudit() { setEvents((await requestJson<{ events: AuditEvent[] }>("/api/admin/audit")).events); }
  useEffect(() => {
    let active = true;
    if (!canUsers && !canRoles) return;
    void Promise.all([
      requestJson<RolePayload>("/api/admin/roles"),
      canUsers ? requestJson<{ users: AccountUser[]; hasMore: boolean }>("/api/admin/users") : null,
      canUsers ? requestJson<{ events: AuditEvent[] }>("/api/admin/audit") : null,
    ]).then(([roleData, userData, auditData]) => {
      if (!active) return;
      setRoles(roleData.roles); setPermissions(roleData.permissions);
      if (userData) { setUsers(userData.users); setMore(userData.hasMore); }
      if (auditData) setEvents(auditData.events);
    }).catch(failure => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [canRoles, canUsers]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice("Изменения сохранены"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить изменения"); }
    finally { setBusy(false); }
  }
  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      await requestJson(`/api/admin/roles${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), permissions: data.getAll("permission") }),
      });
      await loadRoles(); if (canUsers) { await loadUsers(); await loadAudit(); }
      setEditing(null);
      setFormVersion(version => version + 1);
    });
  }

  if (!canUsers && !canRoles) return <main className="account-page"><h1>Нет доступа к админ-панели</h1><button type="button" onClick={() => navigateTo("/account")}>В профиль</button></main>;
  return <main className="account-page account-admin">
    <div className="account-page-nav"><a href="/" onClick={event => { event.preventDefault(); navigateTo("/"); }}>AnimeSoul</a><button type="button" onClick={() => navigateTo("/account")}>← Профиль</button></div>
    <p className="account-eyebrow">УПРАВЛЕНИЕ САЙТОМ</p><h1>Пользователи и роли</h1><p className="account-muted">Изменения разрешений действуют со следующего запроса пользователя.</p>
    {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status" className="account-notice">{notice}</p>}
    {canUsers && <section className="account-card"><h2>Пользователи</h2>
      <form className="account-admin-search" onSubmit={event => { event.preventDefault(); setOffset(0); void run(() => loadUsers(query, 0)); }}><input aria-label="Поиск по логину или email" placeholder="Логин или email" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /><button disabled={busy}>Найти</button></form>
      <div className="account-users">{users.map(member => <form key={member.id} className="account-user-row" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => {
          await requestJson(`/api/admin/users/${member.id}/roles`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles: data.getAll("role") }) });
          await loadUsers(); await loadAudit(); await refresh();
        });
      }}><div><strong>{member.username}</strong><small>{member.email}</small>{!member.emailVerified && <small>Почта не подтверждена</small>}</div>
        <fieldset disabled={busy}><legend>Роли</legend>{roles.map(role => <label key={`${role.id}:${member.roles.some(r => r.id === role.id)}`}><input type="checkbox" name="role" value={role.id} defaultChecked={member.roles.some(r => r.id === role.id)} disabled={role.id === "owner"} />{role.id === "owner" && member.roles.some(r => r.id === "owner") && <input type="hidden" name="role" value="owner" />}{role.name}</label>)}</fieldset><button type="submit" disabled={busy}>Сохранить роли</button>
      </form>)}</div>
      {!users.length && <p>Пользователи не найдены.</p>}
      <div className="account-pagination"><button type="button" disabled={!offset || busy} onClick={() => { const page = Math.max(0, offset - 50); setOffset(page); void run(() => loadUsers(query, page)); }}>Назад</button><span>Страница {offset / 50 + 1}</span><button type="button" disabled={!more || busy} onClick={() => { const page = offset + 50; setOffset(page); void run(() => loadUsers(query, page)); }}>Далее</button></div>
    </section>}
    <div className="account-grid"><section className="account-card"><h2>Роли</h2><div className="account-roles-list">{roles.map(role => <div key={role.id}><strong>{role.name}</strong><small>{role.permissions.map(p => permissions[p]).join(" · ") || "Без разрешений"}</small>{canRoles && !role.protected && <button type="button" disabled={busy} onClick={() => setEditing(role)}>Настроить</button>}</div>)}</div></section>
      {canRoles && <section className="account-card"><h2>{editing ? `Настроить: ${editing.name}` : "Создать роль"}</h2><form className="account-form" key={`${editing?.id ?? "new"}:${formVersion}`} onSubmit={event => void saveRole(event)}><label className="account-field">Название<input name="name" defaultValue={editing?.name ?? ""} minLength={2} maxLength={64} required /></label><fieldset disabled={busy}><legend>Разрешения</legend>{Object.entries(permissions).map(([id, label]) => <label key={id}><input type="checkbox" name="permission" value={id} defaultChecked={editing?.permissions.includes(id)} />{label}</label>)}</fieldset><button className="account-primary" disabled={busy}>Сохранить роль</button>{editing && <button type="button" onClick={() => setEditing(null)}>Отмена</button>}</form></section>}
    </div>
    {canUsers && <section className="account-card"><h2>Последние изменения</h2><div className="account-audit">{events.map(event => <div key={event.id}><time>{new Date(event.created_at * 1000).toLocaleString("ru-RU")}</time><strong>{auditLabels[event.action] ?? "Изменение аккаунта"}</strong><small>Кем: {users.find(member => member.id === event.actor_id)?.username ?? event.actor_id} · Для: {users.find(member => member.id === event.target_id)?.username ?? roles.find(role => role.id === event.target_id)?.name ?? event.target_id}</small></div>)}</div></section>}
  </main>;
}
