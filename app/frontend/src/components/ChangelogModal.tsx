"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION } from "../version";
import { CHANGE_GROUP_META, CHANGELOG } from "../lib/changelog";
import { recordDebugEvent } from "../lib/debugLog";
import { useModalAccessibility } from "../lib/modalAccessibility";

export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(() => CHANGELOG[0]?.id ?? null);
  const modalRef = useRef<HTMLElement>(null);

  useModalAccessibility(open, () => setOpen(false), modalRef);

  useEffect(() => {
    if (!open) return;
    recordDebugEvent("info", "Ченжлог", "Открыто окно", `Текущая версия: ${APP_VERSION}`, undefined, { functionName: "ChangelogButton.useEffect", file: "src/components/ChangelogModal.tsx" });
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
            ref={modalRef}
            className="changelog-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="changelog-title"
            tabIndex={-1}
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
            <ChangelogList expandedId={expandedId} onToggle={toggleVersion} />
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function ChangelogList({
  expandedId,
  onToggle,
}: {
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  return <div className="changelog-list">
    {CHANGELOG.map((version, index) => {
      const isOpen = expandedId === version.id;
      return (
        <article className={`changelog-version ${version.state}`} key={version.id}>
          <button
            className="changelog-version-head"
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(version.id)}
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
  </div>;
}

export function ChangelogPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(() => CHANGELOG[0]?.id ?? null);
  return (
    <div className="settings-changelog-panel">
      <div className="settings-changelog-intro">
        <span>История AnimeSoul</span>
        <h4>Что нового</h4>
        <p>Текущая версия: <b>{APP_VERSION}</b>. Здесь собраны возможности, исправления и улучшения каждого релиза.</p>
      </div>
      <ChangelogList
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((current) => current === id ? null : id)}
      />
    </div>
  );
}
