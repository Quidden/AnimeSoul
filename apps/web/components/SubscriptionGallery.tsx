"use client";
import { useEffect, useRef, useState } from "react";
const shots = [
  {
    id: "navigation",
    title: "Серии и озвучки рядом",
    text: "Меню поверх видео: выбирай серию, сезон и любимую озвучку, сохраняя контекст просмотра.",
    alt: "Полный плеер AnimeSoul с открытым меню сезона, серии и озвучки",
  },
  {
    id: "quality",
    title: "Качество под твоё соединение",
    text: "Меняй доступное качество, сохраняя текущий момент и состояние воспроизведения.",
    alt: "Полный плеер с выбором качества 720p и 360p",
  },
  {
    id: "speed",
    title: "Твой темп просмотра",
    text: "Настраивай скорость прямо в плеере, не открывая отдельную страницу.",
    alt: "Полный плеер AnimeSoul со списком скоростей воспроизведения",
  },
  {
    id: "image",
    title: "Кадр целиком и Anime4K",
    text: "Выбирай отображение без обрезки или заполнение экрана. В совместимом браузере можно включить Anime4K.",
    alt: "Полный плеер с настройками отображения видео и апскейла Anime4K",
  },
  {
    id: "resume",
    title: "Продолжение без лишних действий",
    text: "В аккаунте сохраняются серия и таймкод. Настройки продолжения и автозапуска можно менять отдельно.",
    alt: "Полный плеер с настройками сохранённого момента и автоматического продолжения",
  },
  {
    id: "fullscreen",
    title: "Больше места для истории",
    text: "Разверни видео на весь экран. Навигация и настройки остаются под рукой.",
    alt: "Плеер AnimeSoul в полноэкранном режиме с доступными элементами управления",
  },
];
export function SubscriptionGallery() {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = selected !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (selected !== null && !node.open) node.showModal();
    else if (selected === null && node.open) node.close();
  }, [selected]);
  const shot = selected === null ? null : shots[selected];
  return (
    <section className="subscription-gallery" aria-labelledby="subscription-gallery-title">
      <h3 id="subscription-gallery-title">Посмотри, как это работает</h3>
      <p className="subscription-gallery-intro">
        Настоящий интерфейс плеера. Нажми на снимок, чтобы рассмотреть детали.
      </p>
      <div className="subscription-features">
        {shots.map((item, index) => (
          <figure key={item.id}>
            <button
              className="subscription-shot"
              aria-label={`Увеличить: ${item.title}`}
              onClick={() => setSelected(index)}
            >
              <img
                src={`/images/player-preview/${item.id}-full.jpg`}
                alt={item.alt}
                width="1280"
                height="720"
                loading="lazy"
              />
              <span>Рассмотреть скриншот</span>
            </button>
            <figcaption>
              <h4>{item.title}</h4>
              <p>{item.text}</p>
            </figcaption>
          </figure>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="subscription-lightbox"
        aria-label={shot?.title ?? "Скриншоты плеера"}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelected(null);
        }}
        onClose={(event) => {
          event.stopPropagation();
          setSelected(null);
        }}
        onKeyDown={(event) => {
          if (selected === null || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          setSelected(
            (selected + (event.key === "ArrowRight" ? 1 : shots.length - 1)) % shots.length,
          );
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
      >
        {shot && (
          <>
            <div className="subscription-lightbox-heading">
              <strong>{shot.title}</strong>
              <button
                className="outline"
                aria-label="Закрыть скриншот"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <img
              src={`/images/player-preview/${shot.id}-full.jpg`}
              alt={shot.alt}
              width="1280"
              height="720"
            />
            <a
              className="subscription-lightbox-original"
              href={`/images/player-preview/${shot.id}-full.jpg`}
              target="_blank"
              rel="noopener"
            >
              Открыть в полном размере
            </a>
            <div className="subscription-lightbox-footer">
              <button
                className="outline"
                onClick={() => setSelected((selected! + shots.length - 1) % shots.length)}
              >
                Назад
              </button>
              <span>
                {selected! + 1} / {shots.length}
              </span>
              <button
                className="outline"
                onClick={() => setSelected((selected! + 1) % shots.length)}
              >
                Далее
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
