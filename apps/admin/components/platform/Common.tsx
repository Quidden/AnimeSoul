"use client";
import { useEffect, useRef, useState } from "react";

/** Keep review and confirmation inside the application, with native focus trapping. */
export function useConfirmation() {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{
    message: string;
    resolve: (value: boolean) => void;
  } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const element = ref.current;
    if (element && !element.open) element.showModal();
    return () => {
      pending.resolve(false);
      element?.close();
    };
  }, [pending]);
  function choose(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }
  const ask = (message: string) =>
    new Promise<boolean>((resolve) => setPending({ message, resolve }));
  const confirmation = pending ? (
    <dialog
      ref={ref}
      className="admin-confirm"
      aria-labelledby="admin-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        choose(false);
      }}
    >
      <h2 id="admin-confirm-title">Подтвердите изменение</h2>
      <p>{pending.message}</p>
      <div className="toolbar">
        <button type="button" autoFocus onClick={() => choose(false)}>
          Отмена
        </button>
        <button type="button" className="primary" onClick={() => choose(true)}>
          Подтвердить
        </button>
      </div>
    </dialog>
  ) : null;
  return { ask, confirmation };
}
export function Loading({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  return (
    <>
      {loading && (
        <p role="status" className="muted">
          Загружаем…
        </p>
      )}
      {error && (
        <p role="alert" className="notice">
          {error} <button onClick={reload}>Повторить</button>
        </p>
      )}
    </>
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} из ${total}`
          : "Нет записей"}
      </span>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ←
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / pageSize))}
      </span>
      <button disabled={page * pageSize >= total} onClick={() => onChange(page + 1)}>
        →
      </button>
    </div>
  );
}
export function Notice({ text }: { text: string }) {
  return text ? (
    <p className="notice" role="status">
      {text}
    </p>
  ) : null;
}
