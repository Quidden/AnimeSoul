"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION } from "../version";
import { CHANGE_GROUP_META, CHANGELOG } from "../lib/changelog";
import { recordDebugEvent } from "../lib/debugLog";

export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(() => CHANGELOG[0]?.id ?? null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    recordDebugEvent("info", "Ченжлог", "Открыто окно", `Текущая версия: ${APP_VERSION}`);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleVersion = (id: string) => {
    // The changelog behaves like an accordion: opening one version closes the previous one.
    setExpandedId((current) => current === id ? null : id);
  };

  return (
    <>
      <button className="changelog-trigger" type="button" onClick={() => setOpen(true)}>
        Что нового в версии…
      </button>
      {open && createPortal(
        <div className="system-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="changelog-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="changelog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>История AnimeSoul</span>
                <h2 id="changelog-title">Что нового</h2>
                <p>Текущая версия: <b>{APP_VERSION}</b>. Сборка сама по себе не повышает номер версии.</p>
              </div>
              <button type="button" className="system-modal-close" aria-label="Закрыть" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="changelog-list">
              {CHANGELOG.map((version, index) => {
                const isOpen = expandedId === version.id;
                return (
                  <article className={`changelog-version ${version.state}`} key={version.id}>
                    <button
                      className="changelog-version-head"
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggleVersion(version.id)}
                    >
                      <span className="changelog-version-mark">{version.state === "current-build" ? "Сейчас" : "Релиз"}</span>
                      <span>
                        <b>{version.title}</b>
                        <small>{version.date}</small>
                      </span>
                      {index === 0 && <em>Актуальная</em>}
                      <i aria-hidden="true">{isOpen ? "⌃" : "⌄"}</i>
                    </button>
                    <div className={`changelog-version-body${isOpen ? " open" : ""}`}>
                      <div className="changelog-version-content">
                        <p className="changelog-summary">{version.summary}</p>
                        <div className="changelog-groups">
                          {Object.entries(version.groups)
                            .filter(([group]) => group !== "important")
                            .map(([group, items]) => {
                            const meta = CHANGE_GROUP_META[group as keyof typeof CHANGE_GROUP_META];
                            return (
                              <section className={`changelog-group ${group}`} key={group}>
                                <h3><i>{meta.icon}</i>{meta.label}</h3>
                                <ul>{items?.map((item) => <li key={item}>{item}</li>)}</ul>
                              </section>
                            );
                            })}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
