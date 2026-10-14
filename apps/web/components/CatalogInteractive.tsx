"use client";
import Link from "next/link";
import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { catalogQuerySchema, type CatalogQuery } from "@animesoul/contracts";
import { catalogParameters } from "../lib/catalog-filters";
import { RailControls } from "./RailControls";
import { useSteppedRail } from "./useSteppedRail";

export function CatalogFilterDrawer({ children, count }: { children: ReactNode; count: number }) {
  const [mobile, setMobile] = useState(false),
    [open, setOpen] = useState(true);
  const panel = useRef<HTMLDetailsElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width:900px)");
    const update = () => {
      setMobile(media.matches);
      setOpen(!media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile || !open) return;
    const before = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>(
        "button, input, select, a[href], summary",
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      before?.focus();
    };
  }, [mobile, open]);
  return (
    <>
      {mobile && !open && (
        <button
          className="catalog-filter-fab"
          type="button"
          ref={trigger}
          aria-expanded={false}
          aria-controls="catalog-filter-panel"
          onClick={() => setOpen(true)}
        >
          Фильтры{count ? ` · ${count}` : ""}
        </button>
      )}
      {mobile && open && (
        <button
          className="catalog-filter-backdrop"
          type="button"
          aria-label="Закрыть фильтры"
          onClick={() => setOpen(false)}
        />
      )}
      <details
        ref={panel}
        id="catalog-filter-panel"
        className={`catalog-filter-drawer${mobile ? " is-mobile" : ""}`}
        open={open}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label="Фильтры каталога"
        tabIndex={-1}
        onToggle={(e) => {
          if (mobile) setOpen(e.currentTarget.open);
        }}
        onSubmitCapture={() => {
          if (mobile) setOpen(false);
        }}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            if (mobile) setOpen(false);
          }}
        >
          Фильтры каталога {count ? `· ${count}` : ""}
        </summary>
        {mobile && (
          <button type="button" className="catalog-filter-close" onClick={() => setOpen(false)}>
            Закрыть
          </button>
        )}
        {children}
      </details>
    </>
  );
}

export function CatalogShelf({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const navigation = useSteppedRail(track, ".poster", Children.count(children));
  return (
    <section className="catalog-shelf" aria-label={title}>
      <div className="catalog-shelf-heading">
        <h2>
          <Link href={href}>{title}</Link>
        </h2>
        <div>
          <Link href={href} className="text-link">
            Смотреть все →
          </Link>
        </div>
      </div>
      <div className="rail-shell">
        <div
          id={id}
          className="catalog-shelf-track"
          ref={track}
          role="group"
          aria-label={`${title}: горизонтальная лента`}
          tabIndex={navigation.enabled ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || !navigation.enabled) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              navigation.move(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          {children}
        </div>
        {navigation.enabled && (
          <RailControls
            id={id}
            label={title}
            center={navigation.center}
            previous={navigation.previous}
            next={navigation.next}
            onPrevious={() => navigation.move(-1)}
            onNext={() => navigation.move(1)}
          />
        )}
      </div>
    </section>
  );
}
export function RandomPicker({ filters }: { filters: CatalogQuery }) {
  const router = useRouter(),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  async function pick(mode: string) {
    setBusy(mode);
    setNotice("");
    try {
      const form = document.querySelector<HTMLFormElement>("[data-catalog-filters]");
      const selected =
        mode === "all" || !form
          ? filters
          : catalogQuerySchema.safeParse({
              ...filters,
              ...Object.fromEntries(new FormData(form)),
              page: 1,
            });
      if ("success" in selected && !selected.success)
        throw new Error("Проверьте фильтры: начальный год не должен быть позже конечного.");
      const query = "success" in selected ? selected.data : selected;
      const params =
        mode === "all" ? new URLSearchParams() : catalogParameters({ ...query, page: 1 });
      params.set("mode", mode);
      const response = await fetch("/api/catalog/random?" + params, { cache: "no-store" });
      if (response.status === 401)
        throw new Error("Войдите в аккаунт, чтобы использовать свои просмотры и оценки.");
      if (response.status === 404)
        throw new Error(
          mode === "taste"
            ? "Пока нет подходящих непросмотренных аниме. Посмотрите несколько серий или расширьте фильтры."
            : "С этими фильтрами аниме не найдено. Попробуйте расширить выбор.",
        );
      if (!response.ok) throw new Error("Не удалось выбрать аниме. Попробуйте ещё раз.");
      const result = (await response.json()) as { slug?: string };
      if (!result.slug || !/^[a-z0-9-]+$/.test(result.slug))
        throw new Error("Не удалось выбрать аниме.");
      router.push("/anime/" + result.slug);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось выбрать аниме.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="catalog-random">
      <div className="catalog-random-actions">
        <button
          className="primary"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void pick("all")}
        >
          ⚄ {busy === "all" ? "Выбираем…" : "Случайное аниме"}
        </button>
        <button
          className="outline"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void pick("filtered")}
        >
          {busy === "filtered" ? "Выбираем…" : "По фильтрам"}
        </button>
        <button
          className="outline"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void pick("taste")}
        >
          {busy === "taste" ? "Выбираем…" : "Случайное для меня"}
        </button>
      </div>
      <p>Из всего каталога, по выбранным фильтрам или по жанрам, которые вы чаще смотрите.</p>
      {notice && (
        <p role="status" className="catalog-feedback">
          {notice}
        </p>
      )}
    </div>
  );
}
