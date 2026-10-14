"use client";
import { trackFeature } from "../lib/analytics-client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  globalSearchResponseSchema,
  characterSearchSchema,
  getSearchCompletionContext,
  normalizeSearchText,
  parseGlobalSearch,
  scoreSearchText,
  searchFilterDefinitions,
  type GlobalSearchResponse,
} from "@animesoul/contracts";
import { findSearchSettings, popularSearchSettings } from "../lib/search-settings";
import {
  completeSearchFilter,
  getSearchGhostSuffix,
  isSearchFilterUnclosed,
} from "../lib/search-completion";
import { Icon } from "./Icon";
import { SearchAnimeProgress } from "./SearchAnimeProgress";
import { ProfileImage } from "./ProfileImage";
import { SearchPreview } from "./SearchPreview";
import { useSearchPreview } from "./useSearchPreview";
import type { SearchOption } from "../lib/search-preview";
import { FrameSearch } from "./FrameSearch";
import { appendTextHistory, parseTextHistory, textHistoryKey } from "../lib/frame-search-history";

function completeSearchText(query: string, text: string) {
  const { filters } = parseGlobalSearch(query);
  return [
    filters.genre && `tag:${JSON.stringify(filters.genre)}`,
    filters.status && `status:${filters.status}`,
    filters.format && `type:${filters.format}`,
    filters.from && `year:${filters.from}${filters.to !== filters.from ? `-${filters.to}` : ""}`,
    filters.minRating !== undefined && `rating:${filters.minRating}`,
    text,
  ]
    .filter(Boolean)
    .join(" ");
}

export function UniversalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [caret, setCaret] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputScroll, setInputScroll] = useState(0);
  const [active, setActive] = useState(-1);
  const [response, setResponse] = useState<GlobalSearchResponse | null>(null);
  const [genres, setGenres] = useState<GlobalSearchResponse["genres"]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [frameMode, setFrameMode] = useState(false);
  const [frameFile, setFrameFile] = useState<File | null>(null);
  const [frameDragging, setFrameDragging] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const preview = useSearchPreview(dialog, `${open}:${closing}:${frameMode}:${query}:${retry}`);
  const keyboardSelection = useRef(false);
  const parsed = parseGlobalSearch(query);
  const pending = getSearchCompletionContext(query, caret);
  const completed =
    pending &&
    pending.end === caret &&
    !isSearchFilterUnclosed(query, pending) &&
    !parsed.issues.length &&
    (pending.key === "tag"
      ? genres.some(
          (genre) => normalizeSearchText(genre.name) === normalizeSearchText(pending.value),
        )
      : pending.key === "status"
        ? Boolean(parsed.filters.status)
        : pending.key === "type"
          ? Boolean(parsed.filters.format)
          : pending.key === "year"
            ? Boolean(parsed.filters.from)
            : parsed.filters.minRating !== undefined);
  const context = completed ? null : pending;
  const incompleteFilter = Boolean(context && !context.value.trim());
  const current = response?.query === query.trim() ? response : null;
  const completionLoading = Boolean(context?.key === "tag" && !genres.length && !current && !error);
  const settings =
    !context && !Object.keys(parsed.filters).length
      ? query.trim()
        ? findSearchSettings(parsed.text)
        : popularSearchSettings
      : [];

  function openSearch() {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setClosing(false);
      input.current?.focus();
      return;
    }
    setQuery("");
    setFrameMode(false);
    setFrameFile(null);
    setCaret(0);
    setSelectionEnd(0);
    setInputScroll(0);
    setActive(-1);
    setClosing(false);
    setOpen(true);
  }
  function closeSearch() {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      dialog.current?.close();
      setOpen(false);
      setClosing(false);
      trigger.current?.focus({ preventScroll: true });
    }, 160);
  }
  function edit(value: string, position = value.length) {
    setQuery(value.slice(0, 240));
    setCaret(position);
    setSelectionEnd(position);
    setActive(-1);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
      setInputScroll(input.current?.scrollLeft ?? 0);
    });
  }
  function navigate(href: string) {
    if (query.trim() && /^(?:\/anime\/|\/characters\/|\/users\/|\/search\?)/.test(href)) {
      const next = appendTextHistory(history, query);
      setHistory(next);
      try {
        localStorage.setItem(textHistoryKey, JSON.stringify(next));
      } catch {
        /* History stays usable in this session. */
      }
    }
    closeSearch();
    router.push(href);
  }
  function findFrame(file: File) {
    if (!open) openSearch();
    setFrameMode(true);
    setFrameFile(file);
    setFrameDragging(false);
  }
  function pasteFrame(event: ClipboardEvent<HTMLElement>) {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (image) {
      event.preventDefault();
      findFrame(image);
    }
  }
  function dropFrame(event: DragEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const file = event.dataTransfer.files[0];
    if (file) {
      event.preventDefault();
      findFrame(file);
    }
  }
  useEffect(() => {
    if (!open) return;
    try {
      setHistory(parseTextHistory(localStorage.getItem(textHistoryKey)));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    for (const panel of dialog.current?.querySelectorAll(".global-search-scroll") ?? [])
      panel.scrollTop = 0;
  }, [open, query]);
  useEffect(() => {
    dialog.current?.close();
    setOpen(false);
    setClosing(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, [pathname]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const typing = element.matches("input, textarea, select") || element.isContentEditable;
      if (
        ((event.code === "KeyK" || event.key.toLowerCase() === "k") &&
          (event.ctrlKey || event.metaKey)) ||
        (event.key === "/" && !typing)
      ) {
        event.preventDefault();
        if (dialog.current?.open) {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setClosing(false);
          input.current?.focus();
        } else {
          setQuery("");
          setFrameMode(false);
          setFrameFile(null);
          setCaret(0);
          setSelectionEnd(0);
          setActive(-1);
          setOpen(true);
        }
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!open || frameMode) return;
    const controller = new AbortController();
    setError("");
    const timer = setTimeout(
      () => {
        void fetch("/api/search?" + new URLSearchParams({ q: query }), {
          signal: controller.signal,
          cache: "no-store",
        })
          .then(async (result) => {
            if (!result.ok) throw new Error("Не удалось загрузить результаты. Попробуйте ещё раз.");
            const value = globalSearchResponseSchema.parse(await result.json());
            if (!controller.signal.aborted) {
              if (query.trim()) trackFeature("search.text");
              setResponse(value);
              setGenres(value.genres);
              setActive(-1);
              const parsedQuery = parseGlobalSearch(query);
              if (
                !value.characters.length &&
                value.anime.length &&
                parsedQuery.text.trim().length >= 2 &&
                !parsedQuery.text.startsWith("@") &&
                !parsedQuery.issues.length &&
                !Object.keys(parsedQuery.filters).length &&
                !findSearchSettings(parsedQuery.text).length
              ) {
                void fetch(
                  "/api/characters/search?" + new URLSearchParams({ q: parsedQuery.text }),
                  {
                    signal: controller.signal,
                    cache: "no-store",
                  },
                )
                  .then(async (result) => {
                    if (!result.ok) return;
                    const characters = characterSearchSchema.parse(await result.json()).items;
                    if (!controller.signal.aborted && characters.length)
                      setResponse((current) =>
                        current?.query === value.query ? { ...current, characters } : current,
                      );
                  })
                  .catch(() => {
                    /* Existing anime and local character results remain available. */
                  });
              }
            }
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setError("Не удалось загрузить результаты. Попробуйте ещё раз.");
          });
      },
      query ? 160 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, retry, frameMode]);

  const options: SearchOption[] = [];
  if (context) {
    const definition = searchFilterDefinitions.find((item) => item.key === context.key);
    const year = new Date().getFullYear();
    const values =
      context.key === "tag"
        ? genres.map((genre) => ({
            label: genre.name,
            value: genre.name,
            detail: `${genre.count.toLocaleString("ru-RU")} тайтлов`,
          }))
        : context.key === "year"
          ? [
              String(year),
              String(year - 1),
              String(year - 2),
              `2020-${year}`,
              "2010-2019",
              "2000-2009",
            ].map((value) => ({ label: value, value, detail: "Год выхода" }))
          : context.key === "rating"
            ? ["9", "8", "7", "6"].map((value) => ({
                label: `${value} и выше`,
                value,
                detail: "Оценка Shikimori",
              }))
            : (definition?.values ?? []).map((item) => ({
                ...item,
                detail: definition?.description ?? "",
              }));
    for (const value of values
      .map((value) => ({
        ...value,
        score: !normalizeSearchText(context.value)
          ? 1
          : Math.max(
              scoreSearchText(context.value, value.label),
              scoreSearchText(context.value, value.value),
            ),
      }))
      .filter((value) => value.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)) {
      const completion = completeSearchFilter(query, context, value.value);
      options.push({
        id: "filter-" + value.value,
        group: definition?.label ?? "Подсказки",
        kind: "filter",
        label: value.label,
        detail: value.detail,
        ...completion,
        badge: context.key + ":",
      });
    }
  } else {
    for (const anime of current?.anime ?? [])
      options.push({
        id: "anime-" + anime.id,
        group: "Аниме",
        kind: "anime",
        label: anime.title,
        detail: [anime.originalTitle, anime.year || "", anime.genres.slice(0, 2).join(" · ")]
          .filter(Boolean)
          .join(" · "),
        href: "/anime/" + anime.slug,
        completion: completeSearchText(
          query,
          [anime.title, anime.originalTitle, ...anime.aliases].find(
            (title) =>
              title &&
              parsed.text &&
              title.toLocaleLowerCase("ru-RU").startsWith(parsed.text.toLocaleLowerCase("ru-RU")),
          ) ?? anime.title,
        ),
        poster: anime.poster,
        anime,
        badge: anime.shikimoriScore ? "★ " + anime.shikimoriScore.toFixed(2) : undefined,
      });
    for (const character of current?.characters ?? [])
      options.push({
        id: "character-" + character.id,
        group: "Персонажи",
        kind: "character",
        label: character.name,
        detail:
          [character.originalName, character.japaneseName]
            .filter((name) => name && name !== character.name)
            .join(" · ") || "Персонаж аниме",
        href: "/characters/" + character.slug,
        completion:
          [
            character.name,
            character.originalName,
            character.japaneseName,
            ...character.aliases,
          ].find(
            (name) =>
              name &&
              parsed.text &&
              name.toLocaleLowerCase("ru-RU").startsWith(parsed.text.toLocaleLowerCase("ru-RU")),
          ) ?? character.name,
        poster: character.image,
        character,
      });
    for (const person of query.trim() ? (current?.people ?? []) : [])
      options.push({
        id: "person-" + person.id,
        group: "Люди",
        kind: "person",
        label: person.username,
        detail: "ID: " + person.id,
        href: "/users/" + encodeURIComponent(person.username),
        completion: parsed.text.startsWith("@") ? "@" + person.username : person.username,
        poster: person.avatar,
        person,
      });
    for (const setting of settings)
      options.push({
        id: "setting-" + setting.id,
        group: "Настройки",
        kind: "setting",
        label: setting.label,
        detail: setting.description,
        href: setting.href,
        completion: setting.label,
      });
  }

  const completionOption =
    context || parsed.text.trim() || active >= 0 ? options[active >= 0 ? active : 0] : undefined;
  const ghostSuffix =
    inputFocused && completionOption
      ? getSearchGhostSuffix(query, completionOption.completion, caret, selectionEnd)
      : null;
  const sections = context
    ? [
        {
          id: "filters",
          title: options[0]?.group ?? "Подсказки",
          hint: "Tab · дополнить",
          kind: "filter",
        },
      ]
    : [
        {
          id: "anime",
          title: "Аниме",
          hint: query.trim() ? "По названиям и жанрам" : "Популярно сейчас · топ 3",
          kind: "anime",
        },
        {
          id: "characters",
          title: "Персонажи",
          hint: "По именам и псевдонимам",
          kind: "character",
        },
        { id: "people", title: "Люди", hint: "По нику или ID", kind: "person" },
        {
          id: "settings",
          title: "Настройки",
          hint: query.trim() ? "Нужный раздел" : "Быстрые настройки",
          kind: "setting",
        },
      ].filter(
        (section) =>
          (!query.trim() && (section.kind === "anime" || section.kind === "setting")) ||
          options.some((option) => option.kind === section.kind),
      );
  const divided = Boolean(context) || sections.length > 1;

  useEffect(() => {
    if (active < 0) return;
    const element = document.getElementById("search-option-" + active);
    element?.scrollIntoView({ block: "nearest" });
    if (keyboardSelection.current && element && options[active])
      preview.schedule({ option: options[active], element, origin: null });
    // Selection is an index into the current result set; query changes dismiss the preview.
  }, [active]);
  function choose(option: SearchOption) {
    preview.dismiss();
    if (option.href) navigate(option.href);
    else edit(option.completion, option.caret);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      keyboardSelection.current = true;
      setActive((value) =>
        value < 0
          ? event.key === "ArrowDown"
            ? 0
            : options.length - 1
          : (value + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
      );
    } else if (
      event.key === "Tab" &&
      !event.shiftKey &&
      (context || parsed.text.trim() || active >= 0)
    ) {
      const option = options[active >= 0 ? active : 0];
      if (option && option.completion !== query.trim()) {
        event.preventDefault();
        edit(ghostSuffix ? query + ghostSuffix : option.completion, option.caret);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = options[active];
      if (selected) choose(selected);
      else if (context && options[0]) choose(options[0]);
      else if (!parsed.issues.length && !incompleteFilter)
        navigate("/search?" + new URLSearchParams({ q: query.trim() }));
    }
  }

  return (
    <>
      <button
        ref={trigger}
        className="global-search-trigger"
        type="button"
        aria-label="Поиск аниме, персонажей, людей, настроек и по кадру"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSearch}
        onPaste={pasteFrame}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={dropFrame}
      >
        <Icon name="search" />
        <span>Аниме / Персонажи / Люди / Настройки / Кадр аниме</span>
        <kbd>Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="global-search-dialog"
        aria-label="Поиск по AnimeSoul"
        data-closing={closing}
        data-frame-dragging={frameDragging}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") preview.move({ x: event.clientX, y: event.clientY });
        }}
        onPointerLeave={preview.dismiss}
        onScrollCapture={preview.dismiss}
        onKeyDownCapture={preview.dismiss}
        onPointerDownCapture={(event) => {
          if (!(event.target instanceof Element && event.target.closest(".search-preview")))
            preview.dismiss();
        }}
        onPaste={pasteFrame}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setFrameDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFrameDragging(false);
        }}
        onDrop={dropFrame}
        onCancel={(event) => {
          event.preventDefault();
          closeSearch();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeSearch();
        }}
      >
        <div className="global-search-surface">
          <form
            role="search"
            className="global-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!parsed.issues.length && !incompleteFilter)
                navigate("/search?" + new URLSearchParams({ q: query.trim() }));
            }}
          >
            <Icon name={frameMode ? "image" : "search"} />
            {frameMode ? (
              <div className="search-frame-heading">Поиск аниме по кадру</div>
            ) : (
              <div className="search-input-wrap">
                {ghostSuffix && (
                  <div className="search-inline-hint" aria-hidden="true">
                    <span style={{ transform: `translateX(-${inputScroll}px)` }}>
                      <span className="search-hint-prefix">{query}</span>
                      <span className="search-hint-suffix">{ghostSuffix}</span>
                    </span>
                  </div>
                )}
                <input
                  ref={input}
                  type="text"
                  role="combobox"
                  aria-label="Поиск"
                  aria-autocomplete="both"
                  aria-expanded={open}
                  aria-controls="global-search-options"
                  aria-activedescendant={
                    active >= 0 && options[active] ? "search-option-" + active : undefined
                  }
                  aria-describedby="global-search-help global-search-frame-help"
                  placeholder="Аниме / Персонажи / Люди / Настройки / Кадр аниме"
                  maxLength={240}
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCaret(event.target.selectionStart ?? event.target.value.length);
                    setSelectionEnd(event.target.selectionEnd ?? event.target.value.length);
                    setActive(-1);
                  }}
                  onSelect={(event) => {
                    const nextCaret = event.currentTarget.selectionStart ?? query.length;
                    const nextEnd = event.currentTarget.selectionEnd ?? query.length;
                    if (nextCaret !== caret || nextEnd !== selectionEnd) setActive(-1);
                    setCaret(nextCaret);
                    setSelectionEnd(nextEnd);
                    setInputScroll(event.currentTarget.scrollLeft);
                  }}
                  onScroll={(event) => setInputScroll(event.currentTarget.scrollLeft)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onKeyDown={keyDown}
                />
              </div>
            )}
            {query && !frameMode && (
              <button
                className="search-clear"
                type="button"
                aria-label="Очистить поиск"
                title="Очистить запрос"
                onClick={() => edit("")}
              >
                <Icon name="erase" />
                <span>Очистить</span>
              </button>
            )}
            <button
              className="search-close"
              type="button"
              aria-label="Закрыть поиск"
              title="Закрыть поиск · Esc"
              onClick={closeSearch}
            >
              <Icon name="close" />
            </button>
          </form>
          <div className="search-frame-shortcut">
            <button
              type="button"
              className="outline"
              aria-pressed={!frameMode}
              onClick={() => {
                setFrameMode(false);
                setFrameFile(null);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              По названию
            </button>
            <button
              type="button"
              className="outline"
              aria-pressed={frameMode}
              onClick={() => setFrameMode(true)}
            >
              <Icon name="image" /> Поиск по кадру
            </button>
            {!frameMode && (
              <p className="search-frame-hint" id="global-search-frame-help">
                Перетащите фото или GIF сюда или вставьте из буфера · Ctrl+V
              </p>
            )}
          </div>
          {frameMode ? (
            <div className="search-frame-panel">
              {open && <FrameSearch compact initialFile={frameFile} onNavigate={closeSearch} />}
            </div>
          ) : (
            <>
              {!query.trim() && !!history.length && (
                <div className="search-recent" aria-label="История текстового поиска">
                  <div>
                    <span>История поиска</span>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setHistory([]);
                        try {
                          localStorage.removeItem(textHistoryKey);
                        } catch {
                          /* Already cleared for this session. */
                        }
                      }}
                    >
                      Очистить историю запросов
                    </button>
                  </div>
                  <div>
                    {history.map((item) => (
                      <button type="button" key={item} onClick={() => edit(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="search-filter-shortcuts" aria-label="Фильтры поиска">
                {searchFilterDefinitions.map((filter) => (
                  <button
                    type="button"
                    key={filter.key}
                    title={filter.description + " Пример: " + filter.example}
                    onClick={() =>
                      edit(query.trimEnd() + (query.trim() ? " " : "") + filter.key + ":")
                    }
                  >
                    <b>{filter.key}:</b> {filter.label}
                  </button>
                ))}
              </div>
              <div className="global-search-scroll">
                {parsed.issues.map((issue) => (
                  <p className="search-notice" role="alert" key={issue}>
                    {issue}
                  </p>
                ))}
                {current?.correction && !context && (
                  <p className="search-correction">
                    Похожие названия:{" "}
                    <button
                      type="button"
                      onClick={() => edit(completeSearchText(query, current.correction!))}
                    >
                      {current.correction}
                    </button>
                  </p>
                )}
                {error && (
                  <p className="search-notice" role="alert">
                    {error}{" "}
                    <button type="button" onClick={() => setRetry((value) => value + 1)}>
                      Повторить
                    </button>
                  </p>
                )}
                {!current && !error && (!context || completionLoading) && (
                  <p className="search-loading" role="status">
                    Ищем…
                  </p>
                )}
                {context && (
                  <p className="search-context-hint">
                    Выберите подсказку или допишите значение. <kbd>Tab</kbd> — дополнить.
                  </p>
                )}
                <div
                  id="global-search-options"
                  className="search-sections"
                  data-divided={divided}
                  data-has-anime={sections.some((section) => section.kind === "anime")}
                  role="listbox"
                  aria-label={
                    sections.length === 1 ? sections[0]?.title : "Результаты и подсказки поиска"
                  }
                  aria-busy={!current && !error}
                >
                  {sections.map((section) => (
                    <div
                      key={section.id}
                      className={"search-section search-section-" + section.id}
                      role={divided ? "group" : undefined}
                      aria-labelledby={divided ? "search-group-" + section.id : undefined}
                    >
                      {divided && (
                        <div className="search-section-heading">
                          <p id={"search-group-" + section.id}>
                            {section.title}
                            <span>
                              {options.filter((option) => option.kind === section.kind).length}
                            </span>
                          </p>
                          <small>{section.hint}</small>
                        </div>
                      )}
                      <div className="search-section-scroll">
                        {options.map(
                          (option, index) =>
                            option.kind === section.kind && (
                              <button
                                key={option.id}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                id={"search-option-" + index}
                                aria-selected={active === index}
                                aria-describedby={
                                  preview.snapshot?.option.id === option.id
                                    ? "global-search-preview"
                                    : undefined
                                }
                                className={"search-result search-" + option.kind}
                                onPointerEnter={(event) => {
                                  keyboardSelection.current = false;
                                  if (event.pointerType !== "mouse") return;
                                  setActive(index);
                                  preview.schedule({
                                    option,
                                    element: event.currentTarget,
                                    origin: { x: event.clientX, y: event.clientY },
                                  });
                                }}
                                onPointerMove={(event) => {
                                  if (event.pointerType !== "mouse") return;
                                  keyboardSelection.current = false;
                                  setActive(index);
                                  preview.move(
                                    { x: event.clientX, y: event.clientY },
                                    { option, element: event.currentTarget },
                                  );
                                }}
                                onPointerLeave={(event) => {
                                  if (
                                    !(
                                      event.relatedTarget instanceof Element &&
                                      event.relatedTarget.closest(".search-preview")
                                    )
                                  )
                                    preview.dismiss();
                                }}
                                onClick={() => choose(option)}
                              >
                                <span className="search-result-art">
                                  {option.kind === "person" ? (
                                    <ProfileImage
                                      value={option.poster ?? null}
                                      alt=""
                                      width={40}
                                      height={40}
                                      loading="lazy"
                                      fallback={<Icon name="user" />}
                                    />
                                  ) : option.poster ? (
                                    <img
                                      src={option.poster}
                                      alt=""
                                      width={40}
                                      height={58}
                                      loading="lazy"
                                    />
                                  ) : (
                                    <Icon
                                      name={
                                        option.kind === "setting"
                                          ? "settings"
                                          : option.kind === "character"
                                            ? "user"
                                            : "catalog"
                                      }
                                    />
                                  )}
                                </span>
                                <span className="search-result-copy">
                                  <strong>{option.label}</strong>
                                  <small>{option.detail}</small>
                                  {option.anime && <SearchAnimeProgress anime={option.anime} />}
                                </span>
                                {option.badge && (
                                  <span className="search-result-badge">{option.badge}</span>
                                )}
                                <span className="search-result-action" aria-hidden="true">
                                  {option.href ? "↗" : "Tab"}
                                </span>
                              </button>
                            ),
                        )}
                        {!options.some((option) => option.kind === section.kind) && (
                          <p className="search-section-empty">
                            {section.kind === "filter" && completionLoading
                              ? "Загружаем подсказки…"
                              : !current && !error && section.kind !== "setting" && !context
                                ? "Ищем…"
                                : "Совпадений пока нет."}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {!sections.length && current && !error && !parsed.issues.length && (
                    <p className="search-empty" role="status">
                      Ничего не найдено. Попробуйте другое название, имя, ник или настройку.
                    </p>
                  )}
                </div>
              </div>
              <footer className="global-search-footer" id="global-search-help">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> выбор <kbd>Tab</kbd> дополнить <kbd>Enter</kbd> открыть
                </span>
                <button
                  type="button"
                  disabled={!!parsed.issues.length || incompleteFilter}
                  onClick={() => navigate("/search?" + new URLSearchParams({ q: query.trim() }))}
                >
                  Открыть результаты →
                </button>
              </footer>
            </>
          )}
        </div>
        {preview.snapshot && (
          <SearchPreview
            key={preview.snapshot.option.id}
            snapshot={preview.snapshot}
            onChoose={choose}
          />
        )}
      </dialog>
    </>
  );
}
