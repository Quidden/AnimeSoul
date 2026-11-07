"use client";
import { useEffect, useId, useRef, useState } from "react";
import { RailControls } from "./RailControls";
import { useRailNavigation } from "./useRailNavigation";

// With a `limit`, only that many frames are tiles; the last one shows how many more open in the
// lightbox, which still steps through every frame.
export function AnimeScreenshots({
  images,
  title,
  limit,
}: {
  images: string[];
  title: string;
  limit?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = limit ? images.slice(0, limit) : images;
  const carousel = useRailNavigation(track, "img", shown.length);
  function scrollFrames(direction: number) {
    const element = track.current;
    element?.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  useEffect(() => {
    if (selected === null) return;
    const modal = dialog.current;
    if (!modal) return;
    if (!modal.open) modal.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selected]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      dialog.current?.close();
    },
    [],
  );
  function close() {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(
      () => {
        dialog.current?.close();
        setSelected(null);
        setClosing(false);
        timer.current = null;
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
  }
  function next(offset: number) {
    setSelected((index) => ((index ?? 0) + offset + images.length) % images.length);
  }
  if (!images.length) return null;
  return (
    <section
      className="anime-media anime-screenshots"
      id="anime-screenshots"
      aria-label="Кадры из аниме"
    >
      <div className="rail-shell">
        <div
          id={id}
          ref={track}
          className={`anime-screenshot-track${carousel.enabled ? " carousel" : ""}`}
          role="group"
          aria-label="Карусель кадров"
          tabIndex={carousel.enabled ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (carousel.enabled && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
              event.preventDefault();
              scrollFrames(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          {shown.map((src, i) => {
            const more = i === shown.length - 1 ? images.length - shown.length : 0;
            return (
              <button
                type="button"
                key={src}
                className={more ? "has-more" : undefined}
                aria-label={more ? `Все кадры: ${images.length}` : `Увеличить кадр ${i + 1}`}
                onClick={() => setSelected(i)}
              >
                <img
                  src={src}
                  alt={`Кадр ${i + 1}: ${title}`}
                  width={480}
                  height={270}
                  loading="lazy"
                />
                {more ? (
                  <strong className="anime-screenshot-more" aria-hidden="true">
                    +{more}
                  </strong>
                ) : (
                  <span aria-hidden="true">↗</span>
                )}
              </button>
            );
          })}
        </div>
        {carousel.enabled && (
          <RailControls
            id={id}
            label="Кадры из аниме"
            center={carousel.center}
            previous={carousel.previous}
            next={carousel.next}
            onPrevious={() => scrollFrames(-1)}
            onNext={() => scrollFrames(1)}
          />
        )}
      </div>
      <dialog
        ref={dialog}
        className={`anime-lightbox${closing ? " closing" : ""}`}
        aria-label={`Кадры: ${title}`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            next(1);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            next(-1);
          }
        }}
      >
        {selected !== null && (
          <div className="anime-lightbox-content">
            <div className="anime-lightbox-toolbar">
              <span>
                Кадр {selected + 1} / {images.length}
              </span>
              <button className="outline" aria-label="Закрыть кадр" onClick={close}>
                Esc ×
              </button>
            </div>
            <img src={images[selected]} alt={`Кадр ${selected + 1}: ${title}`} />
            {images.length > 1 && (
              <div className="anime-lightbox-arrows">
                <button className="outline" aria-label="Предыдущий кадр" onClick={() => next(-1)}>
                  ←
                </button>
                <button className="outline" aria-label="Следующий кадр" onClick={() => next(1)}>
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
