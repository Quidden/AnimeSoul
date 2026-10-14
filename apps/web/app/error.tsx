"use client";
import { useEffect } from "react";
import { reportClientError } from "../lib/diagnostics-client";
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return (
    <div className="content empty-state">
      <h1>Не удалось загрузить страницу</h1>
      <p>Сервис временно недоступен. Попробуйте ещё раз.</p>
      {error.digest && <p>Код ошибки: {error.digest}</p>}
      <button className="button" onClick={retry}>
        Повторить
      </button>
    </div>
  );
}
