"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="content empty-state">
      <h1>Не удалось загрузить страницу</h1>
      <p>Сервис временно недоступен. Попробуйте ещё раз.</p>
      <button className="button" onClick={reset}>
        Повторить
      </button>
    </div>
  );
}
