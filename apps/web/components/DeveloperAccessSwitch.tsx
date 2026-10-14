"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  developerAccessSchema,
  type DeveloperAccess,
  type DeveloperAccessMode,
} from "@animesoul/contracts";
import { AccountRequestError, accountRequest } from "../lib/account-client";

const modes: { mode: DeveloperAccessMode; label: string; description: string }[] = [
  { mode: "guest", label: "Гость", description: "Без входа и доступа к AnimeSoul-плееру" },
  { mode: "user", label: "Без подписки", description: "Аккаунт и библиотека, плеер Kodik" },
  { mode: "trial", label: "Пробный доступ", description: "AnimeSoul-плеер и пробный период" },
  { mode: "subscriber", label: "Подписчик", description: "Полный доступ к AnimeSoul-плееру" },
];

export function DeveloperAccessSwitch() {
  const [access, setAccess] = useState<DeveloperAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    let active = true,
      version = 0;
    const refresh = () => {
      const current = ++version;
      void accountRequest("/api/auth/developer-access")
        .then((value) => {
          if (active && current === version) setAccess(developerAccessSchema.parse(value));
        })
        .catch((error) => {
          if (
            active &&
            current === version &&
            error instanceof AccountRequestError &&
            [401, 403].includes(error.status)
          )
            setAccess(null);
        });
    };
    refresh();
    window.addEventListener("animesoul:account-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("animesoul:account-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!access) return null;
  const role = access.role === "owner" ? "Овнер" : "Админ";
  const label = modes.find((value) => value.mode === access.mode)?.label ?? role;
  async function change(mode: DeveloperAccessMode) {
    if (!access || busy || mode === access.mode) return;
    setBusy(true);
    setNotice("");
    try {
      const result = developerAccessSchema.parse(
        await accountRequest("/api/auth/developer-access", { mode }, access.csrfToken),
      );
      setAccess(result);
      window.dispatchEvent(new Event("animesoul:developer-access-changed"));
      setNotice(mode === "actual" ? "Ваш доступ восстановлен." : "Режим сайта переключён.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось переключить доступ.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={root}
      className={`developer-access${access.mode !== "actual" ? " is-simulated" : ""}`}
    >
      <button
        ref={toggle}
        type="button"
        className="developer-access-toggle"
        aria-expanded={open}
        aria-controls="developer-access-panel"
        aria-label={`Dev-режим: ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>DEV</span>
        <span className="developer-access-current">{label}</span>
      </button>
      {open && (
        <div id="developer-access-panel" className="developer-access-panel">
          <div className="developer-access-heading">
            <strong>Доступ на сайте</strong>
            <span>Dev-режим</span>
          </div>
          <p>Проверь сайт с другим доступом. Твоя роль и админка сохраняются.</p>
          <div role="group" aria-label="Режим доступа" aria-busy={busy}>
            <button
              type="button"
              aria-pressed={access.mode === "actual"}
              disabled={busy}
              onClick={() => void change("actual")}
            >
              <span>{role} · полный доступ</span>
              <small>Ваш настоящий доступ</small>
            </button>
            {modes.map((value) => (
              <button
                key={value.mode}
                type="button"
                aria-pressed={access.mode === value.mode}
                disabled={busy}
                onClick={() => void change(value.mode)}
              >
                <span>{value.label}</span>
                <small>{value.description}</small>
              </button>
            ))}
          </div>
          {access.mode !== "actual" && (
            <button
              type="button"
              className="developer-access-restore"
              disabled={busy}
              onClick={() => void change("actual")}
            >
              Вернуться: {role}
            </button>
          )}
          <p className="developer-access-notice" role="status">
            {busy ? "Переключаем доступ…" : notice || `Сейчас: ${label}`}
          </p>
        </div>
      )}
    </div>
  );
}
