"use client";
import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "../../../lib/diagnostics-client";
export default function ProfileError({
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
    <div className="user-profile-page">
      <div className="profile-main profile-route-state">
        <h1>Не удалось загрузить профиль</h1>
        <p>Сервис временно недоступен. Повторите загрузку.</p>
        <div className="profile-state-actions">
          <button type="button" className="primary" onClick={retry}>
            Повторить
          </button>
          <Link className="outline" href="/">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
