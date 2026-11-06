"use client";

import { useEffect, useState } from "react";
import { parseTheme, themeChoices, themeStorageKey, type Theme } from "../lib/theme";
import { greetingEnabled, greetingQuery, setGreetingEnabled } from "../lib/greeting";
import { useSettingsAnchor } from "../lib/use-settings-anchor";

export function AccountAppearance() {
  const [theme, setTheme] = useState<Theme>("lilac");
  const [notice, setNotice] = useState("");
  const [greeting, setGreeting] = useState(true);
  useSettingsAnchor("appearance-settings");
  useEffect(() => {
    setTheme(parseTheme(document.documentElement.dataset.theme) ?? "lilac");
    setGreeting(greetingEnabled());
    const synchronize = (event: StorageEvent) => {
      if (event.key !== null && event.key !== themeStorageKey) return;
      const next = parseTheme(event.newValue) ?? "lilac";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);

  function choose(next: Theme) {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      window.localStorage.setItem(themeStorageKey, next);
      setNotice("Тема сохранена на этом устройстве.");
    } catch {
      setNotice("Тема применена. Браузер не разрешил сохранить её после закрытия страницы.");
    }
  }

  return (
    <section id="appearance-settings" className="account-card account-settings-anchor">
      <h2>Тема оформления</h2>
      <p className="account-help">Обе темы тёмные. Выбор сохраняется только на этом устройстве.</p>
      <div className="theme-choices" role="group" aria-label="Тема оформления">
        {themeChoices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="theme-choice"
            aria-pressed={theme === choice.id}
            onClick={() => choose(choice.id)}
          >
            <span className={"theme-swatch theme-swatch-" + choice.id} aria-hidden="true" />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="greeting-setting">
        <label>
          <input
            type="checkbox"
            role="switch"
            checked={greeting}
            onChange={(event) => {
              const next = event.target.checked;
              setGreeting(next);
              try {
                setGreetingEnabled(next);
                setNotice(next ? "Приветствие включено." : "Приветствие выключено.");
              } catch {
                setNotice("Браузер не разрешил сохранить этот выбор.");
              }
            }}
          />
          <span>
            <strong>Приветствие при первом входе</strong>
            <small>Короткая заставка «Привет» перед главной страницей.</small>
          </span>
        </label>
        {/* A full load lets the pre-paint script hold the page behind the greeting. */}
        <a className="text-link" href={`/?${greetingQuery}=1`}>
          Показать сейчас
        </a>
      </div>
      {notice && (
        <p className="account-help" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
