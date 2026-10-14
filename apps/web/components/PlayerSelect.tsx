"use client";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  Fragment,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
export type PlayerOption = {
  value: string;
  label: string;
  color?: string;
  favorite?: boolean;
  group?: string;
};
export function PlayerSelect({
  label,
  ariaLabel = label,
  value,
  options,
  onChange,
  onFavorite,
  onOpen,
  compact = false,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  options: PlayerOption[];
  onChange: (value: string) => void;
  onFavorite?: ((value: string, enabled: boolean) => void) | undefined;
  onOpen?: (() => void) | undefined;
  compact?: boolean;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const typeahead = useRef({ value: "", at: 0 });
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    const panel = trigger.current?.closest<HTMLElement>(
      ".animesoul-player-quick-picker, .animesoul-player-settings",
    );
    setHost(
      panel && getComputedStyle(panel).position === "fixed"
        ? ((document.fullscreenElement as HTMLElement | null) ?? document.body)
        : (trigger.current?.closest<HTMLElement>(".animesoul-player") ?? document.body),
    );
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
    onOpen?.();
  }
  useEffect(() => {
    if (!open) return;
    const root = trigger.current?.closest(".animesoul-player");
    root?.dispatchEvent(new CustomEvent("animesoul:player-menu", { detail: { id, open: true } }));
    return () => {
      root?.dispatchEvent(
        new CustomEvent("animesoul:player-menu", { detail: { id, open: false } }),
      );
    };
  }, [open, id]);
  useLayoutEffect(() => {
    if (!open || !host) return;
    const local = host.classList.contains("animesoul-player");
    let down: boolean | undefined;
    const position = () => {
      const button = trigger.current,
        list = popup.current;
      if (!button || !list) return;
      const bounds = button.getBoundingClientRect();
      const chrome = document.fullscreenElement
        ? null
        : document.querySelector<HTMLElement>(".site-navigation-glass");
      const visibleTop = chrome?.getBoundingClientRect().bottom ?? 0;
      const owner = button
        .closest(".animesoul-player-settings-content, .animesoul-player-quick-picker")
        ?.getBoundingClientRect();
      if (owner && (bounds.bottom <= owner.top || bounds.top >= owner.bottom)) {
        setOpen(false);
        return;
      }
      const frame = local ? host.getBoundingClientRect() : null;
      // Outside the viewport, let the anchored list travel with its trigger.
      // Scrolling the page is not a request to dismiss an open menu.
      if (local && (bounds.bottom <= visibleTop || bounds.top >= window.innerHeight)) return;
      const scaleX = frame && host.clientWidth ? frame.width / host.clientWidth : 1;
      const scaleY = frame && host.clientHeight ? frame.height / host.clientHeight : 1;
      const left = (bounds.left - (frame?.left ?? 0)) / scaleX;
      const top = (bounds.top - (frame?.top ?? 0)) / scaleY;
      const bottom = (bounds.bottom - (frame?.top ?? 0)) / scaleY;
      const spaceBelow =
        (Math.min(frame?.bottom ?? window.innerHeight, window.innerHeight) - bounds.bottom) /
          scaleY -
        12;
      const spaceAbove = (bounds.top - Math.max(frame?.top ?? 0, visibleTop)) / scaleY - 12;
      down ??= spaceBelow >= Math.min(280, options.length * 42) || spaceBelow >= spaceAbove;
      if ((down ? spaceBelow : spaceAbove) < 80 && (down ? spaceAbove : spaceBelow) > 80)
        down = !down;
      const availableWidth = local ? host.clientWidth : document.documentElement.clientWidth;
      const width = Math.min(
        Math.max(bounds.width / scaleX, compact ? 190 : 240),
        availableWidth - 24,
      );
      // The portal shares the player's coordinate system, so page scrolling
      // and carousel transforms move the trigger and popup together.
      Object.assign(list.style, {
        position: local ? "absolute" : "fixed",
        left: `${Math.max(12, Math.min(left, availableWidth - width - 12))}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(40, Math.min(300, down ? spaceBelow : spaceAbove))}px`,
        top: down ? `${bottom + 6}px` : "auto",
        bottom: down ? "auto" : `${(local ? host.clientHeight : window.innerHeight) - top + 6}px`,
      });
    };
    position();
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) position();
    };
    const resized = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resized);
    const observer = new ResizeObserver(position);
    observer.observe(host);
    if (trigger.current) observer.observe(trigger.current);
    const chrome = document.querySelector(".site-navigation-glass");
    if (chrome && !document.fullscreenElement) observer.observe(chrome);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resized);
      observer.disconnect();
    };
  }, [open, host, options.length, compact]);
  useLayoutEffect(() => {
    if (!open) return;
    const list = popup.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !option) return;
    // Scroll the list alone: scrollIntoView can also move the anime page.
    const bounds = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [active, open]);
  function keyboard(event: KeyboardEvent) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) show();
      else
        setActive(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : Math.max(
                  0,
                  Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)),
                ),
        );
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      event.stopPropagation();
      if (options[active]) onChange(options[active].value);
      close();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
      const now = Date.now();
      typeahead.current = {
        value:
          (now - typeahead.current.at < 700 ? typeahead.current.value : "") +
          event.key.toLocaleLowerCase("ru"),
        at: now,
      };
      const next = options.findIndex((option) =>
        option.label.toLocaleLowerCase("ru").startsWith(typeahead.current.value),
      );
      if (next >= 0) {
        if (!open) show();
        setActive(next);
        event.preventDefault();
      }
    }
  }
  return (
    <div className={`player-select${compact ? " compact" : ""}`}>
      {!compact && <span className="player-select-label">{label}</span>}
      <button
        ref={trigger}
        type="button"
        className="player-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onKeyDown={keyboard}
        onClick={() => (open ? close() : show())}
      >
        <span>{options.find((option) => option.value === value)?.label ?? label}</span>
        <i aria-hidden="true">⌄</i>
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={popup}
            id={id}
            className="player-select-popup"
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
          >
            {options.length ? (
              options.map((option, index) => (
                <Fragment key={option.value}>
                  {option.group && option.group !== options[index - 1]?.group && (
                    <div className="player-select-group-label" role="presentation">
                      {option.group}
                    </div>
                  )}
                  <div className="player-select-option-row" role="presentation">
                    <button
                      id={`${id}-${index}`}
                      data-index={index}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      className={active === index ? "highlighted" : ""}
                      onPointerMove={() => setActive(index)}
                      onClick={() => {
                        onChange(option.value);
                        close();
                      }}
                    >
                      {option.color && (
                        <b className="player-option-dot" style={{ background: option.color }} />
                      )}
                      <span>{option.label}</span>
                      <i aria-hidden="true">{option.value === value ? "✓" : ""}</i>
                    </button>
                    {onFavorite && (
                      <button
                        type="button"
                        className={`player-dubbing-star${option.favorite ? " selected" : ""}`}
                        aria-label={`${option.favorite ? "Убрать из избранных озвучек" : "Добавить в избранные озвучки"}: ${option.label}`}
                        aria-pressed={Boolean(option.favorite)}
                        onClick={() => onFavorite(option.value, !option.favorite)}
                      >
                        {option.favorite ? "★" : "☆"}
                      </button>
                    )}
                  </div>
                </Fragment>
              ))
            ) : (
              <p className="player-select-empty">Включите типы частей ниже.</p>
            )}
          </div>,
          host,
        )}
    </div>
  );
}
