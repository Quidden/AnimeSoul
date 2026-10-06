import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import App from "../../App";
import { requestJson } from "../../lib/http";
import { setAccountRuntime } from "../../lib/accountRuntime";
import { AccountContext, type AccountConfig, type AccountUser } from "./context";
import "./account.css";

const AccountPage = lazy(() => import("./AccountPage").then(module => ({ default: module.AccountPage })));
const AdminPage = lazy(() => import("./AdminPage").then(module => ({ default: module.AdminPage })));
const ProfilePage = lazy(() => import("./ProfilePage").then(module => ({ default: module.ProfilePage })));

export function AccountRoot() {
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState("");
  const [pathname, setPathname] = useState(window.location.pathname);
  const requestRevision = useRef(0);
  const loggingOut = useRef(false);
  const refresh = useCallback(async () => {
    if (loggingOut.current) return;
    const revision = ++requestRevision.current;
    const result = await requestJson<{ user: AccountUser | null }>("/api/auth/me", { cache: "no-store" });
    if (loggingOut.current || revision !== requestRevision.current) return;
    setAccountRuntime(true, result.user?.id ?? null);
    setUser(result.user);
  }, []);
  const logout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    ++requestRevision.current;
    try {
      await requestJson("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      ++requestRevision.current;
      setAccountRuntime(true, null); setUser(null);
    } finally { loggingOut.current = false; }
  }, []);
  useEffect(() => {
    let active = true;
    void requestJson<AccountConfig>("/api/auth/config", { cache: "no-store" }).then(async configuration => {
      if (!active) return;
      if (configuration.website) {
        const result = await requestJson<{ user: AccountUser | null }>("/api/auth/me", { cache: "no-store" });
        if (!active) return;
        setAccountRuntime(true, result.user?.id ?? null); setUser(result.user);
      } else setAccountRuntime(false, null);
      setConfig(configuration);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Сервер недоступен"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const navigate = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", navigate); window.addEventListener("animesoul:navigation", navigate);
    return () => { window.removeEventListener("popstate", navigate); window.removeEventListener("animesoul:navigation", navigate); };
  }, []);
  useEffect(() => {
    if (!config?.website || !user?.id) return;
    // Account changes in another tab and session expiration unmount save writers.
    const check = () => { void refresh().catch(() => undefined); };
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 60_000);
    return () => { window.removeEventListener("focus", check); window.clearInterval(timer); };
  }, [config?.website, user?.id, refresh]);
  useEffect(() => {
    if (!config?.website || !user?.id) return;
    const heartbeat = () => {
      if (document.visibilityState !== "visible") return;
      void requestJson("/api/profiles/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
  }, [config?.website, user?.id]);
  if (!config) return <main className="account-page" role="status">{error ? <><p role="alert">{error}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></> : "Загрузка AnimeSoul…"}</main>;
  if (!config.website) return <App />;
  return <AccountContext.Provider value={{ config, user, refresh, logout }}>
    <Suspense fallback={<main className="account-page" role="status">Загрузка страницы…</main>}>
    {/^\/users\/[^/]+\/?$/.test(pathname) ? <ProfilePage key={`${user?.id ?? "guest"}:${pathname}`} userId={pathname.split("/")[2]} /> : pathname.replace(/\/$/, "") === "/account" ? (user ? <ProfilePage key={user.id} /> : <AccountPage />) : pathname.replace(/\/$/, "") === "/account/settings" ? <AccountPage key={user?.id ?? "guest"} /> : pathname.replace(/\/$/, "") === "/admin" ? (user ? <AdminPage /> : <AccountPage />) : ["/downloads", "/remote"].includes(pathname.replace(/\/$/, "")) ? <main className="account-page"><h1>Раздел доступен в локальном приложении</h1><a href="/">На главную</a></main> : <App key={user?.id ?? "guest"} />}
    </Suspense>
  </AccountContext.Provider>;
}
