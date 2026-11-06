"use client";
import { useEffect, useRef } from "react";
import { PlayerDemoPair } from "./PlayerDemoPair";

// What the AnimeSoul player adds, in the words of the subscription page.
const benefits = [
  ["Серии и озвучки рядом", "Меню поверх видео, без потери контекста."],
  ["Качество без потери момента", "Смена качества и скорости не сбивает просмотр."],
  ["Кадр целиком и Anime4K", "Отображение без обрезки и апскейл."],
  ["Продолжение без действий", "Серия и таймкод сохраняются в аккаунте."],
] as const;

// Shown in place of the player when someone without access picks the AnimeSoul player:
// the same short clip in a plain player and in ours, so the difference can be seen and tried.
export function PlayerComparison({ onTrial, onStay }: { onTrial: () => void; onStay: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div
      className="player-comparison"
      role="region"
      aria-labelledby="player-comparison-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onStay();
      }}
    >
      <div className="player-comparison-head">
        <span className="player-plus-tag">PLUS</span>
        <h3 id="player-comparison-title" ref={heading} tabIndex={-1}>
          Один и тот же фрагмент, два плеера
        </h3>
        <p>Слева обычное воспроизведение, справа плеер AnimeSoul. Попробуйте меню справа.</p>
      </div>
      <PlayerDemoPair />
      <ul className="player-comparison-list">
        {benefits.map(([title, text]) => (
          <li key={title}>
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="player-comparison-actions">
        <button className="primary" type="button" onClick={onTrial}>
          Попробовать 7 дней бесплатно
        </button>
        <button className="outline" type="button" onClick={onStay}>
          Смотреть в Kodik
        </button>
        <small>Для новых аккаунтов. Затем −50% на первый месяц подписки.</small>
      </div>
    </div>
  );
}
