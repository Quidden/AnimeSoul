"use client";
import { useEffect, useId, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  contentDocument,
  contentMention,
  contentMentionRange,
  contentReference,
  normalizeContentHref,
  serializeContentDocument,
  type ContentMention,
} from "../lib/content-links";
import {
  ContentReferencePicker,
  type ContentEditorContext,
  type ContentReference,
} from "./ContentReferencePicker";
import { useContentSearch, type ContentSuggestion } from "./useContentSearch";

type MentionPosition = { mention: ContentMention; paragraph: string; blockStart: number };
type PickerState = {
  range: { from: number; to: number };
  anime?: ContentSuggestion;
  episodeMode: boolean;
};

export function ContentEditor({
  label,
  defaultValue = "",
  placeholder,
  maxLength,
  disabled = false,
  context = {},
  onReady,
}: {
  label: string;
  defaultValue?: string;
  placeholder: string;
  maxLength: number;
  disabled?: boolean;
  context?: ContentEditorContext;
  onReady?: (ready: boolean) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const bodyField = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const keyboard = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const composing = useRef(false);
  const [body, setBody] = useState(defaultValue);
  const [position, setPosition] = useState<MentionPosition | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [active, setActive] = useState(-1);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [notice, setNotice] = useState("");
  const signature = position
    ? `${position.blockStart}:${position.mention.caret}:${position.mention.query}`
    : "";
  const searchEnabled = focused && !disabled && !picker && !!position && dismissed !== signature;
  const search = useContentSearch(position?.mention.query ?? "", searchEnabled);
  function syncMention(value: Editor) {
    const { selection } = value.state;
    if (
      !selection.empty ||
      !selection.$from.parent.isTextblock ||
      composing.current ||
      selection.$from.marks().some((mark) => mark.type.name === "link")
    ) {
      setPosition(null);
      return;
    }
    const paragraph = selection.$from.parent.textContent;
    const mention = contentMention(paragraph, selection.$from.parentOffset);
    setPosition(mention ? { mention, paragraph, blockStart: selection.$from.start() } : null);
  }
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: contentDocument(
      defaultValue,
      typeof window === "undefined" ? undefined : window.location.origin,
    ),
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        underline: false,
        trailingNode: false,
        dropcursor: false,
        gapcursor: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          HTMLAttributes: { class: "content-reference", target: null, rel: null },
          isAllowedUri: (href) =>
            Boolean(
              normalizeContentHref(
                href,
                typeof window === "undefined" ? undefined : window.location.origin,
              ),
            ),
        },
      }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        "aria-autocomplete": "list",
        "aria-controls": id + "-suggestions",
        "aria-describedby": id + "-help",
        "data-placeholder": placeholder,
        class: "content-editor-input",
      },
      handleKeyDown: (_view, event) => keyboard.current?.(event) ?? false,
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true;
          setPosition(null);
          return false;
        },
        compositionend: () => {
          composing.current = false;
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !editorRef.current) return false;
        event.preventDefault();
        editorRef.current.commands.insertContent(
          contentDocument(text, window.location.origin).content ?? [],
        );
        return true;
      },
    },
    onUpdate: ({ editor: value }) => {
      setBody(serializeContentDocument(value.getJSON(), window.location.origin));
      setNotice("");
      syncMention(value);
    },
    onSelectionUpdate: ({ editor: value }) => syncMention(value),
    onFocus: ({ editor: value }) => {
      setFocused(true);
      syncMention(value);
    },
    onBlur: () => setFocused(false),
  });
  editorRef.current = editor;
  useEffect(() => {
    onReady?.(Boolean(editor));
    return () => onReady?.(false);
  }, [editor, onReady]);
  useEffect(() => {
    editor?.setEditable(!disabled && !picker);
  }, [editor, disabled, picker]);
  useEffect(() => {
    setActive(-1);
  }, [signature]);
  useEffect(() => {
    if (!editor) return;
    if (searchEnabled && active >= 0 && search.items[active])
      editor.view.dom.setAttribute("aria-activedescendant", id + "-suggestion-" + active);
    else editor.view.dom.removeAttribute("aria-activedescendant");
  }, [editor, active, searchEnabled, search.items, id]);
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form || !editor) return;
    const reset = () => {
      editor.commands.setContent(contentDocument(defaultValue, window.location.origin));
      setPicker(null);
      setPosition(null);
      setNotice("");
    };
    const validate = (event: Event) => {
      const value = serializeContentDocument(editor.getJSON(), window.location.origin);
      if (bodyField.current) bodyField.current.value = value;
      if (value.trim().length >= 2 && value.trim().length <= maxLength) return;
      event.preventDefault();
      event.stopPropagation();
      setNotice(
        value.trim().length < 2
          ? "Введите хотя бы два символа текста."
          : `Текст со ссылками должен быть не длиннее ${maxLength} символов.`,
      );
      editor.commands.focus();
    };
    form.addEventListener("reset", reset);
    form.addEventListener("submit", validate, true);
    return () => {
      form.removeEventListener("reset", reset);
      form.removeEventListener("submit", validate, true);
    };
  }, [editor, defaultValue, maxLength]);
  function insert(reference: ContentReference, range: { from: number; to: number }) {
    if (!editor || disabled) return;
    const replaced = editor.state.doc.textBetween(range.from, range.to, "\n");
    const length =
      serializeContentDocument(editor.getJSON(), window.location.origin).length -
      replaced.length +
      contentReference(reference.label, reference.href).length +
      1;
    if (length > maxLength) {
      setNotice("Ссылка не помещается. Сократите текст перед вставкой.");
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: "text",
          text: reference.label,
          marks: [{ type: "link", attrs: { href: reference.href } }],
        },
        { type: "text", text: " ", marks: [] },
      ])
      .unsetLink()
      .run();
    setPicker(null);
    setPosition(null);
    setDismissed(signature);
    setNotice("");
  }
  function choose(item: ContentSuggestion) {
    if (!position || !editor) return;
    const local = contentMentionRange(position.paragraph, position.mention, item.names);
    const range = { from: position.blockStart + local.from, to: position.blockStart + local.to };
    setDismissed(signature);
    if (item.kind === "character")
      insert({ label: item.title, href: `/characters/${item.slug}`, kind: "character" }, range);
    else setPicker({ range, anime: item, episodeMode: false });
  }
  keyboard.current = (event) => {
    if (
      !searchEnabled ||
      !search.items.length ||
      event.isComposing ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return false;
    if (event.key === "Escape") {
      setDismissed(signature);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setActive((old) =>
        old < 0
          ? event.key === "ArrowDown"
            ? 0
            : search.items.length - 1
          : (old + (event.key === "ArrowDown" ? 1 : -1) + search.items.length) %
            search.items.length,
      );
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && active >= 0) {
      const item = search.items[active];
      if (item) choose(item);
      return true;
    }
    return false;
  };
  const currentAnime: ContentSuggestion | undefined = context.anime
    ? { ...context.anime, kind: "anime", names: [context.anime.title], image: null }
    : undefined;
  function openPicker(episodeMode: boolean) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setPicker({
      range: { from, to },
      episodeMode,
      ...(episodeMode && currentAnime ? { anime: currentAnime } : {}),
    });
    setDismissed(signature);
  }
  return (
    <div ref={root} className={"content-editor" + (!body ? " content-editor-empty" : "")}>
      <span className="content-editor-label">{label}</span>
      <input ref={bodyField} type="hidden" name="body" value={body} />
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="content-editor-loading" role="status">
          Загружаем редактор…
        </div>
      )}
      <div className="content-editor-toolbar">
        <button
          type="button"
          className="outline"
          disabled={disabled || !editor}
          onClick={() => openPicker(false)}
        >
          Добавить ссылку
        </button>
        {currentAnime && (
          <button
            type="button"
            className="outline"
            disabled={disabled || !editor}
            onClick={() => openPicker(true)}
          >
            Серия и таймкод
          </button>
        )}
      </div>
      <p id={id + "-help"} className="content-editor-help">
        Введите название аниме или имя персонажа, чтобы выбрать ссылку. Можно также начать с @.
      </p>
      {searchEnabled && (search.items.length > 0 || search.loading || search.error) && (
        <div className="content-suggestions">
          {search.loading && <p role="status">Ищем ссылки…</p>}
          {search.error && <p role="status">{search.error}</p>}
          {!!search.items.length && (
            <>
              <p className="content-suggestions-caption">
                Добавить ссылку <span>↑ ↓ выбрать · Enter подтвердить</span>
              </p>
              <div id={id + "-suggestions"} role="listbox" aria-label="Аниме и персонажи">
                {search.items.map((item, index) => (
                  <button
                    key={item.kind + item.id}
                    id={id + "-suggestion-" + index}
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    {item.image && <img src={item.image} alt="" width={30} height={38} />}
                    <span>{item.title}</span>
                    <small>{item.kind === "anime" ? "Аниме" : "Персонаж"}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {picker && (
        <ContentReferencePicker
          initialAnime={picker.anime}
          initialEpisodeId={context.episodeId}
          episodeMode={picker.episodeMode}
          disabled={disabled}
          onClose={() => {
            setPicker(null);
            editor?.commands.focus();
          }}
          onSelect={(reference) => insert(reference, picker.range)}
        />
      )}
      {notice && (
        <p className="content-editor-notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}
